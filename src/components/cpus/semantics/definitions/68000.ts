import { systemForms68000 } from "../../68000-system.ts";
import type { SystemForm68000 } from "../../68000-system.ts";
import { transferForms68000 } from "../../68000-transfers.ts";
import type { TransferForm68000 } from "../../68000-transfers.ts";
import { controlForms68000, conditionNames68000 as conditionNames } from "../../68000-control.ts";
import type { ControlForm68000 } from "../../68000-control.ts";
import { motorolaBranchNames } from "../../motorola.ts";
import { motorolaCondition } from "../motorola.ts";
import { cpu68000StateDescription } from "../../state/68000.ts";
import { operandMoveForms68000 } from "../../68000-moves.ts";
import { arithmeticForms68000, wordArithmeticForms68000, decimalForms68000 } from "../../68000-arithmetic.ts";
import type { ArithmeticOperation68000, ArithmeticSource68000, WordArithmeticForm68000, DecimalForm68000 } from "../../68000-arithmetic.ts";
import { bitForms68000 } from "../../68000-bits.ts";
import type { BitForm68000, ShiftKind68000 } from "../../68000-bits.ts";
import { logicForms68000 } from "../../68000-logic.ts";
import type { LogicOperation68000 } from "../../68000-logic.ts";
import { dataRegisters68000 as dataRegisters, addressRegisters68000 as addressRegisters } from "../../68000-operands.ts";
import type { Operand68000, OperandSize68000 as Size, OperandRegister68000 as RegisterName } from "../../68000-operands.ts";
import { perform, readSource, resetDevices, writeLatch, addOverflow, addWrap, alignmentFault, and, borrow, carry, overflow, select, subtract, bitAnd, bitOr, bitXor, capture, commitAddressUpdates, concat, cpuSymbols, extend, fetchWord, flagLiteral, flagValue, literal, lowBit, negative, readFlag, readMemory, readProgramMemory, readRegister,
  readNextAddress, selectTarget, divide, multiply, not, reject, iterate, iterateTogether, or, xor, shiftLeft, resolveAddress, shiftBits, signExtend, truncate, updateFlags, value, when, writeMemory, writeRegister, zero } from "../model.ts";
import type { FlagExpression, InstructionDefinition, NumberExpression, Register, Statement } from "../model.ts";
import { arithmetic, instructionBodies, instructionSet, shift } from "../builders.ts";
import { choose } from "../control-flow.ts";
import { flagPolicy } from "../status.ts";
import { defineInstruction } from "../validate.ts";
import { families, policies, views, actions } from "../generated/68000.ts";

const cpu = cpuSymbols("68000", cpu68000StateDescription);
const sizes = { 8: "B", 16: "W", 32: "L" } as const;

/** Resolve A7 at this operand's turn, reading only the selected stored stack pointer. */
function withRegister(name: RegisterName, role: string, body: (register: Register) => readonly Statement[]): readonly Statement[] {
  return name === "a7" ? choose({ steps: [readSource(role, views.STACKBANK)], test: not(zero(value(role))) },
    body(cpu.register("ssp")), body(cpu.register("usp"))) : body(cpu.register(name));
}

const narrow = (contents: NumberExpression, size: Size) => size === 32 ? contents : truncate(contents, size);

/** Byte/word writes preserve the destination's live upper part. */
function writeData(register: Register, size: Size, contents: NumberExpression): readonly Statement[] {
  if (size === 32) return [writeRegister(register, contents)];
  return [readRegister("preserved", register), writeRegister(register,
    bitOr(bitAnd(value("preserved"), literal(32, 2 ** 32 - 2 ** size)), extend(contents, 32)))];
}

const resultFlags = (size: Size) => policies[size === 8 ? "byteResult" : size === 16 ? "wordResult" : "longResult"];

export const wordMoves68000 = instructionSet([...families.load, ...families.store], 16);
export const instructions68000 = instructionSet(Object.entries(families)
  .filter(([name]) => !["load", "store", "moveQuick"].includes(name)).flatMap(([, entries]) => entries), 16);

// The native decoder supplies the encoded immediate to one chapter body per Dn.
const quickForms = new Map(families.moveQuick);
export const quick68000 = Object.fromEntries(dataRegisters.map((name, code) => [name, quickForms.get(0x7000 | (code << 9))!]));

// Memory callbacks take full logical addresses. The CPU projects them onto its 24-bit bus
// while retaining the logical address and program/data space for a possible bus fault.
const byteAddress = (name: string, offset: number) => offset ? addWrap(value(name), literal(32, offset)) : value(name);

function memoryRead(size: Size, address: string, result: string, program = false, stride = 1): readonly Statement[] {
  const read = program ? readProgramMemory : readMemory;
  const byte = (offset: number) => value(`${result}Byte${offset}`);
  return [...Array.from({ length: size / 8 }, (_, offset) => read(`${result}Byte${offset}`, byteAddress(address, offset * stride))),
    capture(result, size === 8 ? byte(0) : size === 16 ? concat(byte(0), byte(1)) : concat(concat(byte(0), byte(1)), concat(byte(2), byte(3))))];
}

function memoryWrite(size: Size, address = "destinationAddress", result = "result", stride = 1): readonly Statement[] {
  return Array.from({ length: size / 8 }, (_, offset) => writeMemory(byteAddress(address, offset * stride),
    size === 8 ? value(result) : truncate(shiftBits(value(result), "right", size - 8 - offset * 8), 8)));
}

function immediateRead(size: Size, result: string): readonly Statement[] {
  const high = `${result}High`, low = `${result}Low`;
  return [fetchWord(high), ...(size === 32 ? [fetchWord(low)] : []),
    capture(result, size === 32 ? concat(value(high), value(low)) : size === 16 ? value(high) : truncate(value(high), 8))];
}

