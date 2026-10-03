import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu6502 } from "../../src/components/cpus/generated/6502-cpu.js";
import { families } from "../../src/components/cpus/semantics/generated/6502.js";
import { fetchByte, flagLiteral, perform, when } from "../../src/components/cpus/semantics/model.js";
import type { Statement } from "../../src/components/cpus/semantics/model.js";
import { Ram } from "../../src/components/memory/ram.js";
import { instructionCatalogue6502 } from "../../site/6502-instruction-catalogue.js";
import { disassemble6502Rows } from "../../site/interactive/6502-disassembly.js";
import { apple2CodeRows } from "../../site/interactive/apple2-disassembly.js";
import { parseApple2Address } from "../../site/interactive/apple2-explorer.js";
import { apple2StorageReader } from "../../site/interactive/apple2-inspection.js";
import { createApple2Session } from "../../site/interactive/apple2-session.js";

const entries = Object.values(families).flat(), instructions = instructionCatalogue6502(entries);

test("chapter-derived 6502 lengths match actual fetches for every documented opcode", () => {
  assert.equal(Object.keys(instructions).length, 151);
  for (const [opcode, length] of [[0xea, 1], [0x0a, 1], [0x60, 1], [0xa9, 2], [0xb1, 2], [0x00, 2],
    [0xd0, 2], [0xad, 3], [0x6c, 3], [0x20, 3]] as const) assert.equal(instructions[opcode]?.length, length);
  for (const [opcode] of entries) for (const setFlags of [false, true]) {
    const memory = new Ram(65536);
    [opcode, 0x34, 0x12].forEach((byte, offset) => memory.write(0x200 + offset, byte));
    const cpu = new Cpu6502(memory, { a: 0, x: 0, y: 0, pc: 0x200, sp: 0xff,
      flags: { n: setFlags, v: setFlags, d: false, i: true, z: setFlags, c: setFlags } });
    const record = cpu.step();
    assert.equal(record.outcome, "executed");
    assert.equal(instructions[opcode]?.length, record.instruction.bytes.length, `${instructions[opcode]?.name} ($${opcode.toString(16)})`);
  }
});

test("instruction sizing follows shared actions and rejects conditional or oversized operands", () => {
  const catalogue = (steps: readonly Statement[]) => instructionCatalogue6502([[0, { ...entries[0]![1], steps }]]);
  assert.equal(catalogue([perform({ name: "operand", steps: [fetchByte("operand")] }, {})])[0]?.length, 2);
  assert.throws(() => catalogue([when(flagLiteral(true), [fetchByte("operand")])]), /depend on a condition/);
  assert.throws(() => catalogue([fetchByte("one"), fetchByte("two"), fetchByte("three")]), /Invalid 6502 instruction length/);
});

test("the chapter identifies every 6502 control transfer, including calls and software interrupts", () => {
  const branches = new Set([0x10, 0x30, 0x50, 0x70, 0x90, 0xb0, 0xd0, 0xf0]);
  const transfers = new Set([0x00, 0x20, 0x40, 0x4c, 0x60, 0x6c]);
  for (const [opcode] of entries) {
    const expected = branches.has(opcode) ? "conditional" : transfers.has(opcode) ? "unconditional" : "sequential";
    assert.equal(instructions[opcode]?.controlFlow, expected, instructions[opcode]?.name);
    const rows = apple2CodeRows(address => address === 0x200 ? opcode : 0, 0x200, instructions, false);
    assert.equal(rows[0]?.controlFlow, expected, `Upcoming ${instructions[opcode]?.name}`);
  }
});

test("control-flow metadata follows PC writes through sources, actions, and conditions, not instruction names", () => {
  const jump = entries.find(([opcode]) => opcode === 0x4c)![1];
  const writePC = jump.steps.at(-1)!;
  const catalogue = (steps: readonly Statement[]) => instructionCatalogue6502([[0xea, { ...jump, name: "NOP", steps }]])[0xea]!;
  const action = perform({ name: "transfer", steps: [writePC] }, {});
  assert.equal(catalogue([action]).controlFlow, "unconditional");
  assert.equal(catalogue([when(flagLiteral(true), [action])]).controlFlow, "conditional");
  assert.equal(catalogue([when(flagLiteral(true), [action]), writePC]).controlFlow, "unconditional");
  assert.equal(catalogue([writePC, when(flagLiteral(true), [action])]).controlFlow, "unconditional");
  const result = { kind: "literal", width: 16, value: 0 } as const;
  assert.equal(catalogue([{ kind: "read-source", name: "target", source: { name: "transfer", type: 16, steps: [writePC], result } }]).controlFlow, "unconditional");
  const yes = { steps: [action], result };
  const choice = { kind: "choose", name: "target", condition: flagLiteral(true), type: 16, yes, no: yes } as const;
  assert.equal(catalogue([choice]).controlFlow, "unconditional");
  assert.equal(catalogue([{ ...choice, no: { steps: [], result } }]).controlFlow, "conditional");
});

