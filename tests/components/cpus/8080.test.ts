import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu8080 } from "../../../src/components/cpus/8080.js";
import type { Cpu8080Flags, Cpu8080Snapshot, Cpu8080State } from "../../../src/components/cpus/8080.js";
import { Ram } from "../../../src/components/memory/ram.js";
import { ObservedRam } from "../../helpers/observed-ram.js";

function initialState(overrides: Partial<Cpu8080State> = {}): Cpu8080State {
  return {
    a: 0x11, b: 0x22, c: 0x33, d: 0x44, e: 0x55, h: 0x66, l: 0x77,
    pc: 0x1234,
    sp: 0xabcd,
    flags: { s: true, z: false, ac: true, p: false, cy: true },
    interruptEnabled: true,
    halted: false,
    ...overrides,
  };
}

function expectedSnapshot(overrides: Partial<Cpu8080State> = {}): Cpu8080Snapshot {
  const state = initialState(overrides);
  return {
    ...state,
    bc: state.b * 256 + state.c,
    de: state.d * 256 + state.e,
    hl: state.h * 256 + state.l,
  };
}

test("8080 owns its initial state and returns independent snapshots without RAM accesses", () => {
  const ram = new ObservedRam();
  const supplied = initialState();
  const cpu = new Cpu8080(ram, supplied);
  const first = cpu.snapshot();
  const second = cpu.snapshot();
  assert.deepEqual(first, expectedSnapshot());
  for (const [name, value] of [["bc", 0x2233], ["de", 0x4455], ["hl", 0x6677]] as const) {
    assert.equal(Object.getOwnPropertyDescriptor(first, name)?.value, value);
  }

  supplied.a = 0xff;
  for (const name of ["b", "c", "d", "e", "h", "l"] as const) supplied[name] = 0xff;
  supplied.flags.s = false;
  // Deliberately bypass TypeScript readonly to check runtime isolation too.
  Reflect.set(first, "b", 0xff);
  Reflect.set(first.flags, "cy", false);
  assert.equal(first.b, 0xff);
  assert.equal(first.flags.cy, false);
  assert.equal(first.bc, 0x2233); // A snapshot is a plain copy, not a live register view.
  for (const name of ["bc", "de", "hl"] as const) {
    assert.ok(Reflect.set(first, name, 0xffff));
    assert.equal(first[name], 0xffff);
  }
  assert.deepEqual(second, expectedSnapshot());
  assert.deepEqual(cpu.snapshot(), expectedSnapshot());
  assert.deepEqual(ram.accesses, []);
});

test("8080 copies only model fields, excluding extra state and flag metadata", () => {
  const ram = new ObservedRam();
  const supplied = {
    ...initialState(),
    metadata: { label: "initial state" },
    flags: { ...initialState().flags, metadata: { label: "initial flags" } },
  };
  const cpu = new Cpu8080(ram, supplied);
  const snapshot = cpu.snapshot();
  const first = cpu.step();
  const second = cpu.step();
  const saved = structuredClone(first);

  supplied.metadata.label = "changed state metadata";
  supplied.flags.metadata.label = "changed flag metadata";
  assert.deepEqual(snapshot, expectedSnapshot());
  assert.deepEqual(first.before, expectedSnapshot());
  assert.deepEqual(first.after, expectedSnapshot());
  assert.deepEqual(first, saved);
  assert.deepEqual(second, saved);
  assert.deepEqual(cpu.snapshot(), expectedSnapshot());
});

test("8080 accepts inherited flag getters and non-enumerable state fields", () => {
  class GetterFlags implements Cpu8080Flags {
    get s() { return true; }
    get z() { return false; }
    get ac() { return true; }
    get p() { return false; }
    get cy() { return true; }
  }
  const ram = new ObservedRam();
  let a = 0x11;
  const supplied = { ...initialState(), flags: new GetterFlags() };
  Object.defineProperty(supplied, "a", { enumerable: false, get: () => a });
  const reads = { b: 0, c: 0, d: 0, e: 0, h: 0, l: 0 };
  for (const name of ["b", "c", "d", "e", "h", "l"] as const) {
    Object.defineProperty(supplied, name, {
      enumerable: false,
      get: () => initialState()[name] + reads[name]++,
    });
  }
  const cpu = new Cpu8080(ram, supplied);
  a = 0xff;
  assert.deepEqual(cpu.snapshot(), expectedSnapshot());
  assert.deepEqual(reads, { b: 1, c: 1, d: 1, e: 1, h: 1, l: 1 });
  assert.deepEqual(ram.accesses, []);
});

test("8080 ignores supplied pair getters and reconstructs pair views from snapshot bytes", () => {
  const ram = new ObservedRam();
  const supplied = {
    ...initialState(),
    get bc() { throw new Error("Supplied BC must not be read"); },
    get de() { throw new Error("Supplied DE must not be read"); },
    get hl() { throw new Error("Supplied HL must not be read"); },
  };
  const cpu = new Cpu8080(ram, supplied);
  assert.deepEqual(cpu.snapshot(), expectedSnapshot());
  const snapshot = cpu.snapshot();
  for (const name of ["bc", "de", "hl"] as const) Reflect.set(snapshot, name, -1);
  const restored = new Cpu8080(ram, snapshot);
  assert.deepEqual(restored.snapshot(), expectedSnapshot());
  Reflect.set(snapshot, "b", 0xff);
  Reflect.set(snapshot.flags, "s", false);
  assert.deepEqual(restored.snapshot(), expectedSnapshot());
  assert.deepEqual(ram.accesses, []);
});

// Literal opcode assignments from Intel's instruction table. SP is a stored
// word; the other targets split a word across two stored bytes.
const registerPairs = [
  { name: "BC", lxi: 0x01, inx: 0x03, push: 0xc5, pop: 0xc1, view: "bc",
    bytes: (high: number, low: number) => ({ b: high, c: low }) },
  { name: "DE", lxi: 0x11, inx: 0x13, push: 0xd5, pop: 0xd1, view: "de",
    bytes: (high: number, low: number) => ({ d: high, e: low }) },
  { name: "HL", lxi: 0x21, inx: 0x23, push: 0xe5, pop: 0xe1, view: "hl",
    bytes: (high: number, low: number) => ({ h: high, l: low }) },
  { name: "SP", lxi: 0x31, inx: 0x33, view: "sp",
    bytes: (high: number, low: number) => ({ sp: high * 256 + low }) },
] as const;

const stackPairs = registerPairs.filter((pair) => "push" in pair);

test("8080 derives unsigned register pairs with the first register as the high byte", () => {
  const ram = new ObservedRam();
  for (const pair of registerPairs) {
    for (const [high, low, word] of [
      [0x00, 0x00, 0x0000], [0x00, 0xff, 0x00ff], [0x01, 0x00, 0x0100],
      [0x12, 0x34, 0x1234], [0x7f, 0xff, 0x7fff], [0x80, 0x00, 0x8000],
      [0xff, 0x00, 0xff00], [0xff, 0xff, 0xffff],
    ] as const) {
      const state = initialState(pair.bytes(high, low));
      const cpu = new Cpu8080(ram, state);
      assert.deepEqual(cpu.snapshot(), {
        ...expectedSnapshot(), ...pair.bytes(high, low), [pair.view]: word,
      }, `${pair.name}=${word}`);
    }
  }
  assert.deepEqual(ram.accesses, []);
});