function checkAlignment(size: Size, name: string, operation: "read" | "write", program = false): readonly Statement[] {
  return size === 8 ? [] : [when(lowBit(value(name)), [alignmentFault(operation, value(name), program ? "program" : "data")])];
}

/** A7 reads introduce a scope; keep stages consuming the captured value inside it. */
function withSource(size: Size, source: Operand68000, result: string, next: readonly Statement[], selectors = { mode: "sourceMode", code: "sourceCode" }): readonly Statement[] {
  return source.kind === "register"
    ? withRegister(source.name, "sourceSupervisor", from => [readRegister("sourceRegister", from), capture(result, narrow(value("sourceRegister"), size)), ...next])
    : source.kind === "immediate" ? [...immediateRead(size, result), ...next]
    : [resolveAddress("sourceAddress", size, value(selectors.mode), value(selectors.code)),
      ...checkAlignment(size, "sourceAddress", "read", source.name === "program"),
      ...memoryRead(size, "sourceAddress", result, source.name === "program"), ...next];
}

/** Commit before reading an ALU destination; retain the selected register bank through writeback. */
function aluDestination(size: Size, destination: Operand68000, pending: boolean,
  apply: readonly Statement[], writeBack: boolean, selectors = { mode: "destinationMode", code: "destinationCode" }): readonly Statement[] {
  if (destination.kind === "immediate") {
    if (writeBack) throw new Error("An immediate operand cannot receive ALU writeback.");
    return [...immediateRead(size, "destination"), ...apply];
  }
  const commit = pending ? [commitAddressUpdates()] : [];
  return destination.kind === "register"
    ? withRegister(destination.name, "destinationSupervisor", register => [...commit,
      readRegister("destinationRegister", register), capture("destination", narrow(value("destinationRegister"), size)),
      ...apply, ...(writeBack ? writeData(register, size, value("result")) : [])])
    : [resolveAddress("destinationAddress", size, value(selectors.mode), value(selectors.code)),
      ...checkAlignment(size, "destinationAddress", "read", destination.name === "program"), ...commit,
      ...memoryRead(size, "destinationAddress", "destination", destination.name === "program"),
      ...apply, ...(writeBack ? memoryWrite(size) : [])];
}

/** Resolve and read the source before any destination extension fetch; only complete writes set flags. */
function operandMove(size: Size, source: Operand68000, destination: Exclude<Operand68000, { kind: "immediate" }>) {
  const address = destination.kind === "register" && destination.name.startsWith("a");
  const pending = source.kind === "memory" || destination.kind === "memory";
  const commit = pending ? [commitAddressUpdates()] : [];
  const flags = [updateFlags(resultFlags(size), { result: value("result") })];
  const write: readonly Statement[] = destination.kind === "register"
    ? withRegister(destination.name, "destinationSupervisor", to => [...commit, ...(address
      ? [writeRegister(to, size === 16 ? signExtend(value("result"), 32) : value("result"))]
      : [...writeData(to, size, value("result")), ...flags])])
    : [resolveAddress("destinationAddress", size, value("destinationMode"), value("destinationCode")),
      ...checkAlignment(size, "destinationAddress", "write"), ...commit, ...memoryWrite(size), ...flags];
  return defineInstruction({ cpu: cpu.declaration,
    name: `${address ? "MOVEA" : "MOVE"}.${sizes[size]} ${source.name.toUpperCase()},${destination.name.toUpperCase()}`,
    inputs: { sourceMode: 3, sourceCode: 3, destinationMode: 3, destinationCode: 3 },
    explanation: "Read the complete source before resolving the destination. Memory EA decoding fetches extensions and stages auto-updates; "
      + "later base/index calculations observe those pending values. Reject odd word/long addresses before the rejected access. "
      + "After both operands pass alignment checks, commit pending registers before writing the destination. Failed source/extension accesses discard pending updates; "
      + "failed destination writes retain updates and completed bytes, with flags unchanged. Memory transfers are high byte first with 32-bit logical wrap. "
      + (address ? "MOVEA.W sign-extends, and both sizes preserve every flag. The destination write wins over an auto-update to the same register."
        : "Preserve live upper Dn bits on byte/word writes. Only a complete write sets N/Z and clears V/C; preserve X/T/S."),
    steps: withSource(size, source, "result", write),
  });
}

// Addressing modes share a body when their register/memory/space roles match.
// Decoder inputs retain the exact mode and register selectors for each operation word.
export const moves68000 = instructionBodies(operandMoveForms68000, ({ size, source, destination }) => operandMove(size, source, destination));

function peripheralTransfer({ size, register, base, store }: Extract<TransferForm68000, { kind: "peripheral" }>) {
  const data = cpu.register(register);
  return defineInstruction({ cpu: cpu.declaration,
    name: `MOVEP.${sizes[size]} ${store ? `${register.toUpperCase()},(d,${base.toUpperCase()})` : `(d,${base.toUpperCase()}),${register.toUpperCase()}`}`,
    inputs: { mode: 3, code: 3 },
    explanation: "Capture An before fetching the signed displacement. Transfer high byte first at alternate addresses, with 32-bit logical wrap; odd addresses are legal. "
      + "A store captures Dn after the displacement fetch. A load replaces Dn only after all bytes arrive, preserving its live upper word for MOVEP.W. Preserve An and every flag.",
    steps: withRegister(base, "baseSupervisor", address => [readRegister("base", address), fetchWord("displacement"),
      capture("address", addWrap(value("base"), signExtend(value("displacement"), 32))),
      ...(store ? [readRegister("source", data), capture("result", narrow(value("source"), size)), ...memoryWrite(size, "address", "result", 2)]
        : [...memoryRead(size, "address", "result", false, 2), ...writeData(data, size, value("result"))])]),
  });
}

