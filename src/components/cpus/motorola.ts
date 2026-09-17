import { add, subtract } from "./alu.ts";
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

/** Ordinary Motorola arithmetic changes NZVC; callers separately schedule H, X, and writeback. */
export function motorolaArithmeticFlags(width: ArithmeticWidth, facts: AdditionResult | SubtractionResult) {
  return { ...negativeZero(width, facts.result), v: facts.overflow,
    c: "carry" in facts ? facts.carry : facts.borrow };
}

/**
 * Byte arithmetic shared by the 6800 and 6809. Read the current flag object at execution
 * so restoring CC cannot leave operations attached to the previous object. Construction reads nothing.
 * These operations preserve H except for addition, and preserve flags they do not name.
 */
export function motorolaByteAlu(readFlags: () => ConditionCodes & { h: boolean }) {
  return {
    add(left: number, right: number, carryIn: 0 | 1 = 0): number {
      const flags = readFlags();
      const facts = add(8, left, right, carryIn);
      Object.assign(flags, motorolaArithmeticFlags(8, facts), { h: facts.halfCarry });
      return facts.result;
    },
    subtract(left: number, right: number, borrowIn: 0 | 1 = 0): number {
      const flags = readFlags();
      const facts = subtract(8, left, right, borrowIn);
      Object.assign(flags, motorolaArithmeticFlags(8, facts));
      return facts.result;
    },
    decimalAdjust(value: number): number {
      const flags = readFlags();
      // Both corrections use the original byte and flags, before either nibble changes.
      const low = (value & 0x0f) > 9 || flags.h ? 0x06 : 0;
      const high = value > 0x99 || flags.c ? 0x60 : 0;
      const { result, carry } = add(8, value, low + high);
      Object.assign(flags, negativeZero(8, result));
      flags.v = false; // Explicit model policy for the hardware-undefined V; preserve H.
      flags.c = flags.c || carry;
      return result;
    },
    test(value: number, width: 8 | 16 = 8): void {
      const flags = readFlags();
      Object.assign(flags, negativeZero(width, value));
      flags.v = false;
    },
  };
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

type ByteReadName = "cmp" | "and" | "bit" | "ld" | "eor" | "or";
type ByteBodies<State> = Readonly<Record<`${ByteReadName}${"a" | "b"}Immediate`, (state: State, instruction: WordInstructionContext) => void>
  & Record<`${ByteReadName | "st"}${"a" | "b"}Memory`, (state: State, address: number, instruction: ByteMemory) => void>>;

/** 1 r mm oooo: r selects A/B; these generated bodies share an immediate/resolved-memory boundary. */
export function motorolaByteBindings<State>(bodies: ByteBodies<State>, bind: ReturnType<typeof motorolaOperandBindings<State>>) {
  return (["a", "b"] as const).flatMap((register, r) => [
    ...([
      ["0001", "cmp"], ["0100", "and"], ["0101", "bit"], ["0110", "ld"],
      ["1000", "eor"], ["1010", "or"],
    ] as const).flatMap(([bits, name]) => bind(`1 ${r} mm ${bits}`, bodies[`${name}${register}Immediate`], bodies[`${name}${register}Memory`])),
    ...bind(`1 ${r} mm 0111`, undefined, bodies[`st${register}Memory`]), // Stores have no immediate form.
  ]);
}

type Accumulator = "a" | "b";
interface AccumulatorState { a: number; b: number; flags: { c: boolean } }
type AccumulatorOperation = { readonly bits: string; readonly apply: (register: Accumulator, value: number) => void };

/** Remaining 6800/6809 byte-arithmetic selectors; generated comparisons, logic, and transfers bind separately. */
export function motorolaAccumulatorOperations(readState: () => AccumulatorState, alu: ReturnType<typeof motorolaByteAlu>): readonly AccumulatorOperation[] {
  // 1 r mm oooo: r selects A/B, mm selects addressing, and these rows select oooo.
  // Construct only closures here: CPU state is not available until its constructor runs.
  return [
    { bits: "0000", apply: (r, value) => { readState()[r] = alu.subtract(readState()[r], value); } }, // SUBA/B
    { bits: "0010", apply: (r, value) => { readState()[r] = alu.subtract(readState()[r], value, readState().flags.c ? 1 : 0); } }, // SBCA/B
    { bits: "1001", apply: (r, value) => { readState()[r] = alu.add(readState()[r], value, readState().flags.c ? 1 : 0); } }, // ADCA/B
    { bits: "1011", apply: (r, value) => { readState()[r] = alu.add(readState()[r], value); } }, // ADDA/B
  ];
}
