import { negativeZero } from "./flags.ts";
import type { ArithmeticWidth, AdditionResult, SubtractionResult } from "./alu.ts";
import type { ByteMemory } from "./memory-access.ts";
import type { WordInstructionContext } from "./instruction-context.ts";
import { opcodePattern } from "./opcodes.ts";
import type { OpcodeEntry } from "./opcodes.ts";

interface ConditionCodes { n: boolean; z: boolean; v: boolean; c: boolean }
type Condition = (flags: Readonly<ConditionCodes>) => boolean;

// Motorola condition pairs: ttt selects a test, p selects that test or its inverse.
// The 6800 omits BRN; the 68000 gives condition 0001 a BSR meaning only in its branch family.
export const motorolaConditionPairs: readonly Condition[] = [
  () => true,                    // 000: T / F (BRA / BRN)
  ({ c, z }) => !c && !z,         // 001: HI / LS
  ({ c }) => !c,                 // 010: CC (HS) / CS (LO)
  ({ z }) => !z,                 // 011: NE / EQ
  ({ v }) => !v,                 // 100: VC / VS
  ({ n }) => !n,                 // 101: PL / MI
  ({ n, v }) => n === v,         // 110: GE / LT
  ({ n, v, z }) => !z && n === v, // 111: GT / LE
];
export const motorolaConditions: readonly Condition[] = motorolaConditionPairs.flatMap(test => [test, flags => !test(flags)]);

// 0010 ttt p: ttt selects T/HI/CC/NE/VC/PL/GE/GT; p selects the test or its inverse.
export const motorolaBranchNames = ["bra", "brn", "bhi", "bls", "bcc", "bcs", "bne", "beq",
  "bvc", "bvs", "bpl", "bmi", "bge", "blt", "bgt", "ble"] as const;

// 6809 TFR/EXG postbyte ssss dddd: 0000..0101 = D/X/Y/U/S/PC; 1000..1011 = A/B/CC/DP.
// Only same-width pairs are defined. This inventory drives both generated bodies and decoder bindings.
export const motorola6809TransferForms = ([
  { base: 0b0000, registers: ["d", "x", "y", "u", "s", "pc"] },
  { base: 0b1000, registers: ["a", "b", "cc", "dp"] },
] as const).flatMap(({ base, registers }) => registers.flatMap((source, s) => registers.map((target, d) =>
  [(base + s) << 4 | (base + d), { source, target }] as const)));

/** Ordinary Motorola arithmetic changes NZVC; callers separately schedule H, X, and writeback. */
export function motorolaArithmeticFlags(width: ArithmeticWidth, facts: AdditionResult | SubtractionResult) {
  return { ...negativeZero(width, facts.result), v: facts.overflow,
    c: "carry" in facts ? facts.carry : facts.borrow };
}

type UnaryName = "neg" | "com" | "lsr" | "ror" | "asr" | "asl" | "rol" | "dec" | "inc" | "tst" | "clr";
type UnaryBodies<State> = Readonly<Record<`${UnaryName}${"A" | "B"}`, (state: State) => void>
  & Record<`${UnaryName}Memory`, (state: State, address: number, instruction: ByteMemory) => void>>;

/** Bind generated unary bodies to the shared oooo selector; CPUs supply the addressing prefixes. */
export function motorolaUnaryOperations<State>(bodies: UnaryBodies<State>) {
  return ([
    ["0000", "neg"], // NEG
    ["0011", "com"], // COM
    ["0100", "lsr"], // LSR
    ["0110", "ror"], // ROR
    ["0111", "asr"], // ASR
    ["1000", "asl"], // ASL (LSL)
    ["1001", "rol"], // ROL
    ["1010", "dec"], // DEC
    ["1100", "inc"], // INC
    ["1101", "tst"], // TST: no write
    ["1111", "clr"], // CLR: only the 6809 reads the operand
  ] as const).map(([bits, name]) => ({ bits, registers: [bodies[`${name}A`], bodies[`${name}B`]], memory: bodies[`${name}Memory`] }));
}

/** Bind mm=00 immediate (when supplied) and mm=01/10/11 resolved memory; construction reads no state. */
export function motorolaOperandBindings<State>(readState: () => State,
  modes: readonly { bits: string; address: (instruction: WordInstructionContext) => number | undefined }[]) {
  return (pattern: string, immediate: ((state: State, instruction: WordInstructionContext) => void) | undefined,
    memory: (state: State, address: number, instruction: ByteMemory) => void): readonly OpcodeEntry<(instruction: WordInstructionContext) => "unsupported" | void>[] => [
    ...(immediate ? opcodePattern(pattern.replace("mm", "00"), (instruction: WordInstructionContext) => immediate(readState(), instruction)) : []),
    ...modes.flatMap(({ bits, address: resolve }) => opcodePattern(pattern.replace("mm", bits), (instruction: WordInstructionContext) => {
      const address = resolve(instruction);
      if (address === undefined) return "unsupported";
      memory(readState(), address, instruction);
    })),
  ];
}

type ByteReadName = "sub" | "sbc" | "adc" | "add" | "cmp" | "and" | "bit" | "ld" | "eor" | "or";
type ByteBodies<State> = Readonly<Record<`${ByteReadName}${"a" | "b"}Immediate`, (state: State, instruction: WordInstructionContext) => void>
  & Record<`${ByteReadName | "st"}${"a" | "b"}Memory`, (state: State, address: number, instruction: ByteMemory) => void>>;

/** 1 r mm oooo: r selects A/B; these generated bodies share an immediate/resolved-memory boundary. */
export function motorolaByteBindings<State>(bodies: ByteBodies<State>, bind: ReturnType<typeof motorolaOperandBindings<State>>) {
  return (["a", "b"] as const).flatMap((register, r) => [
    ...([
      ["0000", "sub"], ["0001", "cmp"], ["0010", "sbc"],
      ["0100", "and"], ["0101", "bit"], ["0110", "ld"],
      ["1000", "eor"], ["1001", "adc"], ["1010", "or"], ["1011", "add"],
    ] as const).flatMap(([bits, name]) => bind(`1 ${r} mm ${bits}`, bodies[`${name}${register}Immediate`], bodies[`${name}${register}Memory`])),
    ...bind(`1 ${r} mm 0111`, undefined, bodies[`st${register}Memory`]), // Stores have no immediate form.
  ]);
}
