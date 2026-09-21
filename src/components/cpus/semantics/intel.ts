import { addWrap, bitXor, concat, fetchByte, flagLiteral, flagValue, highByte, literal, lowByte, not, readFlag, readMemory, readRegister, readSource, subtract, updateFlags, value, writeLatch, writeMemory, writeRegister } from "./model.ts";
import type { CpuDeclaration, Flag, Latch, FlagPolicy, InstructionDefinition, Register, Statement, ValueSource } from "./model.ts";
import { instructionSet, memorySource, readWord, registerSource, shift, transfer, writeWord } from "./builders.ts";
import type { RegisterView } from "./builders.ts";
import { decimalAdjust } from "./decimal.ts";
import { flagPolicy } from "./status.ts";
import { defineInstruction } from "./validate.ts";
import { intelAccumulatorTransferForms, intelExchangeForms, intelJumpForms, intelStackForms, intelSubroutineForms, intelWordArithmeticForms, intelWordTransferForms } from "../intel-encodings.ts";
import { flagCondition, jump, subroutineCall, subroutineReturn } from "./control-flow.ts";
import { byteStack, stackPop, stackPush, wordStack } from "./stack.ts";
import type { IntelByteOperand } from "../intel-encodings.ts";
import { pairBytes } from "../register-pairs.ts";
import type { RegisterPair } from "../register-pairs.ts";

interface IntelByteCpu {
  readonly declaration: CpuDeclaration;
  register(field: "a" | "b" | "c" | "d" | "e" | "h" | "l"): Register;
}

interface IntelWordCpu extends IntelByteCpu {
  register(field: "a" | "b" | "c" | "d" | "e" | "h" | "l" | "sp" | "pc"): Register;
}
type WordRegister = Register | { readonly source: ValueSource; readonly write: readonly Statement[] };
type WordTransfer = "immediate" | "load" | "store" | "copy";

const wordSource = (register: WordRegister): ValueSource => "kind" in register ? registerSource(register) : register.source;
const wordDestination = (register: WordRegister): Register | readonly Statement[] => "kind" in register ? register : register.write;

/** Pairs are views of two stored bytes, read and written high byte first. */
export function intelWordRegister(cpu: IntelWordCpu, pair: RegisterPair | "sp"): WordRegister {
  if (pair === "sp") return cpu.register("sp");
  const view = intelPairView(cpu, pair);
  return { source: view.source, write: view.write(value("result")) };
}

/** Construction-time pair view, with an explicit value supplied to each split write. */
export function intelPairView(cpu: IntelByteCpu, pair: RegisterPair): RegisterView {
  const [highField, lowField] = pairBytes[pair], high = cpu.register(highField), low = cpu.register(lowField);
  return { source: { name: pair.toUpperCase(), width: 16,
    steps: [readRegister("high", high), readRegister("low", low)], result: concat(value("high"), value("low")) },
    write: contents => [writeRegister(high, highByte(contents)), writeRegister(low, lowByte(contents))],
  };
}

export const immediateWord: ValueSource = { name: "immediate word, low byte first", width: 16,
  steps: [fetchByte("low"), fetchByte("high")], result: concat(value("high"), value("low")) };

/** Shared absolute/HL jumps; conditional forms capture their flag after both address bytes. */
export function intelJumps(cpu: IntelWordCpu, flags: readonly Flag[], name: (condition: number | "absolute" | "indirect") => string) {
  return instructionSet([
    ...intelJumpForms.conditional.map(([opcode, condition]) => [opcode,
      jump(cpu, name(condition), immediateWord, flagCondition(flags[condition >> 1]!, Boolean(condition & 1)))] as const),
    ...intelJumpForms.absolute.map(([opcode]) => [opcode, jump(cpu, name("absolute"), immediateWord)] as const),
    ...intelJumpForms.indirect.map(([opcode]) => [opcode, jump(cpu, name("indirect"), wordSource(intelWordRegister(cpu, "hl")))] as const),
  ]);
}

