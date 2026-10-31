import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu8088 } from "../../../../src/components/cpus/generated/8088-cpu.js";
import type { Cpu8088State } from "../../../../src/components/cpus/generated/8088-cpu.js";
import { InstructionTimingUnavailable } from "../../../../src/components/cpus/instruction-timing.js";
import { Ram } from "../../../../src/components/memory/ram.js";
import { flags, initialState } from "./helpers.js";

function fixture(code: readonly number[], overrides: Partial<Cpu8088State> = {}) {
  const ram = new Ram(0x100000), state = initialState({ cs: 0, ip: 0x100, ds: 0, ss: 0, es: 0, flags: flags(0), ...overrides });
  code.forEach((byte, index) => ram.write(0x100 + index, byte));
  const cpu = new Cpu8088(ram, state, { test: () => false, ports: { readPort: () => 0x42, writePort: () => {} } });
  return { cpu, ram };
}

// Intel 8086 Family User's Manual, table 2-21; +4 per word data transfer on 8088.
const examples: readonly [readonly number[], number][] = [
  [[0x90], 3], [[0xb0, 1], 4], [[0xb8, 1, 2], 4], [[0x40], 2], [[0x48], 2],
  [[0x88, 0xc3], 2], [[0x8b, 0xc3], 2], [[0x01, 0xc3], 3], [[0x04, 1], 4],
  [[0x88, 6, 0, 2], 15], [[0x8b, 6, 0, 2], 18], [[0x89, 6, 0, 2], 19],
  [[0xc6, 6, 0, 2, 1], 16], [[0xc7, 6, 0, 2, 1, 0], 20],
  [[0xa0, 0, 2], 10], [[0xa1, 0, 2], 14], [[0xa3, 0, 2], 14],
  [[0x01, 6, 0, 2], 30], [[0x03, 6, 0, 2], 19], [[0x39, 6, 0, 2], 19],
  [[0x81, 6, 0, 2, 1, 0], 31], [[0x83, 0x3e, 0, 2, 1], 20],
  [[0xf6, 0xc0, 1], 5], [[0xf6, 6, 0, 2, 1], 17], [[0xf7, 6, 0, 2, 1, 0], 21],
  [[0xfe, 0xc0], 3], [[0xff, 0xc0], 2], [[0xff, 6, 0, 2], 29], [[0x87, 6, 0, 2], 31],
  [[0x50], 15], [[0x54], 15], [[0x58], 12], [[0x1e], 14], [[0x1f], 12],
  [[0x9c], 14], [[0x9d], 12], [[0xe8, 0, 0], 23], [[0xc3], 12], [[0xc2, 2, 0], 16],
  [[0xcb], 26], [[0xca, 2, 0], 25], [[0x9a, 0, 2, 0, 0], 36], [[0xea, 0, 2, 0, 0], 15],
  [[0xe4, 0x40], 10], [[0xe5, 0x40], 14], [[0xec], 8], [[0xed], 12],
  [[0xe6, 0x40], 10], [[0xe7, 0x40], 14], [[0xee], 8], [[0xef], 12],
  [[0xfa], 2], [[0xfb], 2], [[0xfc], 2], [[0xfd], 2], [[0x9e], 4], [[0x9f], 4],
  [[0xcc], 72], [[0xcd, 3], 71], [[0xcf], 36], [[0xeb, 0], 15],
  [[0x26, 0x3e, 0xa1, 0, 2], 18], [[0xf0, 0x01, 6, 0, 2], 32],
];
test("8088 nominal clocks include operand transfers without changing instruction semantics or records", () => {
  for (const [code, expected] of examples) {
    const { cpu } = fixture(code), ordinary = fixture(code).cpu.step();
    const { clocks, ...record } = cpu.stepTimed();
    assert.equal(clocks, expected, code.map(byte => byte.toString(16)).join(" "));
    assert.deepEqual(record, ordinary);
  }
});

test("all 8088 ModR/M address forms use independently tabulated EA clocks", () => {
  // Rows: no displacement (including direct offset), byte displacement, word displacement, registers.
  const costs = [[7, 8, 8, 7, 5, 5, 6, 5], [11, 12, 12, 11, 9, 9, 9, 9],
    [11, 12, 12, 11, 9, 9, 9, 9], [0, 0, 0, 0, 0, 0, 0, 0]];
  for (let mode = 0; mode < 4; mode++) for (let rm = 0; rm < 8; rm++) {
    const { cpu } = fixture([0x8b, mode * 64 + rm, 0, 0]);
    assert.equal(cpu.stepTimed().clocks, mode === 3 ? 2 : 12 + costs[mode]![rm]!, `${mode}/${rm}`);
  }
});

test("conditional timing follows the captured decision, including LOOP wraparound", () => {
  for (const taken of [false, true]) {
    assert.equal(fixture([0x74, 2], { flags: flags(taken ? 8 : 0) }).cpu.stepTimed().clocks, taken ? 16 : 4);
    assert.equal(fixture([0xce], { flags: flags(taken ? 256 : 0) }).cpu.stepTimed().clocks, taken ? 73 : 4);
  }
  for (const cx of [0, 1, 2, 0xffff]) {
    const { cpu } = fixture([0xe2, 0xfe], { cx });
    assert.equal(cpu.stepTimed().clocks, cx === 1 ? 5 : 17);
    assert.equal(cpu.snapshot().cx, (cx + 0xffff) & 0xffff);
    assert.equal(fixture([0xe3, 0], { cx }).cpu.stepTimed().clocks, cx === 0 ? 18 : 6);
  }
});

test("uncovered instructions and group forms reject before data effects and do not consume deferrals", () => {
  for (const code of [[0xd0, 0xc0], [0xf6, 0x26, 0, 2], [0xf7, 0xf3], [0xff, 0xd0], [0xf3, 0xa4], [0x9b], [0x0f]]) {
    const { cpu, ram } = fixture(code, { interruptDeferred: true });
    const before = cpu.snapshot(), writes: number[] = [];
    ram.observeWrites(write => writes.push(write.address));
    assert.throws(() => cpu.stepTimed(), error => {
      assert.ok(error instanceof InstructionTimingUnavailable);
      assert.equal(error.address, 0x100); assert.equal(error.bytes[0], code[0]); return true;
    });
    assert.deepEqual(cpu.snapshot(), before); assert.deepEqual(writes, []);
    if (code[0] !== 0x0f) assert.notEqual(cpu.step().outcome, "unsupported"); // Guard released; ordinary execution still works.
  }
});

test("halt idling, trap delivery, and accepted or ignored external offers have distinct costs", () => {
  const halt = fixture([0xf4]).cpu;
  assert.equal(halt.stepTimed().clocks, 2);
  const idle = halt.stepTimed(); assert.equal(idle.clocks, 0); assert.equal(idle.instruction, null);
  assert.deepEqual(idle.accesses, []);
  let acknowledges = 0;
  assert.equal(halt.interruptTimed("intr", () => { acknowledges++; return 8; }).clocks, 0);
  assert.equal(acknowledges, 0);
  const entry = halt.interruptTimed("nmi"); assert.equal(entry.clocks, 70); assert.equal(entry.outcome, "accepted");
  const active = fixture([0x90], { flags: flags(64) }).cpu;
  assert.equal(active.interruptTimed("intr", () => { acknowledges++; return 8; }).clocks, 81);
  assert.equal(acknowledges, 1);
  const trap = fixture([0x90], { trapPending: true }).cpu.stepTimed();
  assert.equal(trap.clocks, 70); assert.deepEqual(trap.interrupt, { source: "trap", vector: 1 });
});