function multipleTransfer({ size, load, base, predecrement, program }: Extract<TransferForm68000, { kind: "multiple" }>) {
  const registers = [...dataRegisters, ...addressRegisters];
  if (predecrement) registers.reverse();
  // Each mask bit owns one optional transfer. Name the address after each bit so
  // an unselected register consumes no bytes; no mutable register selector is needed.
  const transfers = registers.flatMap((name, bit): readonly Statement[] => {
    const selected = lowBit(shiftBits(value("mask"), "right", bit));
    const before = `address${bit}`, after = `address${bit + 1}`;
    const address = predecrement ? after : before;
    return [capture(after, select(selected, addWrap(value(before), literal(32, predecrement ? 2 ** 32 - size / 8 : size / 8)), value(before))),
      when(selected, withRegister(name, "registerSupervisor", register => load
        ? [...memoryRead(size, address, "result", program), writeRegister(register, size === 16 ? signExtend(value("result"), 32) : value("result"))]
        : [readRegister("source", register), capture("result", narrow(value("source"), size)), ...memoryWrite(size, address)]))];
  });
  const transfer = (register?: Register): readonly Statement[] => [
    ...(register ? [readRegister("address0", register)] : [resolveAddress("address0", 32, value("mode"), value("code"))]),
    when(not(zero(value("mask"))), [capture("firstAddress", predecrement ? subtract(value("address0"), literal(32, size / 8)) : value("address0")),
      ...checkAlignment(size, "firstAddress", load ? "read" : "write", program), ...transfers,
      ...(register ? [writeRegister(register, value("address16"))] : [])]),
  ];
  const location = base ? predecrement ? `-(${base.toUpperCase()})` : `(${base.toUpperCase()})+` : program ? "PROGRAM" : "MEMORY";
  return defineInstruction({ cpu: cpu.declaration,
    name: `MOVEM.${sizes[size]} ${load ? `${location},list` : `list,${location}`}`, inputs: { mode: 3, code: 3 },
    explanation: "Fetch the register mask before resolving the address. An empty list still fetches EA extensions but checks no alignment and updates no base. "
      + "Otherwise check the first transfer's alignment before touching registers or memory. Visit selected D0..D7,A0..A7, reversed for predecrement stores. "
      + "Capture each source and select each A7 bank at its own turn. Transfer high byte first with 32-bit logical wrap; PC-relative loads use program space. "
      + "Word loads sign-extend into the complete register. Commit the captured base bank only after the whole list succeeds: a stored base keeps its original value, "
      + "and the final postincrement pointer wins over a loaded base. Failure retains earlier transfers but skips the final base update. Preserve every flag.",
    steps: [fetchWord("mask"), ...(base ? withRegister(base, "baseSupervisor", transfer) : transfer())],
  });
}

export const transfers68000 = instructionBodies(transferForms68000, form => form.kind === "peripheral" ? peripheralTransfer(form) : multipleTransfer(form));

/** Logical ALU stages differ from MOVE: commit before reading the destination, flags before writing it. */
function logic(operation: LogicOperation68000, size: Size, source: Operand68000 | undefined, destination: Exclude<Operand68000, { kind: "immediate" }>) {
  const result = {
    AND: bitAnd(value("destination"), value("source")), OR: bitOr(value("destination"), value("source")),
    EOR: bitXor(value("destination"), value("source")), NOT: bitXor(value("destination"), literal(size, 2 ** size - 1)),
    CLR: literal(size, 0), TST: value("destination"),
  }[operation];
  const steps = aluDestination(size, destination, destination.kind === "memory" || source?.kind === "memory",
    [capture("result", result), updateFlags(resultFlags(size), { result: value("result") })], operation !== "TST");
  return defineInstruction({ cpu: cpu.declaration,
    name: `${source?.kind === "immediate" ? `${operation}I` : operation}.${sizes[size]} ${source ? `${source.name.toUpperCase()},` : ""}${destination.name.toUpperCase()}`,
    inputs: { sourceMode: 3, sourceCode: 3, destinationMode: 3, destinationCode: 3 },
    explanation: (source ? "Capture the source before resolving the destination. " : "Resolve the destination once. ")
      + "Reject odd word/long operands before committing address updates. "
      + "Commit staged updates before the destination read; a failed source discards them, while a failed destination read retains them. "
      + "Memory transfers are high byte first with 32-bit logical wrap; PC-relative sources use program space. "
      + (operation === "CLR" ? "Read the destination even though the result is zero. " : "")
      + "Set N/Z and clear V/C after the reads; preserve X/T/S. "
      + (operation === "TST" ? "Do not write the tested operand." : "Write the result after flags, preserving live upper Dn bits on byte/word writes. Failed writes retain flags and completed bytes."),
    steps: source ? withSource(size, source, "source", steps) : steps,
  });
}

// Immediate AND/OR-to-Dn encodings share their bodies with the corresponding data-EA forms.
export const logic68000 = instructionBodies(logicForms68000, ({ operation, size, source, destination }) => logic(operation, size, source, destination));

