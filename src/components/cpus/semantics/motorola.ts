import { addWrap, and, flagValue, borrow, concat, fetchByte, flagLiteral, literal, not, overflow, readFlag, readMemory, readRegister, readSource, updateFlags, value, writeMemory, writeRegister, xor } from "./model.ts";
import type { CpuDeclaration, Flag, FlagPolicy, InstructionDefinition, NumberExpression, Register, Statement, ValueSource, Width } from "./model.ts";
import { compare, immediateByte, negativeZeroPolicy, readWord, transfer, writeWord } from "./builders.ts";
import { defineInstruction } from "./validate.ts";
import { relativeBranch } from "./control-flow.ts";
import type { FlowCpu, Condition } from "./control-flow.ts";
import { motorolaBranchNames } from "../motorola.ts";

interface MotorolaCpu {
  readonly declaration: CpuDeclaration;
  flag(field: "n" | "z" | "v" | "c"): Flag;
}

/** Ordinary byte/word comparison changes NZVC, with C meaning borrow. */
export function motorolaComparisonFlags(cpu: MotorolaCpu, width: Width): FlagPolicy {
  const nz = negativeZeroPolicy(`${cpu.declaration.name} comparison`, cpu.flag("n"), cpu.flag("z"), width);
  return { ...nz, parameters: { left: width, right: width, result: width }, updates: [
    ...nz.updates, { flag: cpu.flag("v"), value: overflow(value("left"), value("right")) },
    { flag: cpu.flag("c"), value: borrow(value("left"), value("right")) },
  ] };
}

const immediateWord: ValueSource = { name: "immediate word, high byte first", width: 16,
  steps: [fetchByte("high"), fetchByte("low")], result: concat(value("high"), value("low")) };

/** Motorola cccc=tttp: capture a pair's flags in native order, then optionally invert its test. */
export function motorolaCondition(cpu: { flag(field: "n" | "z" | "v" | "c"): Flag }, code: number): Condition {
  const n = flagValue("n"), z = flagValue("z"), v = flagValue("v"), c = flagValue("c");
  // ttt selects T/HI/CC/NE/VC/PL/GE/GT; p in cccc=tttp negates the chosen test.
  const conditions: readonly Condition[] = [
    { steps: [], test: flagLiteral(true) },
    { steps: [readFlag("c", cpu.flag("c")), readFlag("z", cpu.flag("z"))], test: and(not(c), not(z)) },
    { steps: [readFlag("c", cpu.flag("c"))], test: not(c) },
    { steps: [readFlag("z", cpu.flag("z"))], test: not(z) },
    { steps: [readFlag("v", cpu.flag("v"))], test: not(v) },
    { steps: [readFlag("n", cpu.flag("n"))], test: not(n) },
    { steps: [readFlag("n", cpu.flag("n")), readFlag("v", cpu.flag("v"))], test: not(xor(n, v)) },
    { steps: [readFlag("n", cpu.flag("n")), readFlag("v", cpu.flag("v")), readFlag("z", cpu.flag("z"))], test: and(not(z), not(xor(n, v))) },
  ];
  const condition = conditions[code >> 1]!;
  return { steps: condition.steps, test: code & 1 ? not(condition.test) : condition.test };
}

/** Page 10 retains LBRN/LBcc; base-page LBRA and short branches come from the chapter. */
export function motorolaLongBranches(cpu: MotorolaCpu & FlowCpu) {
  return Object.fromEntries(motorolaBranchNames.flatMap((name, code) => code === 0 ? [] : [
    [`l${name}`, relativeBranch(cpu, `L${name.toUpperCase()}`, immediateWord, motorolaCondition(cpu, code))],
  ]));
}

type OperandModes = readonly ("Immediate" | "Memory")[];

interface OperandForm {
  readonly memory: boolean;
  readonly word: boolean;
  readonly reads: readonly Statement[];
  readonly source: ValueSource | NumberExpression;
}

/** Construct requested modes; callers place memory reads explicitly before using the source. */
function operandFamily(cpu: MotorolaCpu, mnemonic: string, width: Width,
  body: (operand: OperandForm) => Pick<InstructionDefinition, "explanation" | "steps">, key = mnemonic.toLowerCase(), modes: OperandModes = ["Immediate", "Memory"]) {
  const word = width === 16;
  const memoryWord = readWord("high-first", value("address"), addWrap(value("address"), literal(16, 1)));
  return Object.fromEntries(modes.map(mode => {
    const memory = mode === "Memory";
    const reads = !memory ? [] : word ? memoryWord.steps : [readMemory("byte", value("address"))];
    const source = memory ? (word ? memoryWord.result : value("byte")) : (word ? immediateWord : immediateByte);
    return [`${key}${mode}`, defineInstruction({ cpu: cpu.declaration, name: `${mnemonic} ${memory ? "memory" : word ? "#word" : "#byte"}`,
      ...(memory ? { inputs: { address: 16 as const } } : {}), ...body({ memory, word, reads, source }),
    })];
  }));
}

