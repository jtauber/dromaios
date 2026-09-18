import { cpuZ80StateDescription, cpuZ80Status } from "../../state/z80.ts";
import { addOverflow, addWrap, bitAnd, bitOr, bitXor, borrow, capture, carry, cpuSymbols, evenParity, exchangeFlags, flagLiteral, flagValue, halfBorrow, halfCarry, literal, negative, not, overflow,
  readFlag, readLatch, readMemory, readRegister, readSource, replaceFlags, shiftBits, subtract, updateFlags, value, when, writeMemory, writeRegister, zero } from "../model.ts";
import type { FlagExpression, FlagPolicy, InstructionDefinition, Statement } from "../model.ts";
import { immediateByte, registerSource, shift } from "../builders.ts";
import type { ShiftInput } from "../builders.ts";
import { intelAccumulatorRotate, intelAccumulatorTransfers, intelByteAdjustment, intelByteAlu, intelByteSources, intelByteTransfer, intelByteTransfers, intelExchanges, intelJumps, intelRegisterStacks, intelStackTransfer, intelStatusInstructions, intelSubroutines, intelStackExchange, intelWordAdjustment, intelWordArithmetic, intelWordArithmeticFamily, intelWordRegister, intelPairView, intelWordTransfer, intelWordTransfers } from "../intel.ts";
import type { IntelByteOperation } from "../intel.ts";
import { defineInstruction } from "../validate.ts";
import { flagPolicy } from "../status.ts";
import { flagCondition, jump, relativeBranch } from "../control-flow.ts";

const cpu = cpuSymbols("z80", cpuZ80StateDescription);
const conditions = (["z", "c", "pv", "s"] as const).map(flag => cpu.flag(flag));
const conditionNames = ["NZ", "Z", "NC", "C", "PO", "PE", "P", "M"];
const sources = intelByteSources(cpu.register);

const alternate = cpu.bank("alternate");
const bc = intelPairView(cpu, "bc"), de = intelPairView(cpu, "de"), hl = intelPairView(cpu, "hl");

// These bodies replace the complete flag object; any accumulator write follows that replacement.
function resultFlags(name: string, parameters: FlagPolicy["parameters"], updates: Readonly<Record<string, FlagExpression>>) {
  return flagPolicy(cpu, name, { result: 8, ...parameters }, { s: negative(value("result")), z: zero(value("result")), ...updates });
}

function exchangeBank(accumulator: boolean) {
  return defineInstruction({ cpu: cpu.declaration, name: accumulator ? "EX AF,AF′" : "EXX",
    explanation: "Exchange each stored byte in order, reading alternate then main and writing main then alternate. "
      + (accumulator ? "After A, exchange the complete flag objects in the same order, without reading individual flags."
        : "Visit B/C/D/E/H/L, preserving both A registers and both flag objects.") + " No memory or control-state access occurs.",
    steps: [...(accumulator ? ["a"] as const : ["b", "c", "d", "e", "h", "l"] as const).flatMap(register => [
      readRegister(`${register}Alternate`, alternate.register(register)), readRegister(`${register}Main`, cpu.register(register)),
      writeRegister(cpu.register(register), value(`${register}Alternate`)), writeRegister(alternate.register(register), value(`${register}Main`))]),
      ...(accumulator ? [exchangeFlags(cpu.flags, alternate.flags)] : [])],
  });
}

function specialTransfer(register: "i" | "r", load: boolean) {
  const name = load ? `LD A,${register.toUpperCase()}` : `LD ${register.toUpperCase()},A`;
  return defineInstruction({ cpu: cpu.declaration, name,
    explanation: "Entry follows opcode decoding and refresh increments. " + (load
      ? "Capture the special register, IFF2, then C. Replace flags with S/Z from the byte, PV from IFF2, H/N clear, and captured C; then write A."
      : "Copy A into the whole special register, including R bit 7, without accessing flags or latches."),
    steps: load ? [readRegister("result", cpu.register(register)), readLatch("enabled", cpu.latch("iff2")), readFlag("carry", cpu.flag("c")),
      replaceFlags(resultFlags(name, { enabled: "flag", carry: "flag" }, {
        h: flagLiteral(false), pv: flagValue("enabled"), n: flagLiteral(false), c: flagValue("carry"),
      }), { result: value("result"), enabled: flagValue("enabled"), carry: flagValue("carry") }), writeRegister(cpu.register("a"), value("result"))]
      : [readRegister("byte", cpu.register("a")), writeRegister(cpu.register(register), value("byte"))],
  });
}

