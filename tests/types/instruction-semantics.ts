import { cpu6502StateDescription } from "../../src/components/cpus/6502.js";
import { cpu8080StateDescription } from "../../src/components/cpus/8080.js";
import { bitAnd, bitOr, bitXor, cpuSymbols, flagValue, highByte, literal, not, readFlag, shiftLeft, value, xor, zero } from "../../src/components/cpus/semantics/model.js";
import type { FlagPolicy, NumberExpression, Statement } from "../../src/components/cpus/semantics/model.js";
import { instructions as generated6502, sourceReaders } from "../../src/components/cpus/generated/6502.js";
import { instructions as generated8080 } from "../../src/components/cpus/generated/8080.js";
import { instructions as generated6809 } from "../../src/components/cpus/generated/6809.js";
import { instructions as generated6800 } from "../../src/components/cpus/generated/6800.js";
import type { Cpu6800State } from "../../src/components/cpus/6800.js";
import type { Cpu6502State } from "../../src/components/cpus/6502.js";
import type { Cpu8080State } from "../../src/components/cpus/8080.js";
import type { Cpu6809State } from "../../src/components/cpus/6809.js";

// Compiled, never called: names come from CPU schemas; reads, expressions, and writes have distinct roles.
export function checkInstructionSemantics(): void {
  const mos = cpuSymbols("6502", cpu6502StateDescription), intel = cpuSymbols("8080", cpu8080StateDescription);
  mos.register("a");
  intel.flag("cy");
  // @ts-expect-error The 6502 has no B register.
  mos.register("b");
  // @ts-expect-error Flags are not unsigned registers.
  mos.register("flags");
  // @ts-expect-error The 8080's spelling is CY.
  intel.flag("c");
  // @ts-expect-error A Boolean test is not a numeric expression.
  const numeric: NumberExpression = zero(literal(8, 0));
  // @ts-expect-error Register descriptions are not captured values.
  not(mos.register("a"));
  // @ts-expect-error Numeric expressions are not Boolean expressions.
  not(value("byte"));
  readFlag("carry", mos.flag("c"));
  shiftLeft(value("byte"), flagValue("carry"));
  xor(flagValue("carry"), zero(value("byte")));
  highByte(value("word"));
  bitAnd(bitOr(value("byte"), literal(8, 0)), bitXor(value("byte"), literal(8, 255)));
  // @ts-expect-error Numeric AND cannot accept Boolean flags.
  bitAnd(flagValue("carry"), value("byte"));
  // @ts-expect-error Numeric OR cannot implicitly read a register.
  bitOr(value("byte"), mos.register("a"));
  // @ts-expect-error Numeric XOR is distinct from Boolean XOR.
  bitXor(value("byte"), flagValue("carry"));
  // @ts-expect-error Byte extraction requires a numeric expression, not a live register.
  highByte(mos.register("pc"));
  // @ts-expect-error Flags cannot be word operands.
  highByte(flagValue("carry"));
  // @ts-expect-error Boolean XOR cannot accept numeric operands.
  xor(value("byte"), flagValue("carry"));
  // @ts-expect-error Reading a flag requires a flag symbol, not a register.
  readFlag("carry", mos.register("a"));
  // @ts-expect-error The incoming bit is Boolean, not an unchecked numeric value.
  shiftLeft(value("byte"), literal(8, 1));
  // @ts-expect-error A captured flag cannot be the numeric shift operand.
  shiftLeft(flagValue("carry"), flagValue("carry"));
  // @ts-expect-error This vocabulary covers 8- and 16-bit values.
  literal(32, 0);
  // @ts-expect-error Immediate values cannot be register destinations.
  const destination: Statement = { kind: "write-register", register: literal(8, 0), value: value("byte") };
  // @ts-expect-error Sources are structured bodies, not effectful callbacks.
  const opaque: Statement = { kind: "read-source", name: "byte", source: () => 0 };
  const policy: FlagPolicy = { name: "zero", parameters: { byte: 8 }, unlisted: "preserve", updates: [
    // @ts-expect-error Flag assignments require Boolean formulas.
    { flag: mos.flag("z"), value: literal(8, 0) },
  ] };
}