/** Z80 status/control forms bind the shared stack and packed-status builders. */
export function z80StatusInstructions(cpu: IntelWordCpu & { flag(field: string): Flag; latch(field: "halted"): Latch },
  flags: RegisterView) {
  const stack = wordStack(byteStack(cpu.register("sp"), "occupied"), "little-endian");
  const status: ValueSource = { name: "A:F", width: 16,
    steps: [readRegister("a", cpu.register("a")), readSource("flags", flags.source)], result: concat(value("a"), value("flags")) };
  return instructionSet([
    [0x00, defineInstruction({ cpu: cpu.declaration, name: "NOP", explanation: "No effects after opcode fetching.", steps: [] })],
    [0x76, defineInstruction({ cpu: cpu.declaration, name: "HALT", explanation: "Set the halted latch; preserve registers and flags. Retirement remains in the CPU boundary.", steps: [writeLatch(cpu.latch("halted"), true)] })],
    [0xf5, stackPush(cpu.declaration, "PUSH AF", stack, status)],
    [0xf1, defineInstruction({ cpu: cpu.declaration, name: "POP AF",
      explanation: "Pop the complete word before writing A and replacing flags. Ignore reserved status bits. " + stack.explanation,
      steps: [readSource("result", stack.pop), writeRegister(cpu.register("a"), highByte(value("result"))), ...flags.write(lowByte(value("result")))] })],
    [0x27, decimalAdjust(cpu)],
    [0x2f, defineInstruction({ cpu: cpu.declaration, name: "CPL",
      explanation: "Complement A; then set N/H and preserve the other flags.",
      steps: [readRegister("original", cpu.register("a")), writeRegister(cpu.register("a"), bitXor(value("original"), literal(8, 0xff))),
        updateFlags(flagPolicy(cpu, "CPL", {}, { n: flagLiteral(true), h: flagLiteral(true) }), {})] })],
    [0x37, defineInstruction({ cpu: cpu.declaration, name: "SCF", explanation: "Set C, then clear N/H; preserve S/Z/PV and all registers.",
      steps: [updateFlags(flagPolicy(cpu, "SCF", {}, { c: flagLiteral(true), n: flagLiteral(false), h: flagLiteral(false) }), {})] })],
    [0x3f, defineInstruction({ cpu: cpu.declaration, name: "CCF", explanation: "Copy incoming C to H, complement C, and clear N. Preserve S/Z/PV and all registers.",
      steps: [readFlag("carry", cpu.flag("c")), updateFlags(flagPolicy(cpu, "CCF", { carry: "flag" }, { h: flagValue("carry"), c: not(flagValue("carry")), n: flagLiteral(false) }), { carry: flagValue("carry") })] })],
  ]);
}

/** Register pushes capture the complete word before SP; pops replace it only after both reads. */
export function intelStackTransfer(cpu: IntelWordCpu, register: WordRegister, operation: "push" | "pop", name: string) {
  const stack = wordStack(byteStack(cpu.register("sp"), "occupied"), "little-endian");
  return operation === "push" ? stackPush(cpu.declaration, name, stack, wordSource(register))
    : stackPop(cpu.declaration, name, stack, wordDestination(register));
}

export function intelRegisterStacks(cpu: IntelWordCpu, name: (register: RegisterPair, operation: "push" | "pop") => string) {
  return instructionSet((["push", "pop"] as const).flatMap(operation => intelStackForms[operation].map(([opcode, register]) =>
    [opcode, intelStackTransfer(cpu, intelWordRegister(cpu, register), operation, name(register, operation))])));
}

/** Calls, returns, and restarts use the same conditions and stack; untaken paths have no stack effects. */
export function intelSubroutines(cpu: IntelWordCpu, flags: readonly Flag[], names: {
  readonly call: (condition: number | undefined) => string;
  readonly return: (condition: number | undefined) => string;
  readonly restart: (address: number) => string;
}) {
  const stack = wordStack(byteStack(cpu.register("sp"), "occupied"), "little-endian");
  const condition = (code: number | undefined) => code === undefined ? undefined : flagCondition(flags[code >> 1]!, Boolean(code & 1));
  return instructionSet([
    ...[...intelSubroutineForms.conditionalCalls, ...intelSubroutineForms.call].map(([opcode, code]) => [opcode, subroutineCall(cpu, names.call(code), immediateWord, stack, condition(code))] as const),
    ...[...intelSubroutineForms.conditionalReturns, ...intelSubroutineForms.return].map(([opcode, code]) => [opcode, subroutineReturn(cpu, names.return(code), stack, condition(code))] as const),
    ...intelSubroutineForms.restarts.map(([opcode, address]) => [opcode, subroutineCall(cpu, names.restart(address), literal(16, address), stack)] as const),
  ]);
}