test("forward disassembly follows instruction lengths, including BRK's padding, without reading data targets", () => {
  const bytes = [0xa9, 0x41, 0xad, 0x00, 0xc0, 0x6c, 0x36, 0x00, 0xd0, 0xf6, 0x00, 0xff, 0xea];
  const seen: number[] = [];
  const rows = disassemble6502Rows(address => { seen.push(address); return bytes[address - 0x200]; }, 0x200, instructions, 6);
  assert.deepEqual(rows.map(row => [row.address, row.assembly, row.complete]), [
    [0x200, "LDA #$41", true], [0x202, "LDA $C000", true], [0x205, "JMP ($0036)", true],
    [0x208, "BNE $0200", true], [0x20a, "BRK", true], [0x20c, "NOP", true],
  ]);
  assert.deepEqual(seen, bytes.map((_, offset) => 0x200 + offset));
});

test("unsupported, missing, and incomplete instructions remain visible without becoming run targets", () => {
  const bytes = [0x02, undefined, 0xad, 0x10, undefined, 0xea];
  assert.deepEqual(disassemble6502Rows(address => bytes[address], 0, instructions, 4), [
    { address: 0, bytes: [0x02], assembly: ".byte $02", complete: false },
    { address: 1, bytes: [undefined], assembly: "Unavailable", complete: false },
    { address: 2, bytes: [0xad, 0x10, undefined], assembly: "LDA $????", complete: false },
    { address: 5, bytes: [0xea], assembly: "NOP", complete: true },
  ]);
});

test("operands wrap at FFFF while the listing stops at the end of the address space", () => {
  const seen: number[] = [];
  const row = disassemble6502Rows(address => {
    seen.push(address); return address === 0xffff ? 0x4c : address === 0 ? 0x34 : 0x12;
  }, 0xffff, instructions);
  assert.deepEqual(row, [{ address: 0xffff, bytes: [0x4c, 0x34, 0x12], assembly: "JMP $1234", complete: true }]);
  assert.deepEqual(seen, [0xffff, 0, 1]);
  assert.equal(disassemble6502Rows(address => address === 0xffff ? 0xd0 : 0xfe, 0xffff, instructions)[0]?.assembly, "BNE $FFFF");
  assert.deepEqual(disassemble6502Rows(() => { throw new Error("Unexpected read"); }, 0, instructions, 0), []);
  for (const address of [-1, 65536, 1.5, NaN]) assert.throws(() => disassemble6502Rows(() => 0, address, instructions), RangeError);
  for (const count of [-1, 257, 1.5, NaN]) assert.throws(() => disassemble6502Rows(() => 0, 0, instructions, count), RangeError);
});

test("disassembly follows Language Card banks and slot ROM, even before motherboard firmware is loaded", () => {
  const { machine } = createApple2Session();
  const first = (address: number) => disassemble6502Rows(apple2StorageReader(machine), address, instructions, 1)[0]!;
  machine.ram.write(0xbfff, 0xad);
  assert.deepEqual(first(0xbfff), { address: 0xbfff, bytes: [0xad, undefined, undefined], assembly: "LDA $????", complete: false });
  assert.equal(first(0xd000).assembly, "Unavailable");
  machine.bank1.write(0, 0xa9); machine.bank1.write(1, 0x41);
  machine.bank2.write(0, 0xa2); machine.bank2.write(1, 0x42);
  machine.upper.write(0, 0xea);
  machine.language.read(8);
  assert.equal(first(0xd000).assembly, "LDA #$41");
  machine.language.read(0);
  assert.equal(first(0xd000).assembly, "LDX #$42");
  assert.equal(first(0xe000).assembly, "NOP");
  machine.language.read(1);
  assert.equal(first(0xd000).assembly, "Unavailable");
  assert.equal(first(0xc600).assembly, "Unavailable");
  machine.disk.install(new Array(256).fill(0xea));
  assert.equal(first(0xc600).assembly, "NOP");
  assert.equal(first(0xc700).assembly, "Unavailable");
});

test("memory and code address fields accept only the documented hexadecimal notation", () => {
  for (const value of ["fd21", "$FD21", "  $fd21  "]) assert.equal(parseApple2Address(value), 0xfd21);
  assert.equal(parseApple2Address("0"), 0); assert.equal(parseApple2Address("ffff"), 65535);
  for (const value of ["", "$", "0x100", "100h", "10000", "-1", "12.5", "123z", "$ 10"]) {
    assert.throws(() => parseApple2Address(value), /hexadecimal address/);
  }
});

function program(bytes: readonly number[], address = 0x200, zero = false) {
  const memory = new Ram(65536);
  bytes.forEach((byte, offset) => memory.write(address + offset, byte));
  const cpu = new Cpu6502(memory, { a: 0, x: 0, y: 0, pc: address, sp: 0xff,
    flags: { n: false, v: false, d: false, i: true, z: zero, c: false } });
  return { memory, cpu, step: () => ({ record: cpu.step(), romMapped: false }) };
}