test("8080 LXI loads each pair or SP low byte first, preserving flags and unrelated state", () => {
  for (const pair of registerPairs) {
    for (const [low, high, word] of [
      [0x00, 0x00, 0x0000], [0x34, 0x12, 0x1234], [0xff, 0x12, 0x12ff],
      [0x00, 0x80, 0x8000], [0xff, 0xff, 0xffff],
    ] as const) {
      for (const flags of [
        { s: true, z: false, ac: true, p: false, cy: true },
        { s: false, z: true, ac: false, p: true, cy: false },
      ]) {
        const ram = new ObservedRam();
        ram.write(0x1234, pair.lxi);
        ram.write(0x1235, low);
        ram.write(0x1236, high);
        ram.accesses.length = 0;
        const before = expectedSnapshot({ flags });
        const cpu = new Cpu8080(ram, before);
        const record = cpu.step();
        assert.deepEqual(record, {
          instruction: { address: 0x1234, bytes: [pair.lxi, low, high] },
          before,
          after: { ...before, ...pair.bytes(high, low), [pair.view]: word, pc: 0x1237 },
          accesses: [
            { kind: "read", address: 0x1234, value: pair.lxi },
            { kind: "read", address: 0x1235, value: low },
            { kind: "read", address: 0x1236, value: high },
          ],
          outcome: "executed",
        }, `${pair.name}=${word}`);
        assert.deepEqual(cpu.snapshot(), record.after);
        assert.deepEqual(ram.accesses, record.accesses);
      }
    }
  }
});

test("8080 LXI wraps operand fetching and PC for every pair and SP", () => {
  for (const pair of registerPairs) {
    for (const [address, lowAddress, highAddress, nextPc] of [
      [0xfffd, 0xfffe, 0xffff, 0x0000],
      [0xfffe, 0xffff, 0x0000, 0x0001],
      [0xffff, 0x0000, 0x0001, 0x0002],
    ] as const) {
      const ram = new ObservedRam();
      ram.write(address, pair.lxi);
      ram.write(lowAddress, 0x34);
      ram.write(highAddress, 0x12);
      ram.accesses.length = 0;
      const before = expectedSnapshot({ pc: address });
      const cpu = new Cpu8080(ram, before);
      const record = cpu.step();
      assert.deepEqual(record, {
        instruction: { address, bytes: [pair.lxi, 0x34, 0x12] },
        before,
        after: { ...before, ...pair.bytes(0x12, 0x34), [pair.view]: 0x1234, pc: nextPc },
        accesses: [
          { kind: "read", address, value: pair.lxi },
          { kind: "read", address: lowAddress, value: 0x34 },
          { kind: "read", address: highAddress, value: 0x12 },
        ],
        outcome: "executed",
      }, `${pair.name}, PC=${address}`);
      assert.deepEqual(cpu.snapshot(), record.after);
      assert.deepEqual(ram.accesses, record.accesses);
    }
  }
});

test("8080 INX increments each pair or SP with wrapping and no flag changes or data accesses", () => {
  for (const pair of registerPairs) {
    for (const [high, low, nextHigh, nextLow, result] of [
      [0x00, 0x00, 0x00, 0x01, 0x0001],
      [0x00, 0xff, 0x01, 0x00, 0x0100],
      [0x12, 0xff, 0x13, 0x00, 0x1300],
      [0x7f, 0xff, 0x80, 0x00, 0x8000],
      [0xff, 0xfe, 0xff, 0xff, 0xffff],
      [0xff, 0xff, 0x00, 0x00, 0x0000],
    ] as const) {
      for (const flags of [
        { s: true, z: false, ac: true, p: false, cy: true },
        { s: false, z: true, ac: false, p: true, cy: false },
      ]) {
        for (const [address, nextPc] of [[0x1234, 0x1235], [0xffff, 0x0000]] as const) {
          const ram = new ObservedRam();
          ram.write(address, pair.inx);
          ram.accesses.length = 0;
          const before = expectedSnapshot({ ...pair.bytes(high, low), pc: address, flags });
          const cpu = new Cpu8080(ram, before);
          const record = cpu.step();
          assert.deepEqual(record, {
            instruction: { address, bytes: [pair.inx] },
            before,
            after: { ...before, ...pair.bytes(nextHigh, nextLow), [pair.view]: result, pc: nextPc },
            accesses: [{ kind: "read", address, value: pair.inx }],
            outcome: "executed",
          }, `${pair.name}=${high}:${low}, PC=${address}`);
          assert.deepEqual(cpu.snapshot(), record.after);
          assert.deepEqual(ram.accesses, record.accesses);
        }
      }
    }
  }
});

test("8080 pair records retain captured values across later instructions, reset, and caller edits", () => {
  for (const pair of registerPairs) {
    const ram = new ObservedRam();
    ram.write(0, pair.lxi);
    ram.write(1, 0xff);
    ram.write(2, 0x12);
    ram.write(3, pair.inx);
    ram.write(4, pair.inx);
    const cpu = new Cpu8080(ram, initialState({ pc: 0 }));
    const first = cpu.step();
    const savedFirst = structuredClone(first);
    const second = cpu.step();
    const savedSecond = structuredClone(second);
    assert.equal(first.after[pair.view], 0x12ff);
    assert.deepEqual(second.before, first.after);
    assert.equal(second.after[pair.view], 0x1300);
    assert.deepEqual(first, savedFirst);

    for (const name of Object.keys(pair.bytes(0, 0))) Reflect.set(first.after, name, 0);
    Reflect.set(first.after, pair.view, 0xffff);
    assert.deepEqual(first.before, savedFirst.before);
    assert.deepEqual(second, savedSecond);
    assert.deepEqual(cpu.snapshot(), second.after);
    const third = cpu.step();
    assert.equal(third.after[pair.view], 0x1301);
    ram.accesses.length = 0;
    const reset = cpu.reset();
    const expected = { ...third.after, pc: 0, interruptEnabled: false, halted: false };
    assert.deepEqual(reset, { before: third.after, after: expected, accesses: [] });
    Reflect.set(reset.after, pair.view, 0);
    assert.deepEqual(cpu.snapshot(), expected);
    assert.deepEqual(ram.accesses, []);
    assert.deepEqual(second, savedSecond);
  }
});