/** Complete word transfers own operand fetching, source capture, and ordered writes; flags are never accessed. */
export function intelWordTransfer(cpu: IntelWordCpu, register: WordRegister, operation: WordTransfer, name: string): InstructionDefinition {
  const memory = operation === "load" || operation === "store";
  const address = value("address"), next = addWrap(address, literal(16, 1));
  const word = readWord("low-first", address, next);
  const source: ValueSource = operation === "immediate" ? immediateWord : operation === "load"
    ? { name: "memory word, low byte first", width: 16,
      steps: [readSource("address", immediateWord), ...word.steps], result: word.result }
    : wordSource(register);
  const destination = operation === "copy" ? cpu.register("sp") : operation === "store"
    ? writeWord("low-first", address, next, value("result"))
    : wordDestination(register);
  return defineInstruction({ cpu: cpu.declaration, name,
    explanation: (memory ? "Fetch the complete address low byte first, then " : operation === "immediate" ? "Fetch the immediate low byte then high byte; " : "")
      + (operation === "store" ? "capture the complete source before writing memory low byte then high byte, wrapping at FFFF. Never read the destination; a failed second write retains the first. "
        : operation === "load" ? "read memory low byte then high byte, wrapping at FFFF. Only after both reads succeed, write the destination. "
        : operation === "copy" ? "Capture the complete source, then write SP without memory access. " : "write the destination only after both fetches succeed. ")
      + "Register pairs use explicit high-then-low byte reads and writes. Preserve flags, alternate banks, and control state without accessing them. Completed accesses remain on failure.",
    steps: [...(operation === "store" ? [readSource("address", immediateWord)] : []), ...transfer(destination, source)],
  });
}

/** The shared base inventory binds LXI/LHLD/SHLD/SPHL or their Z80 LD counterparts. */
export function intelWordTransfers(cpu: IntelWordCpu, names: (register: RegisterPair | "sp", operation: WordTransfer) => string) {
  return instructionSet(Object.values(intelWordTransferForms).flat().map(([opcode, { register, operation }]) =>
    [opcode, intelWordTransfer(cpu, intelWordRegister(cpu, register), operation, names(register, operation))]));
}

/** Stack exchange captures the register and SP before reading low/high, then writing high/low. SP is unchanged. */
export function intelStackExchange(cpu: IntelWordCpu, register: WordRegister, name: string): InstructionDefinition {
  const address = value("address"), next = addWrap(address, literal(16, 1));
  const word = readWord("low-first", address, next);
  return defineInstruction({ cpu: cpu.declaration, name,
    explanation: "Capture the complete register, then SP. Read memory low byte then high byte, wrapping at FFFF. "
      + "Write the original register high byte then low byte to those captured addresses, even if unchanged. "
      + "Only after both writes succeed, replace the register with the captured memory word; pairs read and write high byte first. "
      + "A failed access prevents register writeback and retains completed memory writes. Never write SP or access flags, alternate banks, or control state.",
    steps: [readSource("original", wordSource(register)), readRegister("address", cpu.register("sp")),
      ...word.steps, ...writeWord("high-first", next, address, value("original")),
      ...transfer(wordDestination(register), word.result)],
  });
}

/** XTHL/XCHG and the corresponding Z80 exchanges share their native encodings and ordered effects. */
export function intelExchanges(cpu: IntelWordCpu, names: (operation: "stack" | "register") => string) {
  return instructionSet(intelExchangeForms.map(([opcode, operation]) => [opcode, operation === "stack"
    ? intelStackExchange(cpu, intelWordRegister(cpu, "hl"), names(operation))
    : defineInstruction({ cpu: cpu.declaration, name: names(operation),
      explanation: "Capture H then D, write D then H; capture L then E, write E then L. "
        + "Preserve all other registers, flags, alternate banks, and control state without accessing them. No memory access occurs.",
      steps: ([["d", "h"], ["e", "l"]] as const).flatMap(([left, right]) => [
        readRegister(right, cpu.register(right)), readRegister(left, cpu.register(left)),
        writeRegister(cpu.register(left), value(right)), writeRegister(cpu.register(right), value(left))]),
    })]));
}

/** Word adjustments wrap without accessing flags; pair views keep their high-then-low order. */
export function intelWordAdjustment(cpu: IntelWordCpu, register: WordRegister, delta: -1 | 1, name: string): InstructionDefinition {
  return defineInstruction({ cpu: cpu.declaration, name,
    explanation: `${delta === 1 ? "Add" : "Subtract"} one with word wraparound. Capture the complete register before writing it; pairs read and write high byte first. Do not access flags, memory, alternate banks, or control state.`,
    steps: [readSource("original", wordSource(register)),
      ...transfer(wordDestination(register), (delta === 1 ? addWrap : subtract)(value("original"), literal(16, 1)))],
  });
}

/** Word arithmetic captures source, destination, and optional carry, then writes the word before flags. */
export function intelWordArithmetic(cpu: IntelWordCpu, destination: WordRegister, source: WordRegister, operation: "add" | "subtract",
  flags: FlagPolicy, name: string, incoming?: Flag): InstructionDefinition {
  const left = value("left"), right = value("right"), carry = incoming === undefined ? undefined : flagValue("carry");
  return defineInstruction({ cpu: cpu.declaration, name,
    explanation: `Read the complete source before the destination, even when both operands name the same register. ${incoming === undefined ? "Do not read incoming flags." : "Then capture incoming carry."} `
      + `${operation === "add" ? "Add" : "Subtract"} with word wraparound; write the destination before applying ${flags.name}. `
      + "Pairs read and write high byte first. Preserve unlisted flags, alternate banks, and control state; no memory access occurs.",
    steps: [readSource("right", wordSource(source)), readSource("left", wordSource(destination)),
      ...(incoming === undefined ? [] : [readFlag("carry", incoming)]),
      ...transfer(wordDestination(destination), (operation === "add" ? addWrap : subtract)(left, right, carry)),
      updateFlags(flags, { left, right, result: value("result"), ...(carry === undefined ? {} : { carry }) })],
  });
}