/** Calculation is shared; the 68000 supplies its X policy and cumulative-zero stage. */
function arithmeticSteps(operation: ArithmeticOperation68000, size: Size, address: boolean): readonly Statement[] {
  const adding = operation === "ADD" || operation === "ADDX", compare = operation === "CMP";
  const extended = operation === "ADDX" || operation === "SUBX" || operation === "NEGX";
  const negate = operation === "NEG" || operation === "NEGX";
  const left = value("left"), right = value("right"), incoming = extended ? flagValue("extend") : undefined;
  const flags = flagPolicy(cpu, `68000 ${operation}`, { left: size, right: size, result: size, ...(extended ? { carry: "flag" } as const : {}) }, {
    n: negative(value("result")), z: zero(value("result")),
    v: (adding ? addOverflow : overflow)(left, right, extended ? flagValue("carry") : undefined),
    c: (adding ? carry : borrow)(left, right, extended ? flagValue("carry") : undefined),
    ...(compare ? {} : { x: (adding ? carry : borrow)(left, right, extended ? flagValue("carry") : undefined) }),
  });
  return [capture("left", negate ? literal(size, 0) : value("destination")), capture("right", negate ? value("destination") : value("source")),
    ...(extended ? [readFlag("previousZero", cpu.flag("z")), readFlag("extend", cpu.flag("x"))] : []),
    ...(address && !compare ? [capture("result", (adding ? addWrap : subtract)(left, right))]
      : arithmetic(adding ? "add" : "subtract", flags, incoming)),
    ...(extended ? [updateFlags(flagPolicy(cpu, "68000 cumulative zero", { previous: "flag", result: size }, {
      z: and(flagValue("previous"), zero(value("result"))),
    }), { previous: flagValue("previousZero"), result: value("result") })] : [])];
}

function operandArithmetic(operation: ArithmeticOperation68000, size: Size, source: ArithmeticSource68000 | undefined,
  destination: Exclude<Operand68000, { kind: "immediate" }>) {
  const address = destination.kind === "register" && destination.name.startsWith("a");
  const width = address ? 32 : size, quick = source?.kind === "quick", compare = operation === "CMP";
  const apply = arithmeticSteps(operation, width, address);
  const finish = aluDestination(width, destination, source?.kind === "memory" || destination.kind === "memory", apply, !compare);
  // A word EA is signed for address arithmetic; a quick constant is always the positive value 1..8.
  const converted = address && size === 16 && !quick ? [capture("source", signExtend(value("wordSource"), 32)), ...finish] : finish;
  const steps = !source ? finish : quick
    ? [capture("source", select(zero(value("sourceCode")), literal(width, 8), extend(value("sourceCode"), width))), ...finish]
    : withSource(size, source, address && size === 16 ? "wordSource" : "source", converted);
  const mnemonic = quick ? `${operation}Q` : address ? `${operation}A` : source?.kind === "immediate" ? `${operation}I`
    : compare && destination.kind === "memory" ? "CMPM" : operation;
  return defineInstruction({ cpu: cpu.declaration, name: `${mnemonic}.${sizes[size]} ${source ? `${source.name.toUpperCase()},` : ""}${destination.name.toUpperCase()}`,
    inputs: { sourceMode: 3, sourceCode: 3, destinationMode: 3, destinationCode: 3 },
    explanation: "Read the complete source before resolving the destination. Stage both operands' auto-updates, including successive uses of the same An. "
      + "Reject odd word/long addresses before committing updates. Commit before reading the destination: source failures discard updates; destination failures retain them. "
      + "Transfers are high byte first with 32-bit logical wrap and distinct program-space reads. "
      + (address ? "Operate on all 32 destination bits; sign-extend word EA sources and keep quick constants positive. " : "Preserve live upper Dn bits on byte/word writeback. ")
      + (address && !compare ? "Preserve every flag. " : "Apply N/Z/V/C before writeback. " + (compare ? "Preserve X. " : "Copy carry/borrow into X. "))
      + (["ADDX", "SUBX", "NEGX"].includes(operation) ? "After the operand reads, capture Z then X; consume X and set final Z only when old Z was set and the result is zero. " : "")
      + (compare ? "Do not write a result." : "Failed writes retain computed flags, committed updates, and completed bytes."),
    steps,
  });
}

// Literal quick values select bindings, while operand roles select shared bodies.
export const arithmetic68000 = instructionBodies(arithmeticForms68000, ({ operation, size, source, destination }) => operandArithmetic(operation, size, source, destination));

/** Fold the result and shift flags together; no architectural flags change during the calculation. */
function shiftSteps(kind: ShiftKind68000, direction: "L" | "R", size: Size): readonly Statement[] {
  const bit = shift(direction === "L" ? "left" : "right", kind === "ROX" ? flagValue("extendBit") : kind === "RO" ? "outgoing"
    : kind === "AS" && direction === "R" ? "sign" : "zero");
  return [readFlag("initialExtend", cpu.flag("x")), iterateTogether(value("count"), {
    shifted: { type: size, initial: value("destination"), next: value("result") },
    extendBit: { type: "flag", initial: flagValue("initialExtend"), next: kind === "RO" ? flagValue("extendBit") : bit.carry },
    carryBit: { type: "flag", initial: kind === "ROX" ? flagValue("initialExtend") : flagLiteral(false), next: bit.carry },
    overflowBit: { type: "flag", initial: flagLiteral(false), next: kind === "AS" && direction === "L"
      ? or(flagValue("overflowBit"), xor(negative(value("original")), negative(value("result")))) : flagLiteral(false) },
  }, [capture("original", value("shifted")), ...bit.steps]), capture("result", value("shifted")),
  updateFlags(flagPolicy(cpu, "68000 shift result", { result: size, extend: "flag", carry: "flag", overflow: "flag" }, {
    n: negative(value("result")), z: zero(value("result")), v: flagValue("overflow"), c: flagValue("carry"), x: flagValue("extend"),
  }), { result: value("result"), extend: flagValue("extendBit"), carry: flagValue("carryBit"), overflow: flagValue("overflowBit") })];
}