function rotateDigits(left: boolean) {
  const name = left ? "RLD" : "RRD", memory = value("memory"), a = value("accumulator"), low = bitAnd(a, literal(8, 0x0f));
  const nextMemory = left ? bitOr(shiftBits(memory, "left", 4), low) : bitOr(shiftBits(low, "left", 4), shiftBits(memory, "right", 4));
  const nextA = bitOr(bitAnd(a, literal(8, 0xf0)), left ? shiftBits(memory, "right", 4) : bitAnd(memory, literal(8, 0x0f)));
  return defineInstruction({ cpu: cpu.declaration, name,
    explanation: `Capture HL, read memory, then capture A. Rotate A's low nibble and both memory nibbles ${left ? "left" : "right"}, preserving A's high nibble. `
      + "Write memory before reading C, replacing S/Z/parity with H/N cleared, and writing A. A failed write preserves A and flags; callbacks cannot change the captured address or result.",
    steps: [readSource("address", hl.source), readMemory("memory", value("address")), readRegister("accumulator", cpu.register("a")),
      capture("result", nextA), writeMemory(value("address"), nextMemory), readFlag("carry", cpu.flag("c")),
      replaceFlags(resultFlags(name, { carry: "flag" }, { h: flagLiteral(false), pv: evenParity(value("result")), n: flagLiteral(false), c: flagValue("carry") }),
        { result: value("result"), carry: flagValue("carry") }), writeRegister(cpu.register("a"), value("result"))],
  });
}

function block(delta: -1 | 1, compare: boolean, repeat: boolean) {
  const name = `${compare ? "CP" : "LD"}${delta === 1 ? "I" : "D"}${repeat ? "R" : ""}`;
  const advance = (name: string) => (delta === 1 ? addWrap : subtract)(value(name), literal(16, 1));
  const rewind = [readRegister("pc", cpu.register("pc")), writeRegister(cpu.register("pc"), subtract(value("pc"), literal(16, 2)))];
  return defineInstruction({ cpu: cpu.declaration, name,
    explanation: "Perform one iteration. Read (HL), then capture BC minus one with word wrapping. "
      + (compare ? "Read A and C, replace comparison flags with PV from the remaining count, and preserve A. "
        : "Read DE and write the captured byte; after success reread and adjust DE, clear N/H, then set PV from the captured count. Preserve S/Z/C. ")
      + `Reread and ${delta === 1 ? "increment" : "decrement"} HL, then write the captured count to BC. `
      + (repeat ? `Only if the count is nonzero${compare ? " and the updated Z is clear" : ""}, rewind current PC by two for the next step to refetch both opcodes. ` : "Do not access PC. ")
      + "Pairs read and write high byte first. Failed accesses retain completed effects and prevent later register/flag updates; decoding and retirement stay in the CPU.",
    steps: [readSource("address", hl.source), readMemory("byte", value("address")), readSource("counter", bc.source),
      capture("count", subtract(value("counter"), literal(16, 1))),
      ...(compare ? [readRegister("accumulator", cpu.register("a")), capture("result", subtract(value("accumulator"), value("byte"))), readFlag("carry", cpu.flag("c")),
        replaceFlags(resultFlags(name, { accumulator: 8, byte: 8, count: 16, carry: "flag" }, {
          h: halfBorrow(value("accumulator"), value("byte")), pv: not(zero(value("count"))), n: flagLiteral(true), c: flagValue("carry"),
        }), { result: value("result"), accumulator: value("accumulator"), byte: value("byte"), count: value("count"), carry: flagValue("carry") })]
        : [readSource("destination", de.source), writeMemory(value("destination"), value("byte")),
          readSource("destinationAfterWrite", de.source), ...de.write(advance("destinationAfterWrite")),
          updateFlags(flagPolicy(cpu, name, { count: 16 }, { n: flagLiteral(false), h: flagLiteral(false), pv: not(zero(value("count"))) }), { count: value("count") })]),
      readSource("addressAfterTransfer", hl.source), ...hl.write(advance("addressAfterTransfer")), ...bc.write(value("count")),
      ...(repeat ? [when(not(zero(value("count"))), compare ? [readFlag("matched", cpu.flag("z")), when(not(flagValue("matched")), rewind)] : rewind)] : [])],
  });
}