test("8080 PUSH writes high then low, wraps SP, and preserves flags and register pairs", () => {
  for (const pair of stackPairs) {
    for (const [high, low] of [[0x00, 0x00], [0x12, 0x34], [0x80, 0xff], [0xff, 0xff]] as const) {
      for (const [sp, highAddress, lowAddress] of [
        [0x2000, 0x1fff, 0x1ffe], [0x0000, 0xffff, 0xfffe],
        [0x0001, 0x0000, 0xffff], [0xffff, 0xfffe, 0xfffd],
      ] as const) {
        for (const flags of [
          { s: true, z: false, ac: true, p: false, cy: true },
          { s: false, z: true, ac: false, p: true, cy: false },
        ]) {
          const ram = new ObservedRam();
          ram.write(0x1234, pair.push);
          ram.accesses.length = 0;
          const before = expectedSnapshot({ ...pair.bytes(high, low), sp, flags });
          const cpu = new Cpu8080(ram, before);
          const record = cpu.step();
          assert.deepEqual(record, {
            instruction: { address: 0x1234, bytes: [pair.push] },
            before,
            after: { ...before, sp: lowAddress, pc: 0x1235 },
            accesses: [
              { kind: "read", address: 0x1234, value: pair.push },
              { kind: "write", address: highAddress, value: high },
              { kind: "write", address: lowAddress, value: low },
            ],
            outcome: "executed",
          }, `${pair.name}, SP=${sp}`);
          assert.deepEqual(cpu.snapshot(), record.after);
          assert.deepEqual(ram.accesses, record.accesses);
          assert.equal(ram.read(highAddress), high);
          assert.equal(ram.read(lowAddress), low);
        }
      }
    }
  }
});

test("8080 POP reads low then high without fetching operands, wraps SP, and preserves flags", () => {
  for (const pair of stackPairs) {
    for (const [high, low, word] of [
      [0x00, 0x00, 0x0000], [0x12, 0x34, 0x1234], [0x80, 0xff, 0x80ff], [0xff, 0xff, 0xffff],
    ] as const) {
      for (const [sp, highAddress, nextSp] of [
        [0x1ffe, 0x1fff, 0x2000], [0xfffe, 0xffff, 0x0000],
        [0xffff, 0x0000, 0x0001], [0x0000, 0x0001, 0x0002],
      ] as const) {
        for (const flags of [
          { s: true, z: false, ac: true, p: false, cy: true },
          { s: false, z: true, ac: false, p: true, cy: false },
        ]) {
          const ram = new ObservedRam();
          ram.write(0x1234, pair.pop);
          ram.write(sp, low);
          ram.write(highAddress, high);
          ram.accesses.length = 0;
          const before = expectedSnapshot({ sp, flags });
          const cpu = new Cpu8080(ram, before);
          const record = cpu.step();
          assert.deepEqual(record, {
            instruction: { address: 0x1234, bytes: [pair.pop] },
            before,
            after: { ...before, ...pair.bytes(high, low), [pair.view]: word, sp: nextSp, pc: 0x1235 },
            accesses: [
              { kind: "read", address: 0x1234, value: pair.pop },
              { kind: "read", address: sp, value: low },
              { kind: "read", address: highAddress, value: high },
            ],
            outcome: "executed",
          }, `${pair.name}, SP=${sp}`);
          assert.deepEqual(cpu.snapshot(), record.after);
          assert.deepEqual(ram.accesses, record.accesses);
          assert.equal(ram.read(sp), low);
          assert.equal(ram.read(highAddress), high);
        }
      }
    }
  }
});

test("8080 PUSH and POP wrap PC independently of their stack accesses", () => {
  for (const pair of stackPairs) {
    for (const operation of ["push", "pop"] as const) {
      const ram = new ObservedRam();
      ram.write(0xffff, pair[operation]);
      ram.write(0x2000, 0x34);
      ram.write(0x2001, 0x12);
      ram.accesses.length = 0;
      const before = expectedSnapshot({ ...pair.bytes(0x12, 0x34), pc: 0xffff, sp: 0x2000 });
      const cpu = new Cpu8080(ram, before);
      const record = cpu.step();
      assert.deepEqual(record, {
        instruction: { address: 0xffff, bytes: [pair[operation]] },
        before,
        after: { ...before, pc: 0, sp: operation === "push" ? 0x1ffe : 0x2002 },
        accesses: [
          { kind: "read", address: 0xffff, value: pair[operation] },
          ...(operation === "push" ? [
            { kind: "write", address: 0x1fff, value: 0x12 },
            { kind: "write", address: 0x1ffe, value: 0x34 },
          ] : [
            { kind: "read", address: 0x2000, value: 0x34 },
            { kind: "read", address: 0x2001, value: 0x12 },
          ]),
        ],
        outcome: "executed",
      });
      assert.deepEqual(ram.accesses, record.accesses);
      assert.deepEqual(cpu.snapshot(), record.after);
    }
  }
});

test("8080 PUSH can overwrite its own opcode with either byte without changing captured instruction bytes", () => {
  for (const pair of stackPairs) {
    for (const [sp, highAddress, lowAddress, overwritten] of [
      [0x2001, 0x2000, 0x1fff, 0xa5], [0x2002, 0x2001, 0x2000, 0x3c],
    ] as const) {
      const ram = new ObservedRam();
      ram.write(0x2000, pair.push);
      ram.accesses.length = 0;
      const before = expectedSnapshot({ ...pair.bytes(0xa5, 0x3c), sp, pc: 0x2000 });
      const cpu = new Cpu8080(ram, before);
      const record = cpu.step();
      assert.deepEqual(record, {
        instruction: { address: 0x2000, bytes: [pair.push] },
        before,
        after: { ...before, sp: lowAddress, pc: 0x2001 },
        accesses: [
          { kind: "read", address: 0x2000, value: pair.push },
          { kind: "write", address: highAddress, value: 0xa5 },
          { kind: "write", address: lowAddress, value: 0x3c },
        ],
        outcome: "executed",
      });
      assert.deepEqual(ram.accesses, record.accesses);
      assert.equal(ram.read(0x2000), overwritten);
      assert.deepEqual(cpu.snapshot(), record.after);
    }
  }
});

test("8080 POP rereads an overlapping opcode as stack data without extending the instruction", () => {
  for (const pair of stackPairs) {
    for (const [sp, highAddress, low, high, nextSp] of [
      [0x2000, 0x2001, pair.pop, 0xa5, 0x2002],
      [0x1fff, 0x2000, 0x3c, pair.pop, 0x2001],
    ] as const) {
      const ram = new ObservedRam();
      ram.write(sp, low);
      ram.write(highAddress, high);
      ram.accesses.length = 0;
      const before = expectedSnapshot({ sp, pc: 0x2000 });
      const cpu = new Cpu8080(ram, before);
      const record = cpu.step();
      assert.deepEqual(record, {
        instruction: { address: 0x2000, bytes: [pair.pop] },
        before,
        after: { ...before, ...pair.bytes(high, low), [pair.view]: high * 256 + low, sp: nextSp, pc: 0x2001 },
        accesses: [
          { kind: "read", address: 0x2000, value: pair.pop },
          { kind: "read", address: sp, value: low },
          { kind: "read", address: highAddress, value: high },
        ],
        outcome: "executed",
      });
      assert.deepEqual(ram.accesses, record.accesses);
      assert.deepEqual(cpu.snapshot(), record.after);
    }
  }
});

