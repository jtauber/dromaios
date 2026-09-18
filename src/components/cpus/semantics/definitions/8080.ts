import { cpu8080StateDescription, cpu8080Status } from "../../state/8080.ts";
import { bitAnd, bitOr, borrow, carry, cpuSymbols, deferInterrupt, evenParity, extend, fetchByte, flagLiteral, flagValue, halfBorrow, halfCarry, literal, negative, not, readSource, value, writeLatch, zero } from "../model.ts";
import type { FlagExpression, FlagPolicy, InstructionDefinition, Statement, ValueSource } from "../model.ts";
import { intelAccumulatorRotate, intelAccumulatorTransfers, intelByteAdjustment, intelByteAlu, intelByteSources, intelByteTransfers, intelExchanges, intelJumps, intelRegisterStacks, intelStatusInstructions, intelSubroutines, intelWordArithmeticFamily, intelWordTransfers } from "../intel.ts";
import { defineInstruction } from "../validate.ts";
import { registerView } from "../builders.ts";
import { portTransfer } from "../ports.ts";

const cpu = cpuSymbols("8080", cpu8080StateDescription);
const conditions = (["z", "cy", "p", "s"] as const).map(flag => cpu.flag(flag));

const immediatePort: ValueSource = { name: "zero-extended immediate port", width: 16,
  steps: [fetchByte("port")], result: extend(value("port"), 16) };
const sources = intelByteSources(cpu.register);

/** S/Z/P describe the captured result; every ALU operation supplies its own CY/AC meaning. */
function aluFlags(name: string, cy: FlagExpression, ac: FlagExpression, withCarry = false): FlagPolicy {
  return { name: `8080 ${name}`, parameters: { left: 8, right: 8, result: 8, ...(withCarry ? { carry: "flag" as const } : {}) }, unlisted: "preserve",
    updates: [
      { flag: cpu.flag("s"), value: negative(value("result")) }, { flag: cpu.flag("z"), value: zero(value("result")) },
      { flag: cpu.flag("p"), value: evenParity(value("result")) }, { flag: cpu.flag("cy"), value: cy }, { flag: cpu.flag("ac"), value: ac },
    ],
  };
}
const left = value("left"), right = value("right");
const comparisonFlags = aluFlags("comparison", borrow(left, right), not(halfBorrow(left, right)));

function adjustment(mnemonic: "INR" | "DCR") {
  const increment = mnemonic === "INR", original = value("original"), one = literal(8, 1);
  return intelByteAdjustment(cpu, mnemonic, increment ? 1 : -1,
    { name: `8080 ${mnemonic}`, parameters: { original: 8, result: 8 }, unlisted: "preserve", updates: [
      { flag: cpu.flag("s"), value: negative(value("result")) }, { flag: cpu.flag("z"), value: zero(value("result")) },
      { flag: cpu.flag("p"), value: evenParity(value("result")) },
      { flag: cpu.flag("ac"), value: increment ? halfCarry(original, one) : not(halfBorrow(original, one)) },
    ] }, `${increment ? "Add" : "Subtract"} one with byte wraparound. S/Z describe the result and P its even parity. `
      + `AC reports ${increment ? "low-nibble carry" : "inverse low-nibble borrow"}.`);
}

/** Expand a complete register/memory/immediate family; the resulting definitions contain only data. */
function aluFamily(mnemonic: string, immediate: string, steps: (source: ValueSource) => readonly Statement[], explanation: string) {
  return Object.fromEntries(sources.map(([name, source]) => [
    name === "byte" ? immediate.toLowerCase() : `${mnemonic.toLowerCase()}${name}`,
    defineInstruction({ cpu: cpu.declaration, name: `${name === "byte" ? immediate : mnemonic} ${name}`, explanation, steps: steps(source) }),
  ]));
}

function binaryArithmetic(mnemonic: string, immediate: string, operation: "add" | "subtract", withCarry = false) {
  const adding = operation === "add", incoming = withCarry ? flagValue("carry") : undefined;
  const flags = aluFlags(adding ? "addition" : "subtraction", (adding ? carry : borrow)(left, right, incoming),
    adding ? halfCarry(left, right, incoming) : not(halfBorrow(left, right, incoming)), withCarry);
  return aluFamily(mnemonic, immediate, source => [
    readSource("right", source), ...intelByteAlu(cpu.register("a"), operation, flags, withCarry ? cpu.flag("cy") : undefined),
  ], `Read the operand, ${withCarry ? "capture incoming CY, then read A" : "then read A without reading incoming flags"}. `
    + `S/Z describe the byte result and P its even parity. CY reports ${adding ? "carry" : "borrow"}; `
    + `AC reports ${adding ? "low-nibble carry" : "the inverse low-nibble borrow"}. `
    + "Apply flags before writing A. A failed operand read prevents flag updates and writeback; completed fetches remain.");
}