function wordTransferName(register: string, operation: "immediate" | "load" | "store" | "copy"): string {
  const name = register.toUpperCase();
  return { immediate: `LD ${name},nn`, load: `LD ${name},(nn)`, store: `LD (nn),${name}`, copy: `LD SP,${name}` }[operation];
}

function wordFlags(mnemonic: "ADD" | "ADC" | "SBC"): FlagPolicy {
  const subtracting = mnemonic === "SBC", withCarry = mnemonic !== "ADD";
  const left = value("left"), right = value("right"), result = value("result"), incoming = withCarry ? flagValue("carry") : undefined;
  // At bit 12, left XOR right XOR result isolates the carry/borrow out of bit 11, including incoming C.
  const half = not(zero(bitAnd(bitXor(bitXor(left, right), result), literal(16, 0x1000))));
  const h = { flag: cpu.flag("h"), value: half }, c = { flag: cpu.flag("c"), value: (subtracting ? borrow : carry)(left, right, incoming) };
  const n = { flag: cpu.flag("n"), value: flagLiteral(subtracting) };
  return { name: `Z80 ${mnemonic} word flags (H at bit 11)`,
    parameters: { left: 16, right: 16, result: 16, ...(withCarry ? { carry: "flag" as const } : {}) }, unlisted: "preserve",
    updates: withCarry ? [
      { flag: cpu.flag("s"), value: negative(result) }, { flag: cpu.flag("z"), value: zero(result) }, h,
      { flag: cpu.flag("pv"), value: (subtracting ? overflow : addOverflow)(left, right, incoming) }, n, c,
    ] : [h, c, n],
  };
}

const wordAdditionFlags = wordFlags("ADD");

function adjustment(mnemonic: "INC" | "DEC") {
  const increment = mnemonic === "INC", original = value("original"), one = literal(8, 1);
  return intelByteAdjustment(cpu, mnemonic, increment ? 1 : -1,
    { name: `Z80 ${mnemonic}`, parameters: { original: 8, result: 8 }, unlisted: "preserve", updates: [
      { flag: cpu.flag("s"), value: negative(value("result")) }, { flag: cpu.flag("z"), value: zero(value("result")) },
      { flag: cpu.flag("h"), value: (increment ? halfCarry : halfBorrow)(original, one) },
      { flag: cpu.flag("pv"), value: (increment ? addOverflow : overflow)(original, one) },
      { flag: cpu.flag("n"), value: flagLiteral(!increment) },
    ] }, `${increment ? "Add" : "Subtract"} one with byte wraparound. S/Z describe the result; P/V reports signed overflow. `
      + `H reports low-nibble ${increment ? "carry" : "borrow"}; ${increment ? "clear" : "set"} N. Preserve the alternate bank and control state.`);
}

function rotation(name: string, direction: "left" | "right", circular: boolean): InstructionDefinition {
  return defineInstruction({ cpu: cpu.declaration, name,
    explanation: `Capture A and rotate ${direction}, inserting ${circular ? "the outgoing bit" : "incoming C captured after A"}. `
      + "Write A before replacing C, then clear N/H. Preserve S/Z/PV, the alternate bank, and control state. No data-memory access occurs.",
    steps: [...intelAccumulatorRotate(cpu.register("a"), cpu.flag("c"), direction, circular),
      updateFlags({ name: "Z80 accumulator rotate N/H", parameters: {}, unlisted: "preserve", updates: [
        { flag: cpu.flag("n"), value: flagLiteral(false) }, { flag: cpu.flag("h"), value: flagLiteral(false) },
      ] }, {})],
  });
}