test("8080 nested pushes and pops use a shared last-in first-out stack across register pairs", () => {
  const ram = new ObservedRam();
  const opcodes = [0xc5, 0xd5, 0xe5, 0xc1, 0xd1, 0xe1];
  for (const [offset, opcode] of opcodes.entries()) ram.write(0x0200 + offset, opcode);
  const initial = expectedSnapshot({ pc: 0x0200, sp: 0x2000 });
  const cpu = new Cpu8080(ram, initial);
  const steps = [
    { after: { ...initial, pc: 0x0201, sp: 0x1ffe }, stack: [
      { kind: "write", address: 0x1fff, value: 0x22 },
      { kind: "write", address: 0x1ffe, value: 0x33 },
    ] },
    { after: { ...initial, pc: 0x0202, sp: 0x1ffc }, stack: [
      { kind: "write", address: 0x1ffd, value: 0x44 },
      { kind: "write", address: 0x1ffc, value: 0x55 },
    ] },
    { after: { ...initial, pc: 0x0203, sp: 0x1ffa }, stack: [
      { kind: "write", address: 0x1ffb, value: 0x66 },
      { kind: "write", address: 0x1ffa, value: 0x77 },
    ] },
    { after: { ...initial, b: 0x66, c: 0x77, bc: 0x6677, pc: 0x0204, sp: 0x1ffc }, stack: [
      { kind: "read", address: 0x1ffa, value: 0x77 },
      { kind: "read", address: 0x1ffb, value: 0x66 },
    ] },
    { after: { ...initial, b: 0x66, c: 0x77, bc: 0x6677, pc: 0x0205, sp: 0x1ffe }, stack: [
      { kind: "read", address: 0x1ffc, value: 0x55 },
      { kind: "read", address: 0x1ffd, value: 0x44 },
    ] },
    { after: { ...initial, b: 0x66, c: 0x77, bc: 0x6677, h: 0x22, l: 0x33, hl: 0x2233, pc: 0x0206, sp: 0x2000 }, stack: [
      { kind: "read", address: 0x1ffe, value: 0x33 },
      { kind: "read", address: 0x1fff, value: 0x22 },
    ] },
  ];
  let before = initial;
  for (const [index, { after, stack }] of steps.entries()) {
    const opcode = opcodes[index];
    ram.accesses.length = 0;
    const record = cpu.step();
    assert.deepEqual(record, {
      instruction: { address: before.pc, bytes: [opcode] },
      before, after,
      accesses: [{ kind: "read", address: before.pc, value: opcode }, ...stack],
      outcome: "executed",
    });
    assert.deepEqual(ram.accesses, record.accesses);
    assert.deepEqual(cpu.snapshot(), after);
    before = after;
  }
  for (const [offset, value] of [0x77, 0x66, 0x55, 0x44, 0x33, 0x22].entries()) {
    assert.equal(ram.read(0x1ffa + offset), value);
  }
});

test("8080 stack records preserve captured reads and writes across RAM edits, reset, and caller edits", () => {
  const ram = new ObservedRam();
  ram.write(0, 0xc5); // PUSH B
  ram.write(1, 0xe1); // POP H
  const cpu = new Cpu8080(ram, initialState({ pc: 0, sp: 0x2000 }));
  const pushed = cpu.step();
  const savedPush = structuredClone(pushed);
  ram.write(0x1ffe, 0xcd);
  ram.write(0x1fff, 0xab);
  ram.accesses.length = 0;
  const popped = cpu.step();
  const savedPop = structuredClone(popped);
  assert.equal(popped.after.hl, 0xabcd);
  assert.deepEqual(popped.instruction, { address: 1, bytes: [0xe1] });
  assert.deepEqual(popped.accesses, [
    { kind: "read", address: 1, value: 0xe1 },
    { kind: "read", address: 0x1ffe, value: 0xcd },
    { kind: "read", address: 0x1fff, value: 0xab },
  ]);
  assert.deepEqual(ram.accesses, popped.accesses);
  assert.deepEqual(pushed, savedPush);
  const live = cpu.snapshot();
  assert.ok(pushed.accesses[1]);
  assert.ok(popped.accesses[1]);
  Reflect.set(pushed.accesses[1], "value", 0);
  Reflect.set(pushed.after, "sp", 0);
  Reflect.set(popped.accesses[1], "value", 0);
  Reflect.set(popped.after, "h", 0);
  assert.deepEqual(cpu.snapshot(), live);
  assert.equal(ram.read(0x1ffe), 0xcd);
  assert.equal(ram.read(0x1fff), 0xab);
  const editedPush = structuredClone(pushed);
  const editedPop = structuredClone(popped);
  ram.accesses.length = 0;
  assert.deepEqual(cpu.reset(), {
    before: savedPop.after,
    after: { ...savedPop.after, pc: 0, interruptEnabled: false, halted: false },
    accesses: [],
  });
  assert.deepEqual(ram.accesses, []);
  cpu.step();
  assert.deepEqual(pushed, editedPush);
  assert.deepEqual(popped, editedPop);
});

test("8080 MVI A,n preserves unrelated state and records exactly the two actual reads", () => {
  for (const immediate of [0, 0x02, 0x80, 0xff]) {
    for (const setFlags of [false, true]) {
      const ram = new ObservedRam();
      ram.write(0x1234, 0x3e);
      ram.write(0x1235, immediate);
      ram.accesses.length = 0;
      const before = expectedSnapshot({
        flags: { s: setFlags, z: setFlags, ac: setFlags, p: setFlags, cy: setFlags },
      });
      const cpu = new Cpu8080(ram, before);
      const record = cpu.step();
      const expectedAccesses = [
        { kind: "read", address: 0x1234, value: 0x3e },
        { kind: "read", address: 0x1235, value: immediate },
      ];
      assert.deepEqual(record, {
        instruction: { address: 0x1234, bytes: [0x3e, immediate] },
        before,
        after: { ...before, a: immediate, pc: 0x1236 },
        accesses: expectedAccesses,
        outcome: "executed",
      });
      assert.deepEqual(cpu.snapshot(), record.after);
      assert.deepEqual(ram.accesses, expectedAccesses);
    }
  }
});

test("8080 MVI A,n wraps operand fetching and PC advancement at the 16-bit boundary", () => {
  for (const [address, operandAddress, nextPc] of [
    [0xfffe, 0xffff, 0x0000],
    [0xffff, 0x0000, 0x0001],
  ] as const) {
    const ram = new ObservedRam();
    ram.write(address, 0x3e);
    ram.write(operandAddress, 0xa5);
    ram.accesses.length = 0;
    const before = expectedSnapshot({ pc: address });
    const cpu = new Cpu8080(ram, before);
    const record = cpu.step();
    assert.deepEqual(record, {
      instruction: { address, bytes: [0x3e, 0xa5] },
      before,
      after: { ...before, a: 0xa5, pc: nextPc },
      accesses: [
        { kind: "read", address, value: 0x3e },
        { kind: "read", address: operandAddress, value: 0xa5 },
      ],
      outcome: "executed",
    });
    assert.deepEqual(ram.accesses, record.accesses);
    assert.deepEqual(cpu.snapshot(), record.after);
  }
});

