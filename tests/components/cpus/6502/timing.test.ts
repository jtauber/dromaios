import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu6502 } from "../../../../src/components/cpus/generated/6502-cpu.js";
import type { Cpu6502Flags, Cpu6502State } from "../../../../src/components/cpus/generated/6502-cpu.js";
import { InstructionTimingUnavailable } from "../../../../src/components/cpus/instruction-timing.js";
import { Ram } from "../../../../src/components/memory/ram.js";

const flags = (): Cpu6502Flags => ({ n: false, v: false, d: false, i: false, z: false, c: false });
function fixture(code: readonly number[], changes: Partial<Cpu6502State> = {}) {
  const state: Cpu6502State = { a: 0x42, x: 0, y: 0, sp: 0xff, pc: 0x200, flags: flags(), ...changes };
  const ram = new Ram(0x10000);
  code.forEach((byte, index) => ram.write((state.pc + index) & 0xffff, byte));
  return { ram, cpu: new Cpu6502(ram, state) };
}

// Independent opcode table checked against the Synertek/MOS manual, Appendices B/C:
// https://syncopate.us/books/Synertek6502ProgrammingManual.html
// Rows are the opcode's high nibble, columns its low nibble. Zero means undocumented.
// Branches are untaken; indexed reads stay within a page. No generated catalogue is used.
const baseClocks = [
  [7, 6, 0, 0, 0, 3, 5, 0, 3, 2, 2, 0, 0, 4, 6, 0],
  [2, 5, 0, 0, 0, 4, 6, 0, 2, 4, 0, 0, 0, 4, 7, 0],
  [6, 6, 0, 0, 3, 3, 5, 0, 4, 2, 2, 0, 4, 4, 6, 0],
  [2, 5, 0, 0, 0, 4, 6, 0, 2, 4, 0, 0, 0, 4, 7, 0],
  [6, 6, 0, 0, 0, 3, 5, 0, 3, 2, 2, 0, 3, 4, 6, 0],
  [2, 5, 0, 0, 0, 4, 6, 0, 2, 4, 0, 0, 0, 4, 7, 0],
  [6, 6, 0, 0, 0, 3, 5, 0, 4, 2, 2, 0, 5, 4, 6, 0],
  [2, 5, 0, 0, 0, 4, 6, 0, 2, 4, 0, 0, 0, 4, 7, 0],
  [0, 6, 0, 0, 3, 3, 3, 0, 2, 0, 2, 0, 4, 4, 4, 0],
  [2, 6, 0, 0, 4, 4, 4, 0, 2, 5, 2, 0, 0, 5, 0, 0],
  [2, 6, 2, 0, 3, 3, 3, 0, 2, 2, 2, 0, 4, 4, 4, 0],
  [2, 5, 0, 0, 4, 4, 4, 0, 2, 4, 2, 0, 4, 4, 4, 0],
  [2, 6, 0, 0, 3, 3, 5, 0, 2, 2, 2, 0, 4, 4, 6, 0],
  [2, 5, 0, 0, 0, 4, 6, 0, 2, 4, 0, 0, 0, 4, 7, 0],
  [2, 6, 0, 0, 3, 3, 5, 0, 2, 2, 2, 0, 4, 4, 6, 0],
  [2, 5, 0, 0, 0, 4, 6, 0, 2, 4, 0, 0, 0, 4, 7, 0],
].flat();
const branches: readonly [number, keyof Cpu6502Flags, boolean][] = [
  [0x10, "n", false], [0x30, "n", true], [0x50, "v", false], [0x70, "v", true],
  [0x90, "c", false], [0xb0, "c", true], [0xd0, "z", false], [0xf0, "z", true],
];

test("all 151 documented 6502 forms have independent base clocks and identical untimed effects", () => {
  assert.equal(baseClocks.filter(Boolean).length, 151);
  for (const [opcode, expected] of baseClocks.entries()) {
    const initialFlags = flags(), branch = branches.find(([byte]) => byte === opcode);
    if (branch) initialFlags[branch[1]] = !branch[2];
    const timed = fixture([opcode, 0x40, 0x30], { flags: initialFlags });
    const ordinary = fixture([opcode, 0x40, 0x30], { flags: initialFlags });
    if (!expected) {
      assert.throws(() => timed.cpu.stepTimed(), (error: unknown) => {
        assert.ok(error instanceof InstructionTimingUnavailable);
        assert.equal(error.address, 0x200); assert.deepEqual(error.bytes, [opcode]); return true;
      });
      assert.deepEqual(timed.cpu.snapshot(), ordinary.cpu.snapshot());
      continue;
    }
    const { clocks, ...record } = timed.cpu.stepTimed();
    assert.equal(clocks, expected, `opcode $${opcode.toString(16)}`);
    assert.deepEqual(record, ordinary.cpu.step());
  }
});

test("all eight branches charge taken and crossed-page paths from the post-operand PC", () => {
  for (const [opcode, flag, set] of branches) for (const taken of [false, true]) {
    for (const [pc, offset, target, cost] of [
      [0x200, 0x7f, 0x281, 3], [0x27e, 0x80, 0x200, 3],
      [0x2fe, 0xfe, 0x2fe, 4], [0x2fd, 0x01, 0x300, 4],
      [0xfffe, 0xff, 0xffff, 4], [0xfffd, 0x01, 0x0000, 4],
      [0x2ff, 0x00, 0x301, 3], [0xffff, 0x00, 0x0001, 3],
    ] as const) {
      const { cpu } = fixture([opcode, offset], { pc, flags: { ...flags(), [flag]: taken ? set : !set } });
      const record = cpu.stepTimed();
      assert.equal(record.clocks, taken ? cost : 2);
      assert.equal(record.after.pc, taken ? target : (pc + 2) & 0xffff);
      assert.equal(record.accesses.length, 2); // Timing adds no dummy reads.
    }
  }
});