export function checkGeneratedInstructionTypes(mos: Cpu6502State, intel: Cpu8080State, motorola: Cpu6809State, m6800: Cpu6800State): void {
  const readers = sourceReaders(mos);
  const address: number = readers.addresses.absoluteX({ fetchByte: () => 0 });
  const byte: number = readers.operands[3]({ fetchByte: () => 0, readByte: () => 0 });
  // @ts-expect-error An indirect address needs pointer reads, even without a final data read.
  readers.addresses.indirectIndexed({ fetchByte: () => 0 });
  // @ts-expect-error The memory operand needs a data read; its address reader does not.
  readers.operands[3]({ fetchByte: () => 0 });
  // @ts-expect-error Reader bindings require the concrete CPU state.
  sourceReaders(intel);
  generated6502[0xaa](mos);
  generated6502[0xc9](mos, { fetchByte: () => 0 });
  generated6502[0xb6](mos, { fetchByte: () => 0, readByte: () => 0 });
  generated6502[0x9a](mos);
  generated6502[0x6a](mos);
  generated6502[0xe8](mos);
  generated6502[0x09](mos, { fetchByte: () => 0 });
  generated6502[0x31](mos, { fetchByte: () => 0, readByte: () => 0 });
  generated6502[0x2c](mos, { fetchByte: () => 0, readByte: () => 0 });
  // @ts-expect-error Immediate EOR cannot access data memory.
  generated6502[0x49](mos, { fetchByte: () => 0, readByte: () => 0 });
  // @ts-expect-error BIT needs the memory operand, not just its address.
  generated6502[0x24](mos, { fetchByte: () => 0 });
  // @ts-expect-error Logical instructions cannot write data memory.
  generated6502[0x05](mos, { fetchByte: () => 0, readByte: () => 0, writeByte: () => {} });
  generated6502[0x8d](mos, { fetchByte: () => 0, writeByte: () => {} });
  generated6502[0x96](mos, { fetchByte: () => 0, writeByte: () => {} });
  generated6502[0x91](mos, { fetchByte: () => 0, readByte: () => 0, writeByte: () => {} });
  // @ts-expect-error Absolute stores cannot read destination memory.
  generated6502[0x8d](mos, { fetchByte: () => 0, readByte: () => 0, writeByte: () => {} });
  // @ts-expect-error Indirect stores still require pointer reads.
  generated6502[0x91](mos, { fetchByte: () => 0, writeByte: () => {} });
  // @ts-expect-error Stores require a write callback even when the memory byte is unchanged.
  generated6502[0x85](mos, { fetchByte: () => 0 });
  // @ts-expect-error Accumulator rotates need no memory or fetching context.
  generated6502[0x6a](mos, { fetchByte: () => 0 });
  generated8080.cmpB(intel);
  generated8080.ral(intel);
  generated6809.rolB(motorola);
  generated6809.rolMemory(motorola, 0xffff, { readByte: () => 0, writeByte: () => {} });
  generated6809.tstMemory(motorola, 0xffff, { readByte: () => 0 });
  generated6809.clrMemory(motorola, 0xffff, { readByte: () => 0, writeByte: () => {} });
  generated6809.negA(motorola);
  generated6809.cmpaMemory(motorola, 0xffff, { readByte: () => 0 });
  generated6809.cmpdMemory(motorola, 0xffff, { readByte: () => 0 });
  generated6809.cmpsImmediate(motorola, { fetchByte: () => 0 });
  // @ts-expect-error Comparison memory bodies cannot fetch or resolve another address.
  generated6809.cmpxMemory(motorola, 0xffff, { readByte: () => 0, fetchByte: () => 0 });
  // @ts-expect-error A comparison cannot write its memory operand.
  generated6809.cmpdMemory(motorola, 0xffff, { readByte: () => 0, writeByte: () => {} });
  generated6800.clrA(m6800);
  generated6800.clrMemory(m6800, 0xffff, { writeByte: () => {} });
  generated6800.tstMemory(m6800, 0xffff, { readByte: () => 0 });
  generated6800.cmpaImmediate(m6800, { fetchByte: () => 0 });
  generated6800.cpxMemory(m6800, 0xffff, { readByte: () => 0 });
  generated6800.cba(m6800);
  // @ts-expect-error CPX needs two explicit byte reads, never a write capability.
  generated6800.cpxMemory(m6800, 0xffff, { readByte: () => 0, writeByte: () => {} });
  // @ts-expect-error The address is already resolved when a memory comparison starts.
  generated6800.cmpbMemory(m6800, 0xffff, { readByte: () => 0, fetchByte: () => 0 });
  // @ts-expect-error CBA needs no instruction context.
  generated6800.cba(m6800, { fetchByte: () => 0 });
  // @ts-expect-error The original 6800 CLR has no read capability.
  generated6800.clrMemory(m6800, 0xffff, { readByte: () => 0, writeByte: () => {} });
  // @ts-expect-error Generated 6800 bodies retain the 6800 state type.
  generated6800.clrA(motorola);
  // @ts-expect-error TST has no write capability.
  generated6809.tstMemory(motorola, 0xffff, { readByte: () => 0, writeByte: () => {} });
  // @ts-expect-error The original 6809 CLR reads its operand even though the result is constant.
  generated6809.clrMemory(motorola, 0xffff, { writeByte: () => {} });
  // @ts-expect-error A memory shift requires the resolved numeric address before its memory capabilities.
  generated6809.rolMemory(motorola, { readByte: () => 0, writeByte: () => {} });
  // @ts-expect-error The resolved address is a value, not an opaque address resolver.
  generated6809.rolMemory(motorola, () => 0xffff, { readByte: () => 0, writeByte: () => {} });
  // @ts-expect-error Memory shifts require both read and write capabilities.
  generated6809.rolMemory(motorola, 0xffff, { readByte: () => 0 });
  // @ts-expect-error Addressing is already complete; the body cannot fetch more instruction bytes.
  generated6809.rolMemory(motorola, 0xffff, { readByte: () => 0, writeByte: () => {}, fetchByte: () => 0 });
  // @ts-expect-error Register shifts need no fetching or memory capability.
  generated6809.rolB(motorola, { fetchByte: () => 0 });
  // @ts-expect-error Rotates require their CPU's concrete state.
  generated8080.rlc(motorola);
  // @ts-expect-error Generated handlers use the concrete CPU's stored-state type.
  generated6502[0xc9](intel, { fetchByte: () => 0 });
  // @ts-expect-error ASL needs both memory callbacks as well as instruction fetching.
  generated6502[0x06](mos, { fetchByte: () => 0 });
  // @ts-expect-error Register comparison neither needs nor accepts a fetching capability.
  generated8080.cmpB(intel, { fetchByte: () => 0 });
  // @ts-expect-error An indexed load also requires a data-memory read capability.
  generated6502[0xb6](mos, { fetchByte: () => 0 });
}