/** CB bodies read once; memory uses a resolved address, and BIT omits writeback entirely. */
function cbFamily(mnemonic: string, steps: readonly Statement[], explanation: string, bit?: number, writeBack = true) {
  return Object.fromEntries((["b", "c", "d", "e", "h", "l", "a", "memory"] as const).map(target => {
    const memory = target === "memory";
    const accesses = writeBack ? "one read and one write, even if the byte is unchanged" : "one read without writing";
    return [`${mnemonic.toLowerCase()}${bit ?? ""}${memory ? "Memory" : target.toUpperCase()}`, defineInstruction({
      cpu: cpu.declaration, name: `${mnemonic} ${bit === undefined ? "" : `${bit},`}${memory ? "memory" : target.toUpperCase()}`,
      ...(memory ? { inputs: { address: 16 as const } } : {}),
      explanation: (memory ? `Use the resolved HL or indexed address for ${accesses}. ` : "Read the selected byte register. ") + explanation,
      steps: [memory ? readMemory("original", value("address")) : readRegister("original", cpu.register(target)),
        ...steps, ...(writeBack ? [memory ? writeMemory(value("address"), value("result")) : writeRegister(cpu.register(target), value("result"))] : [])],
    })];
  }));
}

function shiftFamily(mnemonic: string, direction: "left" | "right", incoming: ShiftInput = "zero") {
  const operation = shift(direction, incoming);
  const flags: FlagPolicy = { name: `Z80 ${mnemonic}`, parameters: { original: 8, result: 8 }, unlisted: "preserve", updates: [
    { flag: cpu.flag("s"), value: negative(value("result")) }, { flag: cpu.flag("z"), value: zero(value("result")) },
    { flag: cpu.flag("h"), value: flagLiteral(false) }, { flag: cpu.flag("pv"), value: evenParity(value("result")) },
    { flag: cpu.flag("n"), value: flagLiteral(false) }, { flag: cpu.flag("c"), value: operation.carry },
  ] };
  return cbFamily(mnemonic, [...operation.steps, updateFlags(flags, { original: value("original"), result: value("result") })],
    (typeof incoming === "string" ? `Shift ${direction}, inserting ${incoming === "outgoing" ? "the outgoing bit" : incoming === "sign" ? "the original sign bit" : "zero"}. `
      : `After the operand read, capture C and shift ${direction} through it. `)
    + "Set S/Z and even parity P/V, clear H/N, and copy the outgoing bit to C before writing the result. "
    + "Preserve the alternate bank and control state. A failed read prevents flag updates and writeback; a failed write retains the calculated flags.");
}

const bitFlags: FlagPolicy = { name: "Z80 BIT", parameters: { result: 8 }, unlisted: "preserve", updates: [
  // The model follows observed S/PV behavior: only bit 7 can set S, and PV equals Z.
  { flag: cpu.flag("s"), value: negative(value("result")) }, { flag: cpu.flag("z"), value: zero(value("result")) },
  { flag: cpu.flag("h"), value: flagLiteral(true) }, { flag: cpu.flag("pv"), value: zero(value("result")) },
  { flag: cpu.flag("n"), value: flagLiteral(false) },
] };

function bitFamily(mnemonic: "BIT" | "RES" | "SET") {
  return Object.fromEntries(Array.from({ length: 8 }, (_, bit) => {
    const mask = 1 << bit, testing = mnemonic === "BIT";
    // BIT isolates its bit; RES ANDs with its byte complement; SET ORs with the mask.
    const result = (mnemonic === "SET" ? bitOr : bitAnd)(value("original"), literal(8, mnemonic === "RES" ? 0xff ^ mask : mask));
    return Object.entries(cbFamily(mnemonic, [capture("result", result),
      ...(testing ? [updateFlags(bitFlags, { result: value("result") })] : [])],
      (testing ? `Test bit ${bit} without writing the operand. Z/PV indicate a clear bit; S is set only for a set bit 7. Set H and clear N; preserve C without reading it. `
        : `${mnemonic === "RES" ? "Clear" : "Set"} bit ${bit} and write the result, even if unchanged. Do not read or write flags. `)
      + "Preserve the alternate bank and control state. A failed read prevents later effects.", bit, !testing));
  }).flat());
}