test("8080 ADI replaces all arithmetic flags, preserves unrelated state, and records only two reads", () => {
  // Literal expectations from the specification and Intel's ADI examples.
  const cases = [
    { a: 0x02, immediate: 0x03, result: 0x05,
      flags: { s: false, z: false, ac: false, p: true, cy: false } },
    { a: 0xff, immediate: 0x01, result: 0x00,
      flags: { s: false, z: true, ac: true, p: true, cy: true } },
    { a: 0x7f, immediate: 0x01, result: 0x80,
      flags: { s: true, z: false, ac: true, p: false, cy: false } },
    { a: 0xff, immediate: 0x00, result: 0xff,
      flags: { s: true, z: false, ac: false, p: true, cy: false } },
    { a: 0x08, immediate: 0x08, result: 0x10,
      flags: { s: false, z: false, ac: true, p: false, cy: false } },
    { a: 0x80, immediate: 0x80, result: 0x00,
      flags: { s: false, z: true, ac: false, p: true, cy: true } },
    { a: 0x14, immediate: 0x42, result: 0x56,
      flags: { s: false, z: false, ac: false, p: true, cy: false } },
    { a: 0x56, immediate: 0xbe, result: 0x14,
      flags: { s: false, z: false, ac: true, p: true, cy: true } },
  ] satisfies readonly { a: number; immediate: number; result: number; flags: Cpu8080Flags }[];

  for (const { a, immediate, result, flags } of cases) {
    for (const setFlags of [false, true]) {
      const ram = new ObservedRam();
      ram.write(0x1234, 0xc6);
      ram.write(0x1235, immediate);
      ram.accesses.length = 0;
      const before = expectedSnapshot({
        a,
        flags: { s: setFlags, z: setFlags, ac: setFlags, p: setFlags, cy: setFlags },
      });
      const cpu = new Cpu8080(ram, before);
      const record = cpu.step();
      const expectedAccesses = [
        { kind: "read", address: 0x1234, value: 0xc6 },
        { kind: "read", address: 0x1235, value: immediate },
      ];
      const context = `A=${a}, immediate=${immediate}, initial flags=${setFlags}`;
      assert.deepEqual(record, {
        instruction: { address: 0x1234, bytes: [0xc6, immediate] },
        before,
        after: { ...before, a: result, flags, pc: 0x1236 },
        accesses: expectedAccesses,
        outcome: "executed",
      }, context);
      assert.deepEqual(cpu.snapshot(), record.after, context);
      assert.deepEqual(ram.accesses, expectedAccesses, context);
    }
  }
});

// Reference addition works one binary column at a time, independently of the
// CPU's whole-byte sum, bit masks, and parity helper. Carry starts at zero for ADI.
function referenceAddition(a: number, immediate: number): { result: number; flags: Cpu8080Flags } {
  let result = 0;
  let carry = 0;
  let auxiliaryCarry = false;
  let setBits = 0;
  for (let bit = 0; bit < 8; bit++) {
    const column = (a % 2) + (immediate % 2) + carry;
    const digit = column % 2;
    result += digit * 2 ** bit;
    setBits += digit;
    carry = column >= 2 ? 1 : 0;
    if (bit === 3) auxiliaryCarry = carry === 1;
    a = Math.floor(a / 2);
    immediate = Math.floor(immediate / 2);
  }
  return {
    result,
    flags: {
      s: result >= 128,
      z: result === 0,
      ac: auxiliaryCarry,
      p: setBits % 2 === 0,
      cy: carry === 1,
    },
  };
}

test("8080 ADI matches reference addition for all operand pairs with old flags clear and set", () => {
  const ram = new Ram(0x10000);
  ram.write(0, 0xc6);
  for (let immediate = 0; immediate < 256; immediate++) {
    ram.write(1, immediate);
    for (let a = 0; a < 256; a++) {
      const expected = referenceAddition(a, immediate);
      for (const setFlags of [false, true]) {
        const cpu = new Cpu8080(ram, initialState({
          a, pc: 0,
          flags: { s: setFlags, z: setFlags, ac: setFlags, p: setFlags, cy: setFlags },
        }));
        const record = cpu.step();
        assert.equal(record.outcome, "executed");
        assert.deepEqual({ result: record.after.a, flags: record.after.flags }, expected,
          `A=${a}, immediate=${immediate}, initial flags=${setFlags}`);
      }
    }
  }
});

test("8080 ADI wraps operand fetching and PC advancement at the 16-bit boundary", () => {
  for (const [address, operandAddress, nextPc] of [
    [0xfffe, 0xffff, 0x0000],
    [0xffff, 0x0000, 0x0001],
  ] as const) {
    const ram = new ObservedRam();
    ram.write(address, 0xc6);
    ram.write(operandAddress, 1);
    ram.accesses.length = 0;
    const before = expectedSnapshot({ a: 0xff, pc: address });
    const cpu = new Cpu8080(ram, before);
    const record = cpu.step();
    assert.deepEqual(record, {
      instruction: { address, bytes: [0xc6, 0x01] },
      before,
      after: {
        ...before, a: 0, pc: nextPc,
        flags: { s: false, z: true, ac: true, p: true, cy: true },
      },
      accesses: [
        { kind: "read", address, value: 0xc6 },
        { kind: "read", address: operandAddress, value: 1 },
      ],
      outcome: "executed",
    });
    assert.deepEqual(cpu.snapshot(), record.after);
    assert.deepEqual(ram.accesses, record.accesses);
  }
});

test("8080 STA decodes low/high address bytes and writes once while preserving CPU state", () => {
  for (const [low, high, destination] of [
    [0x34, 0x12, 0x1234],
    [0x00, 0x00, 0x0000],
    [0xff, 0xff, 0xffff],
  ] as const) {
    for (const a of [0x00, 0x5a, 0xff]) {
      for (const flags of [
        { s: true, z: false, ac: true, p: false, cy: true },
        { s: false, z: true, ac: false, p: true, cy: false },
      ]) {
        const ram = new ObservedRam();
        ram.write(0x2000, 0x32);
        ram.write(0x2001, low);
        ram.write(0x2002, high);
        // A write is still required when the destination already contains A.
        ram.write(destination, 0x5a);
        ram.accesses.length = 0;
        const before = expectedSnapshot({ a, pc: 0x2000, flags });
        const cpu = new Cpu8080(ram, before);
        const record = cpu.step();
        const expectedAccesses = [
          { kind: "read", address: 0x2000, value: 0x32 },
          { kind: "read", address: 0x2001, value: low },
          { kind: "read", address: 0x2002, value: high },
          { kind: "write", address: destination, value: a },
        ];
        const context = `destination=${destination}, A=${a}, flags=${JSON.stringify(flags)}`;
        assert.deepEqual(record, {
          instruction: { address: 0x2000, bytes: [0x32, low, high] },
          before,
          after: { ...before, pc: 0x2003 },
          accesses: expectedAccesses,
          outcome: "executed",
        }, context);
        assert.deepEqual(cpu.snapshot(), record.after, context);
        assert.deepEqual(ram.accesses, expectedAccesses, context);
        assert.equal(ram.read(destination), a, context);
      }
    }
  }
});

test("8080 STA wraps both operand fetching and PC advancement at the 16-bit boundary", () => {
  for (const [address, lowAddress, highAddress, nextPc] of [
    [0xfffd, 0xfffe, 0xffff, 0x0000],
    [0xfffe, 0xffff, 0x0000, 0x0001],
    [0xffff, 0x0000, 0x0001, 0x0002],
  ] as const) {
    const ram = new ObservedRam();
    ram.write(address, 0x32);
    ram.write(lowAddress, 0x34);
    ram.write(highAddress, 0x12);
    ram.accesses.length = 0;
    const before = expectedSnapshot({ a: 0xa5, pc: address });
    const cpu = new Cpu8080(ram, before);
    const record = cpu.step();
    assert.deepEqual(record, {
      instruction: { address, bytes: [0x32, 0x34, 0x12] },
      before,
      after: { ...before, pc: nextPc },
      accesses: [
        { kind: "read", address, value: 0x32 },
        { kind: "read", address: lowAddress, value: 0x34 },
        { kind: "read", address: highAddress, value: 0x12 },
        { kind: "write", address: 0x1234, value: 0xa5 },
      ],
      outcome: "executed",
    });
    assert.deepEqual(cpu.snapshot(), record.after);
    assert.deepEqual(ram.accesses, record.accesses);
    assert.equal(ram.read(0x1234), 0xa5);
  }
});

