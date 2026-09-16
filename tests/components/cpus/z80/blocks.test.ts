import assert from "node:assert/strict";
import { test } from "node:test";
import { CpuZ80 } from "../../../../src/components/cpus/z80.js";
import { Ram } from "../../../../src/components/memory/ram.js";
import { ObservedRam } from "../../../helpers/observed-ram.js";
import { initialState, flagPattern, readAccess, writeAccess, checkPrefixedStep } from "./helpers.js";

const blockForms = [
  { name: "LDI", opcode: 0xa0, delta: 1, compare: false, repeat: false },
  { name: "LDD", opcode: 0xa8, delta: -1, compare: false, repeat: false },
  { name: "LDIR", opcode: 0xb0, delta: 1, compare: false, repeat: true },
  { name: "LDDR", opcode: 0xb8, delta: -1, compare: false, repeat: true },
  { name: "CPI", opcode: 0xa1, delta: 1, compare: true, repeat: false },
  { name: "CPD", opcode: 0xa9, delta: -1, compare: true, repeat: false },
  { name: "CPIR", opcode: 0xb1, delta: 1, compare: true, repeat: true },
  { name: "CPDR", opcode: 0xb9, delta: -1, compare: true, repeat: true },
] as const;

for (const { name, opcode, delta, compare, repeat } of blockForms) {
  test(`Z80 ${name} exposes one iteration with correct counter, flags, direction, and repeat condition`, () => {
    const ram = new ObservedRam();
    for (const count of [0, 1, 2, 0x100, 0x8000, 0xffff]) for (const hl of [0, 0xffff]) for (let bits = 0; bits < 64; bits++) {
      for (const [a, value] of [[0, 0], [0, 1], [0x80, 1], [0x7f, 0xff], [0x10, 0x0f], [0xff, 0xff]] as const) {
        const before = initialState({ a, b: Math.floor(count / 256), c: count % 256, d: Math.floor(hl / 256), e: hl % 256,
          h: Math.floor(hl / 256), l: hl % 256, flags: flagPattern(bits) });
        const remaining = (count + 65535) % 65536, next = (hl + delta + 65536) % 65536;
        const difference = (a - value + 256) % 256;
        const flags = compare ? { s: difference >= 128, z: a === value, h: a % 16 < value % 16, pv: remaining !== 0, n: true, c: before.flags.c }
          : { ...before.flags, h: false, pv: remaining !== 0, n: false };
        ram.write(hl, value);
        checkPrefixedStep(ram, before, [0xed, opcode], { b: Math.floor(remaining / 256), c: remaining % 256,
          h: Math.floor(next / 256), l: next % 256, ...(compare ? {} : { d: Math.floor(next / 256), e: next % 256 }), flags,
          pc: repeat && remaining !== 0 && (!compare || a !== value) ? before.pc : before.pc + 2 },
        [readAccess(hl, value), ...(compare ? [] : [writeAccess(hl, value)])]);
      }
    }
  });
}

test("Z80 block comparisons set S/Z/H from every byte pair, PV from BC, and preserve A/C", () => {
  const ram = new ObservedRam();
  for (let a = 0; a < 256; a++) for (let value = 0; value < 256; value++) {
    const before = initialState({ a, b: 0, c: 2, flags: flagPattern(value % 64) });
    ram.write(0x6677, value);
    const result = (a - value + 256) % 256;
    checkPrefixedStep(ram, before, [0xed, 0xa1], { c: 1, l: 0x78,
      flags: { s: result >= 128, z: result === 0, h: a % 16 < value % 16, pv: true, n: true, c: before.flags.c } }, [readAccess(0x6677, value)]);
  }
});

test("Z80 repeating blocks refetch current code and data, propagate overlap, and resume from snapshots", () => {
  for (const [opcode, delta] of [[0xb0, 1], [0xb8, -1]] as const) {
    const ram = new ObservedRam();
    const start = delta === 1 ? 0x100 : 0x104, destination = start + delta;
    [0xed, opcode, 0x76].forEach((byte, i) => ram.write(0x2000 + i, byte));
    ram.write(start, 0x5a);
    const cpu = new CpuZ80(ram, initialState({ b: 0, c: 4, h: Math.floor(start / 256), l: start % 256,
      d: Math.floor(destination / 256), e: destination % 256 }));
    const retained = cpu.step(), saved = structuredClone(retained);
    assert.equal(retained.after.pc, 0x2000); assert.equal(retained.after.bc, 3);
    const resumed = new CpuZ80(ram, retained.after);
    for (let iteration = 1; iteration < 4; iteration++) {
      const record = resumed.step();
      assert.equal(record.after.bc, 3 - iteration);
      assert.equal(record.after.pc, iteration === 3 ? 0x2002 : 0x2000);
      assert.deepEqual(record.accesses, [readAccess(0x2000, 0xed), readAccess(0x2001, opcode),
        readAccess(start + delta * iteration, 0x5a), writeAccess(destination + delta * iteration, 0x5a)]);
    }
    assert.equal(resumed.step().outcome, "halted");
    assert.deepEqual(retained, saved);
  }
  for (const destination of [0xffff, 0]) {
    const ram = new ObservedRam();
    ram.write(0xffff, 0xed); ram.write(0, 0xb0); ram.write(0x100, 0x76);
    const cpu = new CpuZ80(ram, initialState({ pc: 0xffff, b: 0, c: 2, h: 1, l: 0, d: Math.floor(destination / 256), e: destination % 256 }));
    const record = cpu.step();
    assert.deepEqual(record.instruction, { address: 0xffff, bytes: [0xed, 0xb0] });
    assert.equal(record.after.pc, 0xffff);
    const next = cpu.step();
    assert.equal(next.outcome, destination === 0xffff ? "halted" : "unsupported");
    assert.deepEqual(next.instruction?.bytes, destination === 0xffff ? [0x76] : [0xed, 0x76]);
  }
});

test("Z80 initial BC=0 repeats a full 65536 iterations, while CPIR/CPDR stop on an early match", () => {
  // In-place copy visits all RAM without corrupting its own code and demonstrates the zero-count wrap.
  const ram = new Ram(65536);
  ram.write(0x2000, 0xed); ram.write(0x2001, 0xb0);
  const before = initialState({ b: 0, c: 0, d: 0, e: 0, h: 0, l: 0 });
  const cpu = new CpuZ80(ram, before);
  for (let iteration = 0; iteration < 65536; iteration++) {
    const record = cpu.step();
    assert.equal(record.after.bc, 65535 - iteration);
    assert.equal(record.after.pc, iteration === 65535 ? 0x2002 : 0x2000);
  }
  assert.equal(cpu.snapshot().r, before.r);
  assert.equal(cpu.snapshot().hl, 0); assert.equal(cpu.snapshot().de, 0);
  for (const [opcode, delta] of [[0xb1, 1], [0xb9, -1]] as const) for (const count of [0, 4]) for (const match of [0, 1, 3]) {
    const ram = new Ram(65536);
    [0xed, opcode].forEach((byte, i) => ram.write(0x2000 + i, byte));
    ram.write(0x100 + delta * match, 0x5a);
    const cpu = new CpuZ80(ram, initialState({ a: 0x5a, h: 1, l: 0, b: 0, c: count }));
    for (let i = 0; i <= match; i++) {
      const record = cpu.step();
      assert.equal(record.after.pc, i === match ? 0x2002 : 0x2000);
      assert.equal(record.after.flags.z, i === match);
      assert.equal(record.after.bc, (count - i - 1 + 65536) % 65536);
    }
  }
});