// ooo selects ADD/ADC/SUB/SBC/AND/XOR/OR/CP in the unprefixed and DD/FD ALU families.
// Arithmetic P/V means signed overflow; logic uses parity. H reports carry/borrow, never its inverse.
function family(mnemonic: string, operation: IntelByteOperation, withCarry = false) {
  const adding = operation === "add", subtracting = operation === "subtract" || operation === "compare";
  const left = value("left"), right = value("right"), result = value("result"), incoming = withCarry ? flagValue("carry") : undefined;
  const flags: FlagPolicy = { name: `Z80 ${mnemonic}`, parameters: { left: 8, right: 8, result: 8, ...(withCarry ? { carry: "flag" as const } : {}) }, unlisted: "preserve",
    updates: [
      { flag: cpu.flag("s"), value: negative(result) }, { flag: cpu.flag("z"), value: zero(result) },
      { flag: cpu.flag("h"), value: adding ? halfCarry(left, right, incoming) : subtracting ? halfBorrow(left, right, incoming) : flagLiteral(operation === "and") },
      { flag: cpu.flag("pv"), value: adding ? addOverflow(left, right, incoming) : subtracting ? overflow(left, right, incoming) : evenParity(result) },
      { flag: cpu.flag("n"), value: flagLiteral(subtracting) },
      { flag: cpu.flag("c"), value: adding ? carry(left, right, incoming) : subtracting ? borrow(left, right, incoming) : flagLiteral(false) },
    ],
  };
  return Object.fromEntries([...sources, ["Memory", undefined] as const].map(([suffix, source]) => {
    const memory = source === undefined, operand = memory ? "memory" : suffix === "M" ? "(HL)" : suffix === "byte" ? "n" : suffix;
    return [`${mnemonic.toLowerCase()}${suffix === "byte" ? "Immediate" : suffix}`, defineInstruction({
      cpu: cpu.declaration, name: `${mnemonic} ${adding || withCarry ? "A," : ""}${operand}`,
      ...(memory ? { inputs: { address: 16 as const } } : {}),
      explanation: (memory ? "Entry follows indexed address resolution. Read the byte at that captured address. " : "Read the operand. ")
        + (withCarry ? "Capture incoming C, then read A. " : "Read A without reading incoming flags. ")
        + "S/Z describe the byte result. "
        + (adding || subtracting ? `P/V is signed overflow; H and C report low-nibble and byte ${adding ? "carry" : "borrow"}. `
          : `P/V is even parity; ${operation === "and" ? "set" : "clear"} H and clear C. `)
        + `${subtracting ? "Set" : "Clear"} N. Apply flags, then ${operation === "compare" ? "retain A without a write" : "write A"}. `
        + "Preserve the alternate bank and control state. A failed read prevents flag updates and writeback; completed decoding and fetching remain.",
      steps: [memory ? readMemory("right", value("address")) : readSource("right", source),
        ...intelByteAlu(cpu.register("a"), operation, flags, withCarry ? cpu.flag("c") : undefined)],
    })];
  }));
}