const indexedReads = [0x19, 0x1d, 0x39, 0x3d, 0x59, 0x5d, 0x79, 0x7d, 0xb9, 0xbc, 0xbd, 0xbe, 0xd9, 0xdd, 0xf9, 0xfd];
const indirectReads = [0x11, 0x31, 0x51, 0x71, 0xb1, 0xd1, 0xf1];
test("every page-sensitive read charges once, including pointer and 16-bit wrapping", () => {
  for (const opcode of [...indexedReads, ...indirectReads]) {
    const indirect = indirectReads.includes(opcode);
    for (const base of [0x3000, 0x30fe, 0x30ff, 0xfffe, 0xffff]) for (const index of [0, 1, 2, 0xff]) {
      const code = indirect ? [opcode, 0xff] : [opcode, base & 0xff, base >>> 8];
      const { ram, cpu } = fixture(code, { x: index, y: index });
      if (indirect) { ram.write(0xff, base & 0xff); ram.write(0, base >>> 8); }
      const address = (base + index) & 0xffff;
      const record = cpu.stepTimed();
      assert.equal(record.clocks, (indirect ? 5 : 4) + ((base >>> 8) === (address >>> 8) ? 0 : 1), `opcode $${opcode.toString(16)}`);
      assert.equal(record.accesses.at(-1)?.address, address);
      assert.equal(record.accesses.length, indirect ? 5 : 4);
    }
  }
});

test("indexed stores and read-modify-write instructions have fixed costs across page boundaries", () => {
  for (const opcode of [0x91, 0x99, 0x9d, 0x1e, 0x3e, 0x5e, 0x7e, 0xde, 0xfe]) {
    for (const base of [0x3000, 0x30ff, 0xffff]) {
      const { ram, cpu } = fixture(opcode === 0x91 ? [opcode, 0xff] : [opcode, base & 0xff, base >>> 8], { x: 1, y: 1 });
      if (opcode === 0x91) { ram.write(0xff, base & 0xff); ram.write(0, base >>> 8); }
      assert.equal(cpu.stepTimed().clocks, opcode === 0x91 ? 6 : opcode === 0x99 || opcode === 0x9d ? 5 : 7);
    }
  }
});

test("NMOS decimal arithmetic does not acquire the CMOS extra clock", () => {
  for (const opcode of [0x69, 0x65, 0x75, 0x6d, 0x7d, 0x79, 0x61, 0x71, 0xe9, 0xe5, 0xf5, 0xed, 0xfd, 0xf9, 0xe1, 0xf1]) {
    const code = [opcode, 0x40, 0x30];
    assert.equal(fixture(code, { flags: { ...flags(), d: true } }).cpu.stepTimed().clocks, baseClocks[opcode]);
  }
});

test("IRQ/NMI charge seven clocks only when accepted and preserve ordinary entry records", () => {
  for (const source of ["irq", "nmi"] as const) for (const masked of [false, true]) {
    const state = { flags: { ...flags(), i: masked } };
    const { cpu } = fixture([], state), ordinary = fixture([], state).cpu;
    const { clocks, ...record } = cpu.interruptTimed(source);
    assert.equal(clocks, source === "irq" && masked ? 0 : 7);
    assert.deepEqual(record, ordinary.interrupt(source));
    assert.equal(record.accesses.length, clocks ? 5 : 0);
  }
});

test("timed calls share the guard, retain failing effects, and do not leak clock counts between attempts", () => {
  const ram = new Ram(0x10000);
  [0x9d, 0xff, 0x30, 0xea].forEach((byte, offset) => ram.write(0x200 + offset, byte));
  let fail = true;
  const cpu = new Cpu6502({ size: ram.size, read: address => ram.read(address), write: (address, value) => {
    assert.throws(() => cpu.stepTimed(), /reentrant/);
    assert.throws(() => cpu.interruptTimed("nmi"), /reentrant/);
    assert.throws(() => cpu.reset(), /reentrant/);
    if (fail) throw new Error("write failed");
    ram.write(address, value);
  } }, { a: 0x42, x: 1, y: 0, pc: 0x200, sp: 0xff, flags: flags() });
  assert.throws(() => cpu.stepTimed(), /write failed/);
  assert.equal(cpu.snapshot().pc, 0x203); assert.equal(ram.read(0x3100), 0);
  assert.equal(cpu.stepTimed().clocks, 2);
  fail = false;
  assert.equal(cpu.interruptTimed("nmi").clocks, 7);
});

test("page penalties use captured operands without rereading the pointer or target", () => {
  const reads: number[] = [], ram = new Ram(0x10000);
  ram.write(0x200, 0xb1); ram.write(0x201, 0xff); ram.write(0xff, 0xff); ram.write(0, 0x30); ram.write(0x3100, 0x42);
  const cpu = new Cpu6502({ size: ram.size, read: address => {
    reads.push(address); const value = ram.read(address);
    if (address === 0) ram.write(0xff, 0); // The captured low byte must still carry into the high byte.
    return value;
  }, write: (address, value) => ram.write(address, value) }, { a: 0, x: 0, y: 1, sp: 0xff, pc: 0x200, flags: flags() });
  const record = cpu.stepTimed();
  assert.equal(record.clocks, 6); assert.equal(record.after.a, 0x42);
  assert.deepEqual(reads, [0x200, 0x201, 0xff, 0, 0x3100]);
});