test("8080 STA can overwrite its opcode or either operand without changing fetched bytes", () => {
  for (const [low, destination] of [
    [0x00, 0x2000], [0x01, 0x2001], [0x02, 0x2002],
  ] as const) {
    const ram = new ObservedRam();
    ram.write(0x2000, 0x32);
    ram.write(0x2001, low);
    ram.write(0x2002, 0x20);
    ram.accesses.length = 0;
    const before = expectedSnapshot({ a: 0xe7, pc: 0x2000 });
    const cpu = new Cpu8080(ram, before);
    const record = cpu.step();
    assert.deepEqual(record, {
      instruction: { address: 0x2000, bytes: [0x32, low, 0x20] },
      before,
      after: { ...before, pc: 0x2003 },
      accesses: [
        { kind: "read", address: 0x2000, value: 0x32 },
        { kind: "read", address: 0x2001, value: low },
        { kind: "read", address: 0x2002, value: 0x20 },
        { kind: "write", address: destination, value: 0xe7 },
      ],
      outcome: "executed",
    });
    assert.deepEqual(ram.accesses, record.accesses);
    assert.equal(ram.read(destination), 0xe7);

    const saved = structuredClone(record);
    ram.write(destination, 0x99);
    cpu.reset();
    assert.deepEqual(record, saved);
    const afterReset = cpu.snapshot();
    const write = record.accesses[3];
    assert.ok(write);
    // Bypass readonly as JavaScript could, checking that the write entry is detached.
    assert.ok(Reflect.set(write, "value", 0));
    assert.ok(Reflect.set(write, "address", 0xffff));
    assert.equal(ram.read(destination), 0x99);
    assert.deepEqual(cpu.snapshot(), afterReset);
  }
});

test("8080 MOV A,M reads the byte at HL, preserving flags, HL, and unrelated state", () => {
  for (const address of [0x0000, 0x00ff, 0x0100, 0x12ff, 0x1300, 0x8000, 0xffff]) {
    for (const value of [0x00, 0x5a, 0x80, 0xff]) {
      for (const flags of [
        { s: true, z: false, ac: true, p: false, cy: true },
        { s: false, z: true, ac: false, p: true, cy: false },
      ]) {
        const ram = new ObservedRam();
        ram.write(0x2000, 0x7e);
        const before = expectedSnapshot({ h: Math.floor(address / 256), l: address % 256, pc: 0x2000, flags });
        const cpu = new Cpu8080(ram, before);
        // Data comes from current RAM, including edits made after construction.
        ram.write(address, value);
        ram.accesses.length = 0;
        const record = cpu.step();
        assert.deepEqual(record, {
          instruction: { address: 0x2000, bytes: [0x7e] },
          before,
          after: { ...before, a: value, pc: 0x2001 },
          accesses: [
            { kind: "read", address: 0x2000, value: 0x7e },
            { kind: "read", address, value },
          ],
          outcome: "executed",
        }, `HL=${address}, value=${value}`);
        assert.deepEqual(cpu.snapshot(), record.after);
        assert.deepEqual(ram.accesses, record.accesses);
        assert.equal(ram.read(address), value);
      }
    }
  }
});

test("8080 MOV M,A writes once at HL without reading the destination or changing flags and registers", () => {
  for (const address of [0x0000, 0x00ff, 0x0100, 0x12ff, 0x1300, 0x8000, 0xffff]) {
    for (const a of [0x00, 0x5a, 0x80, 0xff]) {
      for (const flags of [
        { s: true, z: false, ac: true, p: false, cy: true },
        { s: false, z: true, ac: false, p: true, cy: false },
      ]) {
        const ram = new ObservedRam();
        ram.write(0x2000, 0x77);
        ram.write(address, 0x5a); // Still write when the destination already contains A.
        ram.accesses.length = 0;
        const before = expectedSnapshot({ a, h: Math.floor(address / 256), l: address % 256, pc: 0x2000, flags });
        const cpu = new Cpu8080(ram, before);
        const record = cpu.step();
        assert.deepEqual(record, {
          instruction: { address: 0x2000, bytes: [0x77] },
          before,
          after: { ...before, pc: 0x2001 },
          accesses: [
            { kind: "read", address: 0x2000, value: 0x77 },
            { kind: "write", address, value: a },
          ],
          outcome: "executed",
        }, `HL=${address}, A=${a}`);
        assert.deepEqual(cpu.snapshot(), record.after);
        assert.deepEqual(ram.accesses, record.accesses);
        assert.equal(ram.read(address), a);
      }
    }
  }
});

test("8080 memory MOV instructions wrap PC independently of HL and fetch no operand bytes", () => {
  for (const opcode of [0x7e, 0x77]) {
    const ram = new ObservedRam();
    ram.write(0xffff, opcode);
    ram.write(0x12ff, 0xa5);
    ram.accesses.length = 0;
    const before = expectedSnapshot({ h: 0x12, l: 0xff, pc: 0xffff });
    const cpu = new Cpu8080(ram, before);
    const record = cpu.step();
    assert.deepEqual(record, {
      instruction: { address: 0xffff, bytes: [opcode] },
      before,
      after: { ...before, a: opcode === 0x7e ? 0xa5 : 0x11, pc: 0 },
      accesses: [
        { kind: "read", address: 0xffff, value: opcode },
        opcode === 0x7e
          ? { kind: "read", address: 0x12ff, value: 0xa5 }
          : { kind: "write", address: 0x12ff, value: 0x11 },
      ],
      outcome: "executed",
    });
    assert.deepEqual(cpu.snapshot(), record.after);
    assert.deepEqual(ram.accesses, record.accesses);
  }
});

test("8080 MOV A,M can read its own opcode or the following byte as data", () => {
  for (const [low, address, value] of [[0x00, 0x2000, 0x7e], [0x01, 0x2001, 0xa5]] as const) {
    const ram = new ObservedRam();
    ram.write(0x2000, 0x7e);
    ram.write(0x2001, 0xa5);
    ram.accesses.length = 0;
    const before = expectedSnapshot({ h: 0x20, l: low, pc: 0x2000 });
    const cpu = new Cpu8080(ram, before);
    const record = cpu.step();
    assert.deepEqual(record, {
      instruction: { address: 0x2000, bytes: [0x7e] },
      before,
      after: { ...before, a: value, pc: 0x2001 },
      accesses: [
        { kind: "read", address: 0x2000, value: 0x7e },
        { kind: "read", address, value },
      ],
      outcome: "executed",
    });
    assert.deepEqual(cpu.snapshot(), record.after);
    assert.deepEqual(ram.accesses, record.accesses);
  }
});