export const instructionsZ80 = {
  exchangeAf: exchangeBank(true), exchangeGeneralBanks: exchangeBank(false),
  loadAFromI: specialTransfer("i", true), loadAFromR: specialTransfer("r", true),
  loadIFromA: specialTransfer("i", false), loadRFromA: specialTransfer("r", false),
  neg: defineInstruction({ cpu: cpu.declaration, name: "NEG",
    explanation: "Capture A and subtract it from zero. Replace all flags with S/Z from the result, nibble/byte borrow, signed overflow, and N set; then write A. No incoming flag or memory access occurs.",
    steps: [readRegister("original", cpu.register("a")), capture("result", subtract(literal(8, 0), value("original"))),
      replaceFlags(resultFlags("NEG", { original: 8 }, { h: halfBorrow(literal(8, 0), value("original")), pv: overflow(literal(8, 0), value("original")),
        n: flagLiteral(true), c: borrow(literal(8, 0), value("original")) }), { original: value("original"), result: value("result") }),
      writeRegister(cpu.register("a"), value("result"))],
  }),
  rld: rotateDigits(true), rrd: rotateDigits(false),
  ldi: block(1, false, false), ldd: block(-1, false, false), ldir: block(1, false, true), lddr: block(-1, false, true),
  cpi: block(1, true, false), cpd: block(-1, true, false), cpir: block(1, true, true), cpdr: block(-1, true, true),
  ...intelStatusInstructions(cpu, cpuZ80Status, "z80"),
  ...intelRegisterStacks(cpu, (register, operation) => `${operation.toUpperCase()} ${register.toUpperCase()}`),
  ...Object.fromEntries((["ix", "iy"] as const).flatMap(register => (["push", "pop"] as const).map(operation =>
    [`${operation}${register.toUpperCase()}`, intelStackTransfer(cpu, cpu.register(register), operation, `${operation.toUpperCase()} ${register.toUpperCase()}`)]))),
  ...intelSubroutines(cpu, conditions, {
    call: condition => condition === undefined ? "CALL nn" : `CALL ${conditionNames[condition]},nn`,
    return: condition => condition === undefined ? "RET" : `RET ${conditionNames[condition]}`,
    restart: address => `RST ${address.toString(16).toUpperCase().padStart(2, "0")}H`,
  }),
  ...intelJumps(cpu, conditions,
    condition => typeof condition === "number" ? `JP ${conditionNames[condition]},nn`
      : condition === "absolute" ? "JP nn" : "JP (HL)"),
  jr: relativeBranch(cpu, "JR e", immediateByte),
  ...Object.fromEntries((["NZ", "Z", "NC", "C"] as const).map((name, index) =>
    [`jr${name}`, relativeBranch(cpu, `JR ${name},e`, immediateByte, flagCondition(cpu.flag(index < 2 ? "z" : "c"), Boolean(index & 1)))])),
  djnz: defineInstruction({ ...relativeBranch(cpu, "DJNZ e", immediateByte, {
    steps: [readRegister("counter", cpu.register("b")), writeRegister(cpu.register("b"), subtract(value("counter"), literal(8, 1))),
      readRegister("remaining", cpu.register("b"))], test: not(zero(value("remaining"))),
  }), explanation: "Fetch the displacement, then decrement B with byte wraparound without accessing flags. Read B again; if nonzero, "
    + "add the signed displacement to the post-fetch PC with word wraparound. If zero, do not read or write PC. A failed fetch prevents the decrement. Preserve other registers." }),
  ...Object.fromEntries((["ix", "iy"] as const).map(index =>
    [`jump${index.toUpperCase()}`, jump(cpu, `JP (${index.toUpperCase()})`, registerSource(cpu.register(index)))])),
  ...intelByteTransfers(cpu, "LD", "LD", "(HL)"),
  ...intelAccumulatorTransfers(cpu, (address, operation) => operation === "store" ? `LD (${address === "absolute" ? "nn" : address.toUpperCase()}),A`
    : `LD A,(${address === "absolute" ? "nn" : address.toUpperCase()})`),
  ...intelWordTransfers(cpu, wordTransferName),
  ...intelExchanges(cpu, operation => operation === "stack" ? "EX (SP),HL" : "EX DE,HL"),
  ...intelWordArithmeticFamily(cpu, wordAdditionFlags, (register, operation) => operation === "add" ? `ADD HL,${register.toUpperCase()}`
    : `${operation === "increment" ? "INC" : "DEC"} ${register.toUpperCase()}`),
  // ED 01 pp q 010: pp selects BC/DE/HL/SP; q=0 subtracts with carry, q=1 adds with carry.
  ...Object.fromEntries((["SBC", "ADC"] as const).flatMap(mnemonic => (["bc", "de", "hl", "sp"] as const).map(register =>
    [`${mnemonic.toLowerCase()}HL${register.toUpperCase()}`, intelWordArithmetic(cpu, intelWordRegister(cpu, "hl"), intelWordRegister(cpu, register),
      mnemonic === "SBC" ? "subtract" : "add", wordFlags(mnemonic), `${mnemonic} HL,${register.toUpperCase()}`, cpu.flag("c"))]))),
  // DD/FD 00 pp 1 001 replaces both destination HL and pp=10 with IX/IY; 00 10 q 011 adjusts the index.
  ...Object.fromEntries((["ix", "iy"] as const).flatMap(index => [
    ...(["bc", "de", index, "sp"] as const).map((register): readonly [string, InstructionDefinition] => [`add${index.toUpperCase()}${register.toUpperCase()}`,
      intelWordArithmetic(cpu, cpu.register(index), register === "ix" || register === "iy" ? cpu.register(register) : intelWordRegister(cpu, register),
        "add", wordAdditionFlags, `ADD ${index.toUpperCase()},${register.toUpperCase()}`)]),
    ...(["INC", "DEC"] as const).map((mnemonic): readonly [string, InstructionDefinition] => [`${mnemonic.toLowerCase()}${index.toUpperCase()}Word`,
      intelWordAdjustment(cpu, cpu.register(index), mnemonic === "INC" ? 1 : -1, `${mnemonic} ${index.toUpperCase()}`)]),
  ])),
  // ED 01 pp d 011: HL shares its base-page bodies; the other pairs add load/store bodies.
  ...Object.fromEntries((["bc", "de", "sp"] as const).flatMap(register => (["load", "store"] as const).map(operation =>
    [`${operation}${register.toUpperCase()}Memory`, intelWordTransfer(cpu, intelWordRegister(cpu, register), operation, wordTransferName(register, operation))]))),
  // DD/FD replace HL with IX/IY for immediate, absolute-memory, and SP loads.
  ...Object.fromEntries((["ix", "iy"] as const).flatMap(register => (["immediate", "load", "store", "copy"] as const).map(operation =>
    [`${operation}${register.toUpperCase()}Word`, intelWordTransfer(cpu, cpu.register(register), operation, wordTransferName(register, operation))]))),
  // DD/FD 11 100 011: exchange IX/IY with the word at SP, without a displacement or SP update.
  ...Object.fromEntries((["ix", "iy"] as const).map(register =>
    [`exchange${register.toUpperCase()}Word`, intelStackExchange(cpu, cpu.register(register), `EX (SP),${register.toUpperCase()}`)])),
  // DD/FD 01 rrr 110 / 01 110 rrr: use real H/L with a resolved IX/IY address; rrr=110 is excluded.
  ...Object.fromEntries((["b", "c", "d", "e", "h", "l", "a"] as const).flatMap(register => [
    [`load${register.toUpperCase()}Memory`, intelByteTransfer(cpu, register, "m", `LD ${register.toUpperCase()},memory`, "resolved")],
    [`store${register.toUpperCase()}Memory`, intelByteTransfer(cpu, "m", register, `LD memory,${register.toUpperCase()}`, "resolved")],
  ])),
  // DD/FD 00 110 110: the decoder fetches d and resolves the address before the body fetches n.
  storeImmediateMemory: intelByteTransfer(cpu, "m", "immediate", "LD memory,n", "resolved"),
  // 00 rrr 10d: rrr selects B/C/D/E/H/L/(HL)/A; d=0 increments, d=1 decrements.
  // Each memory body also serves DD/FD 00 110 10d after indexed address resolution.
  ...adjustment("INC"), ...adjustment("DEC"),
  // 00 ooo 111: ooo=000/001 rotates A circularly; 010/011 rotates through C. Preserve S/Z/PV.
  rlca: rotation("RLCA", "left", true), rrca: rotation("RRCA", "right", true),
  rla: rotation("RLA", "left", false), rra: rotation("RRA", "right", false),
  // CB 00 yyy rrr: yyy selects the operation; rrr selects B/C/D/E/H/L/(HL)/A.
  // One resolved-memory body also serves DD/FD CB d 00 yyy 110. yyy=110 is undocumented SLL.
  ...shiftFamily("RLC", "left", "outgoing"), // 000
  ...shiftFamily("RRC", "right", "outgoing"), // 001
  ...shiftFamily("RL", "left", cpu.flag("c")), // 010
  ...shiftFamily("RR", "right", cpu.flag("c")), // 011
  ...shiftFamily("SLA", "left"), // 100
  ...shiftFamily("SRA", "right", "sign"), // 101
  ...shiftFamily("SRL", "right"), // 111
  // CB xx bbb rrr: xx=01/10/11 selects BIT/RES/SET; bbb selects bit 0..7.
  ...bitFamily("BIT"), ...bitFamily("RES"), ...bitFamily("SET"),
  // ooo in 10 ooo rrr / 11 ooo 110 selects the same byte ALU family.
  ...family("ADD", "add"), // 000
  ...family("ADC", "add", true), // 001
  ...family("SUB", "subtract"), // 010
  ...family("SBC", "subtract", true), // 011
  ...family("AND", "and"), // 100
  ...family("XOR", "xor"), // 101
  ...family("OR", "or"), // 110
  ...family("CP", "compare"), // 111
};