function operandBits(form: BitForm68000): InstructionDefinition {
  const { kind, operation, size, source, destination } = form;
  let read: readonly Statement[], apply: readonly Statement[];
  if (kind === "shift") {
    read = source.kind === "register" ? [readRegister("countRegister", cpu.register(source.name)), capture("count", bitAnd(truncate(value("countRegister"), 8), literal(8, 63)))]
      : [capture("count", source.name === "one" ? literal(8, 1) : select(zero(value("sourceCode")), literal(8, 8), extend(value("sourceCode"), 8)))];
    apply = shiftSteps(form.shift, form.direction, size);
  } else if (kind === "bit") {
    read = source.kind === "register" ? [readRegister("bitRegister", cpu.register(source.name)), capture("bitNumber", truncate(value("bitRegister"), 8))]
      : [fetchWord("bitWord"), capture("bitNumber", truncate(value("bitWord"), 8))];
    const changed = operation === "BCHG" ? bitXor(value("destination"), value("mask")) : operation === "BSET" ? bitOr(value("destination"), value("mask"))
      : bitAnd(value("destination"), bitXor(value("mask"), literal(size, 2 ** size - 1)));
    apply = [iterate("mask", bitAnd(value("bitNumber"), literal(8, size - 1)), literal(size, 1), [], shiftLeft(value("mask"), flagLiteral(false))),
      updateFlags(flagPolicy(cpu, "68000 tested bit", { original: size, mask: size }, { z: zero(bitAnd(value("original"), value("mask"))) }),
        { original: value("destination"), mask: value("mask") }), ...(operation === "BTST" ? [] : [capture("result", changed)])];
  } else {
    read = [];
    apply = [updateFlags(resultFlags(8), { result: value("destination") }), capture("result", bitOr(value("destination"), literal(8, 0x80)))];
  }
  return defineInstruction({ cpu: cpu.declaration, name: `${operation}.${sizes[size]} ${source ? `${source.name.toUpperCase()},` : ""}${destination.name.toUpperCase()}`,
    inputs: { sourceMode: 3, sourceCode: 3, destinationMode: 3, destinationCode: 3 },
    explanation: (kind === "shift" ? "Capture the count before reading the operand, including aliased registers. Quick zero encodes eight; register counts use six bits; memory shifts once. "
      + "Capture X after the operand read. Carry the result, X, C, and accumulated ASL sign-change overflow through the loop without flag writes. "
      + "Zero counts still set N/Z, clear V, and preserve X; ROX copies X to C, while other zero-count shifts clear C. Ordinary rotates preserve X. "
      : kind === "bit" ? "Capture the bit-number register or complete immediate word before resolving the tested operand. Test modulo 32 for Dn and modulo 8 otherwise. "
        + "Set only Z from the original bit; BTST omits writeback and may read program space or a dynamic form's immediate byte. "
        : "Read the original byte, set N/Z and clear V/C from that byte, then set bit 7; preserve X/T/S. ")
      + "Resolve the operand once and check word alignment before committing pending address updates. Commit before reading memory. "
      + "Failed reads retain committed updates but not new flags; failed writes retain flags and completed bytes. Preserve live upper Dn bits on partial writes.",
    steps: [...read, ...aluDestination(size, destination, destination.kind === "memory", apply, operation !== "BTST")],
  });
}

export const bits68000 = instructionBodies(bitForms68000, operandBits);

/** Word-source operations commit source updates after their result/flags, including completed exceptions. */
function wordArithmetic({ operation, source, destination }: WordArithmeticForm68000): InstructionDefinition {
  const register = cpu.register(destination), commit = source.kind === "memory" ? [commitAddressUpdates()] : [];
  let apply: readonly Statement[];
  if (operation === "CHK") {
    const tested = value("tested"), bound = value("source");
    apply = [readRegister("original", register), capture("tested", truncate(value("original"), 16)),
      when(or(negative(tested), or(negative(bound), borrow(bound, tested))), [
        updateFlags(flagPolicy(cpu, "68000 failed bound", { tested: 16 }, { n: negative(value("tested")) }), { tested }),
        ...commit, reject("bounds-check"),
      ]), ...commit];
  } else if (operation.startsWith("MUL")) {
    apply = [readRegister("original", register), capture("result", multiply(truncate(value("original"), 16), value("source"), operation === "MULS")),
      writeRegister(register, value("result")), updateFlags(resultFlags(32), { result: value("result") }), ...commit];
  } else {
    apply = [updateFlags(flagPolicy(cpu, "68000 division carry", {}, { c: flagLiteral(false) }), {}),
      when(zero(value("source")), [...commit, reject("divide-by-zero")]), readRegister("dividend", register),
      divide({ dividend: value("dividend"), divisor: value("source"), signed: operation === "DIVS", quotient: "quotient", remainder: "remainder",
        overflow: "quotientOverflow", onError: "divide-by-zero" }),
      ...choose({ steps: [], test: flagValue("quotientOverflow") },
        [updateFlags(flagPolicy(cpu, "68000 division overflow", {}, { v: flagLiteral(true) }), {})],
        [writeRegister(register, concat(value("remainder"), value("quotient"))), updateFlags(resultFlags(16), { result: value("quotient") })]),
      ...commit];
  }
  return defineInstruction({ cpu: cpu.declaration, name: `${operation}.W ${source.name.toUpperCase()},${destination.toUpperCase()}`,
    inputs: { sourceMode: 3, sourceCode: 3, destinationMode: 3, destinationCode: 3 },
    explanation: "Read the full word source before the destination; reject odd addresses before reading or committing updates. PC-relative sources use program space. "
      + "Commit source auto-updates only after result/flag effects, including before requesting a synchronous exception. Failed source reads discard updates. "
      + (operation === "CHK" ? "Interpret both words as signed. Accept zero through the bound without changing flags. On failure, set N for a negative tested word, otherwise clear it; preserve X/Z/V/C and request bounds-check."
        : operation.startsWith("MUL") ? "Multiply the source by the low destination word, replacing Dn with the full 32-bit product before setting N/Z and clearing V/C. Preserve X."
        : "Clear C before testing the divisor. Zero commits the source update and requests divide-by-zero without reading Dn, preserving X/N/Z/V. "
          + "Otherwise divide Dn.L by the source word, truncating toward zero with a remainder of the dividend's sign. Overflow sets V and preserves Dn/X/N/Z. "
          + "Success writes remainder:quotient into Dn before setting N/Z from the quotient and clearing V/C; preserve X."),
    steps: withSource(16, source, "source", apply),
  });
}

