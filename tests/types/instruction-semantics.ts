import { instructions as addressing8088 } from "../../src/components/cpus/generated/8088-addressing.js";
import { instructions as strings8088 } from "../../src/components/cpus/generated/8088-strings.js";
import { instructions as arithmetic8088 } from "../../src/components/cpus/generated/8088-arithmetic.js";
import { instructions as stack8088 } from "../../src/components/cpus/generated/8088-stack.js";
import { instructions as unary8088 } from "../../src/components/cpus/generated/8088-unary.js";
import { instructions as alu8088 } from "../../src/components/cpus/generated/8088-alu.js";
import { instructions as transfers8088 } from "../../src/components/cpus/generated/8088-transfers.js";
import { instructions as generated8088, opcodeEntries as opcodeEntries8088 } from "../../src/components/cpus/generated/8088.js";
import { cpu8088StateDescription } from "../../src/components/cpus/state/8088.js";
import type { Cpu8088State } from "../../src/components/cpus/8088.js";
import { byteRegisterView } from "../../src/components/cpus/semantics/builders.js";
import { cpu6809StateDescription } from "../../src/components/cpus/state/6809.js";
import { cpuZ80StateDescription } from "../../src/components/cpus/state/z80.js";
import { cpu6502StateDescription } from "../../src/components/cpus/6502.js";
import { cpu8080StateDescription } from "../../src/components/cpus/8080.js";
import { deferInterrupt, divide, iterate, reject, and, signExtend, truncate, readElement, writeElement, when, addWrap, carry, halfCarry, subtract, multiply, bitAnd, bitOr, bitXor, cpuSymbols, exchangeFlags, flagValue, highByte, lowByte, literal, not, projectAddress, readFlag, readLatch, readMemory, shiftBits, shiftLeft, value, writeLatch, xor, zero } from "../../src/components/cpus/semantics/model.js";
import type { FlagPolicy, NumberExpression, Statement } from "../../src/components/cpus/semantics/model.js";
import { instructions as generated6502, sourceReaders } from "../../src/components/cpus/generated/6502.js";
import { instructions as generatedZ80 } from "../../src/components/cpus/generated/z80.js";
import type { CpuZ80State } from "../../src/components/cpus/z80.js";
import { instructions as generated8008 } from "../../src/components/cpus/generated/8008.js";
import { cpu8008StateDescription } from "../../src/components/cpus/state/8008.js";
import type { Cpu8008State, Cpu8008StoredState } from "../../src/components/cpus/state/8008.js";
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
  const z80 = cpuSymbols("z80", cpuZ80StateDescription), alternate = z80.bank("alternate");
  alternate.register("a");
  exchangeFlags(z80.flags, alternate.flags);
  readLatch("enabled", z80.latch("iff2"));
  shiftBits(value("byte"), "right", 4);
  // @ts-expect-error Bank names come from the CPU schema.
  z80.bank("unknown");
  // @ts-expect-error The flag group is not a register bank.
  z80.bank("flags");
  // @ts-expect-error Alternate banks do not contain the index registers.
  alternate.register("ix");
  // @ts-expect-error Dotted strings are not stored register names.
  z80.register("alternate.a");
  // @ts-expect-error A scalar flag is not a complete flag group.
  exchangeFlags(z80.flags, z80.flag("c"));
  // @ts-expect-error Control-latch reads cannot address numeric registers.
  readLatch("enabled", z80.register("i"));
  // @ts-expect-error Logical shifts operate on captured numbers, not live registers.
  shiftBits(z80.register("a"), "left", 4);
  // @ts-expect-error Logical shifts cannot rotate or insert carry.
  shiftBits(value("byte"), "rotate", 4);
  mos.register("a");
  intel.flag("cy");
  const i8008 = cpuSymbols("8008", cpu8008StateDescription);
  readElement("pc", i8008.array("addressStack"), value("slot"));
  writeElement(i8008.array("addressStack"), literal(3, 7), truncate(value("address"), 14));
  // @ts-expect-error Array names come from the CPU schema.
  i8008.array("a");
  // @ts-expect-error A live selector must be captured before indexing.
  readElement("pc", i8008.array("addressStack"), i8008.register("stackIndex"));
  // @ts-expect-error Array targets are distinct from scalar registers.
  writeElement(i8008.register("stackIndex"), literal(3, 0), literal(14, 0));
  // @ts-expect-error Truncation operates on unsigned numeric values, not flags.
  truncate(flagValue("carry"), 3);
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
  addWrap(value("left"), value("right"), flagValue("carry"));
  subtract(value("left"), value("right"), flagValue("borrow"));
  multiply(value("left"), value("right"));
  // @ts-expect-error Multiplication takes captured unsigned values, not live registers.
  multiply(mos.register("a"), literal(8, 1));
  // @ts-expect-error Flags are not numeric operands.
  multiply(flagValue("carry"), literal(8, 1));
  // @ts-expect-error Numeric bits are not Boolean carry inputs.
  addWrap(value("left"), value("right"), literal(8, 1));
  // @ts-expect-error Live flags must be captured before use in arithmetic facts.
  carry(value("left"), value("right"), mos.flag("c"));
  // @ts-expect-error Arithmetic flags require numeric operands.
  halfCarry(flagValue("carry"), value("right"));
  xor(flagValue("carry"), zero(value("byte")));
  when(and(flagValue("carry"), zero(value("byte"))), []);
  signExtend(value("byte"), 16);
  // @ts-expect-error Conditions are Boolean expressions, not numeric values.
  when(value("byte"), []);
  // @ts-expect-error A live flag must be captured before testing it.
  when(mos.flag("c"), []);
  // @ts-expect-error Conditional bodies are ordered data, not callbacks.
  when(flagValue("carry"), () => {});
  // @ts-expect-error Boolean AND cannot accept numeric operands.
  and(flagValue("carry"), value("byte"));
  // @ts-expect-error Signed widening cannot accept flags.
  signExtend(flagValue("carry"), 16);
  signExtend(value("byte"), 32);
  // @ts-expect-error Quad words are outside the current vocabulary.
  signExtend(value("byte"), 64);
  highByte(value("word"));
  lowByte(value("word"));
  const motorola = cpuSymbols("6809", cpu6809StateDescription);
  writeLatch(motorola.latch("nmiArmed"), true);
  // @ts-expect-error Word registers are not control latches.
  motorola.latch("s");
  // @ts-expect-error Architectural flags remain distinct from control latches.
  motorola.latch("c");
  // @ts-expect-error Latches are not numeric registers.
  motorola.register("nmiArmed");
  // @ts-expect-error Latch writes require an actual Boolean constant.
  writeLatch(motorola.latch("nmiArmed"), 1);
  // @ts-expect-error Architectural flags cannot be written as latches.
  writeLatch(motorola.flag("c"), true);
  // @ts-expect-error Low-byte extraction cannot implicitly read live state.
  lowByte(motorola.register("s"));
  // @ts-expect-error Low-byte extraction cannot accept flags.
  lowByte(flagValue("carry"));
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
  literal(32, 0);
  // @ts-expect-error Quad words are outside the current vocabulary.
  literal(64, 0);
  // @ts-expect-error Immediate values cannot be register destinations.
  const destination: Statement = { kind: "write-register", register: literal(8, 0), value: value("byte") };
  // @ts-expect-error Sources are structured bodies, not effectful callbacks.
  const opaque: Statement = { kind: "read-source", name: "byte", source: () => 0 };
  const policy: FlagPolicy = { name: "zero", parameters: { byte: 8 }, unlisted: "preserve", updates: [
    // @ts-expect-error Flag assignments require Boolean formulas.
    { flag: mos.flag("z"), value: literal(8, 0) },
  ] };
}

