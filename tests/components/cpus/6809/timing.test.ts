import assert from "node:assert/strict";
import { test } from "node:test";
import { InstructionTimingUnavailable } from "../../../../src/components/cpus/instruction-timing.js";
import { baseClocks, branchTaken, fixture, flags, isIndexed, pageClocks } from "./timing-fixture.js";

test("all 268 documented 6809 forms have independent clocks and identical untimed effects", () => {
  let supported = 0;
  for (const page of [0, 0x10, 0x11]) for (let opcode = 0; opcode < 256; opcode++) {
    if (page === 0 && (opcode === 0x10 || opcode === 0x11)) continue;
    const expected = page === 0 ? baseClocks[opcode]! : pageClocks[page]![opcode] ?? 0;
    const initialFlags = flags();
    if (opcode >= 0x22 && opcode <= 0x2f && branchTaken(opcode, initialFlags)) {
      // Every condition is false for some N/Z/V/C combination; choose one without a chapter lookup.
      Object.assign(initialFlags, [...Array(16).keys()].map(bits => ({ ...flags(),
        n: !!(bits & 8), z: !!(bits & 4), v: !!(bits & 2), c: !!(bits & 1) }))
        .find(value => !branchTaken(opcode, value)));
    }
    const code = [...(page ? [page] : []), opcode, isIndexed(opcode) ? 0x84 : 0, 0];
    const timed = fixture(code, { flags: initialFlags }), ordinary = fixture(code, { flags: initialFlags });
    const label = `page $${page.toString(16)}, opcode $${opcode.toString(16)}`;
    if (!expected) {
      assert.throws(() => timed.cpu.stepTimed(), (error: unknown) => {
        assert.ok(error instanceof InstructionTimingUnavailable, label);
        assert.equal(error.address, 0x200); assert.deepEqual(error.bytes, code.slice(0, page ? 2 : 1)); return true;
      });
      assert.deepEqual(timed.cpu.snapshot(), ordinary.cpu.snapshot(), label);
      continue;
    }
    supported++;
    const { clocks, ...record } = timed.cpu.stepTimed();
    assert.equal(clocks, expected, label);
    assert.deepEqual(record, ordinary.cpu.step(), label);
    assert.deepEqual(timed.ram.accesses, ordinary.ram.accesses, label);
    assert.deepEqual(record.accesses, timed.ram.accesses, label);
  }
  assert.equal(supported, 268);
});

test("short branches always cost three; conditional long branches add one only when taken", () => {
  for (let bits = 0; bits < 16; bits++) for (let opcode = 0x20; opcode <= 0x2f; opcode++) {
    const initialFlags = { ...flags(), n: !!(bits & 8), z: !!(bits & 4), v: !!(bits & 2), c: !!(bits & 1) };
    for (const pc of [0x200, 0x2fe, 0xfffe]) for (const offset of [-128, 0, 127]) {
      const taken = branchTaken(opcode, initialFlags);
      const short = fixture([opcode, offset & 255], { pc, flags: initialFlags }).cpu.stepTimed();
      assert.equal(short.clocks, 3);
      assert.equal(short.after.pc, (pc + 2 + (taken ? offset : 0)) & 0xffff);
      if (opcode === 0x20) continue; // LBRA is the separate base-page $16 form.
      const long = fixture([0x10, opcode, (offset >> 8) & 255, offset & 255], { pc, flags: initialFlags }).cpu.stepTimed();
      assert.equal(long.clocks, taken ? 6 : 5);
      assert.equal(long.after.pc, (pc + 4 + (taken ? offset : 0)) & 0xffff);
    }
  }
  for (const offset of [0x0000, 0x7fff, 0x8000, 0xffff]) {
    const record = fixture([0x16, offset >> 8, offset & 255], { pc: 0xfffe }).cpu.stepTimed();
    assert.equal(record.clocks, 5); assert.equal(record.after.pc, (1 + offset) & 0xffff);
  }
});

test("all four stack instructions charge one clock per selected byte for all 256 masks", () => {
  for (const opcode of [0x34, 0x35, 0x36, 0x37]) for (let mask = 0; mask < 256; mask++) {
    const bytes = [...mask.toString(2).padStart(8, "0")].reduce((sum, digit, index) =>
      sum + (digit === "1" ? index < 4 ? 2 : 1 : 0), 0);
    const timed = fixture([opcode, mask]), ordinary = fixture([opcode, mask]);
    const { clocks, ...record } = timed.cpu.stepTimed();
    assert.equal(clocks, 5 + bytes, `opcode $${opcode.toString(16)}, mask $${mask.toString(16)}`);
    assert.equal(record.accesses.length, 2 + bytes);
    assert.deepEqual(record, ordinary.cpu.step());
    assert.deepEqual(timed.ram.accesses, ordinary.ram.accesses);
  }
});

test("RTI clocks follow the restored E flag, not the outgoing interrupt's E", () => {
  for (const incoming of [false, true]) for (const restored of [false, true]) {
    const { cpu, ram } = fixture([0x3b], { flags: { ...flags(), e: incoming }, s: 0xfffe });
    const frame = restored ? [0x80, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0x12, 0x34] : [0, 0x12, 0x34];
    frame.forEach((byte, i) => ram.write((0xfffe + i) & 0xffff, byte));
    const record = cpu.stepTimed();
    assert.equal(record.clocks, restored ? 15 : 6);
    assert.equal(record.after.pc, 0x1234); assert.equal(record.after.flags.e, restored);
    assert.equal(record.after.s, restored ? 10 : 1);
  }
});