test("8080 MOV M,A can overwrite instruction bytes while retaining the captured opcode", () => {
  for (const [low, address] of [[0x00, 0x2000], [0x01, 0x2001]] as const) {
    const ram = new ObservedRam();
    ram.write(0x2000, 0x77);
    ram.write(0x2001, 0x7e);
    ram.accesses.length = 0;
    const before = expectedSnapshot({ a: 0x76, h: 0x20, l: low, pc: 0x2000 });
    const cpu = new Cpu8080(ram, before);
    const record = cpu.step();
    assert.deepEqual(record, {
      instruction: { address: 0x2000, bytes: [0x77] },
      before,
      after: { ...before, pc: 0x2001 },
      accesses: [
        { kind: "read", address: 0x2000, value: 0x77 },
        { kind: "write", address, value: 0x76 },
      ],
      outcome: "executed",
    });
    assert.deepEqual(cpu.snapshot(), record.after);
    assert.deepEqual(ram.accesses, record.accesses);
    assert.equal(ram.read(address), 0x76);

    const saved = structuredClone(record);
    const next = cpu.step();
    assert.equal(next.outcome, address === 0x2001 ? "halted" : "executed");
    assert.deepEqual(next.instruction, { address: 0x2001, bytes: [address === 0x2001 ? 0x76 : 0x7e] });
    ram.write(address, 0);
    cpu.reset();
    assert.deepEqual(record, saved);
  }
});

test("8080 memory MOV uses the current HL after INX wraps FFFF to 0000", () => {
  const ram = new ObservedRam();
  ram.write(0x2000, 0x7e);
  ram.write(0x2001, 0x23);
  ram.write(0x2002, 0x77);
  ram.write(0xffff, 0xa5);
  const before = expectedSnapshot({ h: 0xff, l: 0xff, pc: 0x2000 });
  const cpu = new Cpu8080(ram, before);
  const load = cpu.step();
  const saved = structuredClone(load);
  assert.deepEqual(load.after, { ...before, a: 0xa5, pc: 0x2001 });
  const increment = cpu.step();
  assert.deepEqual(increment.after, { ...load.after, h: 0, l: 0, hl: 0, pc: 0x2002 });
  ram.write(0xffff, 0x5a); // The accumulator retains the byte loaded earlier.
  ram.accesses.length = 0;
  const store = cpu.step();
  assert.deepEqual(store, {
    instruction: { address: 0x2002, bytes: [0x77] },
    before: increment.after,
    after: { ...increment.after, pc: 0x2003 },
    accesses: [
      { kind: "read", address: 0x2002, value: 0x77 },
      { kind: "write", address: 0x0000, value: 0xa5 },
    ],
    outcome: "executed",
  });
  assert.deepEqual(cpu.snapshot(), store.after);
  assert.deepEqual(ram.accesses, store.accesses);
  assert.equal(ram.read(0x0000), 0xa5);
  assert.equal(ram.read(0xffff), 0x5a);
  assert.deepEqual(load, saved);
});

test("8080 HLT advances PC with wrapping, preserves unrelated state, and stops further fetching", () => {
  for (const [address, nextPc] of [
    [0x0000, 0x0001], [0x1234, 0x1235], [0xffff, 0x0000],
  ] as const) {
    for (const flags of [
      { s: true, z: false, ac: true, p: false, cy: true },
      { s: false, z: true, ac: false, p: true, cy: false },
    ]) {
      for (const interruptEnabled of [false, true]) {
        const ram = new ObservedRam();
        ram.write(address, 0x76);
        ram.write(nextPc, 0x3e);
        ram.accesses.length = 0;
        const before = expectedSnapshot({ pc: address, flags, interruptEnabled });
        const after = { ...before, pc: nextPc, halted: true };
        const cpu = new Cpu8080(ram, before);
        const record = cpu.step();
        const expectedAccesses = [{ kind: "read", address, value: 0x76 }];
        const context = `PC=${address}, flags=${JSON.stringify(flags)}, INTE=${interruptEnabled}`;
        assert.deepEqual(record, {
          instruction: { address, bytes: [0x76] },
          before,
          after,
          accesses: expectedAccesses,
          outcome: "halted",
        }, context);
        assert.deepEqual(cpu.snapshot(), after, context);
        assert.deepEqual(ram.accesses, expectedAccesses, context);

        const saved = structuredClone(record);
        ram.accesses.length = 0;
        for (let attempt = 0; attempt < 2; attempt++) {
          assert.deepEqual(cpu.step(), {
            instruction: null, before: after, after, accesses: [], outcome: "halted",
          }, context);
        }
        assert.deepEqual(cpu.snapshot(), after, context);
        assert.deepEqual(ram.accesses, [], context);
        assert.deepEqual(record, saved, context);

        // Bypass readonly to check that a HLT record cannot resume the CPU.
        assert.ok(Reflect.set(record.after, "halted", false));
        assert.deepEqual(record.before, before, context);
        assert.deepEqual(cpu.snapshot(), after, context);
        assert.equal(cpu.step().instruction, null, context);
        assert.deepEqual(ram.accesses, [], context);
      }
    }
  }
});

test("every other 8080 opcode reports unsupported repeatedly with one read and unchanged state", () => {
  const ram = new ObservedRam();
  const before = expectedSnapshot({ pc: 0xffff });
  const cpu = new Cpu8080(ram, before);
  for (let opcode = 0; opcode <= 0xff; opcode++) {
    // Explicit supported encodings, independent of the CPU's dispatch table.
    if ([
      0x01, 0x03, 0x11, 0x13, 0x21, 0x23, 0x31, 0x32, 0x33,
      0x3e, 0x76, 0x77, 0x7e, 0xc1, 0xc5, 0xc6, 0xd1, 0xd5, 0xe1, 0xe5,
    ].includes(opcode)) continue;
    ram.write(0xffff, opcode);
    for (let attempt = 0; attempt < 2; attempt++) {
      ram.accesses.length = 0;
      const record = cpu.step();
      assert.deepEqual(record, {
        instruction: { address: 0xffff, bytes: [opcode] },
        before,
        after: before,
        accesses: [{ kind: "read", address: 0xffff, value: opcode }],
        outcome: "unsupported",
        reason: "opcode",
      });
      assert.deepEqual(cpu.snapshot(), before);
      assert.deepEqual(ram.accesses, record.accesses);
    }
  }
});

test("an already halted 8080 returns independent records without fetching", () => {
  const ram = new ObservedRam();
  const before = expectedSnapshot({ halted: true });
  const cpu = new Cpu8080(ram, before);
  const first = cpu.step();
  const second = cpu.step();
  const expected = {
    instruction: null, before, after: before, accesses: [], outcome: "halted",
  };
  assert.deepEqual(first, expected);
  assert.deepEqual(second, expected);
  // Simulate edits from JavaScript, which has no readonly checks.
  Reflect.set(first.before.flags, "s", false);
  Reflect.set(first.after, "a", 0xff);
  Reflect.set(first.accesses, first.accesses.length, { kind: "read", address: 0, value: 0 });
  assert.deepEqual(second, expected);
  assert.deepEqual(cpu.snapshot(), before);
  assert.deepEqual(ram.accesses, []);
});