export function checkGeneratedInstructionTypes(mos: Cpu6502State, intel: Cpu8080State, motorola: Cpu6809State, m6800: Cpu6800State, z80: CpuZ80State, i8008: Cpu8008StoredState): void {
  generatedZ80.exchangeAf(z80);
  generatedZ80.exchangeGeneralBanks(z80);
  generatedZ80.loadAFromI(z80);
  generatedZ80.loadRFromA(z80);
  generatedZ80.neg(z80);
  generatedZ80.rrd(z80, { readByte: () => 0, writeByte: () => {} });
  generatedZ80.ldir(z80, { readByte: () => 0, writeByte: () => {} });
  generatedZ80.cpir(z80, { readByte: () => 0 });
  // @ts-expect-error Bank exchanges require the Z80's concrete state.
  generatedZ80.exchangeAf(intel);
  // @ts-expect-error Special transfers cannot fetch again after refresh/decoding.
  generatedZ80.loadAFromR(z80, { fetchByte: () => 0 });
  // @ts-expect-error Digit rotations require a memory write.
  generatedZ80.rld(z80, { readByte: () => 0 });
  // @ts-expect-error Block comparisons cannot write memory.
  generatedZ80.cpd(z80, { readByte: () => 0, writeByte: () => {} });
  // @ts-expect-error Repeated blocks cannot fetch or run a second iteration inside the body.
  generatedZ80.lddr(z80, { readByte: () => 0, writeByte: () => {}, fetchByte: () => 0 });
  const readers = sourceReaders(mos);
  const address: number = readers.addresses.absoluteX({ fetchByte: () => 0 });
  const byte: number = readers.operands[3]({ fetchByte: () => 0, readByte: () => 0 });
  // @ts-expect-error An indirect address needs pointer reads, even without a final data read.
  readers.addresses.indirectIndexed({ fetchByte: () => 0 });
  // @ts-expect-error The memory operand needs a data read; its address reader does not.
  readers.operands[3]({ fetchByte: () => 0 });
  // @ts-expect-error Reader bindings require the concrete CPU state.
  sourceReaders(intel);
  generated6502[0x20](mos, { fetchByte: () => 0, writeByte: () => {} });
  generated6502[0x48](mos, { writeByte: () => {} });
  generated6502[0x60](mos, { readByte: () => 0 });
  generated6800.bsr(m6800, { fetchByte: () => 0, writeByte: () => {} });
  generated6809.jsr(motorola, 0xffff, { writeByte: () => {} });
  generated8080[0xc5](intel, { writeByte: () => {} });
  generated8080[0xc1](intel, { readByte: () => 0 });
  generatedZ80.pushIX(z80, { writeByte: () => {} });
  generatedZ80.popIY(z80, { readByte: () => 0 });
  generatedZ80[0xcd](z80, { fetchByte: () => 0, writeByte: () => {} });
  // @ts-expect-error Calls require stack writes, even when the runtime condition is false.
  generated8080[0xc4](intel, { fetchByte: () => 0 });
  // @ts-expect-error Returns read memory but never fetch an operand.
  generated8080[0xc0](intel, { fetchByte: () => 0, readByte: () => 0 });
  // @ts-expect-error RST has no target operand to fetch.
  generatedZ80[0xc7](z80, { fetchByte: () => 0, writeByte: () => {} });
  // @ts-expect-error Resolved JSR cannot fetch or resolve its target again.
  generated6809.jsr(motorola, 0xffff, { fetchByte: () => 0, writeByte: () => {} });
  // @ts-expect-error PHA cannot read its destination.
  generated6502[0x48](mos, { readByte: () => 0, writeByte: () => {} });
  generated6502[0x10](mos, { fetchByte: () => 0 });
  generated6502[0x6c](mos, { fetchByte: () => 0, readByte: () => 0 });
  generated6800.bra(m6800, { fetchByte: () => 0 });
  generated6809.lbrn(motorola, { fetchByte: () => 0 });
  generated6809.jump(motorola, 0xffff);
  generated8080[0xc2](intel, { fetchByte: () => 0 });
  generated8080[0xe9](intel);
  generatedZ80.jumpIX(z80);
  generatedZ80.djnz(z80, { fetchByte: () => 0 });
  // @ts-expect-error Even a branch that is never taken must fetch its displacement.
  generated6809.lbrn(motorola);
  // @ts-expect-error Indirect JMP requires pointer reads.
  generated6502[0x6c](mos, { fetchByte: () => 0 });
  // @ts-expect-error Absolute jumps do not read their destination.
  generated8080[0xc3](intel, { fetchByte: () => 0, readByte: () => 0 });
  // @ts-expect-error Register-indirect jumps do not fetch or read memory.
  generatedZ80.jumpIY(z80, { readByte: () => 0 });
  // @ts-expect-error Resolved jumps cannot resolve their address again.
  generated6800.jump(m6800, 0xffff, { fetchByte: () => 0 });
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
  generatedZ80.adcA(z80);
  generatedZ80.cpM(z80, { readByte: () => 0 });
  generatedZ80.sbcImmediate(z80, { fetchByte: () => 0 });
  generatedZ80.andMemory(z80, 0xffff, { readByte: () => 0 });
  generatedZ80.rlca(z80);
  generated8080[0x02](intel, { writeByte: () => {} });
  generated8080[0x1a](intel, { readByte: () => 0 });
  generatedZ80[0x32](z80, { fetchByte: () => 0, writeByte: () => {} });
  generatedZ80[0x3a](z80, { fetchByte: () => 0, readByte: () => 0 });
  // @ts-expect-error Pair-indirect stores have no destination-read capability.
  generated8080[0x12](intel, { readByte: () => 0, writeByte: () => {} });
  // @ts-expect-error Pair-indirect loads do not fetch an address.
  generatedZ80[0x0a](z80, { fetchByte: () => 0, readByte: () => 0 });
  // @ts-expect-error Absolute stores must fetch both address bytes.
  generated8080[0x32](intel, { writeByte: () => {} });
  // @ts-expect-error Absolute loads have no data-memory write capability.
  generatedZ80[0x3a](z80, { fetchByte: () => 0, readByte: () => 0, writeByte: () => {} });
  // @ts-expect-error Generated accumulator transfers retain the concrete CPU state.
  generated8080[0x02](z80, { writeByte: () => {} });
  generated8080[0x47](intel);
  generated8080[0x36](intel, { fetchByte: () => 0, writeByte: () => {} });
  generated8080[0x01](intel, { fetchByte: () => 0 });
  generated8080[0x22](intel, { fetchByte: () => 0, writeByte: () => {} });
  generated8080[0x2a](intel, { fetchByte: () => 0, readByte: () => 0 });
  generated8080[0xf9](intel);
  generatedZ80.loadBCMemory(z80, { fetchByte: () => 0, readByte: () => 0 });
  generatedZ80.storeSPMemory(z80, { fetchByte: () => 0, writeByte: () => {} });
  generatedZ80.immediateIXWord(z80, { fetchByte: () => 0 });
  generatedZ80.loadIYWord(z80, { fetchByte: () => 0, readByte: () => 0 });
  generatedZ80.copyIXWord(z80);
  generated8080[0x03](intel);
  generated8080[0x09](intel);
  generatedZ80[0x39](z80);
  generatedZ80.adcHLBC(z80);
  generatedZ80.sbcHLHL(z80);
  generatedZ80.addIXIX(z80);
  generatedZ80.decIYWord(z80);
  // @ts-expect-error Word arithmetic needs no fetching or memory capability.
  generated8080[0x09](intel, { fetchByte: () => 0 });
  // @ts-expect-error Carry is read from the CPU's flags, not supplied as an operand.
  generatedZ80.adcHLBC(z80, true);
  // @ts-expect-error Index adjustment retains the Z80's concrete state type.
  generatedZ80.incIXWord(intel);
  // @ts-expect-error Immediate word loads cannot read data memory.
  generated8080[0x01](intel, { fetchByte: () => 0, readByte: () => 0 });
  // @ts-expect-error Absolute word stores fetch their own address.
  generated8080[0x22](intel, { writeByte: () => {} });
  // @ts-expect-error Absolute loads cannot write memory.
  generatedZ80.loadBCMemory(z80, { fetchByte: () => 0, readByte: () => 0, writeByte: () => {} });
  // @ts-expect-error Copying an index to SP requires no instruction context.
  generatedZ80.copyIXWord(z80, { fetchByte: () => 0 });
  // @ts-expect-error Indexed word bodies require the Z80's concrete state.
  generatedZ80.immediateIXWord(intel, { fetchByte: () => 0 });
  generated8008[0xc0](i8008);
  generated8008[0xef](i8008, { readByte: () => 0 });
  generated8008[0xfd](i8008, { writeByte: () => {} });
  generated8008[0x3e](i8008, { fetchByte: () => 0, writeByte: () => {} });
  generated8008[0xff](i8008);
  generated8008[0x46](i8008, { fetchByte: () => 0 });
  generated8008[0x07](i8008);
  generated8008[0x05](i8008);
  // @ts-expect-error Calls fetch operands, but never write a return address to RAM.
  generated8008[0x46](i8008, { fetchByte: () => 0, writeByte: () => {} });
  // @ts-expect-error Returns only select a physical register; no memory capability is needed.
  generated8008[0x07](i8008, { readByte: () => 0 });
  // @ts-expect-error Restart vectors are encoded; no operand fetching is needed.
  generated8008[0x05](i8008, { fetchByte: () => 0 });
  const constructorInput: Cpu8008State = i8008;
  // @ts-expect-error Execution needs owned, mutable slots; constructor inputs may have readonly slots.
  generated8008[0x46](constructorInput, { fetchByte: () => 0 });
  // @ts-expect-error 8008 self-transfers need no context.
  generated8008[0xc0](i8008, { fetchByte: () => 0 });
  // @ts-expect-error LMI requires a write capability.
  generated8008[0x3e](i8008, { fetchByte: () => 0 });
  // @ts-expect-error LMI cannot read the destination.
  generated8008[0x3e](i8008, { fetchByte: () => 0, readByte: () => 0, writeByte: () => {} });
  // @ts-expect-error Transfers require the 8008's concrete address-stack state.
  generated8008[0xc0](intel);
  generatedZ80[0x66](z80, { readByte: () => 0 });
  generatedZ80.loadHMemory(z80, 0xffff, { readByte: () => 0 });
  generatedZ80.storeLMemory(z80, 0xffff, { writeByte: () => {} });
  generatedZ80.storeImmediateMemory(z80, 0xffff, { fetchByte: () => 0, writeByte: () => {} });
  generated8080[0x76](intel);
  generated6502[0x69](mos, { fetchByte: () => 0 });
  generated6502[0x28](mos, { readByte: () => 0 });
  generated6800.daa(m6800);
  generated6809.orcc(motorola, { fetchByte: () => 0 });
  generatedZ80[0xf5](z80, { writeByte: () => {} });
  // @ts-expect-error Decimal adjustment needs no memory capability.
  generatedZ80[0x27](z80, { readByte: () => 0 });
  // @ts-expect-error Immediate ADC cannot access data memory.
  generated6502[0x69](mos, { fetchByte: () => 0, readByte: () => 0 });
  // @ts-expect-error PHP writes the stack; it cannot read it.
  generated6502[0x08](mos, { readByte: () => 0 });
  // @ts-expect-error Status pops require a complete read capability.
  generated8080[0xf1](intel);
  // @ts-expect-error Register transfers need no instruction context.
  generated8080[0x47](intel, { readByte: () => 0 });
  // @ts-expect-error Immediate stores do not read the destination.
  generated8080[0x36](intel, { fetchByte: () => 0, readByte: () => 0, writeByte: () => {} });
  // @ts-expect-error Indexed register stores do not fetch a displacement inside the body.
  generatedZ80.storeLMemory(z80, 0xffff, { writeByte: () => {}, fetchByte: () => 0 });
  generated8080.inrH(intel);
  generated8080.dcrMemory(intel, 0xffff, { readByte: () => 0, writeByte: () => {} });
  generatedZ80.incH(z80);
  generatedZ80.decMemory(z80, 0xffff, { readByte: () => 0, writeByte: () => {} });
  // @ts-expect-error Memory adjustments require writeback.
  generated8080.inrMemory(intel, 0xffff, { readByte: () => 0 });
  // @ts-expect-error Resolved indexed adjustments do not fetch a displacement.
  generatedZ80.incMemory(z80, 0xffff, { readByte: () => 0, writeByte: () => {}, fetchByte: () => 0 });
  // @ts-expect-error Register adjustments need no memory context.
  generatedZ80.decH(z80, { readByte: () => 0, writeByte: () => {} });
  generatedZ80.rlH(z80);
  generatedZ80.sraMemory(z80, 0xffff, { readByte: () => 0, writeByte: () => {} });
  generatedZ80.bit7H(z80);
  generatedZ80.res0L(z80);
  generatedZ80.set3A(z80);
  generatedZ80.bit7Memory(z80, 0xffff, { readByte: () => 0 });
  generatedZ80.res0Memory(z80, 0xffff, { readByte: () => 0, writeByte: () => {} });
  // @ts-expect-error BIT memory bodies do not write memory.
  generatedZ80.bit0Memory(z80, 0xffff, { readByte: () => 0, writeByte: () => {} });
  // @ts-expect-error RES must write even when the selected bit is already clear.
  generatedZ80.res7Memory(z80, 0xffff, { readByte: () => 0 });
  // @ts-expect-error SET consumes a resolved address without fetching a displacement.
  generatedZ80.set0Memory(z80, 0xffff, { readByte: () => 0, writeByte: () => {}, fetchByte: () => 0 });
  // @ts-expect-error BIT register bodies require no memory context.
  generatedZ80.bit0B(z80, { readByte: () => 0 });
  // @ts-expect-error Accumulator rotates require no context.
  generatedZ80.rra(z80, { fetchByte: () => 0 });
  // @ts-expect-error Register shifts require no memory context.
  generatedZ80.srlL(z80, { readByte: () => 0 });
  // @ts-expect-error Memory shifts require both transfers, even when the result is unchanged.
  generatedZ80.rlcMemory(z80, 0xffff, { readByte: () => 0 });
  // @ts-expect-error Memory shifts consume a resolved address without fetching displacement again.
  generatedZ80.rrMemory(z80, 0xffff, { readByte: () => 0, writeByte: () => {}, fetchByte: () => 0 });
  // @ts-expect-error Z80 ALU register bodies require no context.
  generatedZ80.addB(z80, { fetchByte: () => 0 });
  // @ts-expect-error Indexed bodies require the resolved address, not an index selector.
  generatedZ80.cpMemory(z80, "ix", { readByte: () => 0 });
  // @ts-expect-error Indexed bodies do not fetch displacement again.
  generatedZ80.adcMemory(z80, 0xffff, { readByte: () => 0, fetchByte: () => 0 });
  // @ts-expect-error ALU memory operands never write memory.
  generatedZ80.xorM(z80, { readByte: () => 0, writeByte: () => {} });
  // @ts-expect-error Z80 policy fields require Z80 state.
  generatedZ80.subA(intel);
  generated8008.acA(i8008);
  generated8008.inh(i8008);
  generated8008.dcl(i8008);
  generated8008.ral(i8008);
  // @ts-expect-error Register adjustments have no fetch or memory context.
  generated8008.inb(i8008, { fetchByte: () => 0 });
  // @ts-expect-error Accumulator rotates have no memory context.
  generated8008.rrc(i8008, { readByte: () => 0 });
  generated8008.sbM(i8008, { readByte: () => 0 });
  generated8008.ndi(i8008, { fetchByte: () => 0 });
  // @ts-expect-error Register bodies need no fetch or memory capability.
  generated8008.adB(i8008, { fetchByte: () => 0 });
  // @ts-expect-error Memory bodies resolve H:L locally and cannot fetch an address.
  generated8008.cpM(i8008, { readByte: () => 0, fetchByte: () => 0 });
  // @ts-expect-error ALU memory sources are never destinations.
  generated8008.xrM(i8008, { readByte: () => 0, writeByte: () => {} });
  // @ts-expect-error Immediate bodies need byte fetching, not data-memory reads.
  generated8008.aci(i8008, { readByte: () => 0 });
  // @ts-expect-error Concrete CPU state retains the 8008's address-register structure.
  generated8008.adA(intel);
  generated8080.cmpB(intel);
  generated8080.ral(intel);
  generated8080.adcA(intel);
  generated8080.sbbM(intel, { readByte: () => 0 });
  generated8080.ani(intel, { fetchByte: () => 0 });
  // @ts-expect-error ALU register bodies do not need or accept an instruction context.
  generated8080.addB(intel, { fetchByte: () => 0 });
  // @ts-expect-error M supplies HL locally; memory ALU bodies cannot fetch another address.
  generated8080.anaM(intel, { readByte: () => 0, fetchByte: () => 0 });
  // @ts-expect-error Immediate ALU bodies have no data-memory read capability.
  generated8080.sbi(intel, { fetchByte: () => 0, readByte: () => 0 });
  // @ts-expect-error An ALU memory source is never a memory destination.
  generated8080.oraM(intel, { readByte: () => 0, writeByte: () => {} });
  // @ts-expect-error ALU bodies retain their concrete CPU state.
  generated8080.adi(motorola, { fetchByte: () => 0 });
  generated6809.rolB(motorola);
  generated6809.rolMemory(motorola, 0xffff, { readByte: () => 0, writeByte: () => {} });
  generated6809.tstMemory(motorola, 0xffff, { readByte: () => 0 });
  generated6809.clrMemory(motorola, 0xffff, { readByte: () => 0, writeByte: () => {} });
  generated6809.negA(motorola);
  generated6809.cmpaMemory(motorola, 0xffff, { readByte: () => 0 });
  generated6809.exg_d_s(motorola);
  generated6809.mul(motorola);
  generated6809.leax(motorola, 0xffff);
  generated6809.pshs(motorola, { fetchByte: () => 0xff, writeByte: () => {} });
  generated6809.pulu(motorola, { fetchByte: () => 0xff, readByte: () => 0 });
  generated6809.pushFrame(motorola, 0xff, { writeByte: () => {} });
  generated6809.pullFrame(motorola, 0xff, { readByte: () => 0 });
  // @ts-expect-error Transfers enter after the CPU fetches and validates their postbyte.
  generated6809.tfr_pc_x(motorola, { fetchByte: () => 0 });
  // @ts-expect-error LEA receives an already resolved numeric address.
  generated6809.leas(motorola, () => 0xffff);
  // @ts-expect-error Resolved LEA cannot fetch or read memory again.
  generated6809.leax(motorola, 0xffff, { readByte: () => 0 });
  // @ts-expect-error Register-mask pushes cannot read memory.
  generated6809.pshu(motorola, { fetchByte: () => 0, writeByte: () => {}, readByte: () => 0 });
  // @ts-expect-error Register-mask pulls cannot write memory.
  generated6809.puls(motorola, { fetchByte: () => 0, readByte: () => 0, writeByte: () => {} });
  // @ts-expect-error Ordinary register-mask instructions fetch their mask.
  generated6809.pshs(motorola, { writeByte: () => {} });
  // @ts-expect-error Frame helpers take a supplied mask and never fetch.
  generated6809.pushFrame(motorola, 0xff, { writeByte: () => {}, fetchByte: () => 0 });
  // @ts-expect-error Transfer bodies require the concrete 6809 state.
  generated6809.tfr_a_b(m6800);
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
  generated6800.ldsImmediate(m6800, { fetchByte: () => 0 });
  generated6800.ldxMemory(m6800, 0xffff, { readByte: () => 0 });
  generated6800.stsMemory(m6800, 0xffff, { writeByte: () => {} });
  generated6809.ldsImmediate(motorola, { fetchByte: () => 0 });
  generated6809.lddMemory(motorola, 0xffff, { readByte: () => 0 });
  generated6809.stdMemory(motorola, 0xffff, { writeByte: () => {} });
  // @ts-expect-error Word loads need byte fetching, not an opaque word fetch.
  generated6800.ldsImmediate(m6800, { fetchWord: () => 0 });
  // @ts-expect-error Word stores cannot read destination memory.
  generated6809.stsMemory(motorola, 0xffff, { readByte: () => 0, writeByte: () => {} });
  // @ts-expect-error Resolved word loads cannot fetch another address.
  generated6809.ldyMemory(motorola, 0xffff, { fetchByte: () => 0, readByte: () => 0 });
  // @ts-expect-error Word stores require writes, including unchanged values.
  generated6800.stxMemory(m6800, 0xffff, {});
  // @ts-expect-error Word bodies retain the concrete CPU state.
  generated6800.ldsImmediate(motorola, { fetchByte: () => 0 });
  generated6800.aba(m6800);
  generated6800.adcaImmediate(m6800, { fetchByte: () => 0 });
  generated6809.sbcbMemory(motorola, 0xffff, { readByte: () => 0 });
  generated6809.adddMemory(motorola, 0xffff, { readByte: () => 0 });
  // @ts-expect-error Word arithmetic fetches explicit high/low bytes, not an opaque word source.
  generated6809.subdImmediate(motorola, { fetchWord: () => 0 });
  // @ts-expect-error Resolved arithmetic cannot fetch another address.
  generated6800.subaMemory(m6800, 0xffff, { fetchByte: () => 0, readByte: () => 0 });
  // @ts-expect-error Arithmetic bodies never write data memory.
  generated6809.adcbMemory(motorola, 0xffff, { readByte: () => 0, writeByte: () => {} });
  // @ts-expect-error SBA has no fetching or memory capability.
  generated6800.sba(m6800, { fetchByte: () => 0 });
  // @ts-expect-error Arithmetic retains each CPU's concrete state.
  generated6800.addaImmediate(motorola, { fetchByte: () => 0 });
  generated6800.tab(m6800);
  generated6800.tba(m6800);
  generated6800.ldaImmediate(m6800, { fetchByte: () => 0 });
  generated6809.ldbImmediate(motorola, { fetchByte: () => 0 });
  generated6800.ldbMemory(m6800, 0xffff, { readByte: () => 0 });
  generated6809.ldaMemory(motorola, 0xffff, { readByte: () => 0 });
  generated6800.staMemory(m6800, 0xffff, { writeByte: () => {} });
  generated6809.stbMemory(motorola, 0xffff, { writeByte: () => {} });
  // @ts-expect-error Resolved byte stores have no destination-read capability.
  generated6800.stbMemory(m6800, 0xffff, { readByte: () => 0, writeByte: () => {} });
  // @ts-expect-error Store addressing is already complete, including any indirect pointer reads.
  generated6809.staMemory(motorola, 0xffff, { fetchByte: () => 0, writeByte: () => {} });
  // @ts-expect-error Byte stores require a write capability even when the destination is unchanged.
  generated6809.stbMemory(motorola, 0xffff, {});
  // @ts-expect-error Immediate byte loads have no data-memory capability.
  generated6800.ldaImmediate(m6800, { fetchByte: () => 0, readByte: () => 0 });
  // @ts-expect-error Resolved loads cannot fetch another address.
  generated6809.ldbMemory(motorola, 0xffff, { fetchByte: () => 0, readByte: () => 0 });
  // @ts-expect-error TAB needs no fetching or memory context.
  generated6800.tab(m6800, { fetchByte: () => 0 });
  // @ts-expect-error Byte transfer bodies require the concrete CPU state.
  generated6800.ldaImmediate(motorola, { fetchByte: () => 0 });
  generated6800.andaImmediate(m6800, { fetchByte: () => 0 });
  generated6800.orbMemory(m6800, 0xffff, { readByte: () => 0 });
  generated6809.bitbImmediate(motorola, { fetchByte: () => 0 });
  generated6809.eoraMemory(motorola, 0xffff, { readByte: () => 0 });
  // @ts-expect-error A resolved logical memory body cannot fetch another address.
  generated6809.andaMemory(motorola, 0xffff, { readByte: () => 0, fetchByte: () => 0 });
  // @ts-expect-error Logical instructions never write memory, including BIT.
  generated6800.bitaMemory(m6800, 0xffff, { readByte: () => 0, writeByte: () => {} });
  // @ts-expect-error Immediate logic cannot access data memory.
  generated6800.eorbImmediate(m6800, { fetchByte: () => 0, readByte: () => 0 });
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

// Generated register bodies retain concrete state and only the capabilities they actually use.
export function check8088Semantics(state: Cpu8088State, intel: Cpu8080State): void {
  const cpu = cpuSymbols("8088", cpu8088StateDescription);
  byteRegisterView(cpu.register("ax"), "low");
  byteRegisterView(cpu.register("bx"), "high");
  // @ts-expect-error AL is a view, not stored state.
  cpu.register("al");
  // @ts-expect-error A byte view requires a register, not a flag.
  byteRegisterView(cpu.flag("cf"), "low");
  // @ts-expect-error Word byte views select only low or high.
  byteRegisterView(cpu.register("ax"), "middle");
  generated8088[0xb0](state, { fetchByte: () => 0 });
  generated8088[0x15](state, { fetchByte: () => 0 });
  generated8088[0x40](state);
  generated8088[0x90](state);
  opcodeEntries8088(state);
  // @ts-expect-error Immediate forms require instruction fetching.
  generated8088[0xb0](state, {});
  // @ts-expect-error Register arithmetic never accesses data memory.
  generated8088[0x15](state, { fetchByte: () => 0, readByte: () => 0 });
  // @ts-expect-error Word INC needs no instruction context.
  generated8088[0x40](state, { fetchByte: () => 0 });
  // @ts-expect-error 8080 state is not 8088 state.
  generated8088[0x90](intel);
}

export function check8088TransferTypes(state: Cpu8088State, intel: Cpu8080State): void {
  readMemory("byte", projectAddress(value("segment"), value("offset"), 4, 20));
  // @ts-expect-error Physical address projections are distinct from numeric register expressions.
  addWrap(projectAddress(value("segment"), value("offset"), 4, 20), literal(16, 1));
  // @ts-expect-error Projections use numeric words, not conditions.
  projectAddress(flagValue("carry"), value("offset"), 4, 20);
  transfers8088.move_8_0_4(state);
  transfers8088.exchange_8_0_4(state);
  transfers8088.load_16_0(state, 0xffff, 0xffff, { readByte: () => 0 });
  transfers8088.store_16_0(state, 0xffff, 0xffff, { writeByte: () => {} });
  transfers8088.immediate_16(state, 0xffff, 0xffff, { fetchByte: () => 0, writeByte: () => {} });
  transfers8088.exchangeMemory_16_0(state, 0xffff, 0xffff, { readByte: () => 0, writeByte: () => {} });
  // @ts-expect-error Generated register transfers need no memory or fetch capability.
  transfers8088.move_8_0_4(state, {});
  // @ts-expect-error Resolved addresses are numbers, not opaque mapping callbacks.
  transfers8088.load_16_0(state, () => 0xffff, 0xffff, { readByte: () => 0 });
  // @ts-expect-error MOV never reads its memory destination.
  transfers8088.store_16_0(state, 0xffff, 0xffff, { readByte: () => 0, writeByte: () => {} });
  // @ts-expect-error A memory exchange needs the write capability as well as reading.
  transfers8088.exchangeMemory_16_0(state, 0xffff, 0xffff, { readByte: () => 0 });
  // @ts-expect-error Immediate memory MOV must fetch before writing.
  transfers8088.immediate_16(state, 0xffff, 0xffff, { writeByte: () => {} });
  // @ts-expect-error Resolved transfer bodies retain concrete 8088 state.
  transfers8088.exchange_8_0_4(intel);
}

export function check8088AluTypes(state: Cpu8088State, intel: Cpu8080State): void {
  alu8088.ADD_8_0_4(state);
  alu8088.ADC_fromMemory_16_0(state, 0xffff, 0xffff, { readByte: () => 0 });
  alu8088.CMP_toMemory_16_0(state, 0xffff, 0xffff, { readByte: () => 0 });
  alu8088.TEST_immediate_16_memory(state, 0xffff, 0xffff, { fetchByte: () => 0, readByte: () => 0 });
  alu8088.SBB_signed_16_4(state, { fetchByte: () => 0 });
  alu8088.ADD_immediate_8_memory(state, 0xffff, 0xffff, { fetchByte: () => 0, readByte: () => 0, writeByte: () => {} });
  // @ts-expect-error A register-pair body has no context.
  alu8088.ADD_8_0_4(state, {});
  // @ts-expect-error CMP cannot write its memory operand.
  alu8088.CMP_toMemory_16_0(state, 0xffff, 0xffff, { readByte: () => 0, writeByte: () => {} });
  // @ts-expect-error Immediate TEST must fetch before reading its destination.
  alu8088.TEST_immediate_16_memory(state, 0xffff, 0xffff, { readByte: () => 0 });
  // @ts-expect-error Memory arithmetic requires writing as well as reading.
  alu8088.ADD_toMemory_16_0(state, 0xffff, 0xffff, { readByte: () => 0 });
  // @ts-expect-error 8088 generated bodies retain their concrete CPU state.
  alu8088.ADD_8_0_4(intel);
  // @ts-expect-error The original chip has no sign-extended immediate OR.
  alu8088.OR_signed_16_0(state, { fetchByte: () => 0 });
}


export function check8088OrdinaryTypes(state: Cpu8088State, intel: Cpu8080State): void {
  generated8088[0x76](state, { fetchByte: () => 0 });
  generated8088[0xe0](state, { fetchByte: () => 0 });
  generated8088[0xe9](state, { fetchByte: () => 0 });
  generated8088[0x98](state);
  generated8088[0x9e](state);
  generated8088[0x9f](state);
  generated8088[0xf4](state);
  unary8088.INC_8_4(state);
  unary8088.NEG_16_memory(state, 0xffff, 0xffff, { readByte: () => 0, writeByte: () => {} });
  // @ts-expect-error Branches cannot access data memory.
  generated8088[0x76](state, { fetchByte: () => 0, readByte: () => 0 });
  // @ts-expect-error Relative word branches require explicit byte fetching.
  generated8088[0xe9](state, { fetchWord: () => 0 });
  // @ts-expect-error HLT has no context or retirement callback.
  generated8088[0xf4](state, { retire: () => {} });
  // @ts-expect-error SAHF needs no memory capability.
  generated8088[0x9e](state, { readByte: () => 0 });
  // @ts-expect-error Register unary operations need no context.
  unary8088.INC_8_4(state, {});
  // @ts-expect-error Even NOT requires a complete memory read before writing.
  unary8088.NOT_16_memory(state, 0xffff, 0xffff, { writeByte: () => {} });
  // @ts-expect-error Unary memory operations need both read and write.
  unary8088.DEC_16_memory(state, 0xffff, 0xffff, { readByte: () => 0 });
  // @ts-expect-error The decoder has finished fetching before a unary body begins.
  unary8088.NEG_8_memory(state, 0xffff, 0xffff, { readByte: () => 0, writeByte: () => {}, fetchByte: () => 0 });
  // @ts-expect-error Bodies retain their concrete CPU state.
  unary8088.NEG_8_0(intel);
}


export function check8088StackTypes(state: Cpu8088State, intel: Cpu8080State): void {
  generated8088[0x50](state, { writeByte: () => {} });
  generated8088[0x5c](state, { readByte: () => 0 });
  generated8088[0x17](state, { readByte: () => 0, deferInterrupt: () => {} });
  generated8088[0x9d](state, { readByte: () => 0, deferInterrupt: () => {} });
  generated8088[0x9a](state, { fetchByte: () => 0, writeByte: () => {} });
  generated8088[0xc2](state, { fetchByte: () => 0, readByte: () => 0 });
  stack8088.JMP_0(state);
  stack8088.CALL_4(state, { writeByte: () => {} });
  stack8088.CALL_far_memory(state, 0xffff, 0xffff, { readByte: () => 0, writeByte: () => {} });
  stack8088.POP_memory(state, 0xffff, 0xffff, { readByte: () => 0, writeByte: () => {} });
  stack8088.pushWord(state, 0x1234, { writeByte: () => {} });
  deferInterrupt("all");
  // @ts-expect-error Deferral is a specific boundary request, not an arbitrary callback.
  deferInterrupt(() => {});
  // @ts-expect-error Only the two modeled recognition scopes are supported.
  deferInterrupt("irq");
  // @ts-expect-error Segment POP requires a boundary deferral capability.
  generated8088[0x17](state, { readByte: () => 0 });
  // @ts-expect-error POPF cannot silently skip its IF-transition deferral.
  generated8088[0x9d](state, { readByte: () => 0 });
  // @ts-expect-error An ordinary register POP cannot request deferral.
  generated8088[0x58](state, { readByte: () => 0, deferInterrupt: () => {} });
  // @ts-expect-error PUSH cannot read its destination memory.
  generated8088[0x50](state, { readByte: () => 0, writeByte: () => {} });
  // @ts-expect-error Relative CALL fetches explicit bytes, not an opaque word.
  generated8088[0xe8](state, { fetchWord: () => 0, writeByte: () => {} });
  // @ts-expect-error RETF without a discard operand has no fetch capability.
  generated8088[0xcb](state, { fetchByte: () => 0, readByte: () => 0 });
  // @ts-expect-error A resolved pointer jump has no stack-writing capability.
  stack8088.JMP_far_memory(state, 0, 0, { readByte: () => 0, writeByte: () => {} });
  // @ts-expect-error Numeric inputs precede context; the stack word is not a callback.
  stack8088.pushWord(state, () => 0, { writeByte: () => {} });
  // @ts-expect-error Generated stack bodies retain the concrete CPU state.
  stack8088.PUSH_memory(intel, 0, 0, { readByte: () => 0, writeByte: () => {} });
}


export function check8088AddressingAndStringTypes(state: Cpu8088State, intel: Cpu8080State): void {
  addressing8088.segment_load_ss_0(state, { deferInterrupt: () => {} });
  addressing8088.segment_store_cs_memory(state, 0xffff, 0xffff, { writeByte: () => {} });
  addressing8088.LEA_0(state, 0xffff);
  addressing8088.LES_0(state, 0xffff, 0xffff, { readByte: () => 0 });
  addressing8088.XLAT(state, { readByte: () => 0 });
  addressing8088.XLAT_override(state, 0xffff, { readByte: () => 0 });
  generated8088[0xfa](state);
  generated8088[0xfb](state, { deferInterrupt: () => {} });
  generated8088[0xcf](state, { readByte: () => 0, deferInterrupt: () => {} });
  strings8088.move_8(state, { readByte: () => 0, writeByte: () => {} });
  strings8088.store_16_override(state, 0xffff, { writeByte: () => {} });
  strings8088.compare_16_repne(state, 0xffff, { readByte: () => 0 });
  strings8088.load_8_repe_override(state, 0xffff, 0xffff, { readByte: () => 0 });
  // @ts-expect-error Segment loads cannot omit their retirement request.
  addressing8088.segment_load_ss_0(state);
  // @ts-expect-error Segment stores cannot read their memory destination.
  addressing8088.segment_store_cs_memory(state, 0, 0, { readByte: () => 0, writeByte: () => {} });
  // @ts-expect-error LEA never accesses memory.
  addressing8088.LEA_0(state, 0, { readByte: () => 0 });
  // @ts-expect-error LES has no segment-MOV inhibition effect.
  addressing8088.LES_0(state, 0, 0, { readByte: () => 0, deferInterrupt: () => {} });
  // @ts-expect-error A plain XLAT has no override input.
  addressing8088.XLAT(state, 0xffff, { readByte: () => 0 });
  // @ts-expect-error CLI has no deferral effect.
  generated8088[0xfa](state, { deferInterrupt: () => {} });
  // @ts-expect-error IRET needs a deferral capability as well as stack reads.
  generated8088[0xcf](state, { readByte: () => 0 });
  // @ts-expect-error REPNE has no documented MOVS form.
  strings8088.move_8_repne(state, 0, { readByte: () => 0, writeByte: () => {} });
  // @ts-expect-error Comparisons never write memory.
  strings8088.compare_16_repne(state, 0, { readByte: () => 0, writeByte: () => {} });
  // @ts-expect-error Repeated bodies take a captured prefix-start IP, not a fetch callback.
  strings8088.load_8_repe(state, { fetchByte: () => 0, readByte: () => 0 });
  // @ts-expect-error A completed string body cannot deliver interrupts or fetch the next iteration.
  strings8088.store_8(state, { writeByte: () => {}, fetchByte: () => 0 });
  // @ts-expect-error Bodies retain their concrete CPU state.
  strings8088.move_8(intel, { readByte: () => 0, writeByte: () => {} });
}

export function check8088ArithmeticTypes(state: Cpu8088State, intel: Cpu8080State): void {
  arithmetic8088.shift_0_cl_8_1(state);
  arithmetic8088.shift_7_one_16_memory(state, 0, 0, { readByte: () => 0, writeByte: () => {} });
  arithmetic8088.IMUL_16_memory(state, 0, 0, { readByte: () => 0 });
  const outcome: "divide-error" | void = arithmetic8088.IDIV_16_2(state);
  const radix: "opcode" | "divide-error" | void = generated8088[0xd4](state, { fetchByte: () => 10 });
  void outcome; void radix;
  iterate("current", literal(8, 3), literal(16, 0), [], value("current"));
  divide({ quotient: "q", remainder: "r", dividend: value("wide"), divisor: value("word"), signed: true, onError: "divide-error" });
  reject("opcode");
  multiply(value("left"), value("right"), true);
  // @ts-expect-error Iteration bodies are ordered statements, not host callbacks.
  iterate("current", literal(8, 3), literal(16, 0), () => {}, value("current"));
  // @ts-expect-error A Boolean flag is not a numeric repetition count.
  iterate("current", flagValue("count"), literal(16, 0), [], value("current"));
  // @ts-expect-error Signedness is explicit Boolean data.
  multiply(value("left"), value("right"), "signed");
  // @ts-expect-error Outcome names are data, not exception callbacks.
  reject(() => {});
  // @ts-expect-error /6 remains undocumented.
  arithmetic8088.shift_6_one_8_0(state);
  // @ts-expect-error Shifts need their write capability even with a zero count.
  arithmetic8088.shift_4_cl_16_memory(state, 0, 0, { readByte: () => 0 });
  // @ts-expect-error Multiply cannot write its memory operand.
  arithmetic8088.MUL_8_memory(state, 0, 0, { readByte: () => 0, writeByte: () => {} });
  // @ts-expect-error Division returns an outcome; it never delivers an interrupt itself.
  arithmetic8088.DIV_16_memory(state, 0, 0, { readByte: () => 0, interrupt: () => {} });
  // @ts-expect-error Register arithmetic has no fetch or memory capability.
  arithmetic8088.IMUL_8_0(state, { fetchByte: () => 0 });
  // @ts-expect-error The divide-error outcome cannot be silently narrowed to success.
  const success: undefined = arithmetic8088.DIV_8_0(state);
  // @ts-expect-error Bodies retain concrete CPU state.
  arithmetic8088.MUL_16_0(intel);
}