/** Correct the low digit, then the high digit, carrying one decimal carry/borrow between them. */
function decimalSteps(operation: DecimalForm68000["operation"]): readonly Statement[] {
  const adding = operation === "ABCD", calculate = adding ? addWrap : subtract;
  const steps: Statement[] = [readFlag("extend", cpu.flag("x")),
    capture("left", operation === "NBCD" ? literal(8, 0) : value("destination")),
    capture("right", operation === "NBCD" ? value("destination") : value("source"))];
  let incoming: FlagExpression = flagValue("extend");
  for (const [digit, offset] of [["Low", 0], ["High", 4]] as const) {
    const left = value(`left${digit}`), right = value(`right${digit}`), raw = value(`raw${digit}`);
    steps.push(capture(`left${digit}`, bitAnd(shiftBits(value("left"), "right", offset), literal(8, 15))),
      capture(`right${digit}`, bitAnd(shiftBits(value("right"), "right", offset), literal(8, 15))), capture(`raw${digit}`, calculate(left, right, incoming)));
    const correction = adding ? not(borrow(raw, literal(8, 10))) : borrow(left, right, incoming);
    steps.push(capture(`digit${digit}`, bitAnd(select(correction, calculate(raw, literal(8, 6)), raw), literal(8, 15))));
    incoming = correction;
  }
  return [...steps, capture("result", bitOr(shiftBits(value("digitHigh"), "left", 4), value("digitLow"))),
    updateFlags(flagPolicy(cpu, "68000 decimal carry", { carry: "flag" }, { c: flagValue("carry"), x: flagValue("carry") }), { carry: incoming }),
    readFlag("previousZero", cpu.flag("z")), updateFlags(flagPolicy(cpu, "68000 decimal zero", { previous: "flag", result: 8 }, {
      z: and(flagValue("previous"), zero(value("result"))),
    }), { previous: flagValue("previousZero"), result: value("result") })];
}

function decimalArithmetic({ operation, source, destination }: DecimalForm68000): InstructionDefinition {
  const finish = aluDestination(8, destination, destination.kind === "memory", decimalSteps(operation), true);
  return defineInstruction({ cpu: cpu.declaration, name: `${operation} ${source ? `${source.name.toUpperCase()},` : ""}${destination.name.toUpperCase()}`,
    inputs: { sourceMode: 3, sourceCode: 3, destinationMode: 3, destinationCode: 3 },
    explanation: "Read the source before resolving the destination; paired predecrements of one An use successive addresses and A7 steps by two for each byte. "
      + "Commit pending updates before reading the destination. Capture X after both operands. Correct low then high nibble, propagating one carry/borrow: "
      + "add six for an addition digit above nine, or subtract six for a negative subtraction digit, retaining four bits. Apply this deterministic rule to non-BCD inputs too. "
      + "Set C then X from the final decimal carry/borrow; read previous Z afterward and retain it only for a zero result. Preserve N/V/T/S. "
      + "Write even unchanged results after flags, preserving live upper Dn bits. Source failures discard pending updates; destination failures retain committed updates, and failed writes also retain flags.",
    steps: source ? withSource(8, source, "source", finish) : finish,
  });
}

export const wordArithmetic68000 = instructionBodies(wordArithmeticForms68000, wordArithmetic);
export const decimal68000 = instructionBodies(decimalForms68000, decimalArithmetic);


/** Only taken transfers validate and select a target; selection never advances the fetch cursor. */
function jumpTarget(): readonly Statement[] {
  return [when(lowBit(value("target")), [alignmentFault("fetch", value("target"))]), selectTarget(value("target"))];
}

/** A long push commits its original stack bank only after all four writes succeed. */
function pushLong(contents: string, prepare: readonly Statement[] = [],
  finish = (stack: Register): readonly Statement[] => [writeRegister(stack, value("stackAddress"))]): readonly Statement[] {
  return withRegister("a7", "stackSupervisor", stack => [readRegister("stack", stack),
    capture("stackAddress", subtract(value("stack"), literal(32, 4))), ...checkAlignment(32, "stackAddress", "write"),
    ...prepare, ...memoryWrite(32, "stackAddress", contents), ...finish(stack)]);
}

const callTarget = (): readonly Statement[] => [readNextAddress("returnAddress"), ...pushLong("returnAddress", jumpTarget())];

/** Displacements are relative to the cursor before an extension word is fetched. */
function branchTarget(word: boolean): readonly Statement[] {
  return [readNextAddress("base"), ...(word ? [fetchWord("offset")] : []),
    capture("target", addWrap(value("base"), signExtend(value(word ? "offset" : "displacement"), 32)))];
}

