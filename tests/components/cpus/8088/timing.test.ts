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
  [[0xff, 0xe0], 11], [[0xff, 0x26, 0, 2], 28], [[0x2e, 0xff, 0xa4, 0, 2], 33],
  [[0xc4, 6, 0, 2], 30], [[0xc5, 6, 0, 2], 30], [[0x26, 0xc5, 0x80, 0, 2], 37],
  [[0x98], 2], [[0x99], 5],
  [[0xf6, 0xd0], 3], [[0xf7, 0xd9], 3], [[0xf6, 0x16, 0, 2], 22], [[0xf7, 0x1e, 0, 2], 30],
  [[0xff, 0xf0], 15], [[0xff, 0xf4], 15], [[0xff, 0x36, 0, 2], 30], [[0x2e, 0xff, 0xb7, 0, 2], 35],
  [[0xd7], 11], [[0x2e, 0xd7], 13],
  [[0x26, 0xf7, 0x60, 0], 156], // MUL word ES:[BX+SI+0]: 139 + 4 transfer + 11 EA + 2 prefix.
];
test("8088 nominal clocks include operand transfers without changing instruction semantics or records", () => {
  for (const [code, expected] of examples) {
    const { cpu } = fixture(code), ordinary = fixture(code).cpu.step();
    const { clocks, ...record } = cpu.stepTimed();
    assert.equal(clocks, expected, code.map(byte => byte.toString(16)).join(" "));
    assert.deepEqual(record, ordinary);
  }
});

test("8088 unsigned MUL charges the declared Intel range ceiling independently of operand values", () => {
  // Table 2-21: byte register 70–77, memory 76–83; word register 118–133,
  // memory 124–139, plus four clocks for its word read. Direct memory EA costs six.
  for (const word of [false, true]) for (const memory of [false, true]) {
    for (const left of [0, 1, 0x7f, 0x80, 0xff, 0x8000, 0xffff]) for (const right of [0, 1, 0x10, 0xff, 0xffff]) {
      const code = [word ? 0xf7 : 0xf6, memory ? 0x26 : 0xe1, ...(memory ? [0, 2] : [])];
      const state = { ax: left, cx: right, flags: flags(0x1ff) };
      const timed = fixture(code, state), plain = fixture(code, state);
      for (const { ram } of [timed, plain]) { ram.write(0x200, right & 255); ram.write(0x201, right >>> 8); }
      const { clocks, ...record } = timed.cpu.stepTimed();
      assert.equal(clocks, word ? memory ? 149 : 133 : memory ? 89 : 77);
      assert.deepEqual(record, plain.cpu.step()); // Includes one ordered source read, never a timing peek.
      const product = (word ? left : left & 255) * (word ? right : right & 255);
      assert.equal(record.after.ax, product % 65536);
      if (word) assert.equal(record.after.dx, Math.floor(product / 65536));
    }
  }
});

test("8088 unsigned DIV charges the declared range ceiling without extra operand reads", () => {
  // Intel table 2-21: byte 80–90 / 86–96+EA; word 144–162 / 150–168+EA.
  // Word memory adds four transfer clocks; direct EA adds six. Fault delivery
  // retains ordinary semantics, with the explicitly declared nominal DIV cost.
  for (const word of [false, true]) for (const memory of [false, true]) {
    for (const [high, low, divisor] of [[0, 0, 1], [0, 640, 10], [0, 65535, 255], [1, 0, 2], [0, 1, 0], [65535, 65535, 1]] as const) {
      const code = [word ? 0xf7 : 0xf6, memory ? 0x36 : 0xf3, ...(memory ? [0, 2] : [])];
      const state = { ax: low, dx: high, bx: divisor, flags: flags(0x1ff) };
      const timed = fixture(code, state), plain = fixture(code, state);
      for (const { ram } of [timed, plain]) { ram.write(0x200, divisor & 255); ram.write(0x201, divisor >>> 8); }
      const { clocks, ...record } = timed.cpu.stepTimed();
      assert.equal(clocks, word ? memory ? 178 : 162 : memory ? 102 : 90);
      assert.deepEqual(record, plain.cpu.step());
    }
  }
});