/** Comparison bodies use immediate fetching or data reads after CPU-owned address resolution. */
export function motorolaComparison(cpu: MotorolaCpu, mnemonic: string, left: Register | ValueSource, modes?: OperandModes) {
  const flags = motorolaComparisonFlags(cpu, left.width);
  return operandFamily(cpu, mnemonic, left.width, ({ memory, word, reads, source }) => ({
    explanation: (memory ? "Entry is after successful address resolution. Read the operand at that captured address. " : "Fetch the immediate operand. ")
      + (word ? "Read high byte then low byte, wrapping at FFFF. " : "")
      + `Only then read ${"kind" in left ? left.field.toUpperCase() : left.name}. `
      + "Apply N/Z/V/C from subtraction, preserving H and control flags. C means borrow. Do not write a result. "
      + "A failed read leaves flags unchanged; completed fetches and addressing effects remain.",
    steps: [...reads, ...compare(left, source, flags)],
  }), undefined, modes);
}

/** Loads, stores, transfers, and logic describe the result in N/Z, clear V, and preserve other flags. */
export function motorolaResultFlags(cpu: MotorolaCpu, operation: string, width: Width = 8): FlagPolicy {
  const nz = negativeZeroPolicy(`${cpu.declaration.name} ${operation}`, cpu.flag("n"), cpu.flag("z"), width);
  return { ...nz, updates: [...nz.updates, { flag: cpu.flag("v"), value: flagLiteral(false) }] };
}

// A compound destination supplies explicit writes consuming "result", rather than a hidden runtime setter.
type WritableRegister = Register | { readonly source: ValueSource; readonly write: readonly Statement[]; readonly explanation: string };

/** Byte/word loads and stores share ordering; CPU-owned declarations expose compound register writes. */
export function motorolaTransfers(cpu: MotorolaCpu, suffix: string, register: WritableRegister, modes?: OperandModes) {
  const stored = "kind" in register, width = stored ? register.width : register.source.width, word = width === 16;
  const flags = motorolaResultFlags(cpu, "transfer", width), unit = word ? "word" : "byte";
  const write = stored ? `Write ${register.field.toUpperCase()}` : register.explanation;
  return {
    ...operandFamily(cpu, `LD${suffix}`, width, ({ memory, reads, source }) => ({
      explanation: (memory ? `Entry is after successful address resolution. Read the ${unit} at that address. ` : `Fetch the immediate ${unit}. `)
        + (word ? "Read high byte then low byte, wrapping at FFFF. " : "")
        + `${write}, then set N/Z from the captured ${unit} and clear V, preserving other flags. `
        + "A failed read prevents register and flag updates; completed fetches and addressing effects remain.",
      steps: [...reads, ...transfer(stored ? register : register.write, source, flags)],
    }), `ld${suffix.toLowerCase()}`, modes),
    [`st${suffix.toLowerCase()}Memory`]: defineInstruction({
      cpu: cpu.declaration, name: `ST${suffix} memory`, inputs: { address: 16 },
      explanation: `Entry is after successful address resolution. Only then capture ${stored ? register.field.toUpperCase() : suffix}. `
        + (word ? "Do not read the destination; write high byte then low byte, wrapping at FFFF, even if unchanged. "
          + "Only after both writes succeed, set N/Z from the captured word and clear V, preserving other flags. "
          + "A failed write leaves flags unchanged; completed writes, fetches, and addressing effects remain."
          : "Do not read the destination; write the captured byte once, even if unchanged. "
          + "Only after a successful write, set N/Z from that byte and clear V, preserving other flags. "
          + "A failed write leaves flags unchanged; completed fetches and addressing effects remain."),
      steps: [stored ? readRegister("result", register) : readSource("result", register.source),
        ...(word ? writeWord("high-first", value("address"), addWrap(value("address"), literal(16, 1)), value("result"))
          : [writeMemory(value("address"), value("result"))]),
        updateFlags(flags, { result: value("result") })],
    }),
  };
}