function control(form: ControlForm68000): InstructionDefinition {
  let name: string, explanation: string, steps: readonly Statement[];
  switch (form.kind) {
    case "condition": {
      const condition = motorolaCondition(cpu, form.condition);
      name = `S${conditionNames[form.condition]} ${form.destination.name.toUpperCase()}`;
      explanation = "Resolve and read the byte destination, committing its auto-updates before the read. Then test the captured condition flags in native order. "
        + "Write FF when true or 00 when false, including unchanged bytes; preserve flags and live upper Dn bits. A failed read retains address updates; a failed write retains completed effects.";
      steps = aluDestination(8, form.destination, form.destination.kind === "memory",
        [...condition.steps, capture("result", select(condition.test, literal(8, 255), literal(8, 0)))], true, { mode: "mode", code: "code" });
      break;
    }
    case "decrement": {
      const condition = motorolaCondition(cpu, form.condition), register = cpu.register(form.register);
      name = `DB${conditionNames[form.condition]} ${form.register.toUpperCase()},label`;
      explanation = "Capture the condition before fetching the complete displacement word. If true, leave Dn and target untouched. "
        + "Otherwise decrement only the low word; FFFF falls through without validating the target. For every other result, reject an odd target before changing Dn. "
        + "Select a valid target before writing the counter, preserving live upper Dn bits and every flag.";
      steps = [...condition.steps, ...branchTarget(true), when(not(condition.test), [readRegister("counter", register),
        capture("result", subtract(truncate(value("counter"), 16), literal(16, 1))),
        when(not(zero(subtract(value("result"), literal(16, 0xffff)))), jumpTarget()), ...writeData(register, 16, value("result"))])];
      break;
    }
    case "branch": {
      const call = form.condition === 1, condition = motorolaCondition(cpu, call ? 0 : form.condition);
      name = `${call ? "BSR" : motorolaBranchNames[form.condition]!.toUpperCase()}.${form.word ? "W" : "B"} label`;
      explanation = "Capture condition flags before the displacement. Read the sequential cursor before fetching any extension word; add the signed displacement with 32-bit wrap. "
        + (call ? "Capture the return cursor after fetching. Check the decremented active stack before the target; select the target, write the return address high byte first, then commit the captured stack bank."
          : "Only a taken branch validates and selects the target; untaken odd targets are harmless. Preserve all registers and flags.");
      steps = [...condition.steps, ...branchTarget(form.word), ...(call ? callTarget() : [when(condition.test, jumpTarget())])];
      break;
    }
    case "address": {
      const resolve = [resolveAddress("target", 32, value("mode"), value("code"))];
      name = `${form.operation} control EA${form.register ? `,${form.register.toUpperCase()}` : ""}`;
      explanation = "Resolve the control address without reading its data or requiring even alignment. Preserve flags. "
        + (form.operation === "LEA" ? "Select the destination A7 bank before resolving the source, then write the full address."
          : form.operation === "PEA" ? "Select the active stack after resolving the address. Check stack alignment, write the address high byte first, then commit that stack bank."
          : form.operation === "JMP" ? "Reject an odd target before selection, without fetching any target byte."
          : "Capture the return cursor after all extensions. Check stack alignment before target alignment; select the target before stacking, and commit the original stack bank after all bytes succeed.");
      steps = form.operation === "LEA" ? withRegister(form.register, "destinationSupervisor", register => [...resolve, writeRegister(register, value("target"))])
        : [...resolve, ...(form.operation === "PEA" ? pushLong("target") : form.operation === "JSR" ? callTarget() : jumpTarget())];
      break;
    }
    case "frame": {
      const link = form.operation === "LINK";
      name = `${form.operation} ${form.register.toUpperCase()}${link ? ",#allocation" : ""}`;
      explanation = "Preserve flags and resolve the frame register's identity before the active stack bank. "
        + (link ? "Fetch the signed allocation word first. Check decremented stack alignment before reading the saved register. LINK A7 saves the decremented stack itself. "
          + "After all four writes, set the frame register, then apply the allocation to the captured stack address."
          : "Read the whole saved long through the frame register, checking alignment before access. Only after all bytes succeed, advance the captured stack bank by four and restore the frame register. UNLK A7 leaves the popped value in SP.");
      steps = [...(link ? [fetchWord("allocation")] : []), ...withRegister(form.register, "frameSupervisor", register => link
        ? pushLong("saved", [form.register === "a7" ? capture("saved", value("stackAddress")) : readRegister("saved", register)], stack => [
          writeRegister(register, value("stackAddress")), writeRegister(stack, addWrap(value("stackAddress"), signExtend(value("allocation"), 32)))])
        : withRegister("a7", "stackSupervisor", stack => [readRegister("frameAddress", register), ...checkAlignment(32, "frameAddress", "read"),
          ...memoryRead(32, "frameAddress", "saved"), writeRegister(stack, addWrap(value("frameAddress"), literal(32, 4))), writeRegister(register, value("saved"))]))];
      break;
    }
    case "return":
      name = "RTS";
      explanation = "Select and capture the active stack before reading. Check its alignment, read the complete return long high byte first, then validate and select the target. "
        + "Only after target selection, advance the original stack bank by four. Failed reads and odd targets leave the pointer unchanged; preserve every flag.";
      steps = withRegister("a7", "stackSupervisor", stack => [readRegister("stackAddress", stack), ...checkAlignment(32, "stackAddress", "read"),
        ...memoryRead(32, "stackAddress", "target"), ...jumpTarget(), writeRegister(stack, addWrap(value("stackAddress"), literal(32, 4)))]);
  }
  return defineInstruction({ cpu: cpu.declaration, name, inputs: { mode: 3, code: 3, displacement: 8 }, explanation, steps });
}

export const control68000 = instructionBodies(controlForms68000, control);

const privileged = (): readonly Statement[] => [readFlag("supervisor", cpu.flag("s")), when(not(flagValue("supervisor")), [reject("privilege-violation")])];

/** Preserve runtime SR capture order: system flags, interrupt mask, then condition codes. */
function readStatus(): readonly Statement[] {
  return [readSource("status", views.SR)];
}