test("PC following shows the last three executed instructions before live memory", () => {
  const { memory, cpu, step } = program([0xa9, 0x41, 0xe8, 0x8d, 0x00, 0x04, 0xea]);
  const records = [step(), step(), step(), step()];
  const rows = apple2CodeRows(address => memory.read(address), cpu.snapshot().pc, instructions, false, records);
  assert.deepEqual(rows.slice(0, 4).map(row => [row.address, row.assembly, row.executed, row.controlFlow]), [
    [0x202, "INX", true, "sequential"], [0x203, "STA $0400", true, "sequential"],
    [0x206, "NOP", true, "sequential"], [0x207, "BRK", false, "unconditional"],
  ]);
  assert.equal(rows.length, 16);
});

test("history omits skipped instructions but marks conditional branches whether taken or not", () => {
  for (const zero of [false, true]) {
    const { memory, cpu, step } = program([0xd0, 0x02, 0xea, 0xea, 0xea], 0x200, zero);
    const records = [step()];
    const rows = apple2CodeRows(address => memory.read(address), cpu.snapshot().pc, instructions, false, records);
    assert.equal(rows[0]?.address, 0x200); assert.equal(rows[0]?.executed, true);
    assert.equal(rows[1]?.address, zero ? 0x202 : 0x204);
    assert.equal(rows[0]?.controlFlow, "conditional");
    assert.equal(rows[1]?.controlFlow, "sequential");
    assert.equal(rows[1]?.executed, false);
  }
});

test("calls and returns retain execution order and mark each unconditional transfer", () => {
  const { memory, cpu, step } = program([0x20, 0x00, 0x03, 0xea]);
  memory.write(0x300, 0x60);
  const records = [step(), step()];
  const rows = apple2CodeRows(address => memory.read(address), cpu.snapshot().pc, instructions, false, records);
  assert.deepEqual(rows.slice(0, 3).map(row => [row.address, row.assembly, row.controlFlow]), [
    [0x200, "JSR $0300", "unconditional"], [0x300, "RTS", "unconditional"], [0x203, "NOP", "sequential"],
  ]);
});

test("transfers remain marked when their destination is the next sequential address", () => {
  for (const bytes of [[0x4c, 0x03, 0x02, 0xea], [0xd0, 0x00, 0xea]]) {
    const { memory, cpu, step } = program(bytes);
    const records = [step()];
    const rows = apple2CodeRows(address => memory.read(address), cpu.snapshot().pc, instructions, false, records);
    assert.equal(rows[0]?.controlFlow, bytes[0] === 0x4c ? "unconditional" : "conditional");
    assert.equal(rows[1]?.address, 0x200 + records[0]!.record.instruction.bytes.length);
    assert.equal(rows[1]?.controlFlow, "sequential");
  }
});

test("known transfers retain markers with missing operands; unknown bytes have none", () => {
  const bytes = [0x02, undefined, 0x4c, undefined, undefined, 0xd0];
  const rows = apple2CodeRows(address => bytes[address], 0, instructions, false);
  assert.deepEqual(rows.slice(0, 4).map(row => [row.complete, row.controlFlow]), [
    [false, "sequential"], [false, "sequential"], [false, "unconditional"], [false, "conditional"],
  ]);
});

test("loop history distinguishes repeated addresses from the next instruction at PC", () => {
  const { memory, cpu, step } = program([0xd0, 0xfe]);
  const records = [step(), step(), step()];
  const rows = apple2CodeRows(address => memory.read(address), cpu.snapshot().pc, instructions, false, records);
  assert.deepEqual(rows.slice(0, 4).map(row => [row.address, row.executed, row.controlFlow]), [
    [0x200, true, "conditional"], [0x200, true, "conditional"], [0x200, true, "conditional"], [0x200, false, "conditional"],
  ]);
});

test("executed rows preserve recorded bytes and ROM mapping without rereading changed memory", () => {
  const { memory, cpu, step } = program([0xa9, 0x41, 0xea], 0xd000);
  const entry = { ...step(), romMapped: true };
  memory.write(0xd000, 0x00); memory.write(0xd001, 0xff);
  const read = (address: number) => {
    assert.ok(address >= 0xd002, "History must use its captured bytes"); return memory.read(address);
  };
  const rows = apple2CodeRows(read, cpu.snapshot().pc, instructions, false, [entry]);
  assert.deepEqual(rows[0], { address: 0xd000, bytes: [0xa9, 0x41], assembly: "LDA #$41",
    executed: true, complete: true, romMapped: true, controlFlow: "sequential" });
  assert.equal(rows[1]?.romMapped, false);
  assert.equal(rows[1]?.assembly, "NOP");
});

test("sequential execution across FFFF needs no jump separator", () => {
  const { memory, cpu, step } = program([0xea], 0xffff);
  const records = [step()];
  const rows = apple2CodeRows(address => memory.read(address), cpu.snapshot().pc, instructions, false, records);
  assert.equal(rows[0]?.address, 0xffff); assert.equal(rows[0]?.executed, true);
  assert.equal(rows[1]?.address, 0); assert.equal(rows[0]?.controlFlow, "sequential");
  assert.equal(apple2CodeRows(address => memory.read(address), 0xffff, instructions, false).length, 1);
});