/** The shared base encodings select INX/DCX/DAD or INC/DEC/ADD HL with native names and flags. */
export function intelWordArithmeticFamily(cpu: IntelWordCpu, flags: FlagPolicy,
  names: (register: RegisterPair | "sp", operation: "increment" | "decrement" | "add") => string) {
  return instructionSet(Object.values(intelWordArithmeticForms).flat().map(([opcode, { register, operation }]) => {
    const word = intelWordRegister(cpu, register), name = names(register, operation);
    return [opcode, operation === "add" ? intelWordArithmetic(cpu, intelWordRegister(cpu, "hl"), word, "add", flags, name)
      : intelWordAdjustment(cpu, word, operation === "increment" ? 1 : -1, name)];
  }));
}

/** Capture the source before writing; ordinary stores read HL after the source, indexed forms take one resolved address. */
export function intelByteTransfer(cpu: IntelByteCpu, destination: IntelByteOperand, source: IntelByteOperand | "immediate",
  name: string, addressing: "hl" | "resolved" = "hl"): InstructionDefinition {
  if (destination === "m" && source === "m") throw new Error("The memory-to-memory slot belongs to HALT.");
  const resolved = addressing === "resolved";
  const hl = [readRegister("high", cpu.register("h")), readRegister("low", cpu.register("l"))];
  const pair = concat(value("high"), value("low"));
  const address = resolved ? value("address") : pair;
  return defineInstruction({ cpu: cpu.declaration, name,
    ...(resolved ? { inputs: { address: 16 as const } } : {}),
    explanation: (resolved ? "Entry follows indexed address resolution; use that captured address. " : "Use the selected byte registers; memory uses H then L at the access point. ")
      + "Capture the source before writing the destination, including self-transfers and unchanged writes. "
      + "Stores never read the destination. Do not access flags or control state. A failed source read or fetch prevents writeback.",
    steps: [
      ...(source === "immediate" ? [fetchByte("result")] : source === "m"
        ? [...(resolved ? [] : hl), readMemory("result", address)] : [readRegister("result", cpu.register(source))]),
      ...(destination === "m" ? [...(resolved ? [] : hl), writeMemory(address, value("result"))] : [writeRegister(cpu.register(destination), value("result"))]),
    ],
  });
}

/** Accumulator memory transfers capture BC/DE or the complete immediate address before accessing A. */
export function intelAccumulatorTransfers(cpu: IntelWordCpu, names: (address: "bc" | "de" | "absolute", operation: "load" | "store") => string) {
  return instructionSet(Object.values(intelAccumulatorTransferForms).flat().map(([opcode, { address, operation }]) => {
    const addressSource = address === "absolute" ? immediateWord : wordSource(intelWordRegister(cpu, address)), accumulator = cpu.register("a");
    return [opcode, defineInstruction({ cpu: cpu.declaration, name: names(address, operation),
      explanation: (address === "absolute" ? "Fetch the complete address low byte then high byte. " : `Read ${address.toUpperCase()} high byte then low byte, without changing the pair. `)
        + (operation === "store" ? "Then capture A and write once to the captured address, without reading the destination. "
          : "Read once at the captured address, then write A only after the read succeeds; do not read the previous A. ")
        + "Preserve flags, alternate banks, and control state without accessing them. A failed access stops later effects; completed fetches remain.",
      steps: operation === "store" ? [readSource("address", addressSource),
        ...transfer([writeMemory(value("address"), value("result"))], registerSource(accumulator))]
        : transfer(accumulator, memorySource(addressSource)),
    })];
  }));
}

/** Accumulator rotates write A before carry; callers may append other flag updates. */
export function intelAccumulatorRotate(accumulator: Register, carry: Flag, direction: "left" | "right", circular: boolean): readonly Statement[] {
  const operation = shift(direction, circular ? "outgoing" : carry);
  return [
    readRegister("original", accumulator), ...operation.steps,
    writeRegister(accumulator, value("result")),
    updateFlags({ name: `${accumulator.cpu} rotate carry`, parameters: { original: 8 }, unlisted: "preserve",
      updates: [{ flag: carry, value: operation.carry }],
    }, { original: value("original") }),
  ];
}