function logic(mnemonic: "ANA" | "XRA" | "ORA", immediate: string) {
  const operation = ({ ANA: "and", XRA: "xor", ORA: "or" } as const)[mnemonic];
  const auxiliary = mnemonic === "ANA" ? not(zero(bitAnd(bitOr(left, right), literal(8, 0x08)))) : flagLiteral(false);
  const flags = aluFlags(mnemonic, flagLiteral(false), auxiliary);
  return aluFamily(mnemonic, immediate, source => [
    readSource("right", source), ...intelByteAlu(cpu.register("a"), operation, flags),
  ], "Read the operand before A; do not read incoming flags. S/Z describe the byte result and P its even parity. "
    + (mnemonic === "ANA" ? "Clear CY; AC is bit 3 of the original A OR the operand. " : "Clear CY and AC. ")
    + "Apply flags before writing A. A failed operand read prevents flag updates and writeback; completed fetches remain.");
}

function rotation(name: string, direction: "left" | "right", circular: boolean): InstructionDefinition {
  return defineInstruction({
    cpu: cpu.declaration, name,
    explanation: `Capture A and rotate ${direction}, inserting ${circular ? "the outgoing bit" : "the captured incoming CY"}. `
      + "Write A before replacing CY with the outgoing bit. Preserve S, Z, AC, and P; no data-memory access occurs.",
    steps: intelAccumulatorRotate(cpu.register("a"), cpu.flag("cy"), direction, circular),
  });
}

export const instructions8080 = {
  di: defineInstruction({ cpu: cpu.declaration, name: "DI", explanation: "Clear interrupt enable without changing deferral until retirement.",
    steps: [writeLatch(cpu.latch("interruptEnabled"), false)] }),
  ei: defineInstruction({ cpu: cpu.declaration, name: "EI", explanation: "Set interrupt enable, then request IRQ inhibition through the following instruction at successful retirement.",
    steps: [writeLatch(cpu.latch("interruptEnabled"), true), deferInterrupt("irq")] }),
  input: portTransfer(cpu.declaration, "IN n", immediatePort, registerView(cpu.register("a")), false),
  output: portTransfer(cpu.declaration, "OUT n", immediatePort, registerView(cpu.register("a")), true),
  ...intelStatusInstructions(cpu, cpu8080Status, "8080"),
  ...intelRegisterStacks(cpu, (register, operation) => `${operation.toUpperCase()} ${register[0]!.toUpperCase()}`),
  ...intelSubroutines(cpu, conditions, {
    call: condition => condition === undefined ? "CALL" : ["CNZ", "CZ", "CNC", "CC", "CPO", "CPE", "CP", "CM"][condition]!,
    return: condition => condition === undefined ? "RET" : ["RNZ", "RZ", "RNC", "RC", "RPO", "RPE", "RP", "RM"][condition]!,
    restart: address => `RST ${address / 8}`,
  }),
  ...intelJumps(cpu, conditions,
    condition => typeof condition === "number" ? ["JNZ", "JZ", "JNC", "JC", "JPO", "JPE", "JP", "JM"][condition]!
      : condition === "absolute" ? "JMP" : "PCHL"),
  ...intelByteTransfers(cpu, "MOV", "MVI", "M"),
  ...intelAccumulatorTransfers(cpu, (address, operation) => address === "absolute" ? `${operation === "store" ? "STA" : "LDA"} nn`
    : `${operation === "store" ? "STAX" : "LDAX"} ${address === "bc" ? "B" : "D"}`),
  ...intelWordTransfers(cpu, (register, operation) => operation === "immediate"
    ? `LXI ${{ bc: "B", de: "D", hl: "H", sp: "SP" }[register]},nn`
    : { load: "LHLD nn", store: "SHLD nn", copy: "SPHL" }[operation]),
  ...intelExchanges(cpu, operation => operation === "stack" ? "XTHL" : "XCHG"),
  ...intelWordArithmeticFamily(cpu, { name: "8080 DAD carry", parameters: { left: 16, right: 16, result: 16 }, unlisted: "preserve",
    updates: [{ flag: cpu.flag("cy"), value: carry(left, right) }] },
    (register, operation) => `${{ increment: "INX", decrement: "DCX", add: "DAD" }[operation]} ${{ bc: "B", de: "D", hl: "H", sp: "SP" }[register]}`),
  // 00 rrr 10d: rrr selects B/C/D/E/H/L/M/A; d=0 increments, d=1 decrements.
  ...adjustment("INR"), ...adjustment("DCR"),
  // 00 ooo 111: ooo=000/001 selects circular left/right; 010/011 rotates through CY.
  rlc: rotation("RLC", "left", true), rrc: rotation("RRC", "right", true),
  ral: rotation("RAL", "left", false), rar: rotation("RAR", "right", false),
  // ooo in 10 ooo rrr / 11 ooo 110 selects these eight ALU families.
  ...binaryArithmetic("ADD", "ADI", "add"), // 000
  ...binaryArithmetic("ADC", "ACI", "add", true), // 001
  ...binaryArithmetic("SUB", "SUI", "subtract"), // 010
  ...binaryArithmetic("SBB", "SBI", "subtract", true), // 011
  ...logic("ANA", "ANI"), // 100
  ...logic("XRA", "XRI"), // 101
  ...logic("ORA", "ORI"), // 110
  ...aluFamily("CMP", "CPI", source => [readSource("right", source), ...intelByteAlu(cpu.register("a"), "compare", comparisonFlags)], // 111
    "Retain A without a destination write. S/Z describe the byte result, P its even parity, "
      + "CY the borrow, and AC the inverse borrow at the low-nibble boundary."),
};