/** CCR writes preserve the flag object and system fields; full SR writes restore those fields afterward. */
function writeStatus(contents: NumberExpression, full: boolean): readonly Statement[] {
  return [perform(full ? actions.writeSR : actions.writeCCR, { contents })];
}

function statusReturn(full: boolean): readonly Statement[] {
  const restore = (stack: Register): readonly Statement[] => [readRegister("stack", stack), ...checkAlignment(16, "stack", "read"),
    ...(full ? [capture("highAddress", byteAddress("stack", 2)), ...memoryRead(16, "highAddress", "high"),
      ...memoryRead(16, "stack", "status"), capture("lowAddress", byteAddress("stack", 4)), ...memoryRead(16, "lowAddress", "low"),
      capture("target", concat(value("high"), value("low")))]
      : [...memoryRead(16, "stack", "status"), capture("targetAddress", byteAddress("stack", 2)), ...memoryRead(32, "targetAddress", "target")]),
    ...jumpTarget(), writeRegister(stack, byteAddress("stack", 6)), ...writeStatus(value("status"), full)];
  return full ? [...privileged(), ...restore(cpu.register("ssp"))] : withRegister("a7", "stackSupervisor", restore);
}

function system(form: SystemForm68000): InstructionDefinition {
  let name: string, explanation: string, steps: readonly Statement[];
  switch (form.kind) {
    case "immediate": {
      name = `${form.operation} #n,${form.full ? "SR" : "CCR"}`;
      explanation = "Check SR privilege before any status capture or operand fetch. Capture old packed SR before fetching the complete immediate word. "
        + "Apply logical status changes to that captured value, ignoring reserved bits. CCR preserves T/S and the live interrupt mask; SR restores them after X/N/Z/V/C.";
      const apply = { ORI: bitOr, ANDI: bitAnd, EORI: bitXor }[form.operation];
      steps = [...(form.full ? privileged() : []), ...readStatus(), fetchWord("immediate"),
        capture("result", apply(value("status"), value("immediate"))), ...writeStatus(value("result"), form.full)];
      break;
    }
    case "from-status":
      name = `MOVE SR,${form.operand.name.toUpperCase()}`;
      explanation = "Unprivileged on the original 68000. Resolve and align the destination, committing auto-updates before reading it. "
        + "Then capture packed SR and write its word, preserving live upper Dn bits and every flag. A failed read retains address updates; a failed write retains completed bytes.";
      steps = aluDestination(16, form.operand, form.operand.kind === "memory",
        [...readStatus(), capture("result", value("status"))], true, { mode: "mode", code: "code" });
      break;
    case "to-status":
      name = `MOVE ${form.operand.name.toUpperCase()},${form.full ? "SR" : "CCR"}`;
      explanation = "Check SR privilege before resolving or reading the source. Read a complete word even for CCR, rejecting odd memory addresses first. "
        + "Restore status before committing staged address updates, which retain their original stack bank even if S changes. A failed source leaves status and pending updates untouched.";
      steps = [...(form.full ? privileged() : []), ...withSource(16, form.operand, "status",
        [...writeStatus(value("status"), form.full), ...(form.operand.kind === "memory" ? [commitAddressUpdates()] : [])], { mode: "mode", code: "code" })];
      break;
    case "user-stack":
      name = `MOVE ${form.load ? `USP,${form.register.toUpperCase()}` : `${form.register.toUpperCase()},USP`}`;
      explanation = "Check privilege before selecting An's identity. Capture the complete source before writing the destination; A7 selects SSP in supervisor mode. Preserve every flag.";
      steps = [...privileged(), ...withRegister(form.register, "addressSupervisor", register => [
        readRegister("source", form.load ? cpu.register("usp") : register), writeRegister(form.load ? register : cpu.register("usp"), value("source"))])];
      break;
    case "exception":
      name = form.body === "TRAP" ? "TRAP #n" : form.body;
      explanation = "Request synchronous exception delivery without changing state here. The CPU boundary selects the vector and saved PC, and owns frame entry, trace, and nested faults.";
      steps = [reject(form.reason)];
      break;
    case "simple":
      name = form.operation;
      switch (form.operation) {
        case "RESET":
          explanation = "Check privilege before asserting the device reset connection. Record the reset only after the callback succeeds. Preserve CPU state; callback failure prevents retirement.";
          steps = [...privileged(), resetDevices()]; break;
        case "NOP": explanation = "No effects after opcode fetching."; steps = []; break;
        case "STOP":
          explanation = "Check privilege before fetching the complete status word. Restore SR, including S/T and interrupt mask, before halting. A failed fetch changes neither status nor halt state.";
          steps = [...privileged(), fetchWord("status"), ...writeStatus(value("status"), true), writeLatch(cpu.latch("halted"), true)]; break;
        case "TRAPV": explanation = "Request overflow-trap delivery only when V is set; preserve every flag and register.";
          steps = [readFlag("overflow", cpu.flag("v")), when(flagValue("overflow"), [reject("overflow-trap")])]; break;
        case "RTE": case "RTR":
          explanation = (form.operation === "RTE" ? "Check privilege, then capture SSP. Read PC high, SR, then PC low through the original supervisor stack. "
            : "Capture the active stack bank. Read the condition-code word, then the complete long return address. ")
            + "Reject odd stack addresses before reading. Validate and select the target before advancing the captured stack by six and restoring status. "
            + "Failed reads or an odd target leave the pointer and status unchanged; switching S never redirects frame reads.";
          steps = statusReturn(form.operation === "RTE"); break;
      }
      break;
  }
  return defineInstruction({ cpu: cpu.declaration, name, explanation, inputs: { mode: 3, code: 3 }, steps });
}

export const system68000 = instructionBodies(systemForms68000, system);