test("8088 sign-extension clocks preserve ordinary results and flags for both signs", () => {
  for (const [opcode, expected] of [[0x98, 2], [0x99, 5]] as const) for (const ax of [0, 0x7f, 0x80, 0xff, 0x7fff, 0x8000, 0xffff]) {
    const state = { ax, dx: 0xa55a, flags: flags(0x1ff) };
    const { clocks, ...record } = fixture([opcode], state).cpu.stepTimed();
    assert.equal(clocks, expected); assert.deepEqual(record, fixture([opcode], state).cpu.step());
    assert.deepEqual(record.after.flags, state.flags);
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

test("8088 shift and rotate clocks include the full CL count, EA, and word read/write transfers", () => {
  for (const operation of [0, 1, 2, 3, 4, 5, 7]) for (const word of [false, true]) for (const memory of [false, true]) {
    for (const count of [undefined, 0, 1, 32, 255]) {
      const code = [0xd0 + Number(word) + (count === undefined ? 0 : 2), operation * 8 + (memory ? 6 : 0xc0), ...(memory ? [0, 2] : [])];
      const state = { cx: count ?? 0x80, ax: 0xa55a, flags: flags(1) };
      const { cpu } = fixture(code, state), ordinary = fixture(code, state).cpu.step();
      const { clocks, ...record } = cpu.stepTimed();
      const base = count === undefined ? memory ? 15 : 2 : memory ? 20 : 8;
      assert.equal(clocks, base + (memory ? 6 + (word ? 8 : 0) : 0) + (count === undefined ? 0 : 4 * count));
      assert.deepEqual(record, ordinary);
    }
  }
  for (const opcode of [0xd0, 0xd1, 0xd2, 0xd3]) {
    const { cpu } = fixture([opcode, 0xf0]), before = cpu.snapshot(); // Reserved /6 form.
    assert.throws(() => cpu.stepTimed(), InstructionTimingUnavailable);
    assert.deepEqual(cpu.snapshot(), before);
  }
});

test("8088 strings use standalone or bounded REP-entry clocks, including empty counts and word transfers", () => {
  // opcode, standalone byte, repeated byte, extra clocks for word transfers (Intel table 2-21).
  for (const [opcode, plain, repeated, wordExtra] of [[0xa4, 18, 17, 8], [0xa6, 22, 22, 8],
    [0xaa, 11, 10, 4], [0xac, 12, 13, 4], [0xae, 15, 15, 4]] as const) {
    const prefixes = opcode === 0xa6 || opcode === 0xae ? [undefined, 0xf2, 0xf3] : [undefined, 0xf3];
    for (const prefix of prefixes) for (const word of [false, true]) for (const cx of [0, 1, 2]) for (const df of [false, true]) {
      const code = [...(prefix === undefined ? [] : [prefix]), opcode + Number(word)];
      const state = { cx, si: 0x400, di: 0x600, ax: 0, flags: { ...flags(0), df } };
      const { cpu } = fixture(code, state), ordinary = fixture(code, state).cpu.step();
      const { clocks, ...record } = cpu.stepTimed();
      const extra = word ? wordExtra : 0;
      assert.equal(clocks, prefix === undefined ? plain + extra : 2 + 9 + (cx ? repeated + extra : 0));
      assert.deepEqual(record, ordinary);
      if (prefix !== undefined && cx === 0) assert.deepEqual(record.accesses,
        code.map((value, index) => ({ kind: "read", address: 0x100 + index, value })));
    }
  }
});

test("8088 timed REP resumption has no hidden timing state and refetches prefixes on every step", () => {
  const { cpu, ram } = fixture([0x26, 0xf3, 0xab], { cx: 3, di: 0x600, ax: 0x1234 });
  assert.equal(cpu.stepTimed().clocks, 27); // Two prefixes + 9 setup + 10 store + 4 word transfer.
  const restored = new Cpu8088(ram, cpu.snapshot());
  const second = restored.stepTimed(); assert.equal(second.clocks, 27);
  assert.equal(second.after.cx, 1); assert.equal(second.after.ip, 0x100);
  const third = restored.stepTimed(); assert.equal(third.clocks, 27);
  assert.equal(third.after.cx, 0); assert.equal(third.after.ip, 0x103);
  assert.deepEqual(Array.from({ length: 6 }, (_, i) => ram.read(0x600 + i)), [0x34, 0x12, 0x34, 0x12, 0x34, 0x12]);
  ram.write(0x100, 0xf4); // The still-pending original CPU sees modified code, not a cached repetition.
  assert.equal(cpu.stepTimed().clocks, 2); assert.equal(cpu.snapshot().cx, 2);
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

test("8088 LOOPNE and LOOPE timing follows both the remaining count and ZF without changing flags", () => {
  // Intel table 2-21: LOOPNE taken/not taken = 19/5; LOOPE = 18/6.
  for (const opcode of [0xe0, 0xe1]) for (const cx of [0, 1, 2, 0xffff]) for (const zf of [false, true]) {
    const state = { cx, flags: { ...flags(0x1ff), zf } }, code = [opcode, 0xfe];
    const { clocks, ...record } = fixture(code, state).cpu.stepTimed();
    const taken = cx !== 1 && (opcode === 0xe1 ? zf : !zf);
    assert.equal(clocks, opcode === 0xe1 ? taken ? 18 : 6 : taken ? 19 : 5);
    assert.equal(record.after.cx, (cx + 0xffff) & 0xffff);
    assert.equal(record.after.ip, taken ? 0x100 : 0x102);
    assert.deepEqual(record.after.flags, state.flags);
    assert.deepEqual(record, fixture(code, state).cpu.step());
  }
});

test("8088 unary timing includes both word transfers and preserves NOT/NEG semantics at byte and word boundaries", () => {
  for (const operation of [2, 3]) for (const word of [false, true]) for (const memory of [false, true]) {
    for (const value of [0, 1, 0x7f, 0x80, 0xff, 0x7fff, 0x8000, 0xffff]) {
      const code = [word ? 0xf7 : 0xf6, operation * 8 + (memory ? 6 : 0xc0), ...(memory ? [0, 2] : [])];
      const state = { ax: value, flags: flags(0x1ff) }, timed = fixture(code, state), plain = fixture(code, state);
      for (const { ram } of [timed, plain]) { ram.write(0x200, value & 255); ram.write(0x201, value >>> 8); }
      const { clocks, ...record } = timed.cpu.stepTimed();
      assert.equal(clocks, memory ? word ? 30 : 22 : 3);
      assert.deepEqual(record, plain.cpu.step());
    }
  }
});

test("uncovered instructions and group forms reject before data effects and do not consume deferrals", () => {
  for (const code of [[0xf6, 0xe8], [0xf6, 0x2e, 0, 2], [0xf7, 0xfb], [0xff, 0xd0], [0x9b], [0x0f], [0xc4, 0xc0], [0xc5, 0xc0]]) {
    const { cpu, ram } = fixture(code, { interruptDeferred: true });
    const before = cpu.snapshot(), writes: number[] = [];
    ram.observeWrites(write => writes.push(write.address));
    assert.throws(() => cpu.stepTimed(), error => {
      assert.ok(error instanceof InstructionTimingUnavailable);
      assert.equal(error.address, 0x100); assert.equal(error.bytes[0], code[0]); return true;
    });
    assert.deepEqual(cpu.snapshot(), before); assert.deepEqual(writes, []);
    if (![0x0f, 0xc4, 0xc5].includes(code[0]!)) assert.notEqual(cpu.step().outcome, "unsupported"); // Guard released; ordinary execution still works.
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