test("8080 reset after HLT clears only control state without accessing RAM, then execution resumes", () => {
  const ram = new ObservedRam();
  ram.write(0, 0x3e);
  ram.write(1, 0x5a);
  ram.write(0x0080, 0xa5);
  ram.write(0x1234, 0x76);
  ram.accesses.length = 0;
  const before = expectedSnapshot();
  const cpu = new Cpu8080(ram, before);
  const oldRecord = cpu.step();
  assert.equal(oldRecord.outcome, "halted");
  const savedRecord = structuredClone(oldRecord);
  ram.accesses.length = 0;
  const reset = cpu.reset();
  const afterReset = {
    ...before, pc: 0, interruptEnabled: false, halted: false,
  };
  assert.deepEqual(reset, { before: oldRecord.after, after: afterReset, accesses: [] });
  const savedReset = structuredClone(reset);
  assert.deepEqual(cpu.snapshot(), afterReset);
  assert.deepEqual(ram.accesses, []);
  assert.deepEqual(oldRecord, savedRecord);
  assert.equal(ram.read(0x0080), 0xa5);
  ram.accesses.length = 0;
  const resumed = cpu.step();
  assert.deepEqual(resumed, {
    instruction: { address: 0, bytes: [0x3e, 0x5a] },
    before: afterReset,
    after: { ...afterReset, a: 0x5a, pc: 2 },
    accesses: [
      { kind: "read", address: 0, value: 0x3e },
      { kind: "read", address: 1, value: 0x5a },
    ],
    outcome: "executed",
  });
  assert.deepEqual(cpu.snapshot(), resumed.after);
  assert.deepEqual(ram.accesses, resumed.accesses);
  assert.deepEqual(oldRecord, savedRecord);
  assert.deepEqual(reset, savedReset);
});

test("8080 reset records stay independent across repeated resets, execution, and caller edits", () => {
  const ram = new ObservedRam();
  ram.write(0, 0xc6);
  ram.write(1, 0xef);
  ram.accesses.length = 0;
  const before = expectedSnapshot();
  const cpu = new Cpu8080(ram, before);
  const afterReset = { ...before, pc: 0, interruptEnabled: false, halted: false };
  const first = cpu.reset();
  const savedFirst = structuredClone(first);
  const second = cpu.reset();
  const savedSecond = structuredClone(second);
  assert.deepEqual(first, { before, after: afterReset, accesses: [] });
  assert.deepEqual(second, { before: afterReset, after: afterReset, accesses: [] });
  assert.deepEqual(cpu.snapshot(), afterReset);
  assert.deepEqual(ram.accesses, []);

  const step = cpu.step();
  const savedStep = structuredClone(step);
  assert.equal(step.outcome, "executed");
  assert.equal(step.after.a, 0);
  assert.deepEqual(first, savedFirst);
  assert.deepEqual(second, savedSecond);

  // Deliberately bypass readonly to check nested snapshots and empty access lists.
  assert.ok(Reflect.set(first.before, "pc", 0xffff));
  assert.ok(Reflect.set(first.before.flags, "s", false));
  assert.deepEqual(first.after, savedFirst.after);
  assert.ok(Reflect.set(first.after, "halted", true));
  assert.ok(Reflect.set(first.after.flags, "cy", false));
  assert.equal(first.before.flags.cy, true);
  assert.ok(Reflect.set(first.accesses, 0, { kind: "write", address: 0, value: 0 }));
  assert.deepEqual(second, savedSecond);
  assert.deepEqual(step, savedStep);
  assert.deepEqual(cpu.snapshot(), savedStep.after);
  assert.equal(ram.read(0), 0xc6);

  ram.write(0, 0x76);
  cpu.reset();
  cpu.step();
  assert.deepEqual(second, savedSecond);
  assert.deepEqual(step, savedStep);
});

test("8080 records stay independent of execution, inspection, RAM edits, reset, and each other", () => {
  const ram = new ObservedRam();
  ram.write(0, 0x3e);
  ram.write(1, 0x02);
  ram.write(2, 0xc6);
  ram.write(3, 0x03);
  const before = expectedSnapshot({ pc: 0 });
  const cpu = new Cpu8080(ram, before);
  const first = cpu.step();
  const savedFirst = structuredClone(first);
  const second = cpu.step();
  const savedSecond = structuredClone(second);
  const live = cpu.snapshot();
  ram.accesses.length = 0;
  // Simulate edits from JavaScript, which has no readonly checks.
  Reflect.set(cpu.snapshot().flags, "p", false);
  assert.deepEqual(cpu.snapshot(), live);
  assert.deepEqual(ram.accesses, []);
  assert.deepEqual(first, savedFirst);

  assert.ok(first.instruction);
  assert.ok(first.accesses[0]);
  Reflect.set(first.before, "a", 0xff);
  Reflect.set(first.before.flags, "s", false);
  assert.deepEqual(first.after, savedFirst.after);
  Reflect.set(first.after, "pc", 0xffff);
  Reflect.set(first.after.flags, "ac", false);
  Reflect.set(first.instruction.bytes, 0, 0);
  Reflect.set(first.accesses[0], "value", 0);
  Reflect.set(first.accesses, first.accesses.length, { kind: "write", address: 0, value: 0 });
  assert.deepEqual(second, savedSecond);
  assert.deepEqual(cpu.snapshot(), live);
  assert.equal(ram.read(0), 0x3e);

  ram.write(2, 0);
  cpu.reset();
  assert.deepEqual(second, savedSecond);
  const third = cpu.step();
  assert.equal(third.after.a, 2);
  assert.deepEqual(second, savedSecond);
});

test("8080 rejects RAM sizes outside its flat 64 KiB model", () => {
  for (const size of [1, 0xffff, 0x10001]) {
    assert.throws(() => new Cpu8080(new Ram(size), initialState()), RangeError);
  }
});

test("8080 rejects invalid initial register values without accessing RAM", () => {
  const ram = new ObservedRam();
  for (const name of ["a", "b", "c", "d", "e", "h", "l", "pc", "sp"] as const) {
    const maximum = name === "pc" || name === "sp" ? 0xffff : 0xff;
    for (const value of [-1, maximum + 1, 1.5, NaN, Infinity, -Infinity]) {
      const state = initialState({ [name]: value });
      assert.throws(() => new Cpu8080(ram, state), RangeError, `${name}: ${value}`);
    }
    assert.equal(new Cpu8080(ram, initialState({ [name]: maximum })).snapshot()[name], maximum);
  }
  assert.deepEqual(ram.accesses, []);
});

test("8080 rejects non-boolean initial flags and control latches", () => {
  const ram = new ObservedRam();
  for (const name of ["s", "z", "ac", "p", "cy"] as const) {
    const state = initialState();
    // @ts-expect-error Exercise invalid JavaScript input at the host boundary.
    state.flags[name] = 1;
    assert.throws(() => new Cpu8080(ram, state), TypeError);
  }
  for (const name of ["interruptEnabled", "halted"] as const) {
    const state = initialState();
    // @ts-expect-error Exercise invalid JavaScript input at the host boundary.
    state[name] = 0;
    assert.throws(() => new Cpu8080(ram, state), TypeError);
  }
  assert.deepEqual(ram.accesses, []);
});
