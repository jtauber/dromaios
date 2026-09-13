import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu8080 } from "../../../src/components/cpus/8080.js";
import type { Cpu8080Flags, Cpu8080MemoryAccess, Cpu8080Snapshot, Cpu8080State } from "../../../src/components/cpus/8080.js";
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
// CPU's whole-byte sum, bit masks, and parity helper.
function referenceAddition(a: number, immediate: number, carry = 0): { result: number; flags: Cpu8080Flags } {
  let result = 0;
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

// Subtract one binary column at a time. Unlike the CPU implementation, this
// propagates borrows directly; 8080 AC is the complement of the bit-3 borrow.
function referenceSubtraction(a: number, value: number, borrow = 0): { result: number; flags: Cpu8080Flags } {
  let result = 0;
  let auxiliaryCarry = false;
  let setBits = 0;
  for (let bit = 0; bit < 8; bit++) {
    const column = (a % 2) - (value % 2) - borrow;
    const digit = column < 0 ? column + 2 : column;
    result += digit * 2 ** bit;
    setBits += digit;
    borrow = column < 0 ? 1 : 0;
    if (bit === 3) auxiliaryCarry = borrow === 0;
    a = Math.floor(a / 2);
    value = Math.floor(value / 2);
  }
  return { result, flags: {
    s: result >= 128, z: result === 0, ac: auxiliaryCarry, p: setBits % 2 === 0, cy: borrow === 1,
  } };
}

function referenceLogic(a: number, value: number, operation: "and" | "xor" | "or"): { result: number; flags: Cpu8080Flags } {
  let result = 0;
  let setBits = 0;
  let auxiliaryCarry = false;
  for (let bit = 0; bit < 8; bit++) {
    const left = a % 2 === 1;
    const right = value % 2 === 1;
    const set = operation === "and" ? left && right : operation === "xor" ? left !== right : left || right;
    if (set) { result += 2 ** bit; setBits++; }
    if (bit === 3 && operation === "and") auxiliaryCarry = left || right;
    a = Math.floor(a / 2);
    value = Math.floor(value / 2);
  }
  return { result, flags: {
    s: result >= 128, z: result === 0, ac: auxiliaryCarry, p: setBits % 2 === 0, cy: false,
  } };
}

interface AluCase {
  readonly name: string;
  readonly opcodes: readonly number[];
  readonly immediate: number;
  readonly reference: (a: number, value: number, carry: number) => { result: number; flags: Cpu8080Flags };
}

// Separately authored Intel opcode rows, with no imports from the dispatch table.
const aluCases: readonly AluCase[] = [
  { name: "ADD/ADI", opcodes: [0x80, 0x81, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87], immediate: 0xc6,
    reference: (a, value) => referenceAddition(a, value) },
  { name: "ADC/ACI", opcodes: [0x88, 0x89, 0x8a, 0x8b, 0x8c, 0x8d, 0x8e, 0x8f], immediate: 0xce,
    reference: referenceAddition },
  { name: "SUB/SUI", opcodes: [0x90, 0x91, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97], immediate: 0xd6,
    reference: (a, value) => referenceSubtraction(a, value) },
  { name: "SBB/SBI", opcodes: [0x98, 0x99, 0x9a, 0x9b, 0x9c, 0x9d, 0x9e, 0x9f], immediate: 0xde,
    reference: referenceSubtraction },
  { name: "ANA/ANI", opcodes: [0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7], immediate: 0xe6,
    reference: (a, value) => referenceLogic(a, value, "and") },
  { name: "XRA/XRI", opcodes: [0xa8, 0xa9, 0xaa, 0xab, 0xac, 0xad, 0xae, 0xaf], immediate: 0xee,
    reference: (a, value) => referenceLogic(a, value, "xor") },
  { name: "ORA/ORI", opcodes: [0xb0, 0xb1, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7], immediate: 0xf6,
    reference: (a, value) => referenceLogic(a, value, "or") },
  { name: "CMP/CPI", opcodes: [0xb8, 0xb9, 0xba, 0xbb, 0xbc, 0xbd, 0xbe, 0xbf], immediate: 0xfe,
    reference: (a, value) => ({ result: a, flags: referenceSubtraction(a, value).flags }) },
];

const aluSources = ["b", "c", "d", "e", "h", "l", "m", "a", "immediate"] as const;

for (const { name, opcodes, immediate, reference } of aluCases) {
  test(`8080 ${name} matches its reference for every byte pair and both incoming carry values`, () => {
    const ram = new Ram(0x10000);
    ram.write(0, immediate);
    for (let value = 0; value < 256; value++) {
      ram.write(1, value);
      for (let a = 0; a < 256; a++) {
        for (const cy of [false, true]) {
          const expected = reference(a, value, Number(cy));
          const cpu = new Cpu8080(ram, initialState({ a, pc: 0,
            flags: { s: cy, z: cy, ac: cy, p: cy, cy },
          }));
          const record = cpu.step();
          assert.equal(record.outcome, "executed");
          assert.deepEqual({ result: record.after.a, flags: record.after.flags }, expected,
            `A=${a}, operand=${value}, incoming CY=${cy}`);
        }
      }
    }
  });

  test(`8080 ${name} decodes every source, replaces flags, preserves other state, and records exact reads`, () => {
    const ram = new ObservedRam();
    for (const [sourceIndex, opcode] of [...opcodes, immediate].entries()) {
      const source = aluSources[sourceIndex];
      assert.ok(source);
      for (const [a, value] of [
        [0, 0], [0, 1], [0, 8], [8, 0], [0x0f, 1], [0x10, 1],
        [0x7f, 1], [0x80, 0x80], [0xff, 1], [0xff, 0xff], [0xa5, 0x5a],
      ] as const) {
        for (let bits = 0; bits < 32; bits++) {
          for (const interruptEnabled of [false, true]) {
            const state = initialState({ a, pc: 0xffff, interruptEnabled,
              flags: { s: (bits & 16) !== 0, z: (bits & 8) !== 0, ac: (bits & 4) !== 0,
                p: (bits & 2) !== 0, cy: (bits & 1) !== 0 },
            });
            if (source !== "m" && source !== "a" && source !== "immediate") state[source] = value;
            const before = expectedSnapshot(state);
            ram.write(0xffff, opcode);
            ram.write(0, value);
            ram.write(before.hl, value);
            ram.accesses.length = 0;
            const operand = source === "a" ? a : value;
            const expected = reference(a, operand, Number(state.flags.cy));
            const bytes: number[] = source === "immediate" ? [opcode, value] : [opcode];
            const accesses: Cpu8080MemoryAccess[] = [{ kind: "read", address: 0xffff, value: opcode }];
            if (source === "immediate") accesses.push({ kind: "read", address: 0, value });
            if (source === "m") accesses.push({ kind: "read", address: before.hl, value });
            const cpu = new Cpu8080(ram, state);
            const record = cpu.step();
            const context: string = `${name} ${source}, A=${a}, operand=${operand}, flags=${bits}, IE=${interruptEnabled}`;
            assert.deepEqual(record, {
              instruction: { address: 0xffff, bytes }, before,
              after: { ...before, a: expected.result, flags: expected.flags, pc: source === "immediate" ? 1 : 0 },
              accesses, outcome: "executed",
            }, context);
            assert.deepEqual(cpu.snapshot(), record.after, context);
            assert.deepEqual(ram.accesses, accesses, context);
          }
        }
      }
    }
  });

  test(`8080 ${name} reads M even when it overlaps code or lies at an address-space boundary`, () => {
    const opcode = opcodes[6];
    assert.ok(opcode !== undefined);
    for (const address of [0, 0xffff, 0x1234]) {
      const ram = new ObservedRam();
      const value: number = address === 0xffff ? opcode : 0x81;
      ram.write(address, value);
      ram.write(0xffff, opcode);
      ram.accesses.length = 0;
      const before = expectedSnapshot({ pc: 0xffff, h: address >>> 8, l: address & 0xff });
      const expected = reference(before.a, value, Number(before.flags.cy));
      const cpu = new Cpu8080(ram, before);
      const record = cpu.step();
      assert.deepEqual(record, {
        instruction: { address: 0xffff, bytes: [opcode] }, before,
        after: { ...before, a: expected.result, flags: expected.flags, pc: 0 },
        accesses: [{ kind: "read", address: 0xffff, value: opcode }, { kind: "read", address, value }],
        outcome: "executed",
      });
      assert.deepEqual(ram.accesses, record.accesses);
    }
  });

  test(`8080 ${name} uses current HL and RAM on successive M operations and retains earlier records`, () => {
    const opcode = opcodes[6];
    assert.ok(opcode !== undefined);
    const ram = new ObservedRam();
    for (const [offset, byte] of [opcode, 0x23, opcode, opcode].entries()) ram.write(0x2000 + offset, byte);
    ram.write(0xffff, 0x81);
    ram.write(0, 0x42);
    const cpu = new Cpu8080(ram, initialState({ pc: 0x2000, h: 0xff, l: 0xff }));
    const first = cpu.step();
    const saved = structuredClone(first);
    cpu.step(); // INX H wraps HL from FFFF to 0000.
    for (const [pc, value] of [[0x2002, 0x42], [0x2003, 0x18]] as const) {
      ram.write(0, value);
      const before = cpu.snapshot();
      const expected = reference(before.a, value, Number(before.flags.cy));
      ram.accesses.length = 0;
      assert.deepEqual(cpu.step(), {
        instruction: { address: pc, bytes: [opcode] }, before,
        after: { ...before, a: expected.result, flags: expected.flags, pc: pc + 1 },
        accesses: [{ kind: "read", address: pc, value: opcode }, { kind: "read", address: 0, value }],
        outcome: "executed",
      });
      assert.deepEqual(ram.accesses, [{ kind: "read", address: pc, value: opcode }, { kind: "read", address: 0, value }]);
    }
    assert.deepEqual(first, saved);
  });
}

test("8080 auxiliary carry follows Intel's subtraction and AND rules, including SUB A", () => {
  const cases = [
    { opcode: 0x97, a: 0x3e, value: 0, cy: true, result: 0,
      flags: { s: false, z: true, ac: true, p: true, cy: false } },
    { opcode: 0xd6, a: 0, value: 1, cy: false, result: 0xff,
      flags: { s: true, z: false, ac: false, p: true, cy: true } },
    { opcode: 0xd6, a: 1, value: 0, cy: true, result: 1,
      flags: { s: false, z: false, ac: true, p: false, cy: false } },
    { opcode: 0xde, a: 0, value: 0xff, cy: true, result: 0,
      flags: { s: false, z: true, ac: false, p: true, cy: true } },
    { opcode: 0xce, a: 0, value: 0xff, cy: true, result: 0,
      flags: { s: false, z: true, ac: true, p: true, cy: true } },
    { opcode: 0xe6, a: 0x07, value: 0x07, cy: true, result: 0x07,
      flags: { s: false, z: false, ac: false, p: false, cy: false } },
    { opcode: 0xe6, a: 0x08, value: 0, cy: true, result: 0,
      flags: { s: false, z: true, ac: true, p: true, cy: false } },
    { opcode: 0xe6, a: 0, value: 0x08, cy: true, result: 0,
      flags: { s: false, z: true, ac: true, p: true, cy: false } },
    { opcode: 0xfe, a: 0x08, value: 0x08, cy: true, result: 0x08,
      flags: { s: false, z: true, ac: true, p: true, cy: false } },
  ];
  const ram = new Ram(0x10000);
  for (const { opcode, a, value, cy, result, flags } of cases) {
    ram.write(0, opcode);
    ram.write(1, value);
    const cpu = new Cpu8080(ram, initialState({ a, pc: 0, flags: { s: true, z: false, ac: false, p: false, cy } }));
    const record = cpu.step();
    assert.equal(record.outcome, "executed");
    assert.equal(record.after.a, result);
    assert.deepEqual(record.after.flags, flags);
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

// Literal opcode rows from Intel's table; expectations do not use the CPU operand table.
const moveSources = ["b", "c", "d", "e", "h", "l", "m", "a"] as const;
const moveRows = [
  { destination: "b", opcodes: [0x40, 0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47] },
  { destination: "c", opcodes: [0x48, 0x49, 0x4a, 0x4b, 0x4c, 0x4d, 0x4e, 0x4f] },
  { destination: "d", opcodes: [0x50, 0x51, 0x52, 0x53, 0x54, 0x55, 0x56, 0x57] },
  { destination: "e", opcodes: [0x58, 0x59, 0x5a, 0x5b, 0x5c, 0x5d, 0x5e, 0x5f] },
  { destination: "h", opcodes: [0x60, 0x61, 0x62, 0x63, 0x64, 0x65, 0x66, 0x67] },
  { destination: "l", opcodes: [0x68, 0x69, 0x6a, 0x6b, 0x6c, 0x6d, 0x6e, 0x6f] },
  { destination: "m", opcodes: [0x70, 0x71, 0x72, 0x73, 0x74, 0x75, 0x76, 0x77] },
  { destination: "a", opcodes: [0x78, 0x79, 0x7a, 0x7b, 0x7c, 0x7d, 0x7e, 0x7f] },
] as const;

test("8080 MOV covers every source/destination, including self moves and old HL when H or L changes", () => {
  for (const { destination, opcodes } of moveRows) {
    for (const [sourceCode, opcode] of opcodes.entries()) {
      if (opcode === 0x76) continue; // This encoding is HLT, tested separately.
      const source = moveSources[sourceCode];
      assert.ok(source);
      for (const value of [0, 1, 0x7f, 0x80, 0xa5, 0xff]) {
        for (const set of [false, true]) {
          const state = initialState({ pc: 0xffff, interruptEnabled: set,
            flags: { s: set, z: set, ac: set, p: set, cy: set } });
          if (source !== "m") state[source] = value;
          const before = expectedSnapshot(state);
          const ram = new ObservedRam();
          ram.write(0xffff, opcode);
          ram.write(before.hl, value); // Includes unchanged-value writes to M.
          ram.accesses.length = 0;
          const cpu = new Cpu8080(ram, state);
          const afterState = { ...state, pc: 0 };
          if (destination !== "m") afterState[destination] = value;
          const accesses: Cpu8080MemoryAccess[] = [{ kind: "read", address: 0xffff, value: opcode }];
          if (source === "m") accesses.push({ kind: "read", address: before.hl, value });
          if (destination === "m") accesses.push({ kind: "write", address: before.hl, value });
          const context: string = `MOV ${destination},${source}, value=${value}, flags=${set}`;
          assert.deepEqual(cpu.step(), {
            instruction: { address: 0xffff, bytes: [opcode] }, before,
            after: expectedSnapshot(afterState), accesses, outcome: "executed",
          }, context);
          assert.deepEqual(cpu.snapshot(), expectedSnapshot(afterState), context);
          assert.deepEqual(ram.accesses, accesses, context);
        }
      }
    }
  }
});

test("8080 MVI covers all eight destinations and every byte value with PC wrapping", () => {
  for (const [opcode, destination] of [
    [0x06, "b"], [0x0e, "c"], [0x16, "d"], [0x1e, "e"],
    [0x26, "h"], [0x2e, "l"], [0x36, "m"], [0x3e, "a"],
  ] as const) {
    const ram = new ObservedRam();
    for (let value = 0; value <= 0xff; value++) {
      for (const set of [false, true]) {
        const state = initialState({ pc: 0xffff, interruptEnabled: set,
          flags: { s: set, z: set, ac: set, p: set, cy: set } });
        const before = expectedSnapshot(state);
        ram.write(0xffff, opcode);
        ram.write(0, value);
        ram.write(before.hl, value);
        ram.accesses.length = 0;
        const cpu = new Cpu8080(ram, state);
        const afterState = { ...state, pc: 1 };
        if (destination !== "m") afterState[destination] = value;
        const accesses: Cpu8080MemoryAccess[] = [
          { kind: "read", address: 0xffff, value: opcode }, { kind: "read", address: 0, value },
        ];
        if (destination === "m") accesses.push({ kind: "write", address: before.hl, value });
        assert.deepEqual(cpu.step(), {
          instruction: { address: 0xffff, bytes: [opcode, value] }, before,
          after: expectedSnapshot(afterState), accesses, outcome: "executed",
        });
        assert.deepEqual(ram.accesses, accesses);
      }
    }
  }
});

test("8080 MVI M can overwrite its opcode or immediate after fetching the original bytes", () => {
  for (const address of [0x2000, 0x2001]) {
    const ram = new ObservedRam();
    ram.write(0x2000, 0x36);
    ram.write(0x2001, 0xa5);
    ram.accesses.length = 0;
    const before = expectedSnapshot({ pc: 0x2000, h: 0x20, l: address % 256 });
    const cpu = new Cpu8080(ram, before);
    const record = cpu.step();
    assert.deepEqual(record, {
      instruction: { address: 0x2000, bytes: [0x36, 0xa5] }, before,
      after: { ...before, pc: 0x2002 },
      accesses: [
        { kind: "read", address: 0x2000, value: 0x36 },
        { kind: "read", address: 0x2001, value: 0xa5 },
        { kind: "write", address, value: 0xa5 },
      ], outcome: "executed",
    });
    assert.deepEqual(ram.accesses, record.accesses);
    assert.equal(ram.read(address), 0xa5);
    const saved = structuredClone(record);
    ram.write(address, 0);
    cpu.reset();
    assert.deepEqual(record, saved);
  }
});

test("8080 MOV H,M and MOV L,M can read their own opcode before changing HL", () => {
  for (const [opcode, h, l, hl] of [[0x66, 0x66, 0x00, 0x6600], [0x6e, 0x20, 0x6e, 0x206e]] as const) {
    const ram = new ObservedRam();
    ram.write(0x2000, opcode);
    ram.accesses.length = 0;
    const before = expectedSnapshot({ pc: 0x2000, h: 0x20, l: 0 });
    const cpu = new Cpu8080(ram, before);
    const record = cpu.step();
    assert.deepEqual(record, {
      instruction: { address: 0x2000, bytes: [opcode] }, before,
      after: { ...before, h, l, hl, pc: 0x2001 },
      accesses: [
        { kind: "read", address: 0x2000, value: opcode },
        { kind: "read", address: 0x2000, value: opcode },
      ], outcome: "executed",
    });
    assert.deepEqual(ram.accesses, record.accesses);
  }
});

test("8080 LDAX and STAX use BC or DE independently of HL and preserve flags and pair views", () => {
  for (const [opcode, high, low, load] of [
    [0x0a, "b", "c", true], [0x1a, "d", "e", true],
    [0x02, "b", "c", false], [0x12, "d", "e", false],
  ] as const) {
    for (const address of [0, 0x00ff, 0x1234, 0xffff]) {
      for (const value of [0, 0x7f, 0x80, 0xa5, 0xff]) {
        for (const set of [false, true]) {
          const ram = new ObservedRam();
          const before = expectedSnapshot({ a: value, pc: 0xffff,
            [high]: Math.floor(address / 256), [low]: address % 256,
            flags: { s: set, z: set, ac: set, p: set, cy: set }, interruptEnabled: set });
          const cpu = new Cpu8080(ram, before);
          // Operand data is read from current RAM, including opcode overlap.
          ram.write(address, value);
          ram.write(0xffff, opcode);
          ram.accesses.length = 0;
          const readValue = address === 0xffff ? opcode : value;
          const record = cpu.step();
          assert.deepEqual(record, {
            instruction: { address: 0xffff, bytes: [opcode] }, before,
            after: { ...before, a: load ? readValue : value, pc: 0 },
            accesses: [
              { kind: "read", address: 0xffff, value: opcode },
              { kind: load ? "read" : "write", address, value: load ? readValue : value },
            ], outcome: "executed",
          });
          assert.deepEqual(ram.accesses, record.accesses);
          assert.equal(ram.read(address), load ? readValue : value);
        }
      }
    }
  }
});

test("8080 LDA, LHLD, and SHLD capture their address, wrap data and fetch addresses, and handle code overlap", () => {
  for (const opcode of [0x3a, 0x2a, 0x22]) {
    for (const pc of [0x2000, 0xfffe, 0xffff]) {
      for (const address of [0, 0x1234, 0x2000, 0x2001, 0x2002, 0xffff]) {
        for (const set of [false, true]) {
          const highAddress = (address + 1) % 0x10000;
          const bytes = [opcode, address % 256, Math.floor(address / 256)];
          const image = new Uint8Array(0x10000);
          image[address] = 0x5a;
          image[highAddress] = 0xa5;
          for (const [offset, byte] of bytes.entries()) image[(pc + offset) % 0x10000] = byte;
          const ram = new ObservedRam();
          const before = expectedSnapshot({ pc, h: 0x12, l: 0x34,
            flags: { s: set, z: set, ac: set, p: set, cy: set }, interruptEnabled: set });
          const cpu = new Cpu8080(ram, before);
          for (const location of [address, highAddress, pc, (pc + 1) % 0x10000, (pc + 2) % 0x10000]) {
            const byte = image[location];
            assert.ok(byte !== undefined);
            ram.write(location, byte);
          }
          ram.accesses.length = 0;
          const low = image[address];
          const high = image[highAddress];
          assert.ok(low !== undefined && high !== undefined);
          const accesses: Cpu8080MemoryAccess[] = bytes.map((value, offset) => ({
            kind: "read", address: (pc + offset) % 0x10000, value,
          }));
          const after = { ...before, pc: (pc + 3) % 0x10000 };
          if (opcode === 0x22) {
            accesses.push({ kind: "write", address, value: 0x34 }, { kind: "write", address: highAddress, value: 0x12 });
          } else {
            accesses.push({ kind: "read", address, value: low });
            if (opcode === 0x3a) after.a = low;
            else {
              accesses.push({ kind: "read", address: highAddress, value: high });
              after.l = low;
              after.h = high;
              after.hl = high * 256 + low;
            }
          }
          const record = cpu.step();
          assert.deepEqual(record, { instruction: { address: pc, bytes }, before, after, accesses, outcome: "executed" });
          assert.deepEqual(ram.accesses, accesses);
          if (opcode === 0x22) {
            assert.equal(ram.read(address), 0x34);
            assert.equal(ram.read(highAddress), 0x12);
          }
          const saved = structuredClone(record);
          ram.write(address, 0);
          cpu.reset();
          assert.deepEqual(record, saved);
        }
      }
    }
  }
});

test("8080 XCHG exchanges both register pairs and SPHL copies HL without memory accesses", () => {
  for (const opcode of [0xeb, 0xf9]) {
    for (const de of [0, 0x00ff, 0xff00, 0x8000, 0xffff, 0x1234]) {
      for (const hl of [0, 0x00ff, 0xff00, 0x8000, 0xffff, 0x5678]) {
        for (const set of [false, true]) {
          const before = expectedSnapshot({ pc: 0xffff,
            d: Math.floor(de / 256), e: de % 256, h: Math.floor(hl / 256), l: hl % 256,
            flags: { s: set, z: set, ac: set, p: set, cy: set }, interruptEnabled: set });
          const ram = new ObservedRam();
          ram.write(0xffff, opcode);
          ram.accesses.length = 0;
          const cpu = new Cpu8080(ram, before);
          const after = opcode === 0xeb
            ? { ...before, d: before.h, e: before.l, de: hl, h: before.d, l: before.e, hl: de, pc: 0 }
            : { ...before, sp: hl, pc: 0 };
          const record = cpu.step();
          assert.deepEqual(record, {
            instruction: { address: 0xffff, bytes: [opcode] }, before, after,
            accesses: [{ kind: "read", address: 0xffff, value: opcode }], outcome: "executed",
          });
          assert.deepEqual(ram.accesses, record.accesses);
        }
      }
    }
  }
});

test("8080 XTHL reads low then high and writes high then low, preserving SP across wrapping and code overlap", () => {
  for (const pc of [0x2000, 0xffff]) {
    for (const sp of [0, 0xff, 0xffff, pc, pc - 1]) {
      for (const hl of [0, 0x1234, 0x8000, 0xffff]) {
        for (const set of [false, true]) {
          const ram = new ObservedRam();
          const before = expectedSnapshot({ pc, sp, h: Math.floor(hl / 256), l: hl % 256,
            flags: { s: set, z: set, ac: set, p: set, cy: set }, interruptEnabled: set });
          const cpu = new Cpu8080(ram, before);
          const highAddress = (sp + 1) % 0x10000;
          ram.write(sp, 0x34);
          ram.write(highAddress, 0x12);
          ram.write(pc, 0xe3);
          ram.accesses.length = 0;
          const low = sp === pc ? 0xe3 : 0x34;
          const high = highAddress === pc ? 0xe3 : 0x12;
          const record = cpu.step();
          assert.deepEqual(record, {
            instruction: { address: pc, bytes: [0xe3] }, before,
            after: { ...before, h: high, l: low, hl: high * 256 + low, pc: (pc + 1) % 0x10000 },
            accesses: [
              { kind: "read", address: pc, value: 0xe3 },
              { kind: "read", address: sp, value: low },
              { kind: "read", address: highAddress, value: high },
              { kind: "write", address: highAddress, value: before.h },
              { kind: "write", address: sp, value: before.l },
            ], outcome: "executed",
          });
          assert.deepEqual(ram.accesses, record.accesses);
          assert.equal(ram.read(sp), before.l);
          assert.equal(ram.read(highAddress), before.h);
          const saved = structuredClone(record);
          cpu.reset();
          ram.write(sp, 0);
          assert.deepEqual(record, saved);
        }
      }
    }
  }
});

// Independent encodings and condition meanings from Intel's instruction tables.
const branchConditions = [
  { flag: "z", value: false, jump: 0xc2, call: 0xc4, return: 0xc0 },
  { flag: "z", value: true, jump: 0xca, call: 0xcc, return: 0xc8 },
  { flag: "cy", value: false, jump: 0xd2, call: 0xd4, return: 0xd0 },
  { flag: "cy", value: true, jump: 0xda, call: 0xdc, return: 0xd8 },
  { flag: "p", value: false, jump: 0xe2, call: 0xe4, return: 0xe0 },
  { flag: "p", value: true, jump: 0xea, call: 0xec, return: 0xe8 },
  { flag: "s", value: false, jump: 0xf2, call: 0xf4, return: 0xf0 },
  { flag: "s", value: true, jump: 0xfa, call: 0xfc, return: 0xf8 },
] as const;

for (const family of ["jump", "call", "return"] as const) {
  test(`8080 conditional ${family} checks all eight conditions against every flag combination`, () => {
    for (const condition of branchConditions) {
      for (let bits = 0; bits < 32; bits++) {
        for (const interruptEnabled of [false, true]) {
          const flags = {
            s: !!(bits & 16), z: !!(bits & 8), ac: !!(bits & 4), p: !!(bits & 2), cy: !!(bits & 1),
          };
          const take = flags[condition.flag] === condition.value;
          const opcode = condition[family];
          const bytes = family === "return" ? [opcode] : [opcode, 0x78, 0x56];
          const ram = new ObservedRam();
          for (const [offset, byte] of bytes.entries()) ram.write(0x1234 + offset, byte);
          ram.write(0x8000, 0x78);
          ram.write(0x8001, 0x56);
          ram.accesses.length = 0;
          const before = expectedSnapshot({ flags, interruptEnabled, sp: 0x8000 });
          const cpu = new Cpu8080(ram, before);
          const accesses = bytes.map((value, offset) => ({ kind: "read", address: 0x1234 + offset, value }));
          if (take && family === "call") {
            accesses.push({ kind: "write", address: 0x7fff, value: 0x12 },
              { kind: "write", address: 0x7ffe, value: 0x37 });
          } else if (take && family === "return") {
            accesses.push({ kind: "read", address: 0x8000, value: 0x78 },
              { kind: "read", address: 0x8001, value: 0x56 });
          }
          const after = {
            ...before,
            pc: take ? 0x5678 : family === "return" ? 0x1235 : 0x1237,
            sp: take && family === "call" ? 0x7ffe : take && family === "return" ? 0x8002 : 0x8000,
          };
          const context = `opcode=${opcode}, flags=${bits}, INTE=${interruptEnabled}`;
          assert.deepEqual(cpu.step(), {
            instruction: { address: 0x1234, bytes }, before, after, accesses, outcome: "executed",
          }, context);
          assert.deepEqual(cpu.snapshot(), after, context);
          assert.deepEqual(ram.accesses, accesses, context);
        }
      }
    }
  });
}

test("8080 JMP and PCHL replace PC with the exact target without reading target memory", () => {
  for (const opcode of [0xc3, 0xe9]) {
    for (const target of [0, 0x1234, 0x8000, 0xffff]) {
      for (const set of [false, true]) {
        const ram = new ObservedRam();
        const bytes = opcode === 0xc3 ? [opcode, target % 256, Math.floor(target / 256)] : [opcode];
        for (const [offset, byte] of bytes.entries()) ram.write(0x1234 + offset, byte);
        ram.accesses.length = 0;
        const before = expectedSnapshot({
          h: Math.floor(target / 256), l: target % 256,
          flags: { s: set, z: set, ac: set, p: set, cy: set }, interruptEnabled: set,
        });
        const cpu = new Cpu8080(ram, before);
        const accesses = bytes.map((value, offset) => ({ kind: "read", address: 0x1234 + offset, value }));
        assert.deepEqual(cpu.step(), {
          instruction: { address: 0x1234, bytes }, before, after: { ...before, pc: target },
          accesses, outcome: "executed",
        });
        assert.deepEqual(ram.accesses, accesses);
      }
    }
  }
});

test("8080 jumps and calls fetch both operands across PC wrapping before any stack writes", () => {
  for (const opcode of [0xc3, 0xc2, 0xcd, 0xc4]) {
    for (const pc of [0xfffd, 0xfffe, 0xffff]) {
      for (const sp of [0, 1, 0x8000, 0xffff]) {
        for (const z of [false, true]) {
          const ram = new ObservedRam();
          const bytes = [opcode, 0x78, 0x56];
          for (const [offset, byte] of bytes.entries()) ram.write((pc + offset) % 0x10000, byte);
          ram.accesses.length = 0;
          const before = expectedSnapshot({ pc, sp, flags: { ...initialState().flags, z } });
          const cpu = new Cpu8080(ram, before);
          const take = opcode === 0xc3 || opcode === 0xcd || !z;
          const call = take && (opcode === 0xcd || opcode === 0xc4);
          const nextPc = (pc + 3) % 0x10000;
          const accesses = bytes.map((value, offset) => ({ kind: "read", address: (pc + offset) % 0x10000, value }));
          if (call) {
            accesses.push({ kind: "write", address: (sp + 0xffff) % 0x10000, value: Math.floor(nextPc / 256) },
              { kind: "write", address: (sp + 0xfffe) % 0x10000, value: nextPc % 256 });
          }
          const record = cpu.step();
          assert.deepEqual(record, {
            instruction: { address: pc, bytes }, before,
            after: { ...before, pc: take ? 0x5678 : nextPc, sp: call ? (sp + 0xfffe) % 0x10000 : sp },
            accesses, outcome: "executed",
          });
          assert.deepEqual(ram.accesses, accesses);
        }
      }
    }
  }
});

test("8080 CALL fetches a target before overwriting its opcode or operands with the return address", () => {
  for (const sp of [0x2001, 0x2002, 0x2003]) {
    const ram = new ObservedRam();
    ram.write(0x2000, 0xcd);
    ram.write(0x2001, 0x78);
    ram.write(0x2002, 0x56);
    ram.accesses.length = 0;
    const before = expectedSnapshot({ pc: 0x2000, sp });
    const cpu = new Cpu8080(ram, before);
    const record = cpu.step();
    assert.deepEqual(record, {
      instruction: { address: 0x2000, bytes: [0xcd, 0x78, 0x56] }, before,
      after: { ...before, pc: 0x5678, sp: sp - 2 },
      accesses: [
        { kind: "read", address: 0x2000, value: 0xcd },
        { kind: "read", address: 0x2001, value: 0x78 },
        { kind: "read", address: 0x2002, value: 0x56 },
        { kind: "write", address: sp - 1, value: 0x20 },
        { kind: "write", address: sp - 2, value: 0x03 },
      ], outcome: "executed",
    });
    assert.deepEqual(ram.accesses, record.accesses);
    assert.equal(ram.read(sp - 1), 0x20);
    assert.equal(ram.read(sp - 2), 0x03);
    const saved = structuredClone(record);
    cpu.reset();
    ram.write(sp - 2, 0);
    assert.deepEqual(record, saved);
    assert.ok(record.accesses[3]);
    Reflect.set(record.accesses[3], "value", 0);
    Reflect.set(record.after, "pc", 0xffff);
    assert.equal(ram.read(sp - 1), 0x20);
    assert.equal(cpu.snapshot().pc, 0);
  }
});

test("8080 returns read current stack bytes low then high with SP wrapping and code overlap", () => {
  for (const opcode of [0xc9, 0xc0]) {
    for (const [pc, sp] of [[0xffff, 0x8000], [0x2000, 0xffff], [0x2000, 0x2000], [0x2000, 0x1fff]] as const) {
      for (const z of [false, true]) {
        const ram = new ObservedRam();
        const highAddress = (sp + 1) % 0x10000;
        const before = expectedSnapshot({ pc, sp, flags: { ...initialState().flags, z } });
        const cpu = new Cpu8080(ram, before);
        // Edits after construction must supply the return target, even when it overlaps code.
        ram.write(sp, 0x34);
        ram.write(highAddress, 0x12);
        ram.write(pc, opcode);
        const low = sp === pc ? opcode : 0x34;
        const high = highAddress === pc ? opcode : 0x12;
        ram.accesses.length = 0;
        const take = opcode === 0xc9 || !z;
        const accesses: Cpu8080MemoryAccess[] = [{ kind: "read", address: pc, value: opcode }];
        if (take) accesses.push({ kind: "read", address: sp, value: low },
          { kind: "read", address: highAddress, value: high });
        const record = cpu.step();
        assert.deepEqual(record, {
          instruction: { address: pc, bytes: [opcode] }, before,
          after: { ...before, pc: take ? high * 256 + low : (pc + 1) % 0x10000,
            sp: take ? (sp + 2) % 0x10000 : sp },
          accesses, outcome: "executed",
        });
        assert.deepEqual(ram.accesses, accesses);
        assert.equal(ram.read(sp), low);
        assert.equal(ram.read(highAddress), high);
      }
    }
  }
});

test("8080 RST covers all eight vectors, pushing the following PC with wrapping and preserving INTE", () => {
  for (const [opcode, target] of [
    [0xc7, 0x00], [0xcf, 0x08], [0xd7, 0x10], [0xdf, 0x18],
    [0xe7, 0x20], [0xef, 0x28], [0xf7, 0x30], [0xff, 0x38],
  ] as const) {
    for (const pc of [0x1234, 0xffff]) {
      for (const sp of [0, 1, 0x8000]) {
        for (const set of [false, true]) {
          const ram = new ObservedRam();
          ram.write(pc, opcode);
          ram.accesses.length = 0;
          const before = expectedSnapshot({ pc, sp, interruptEnabled: set,
            flags: { s: set, z: set, ac: set, p: set, cy: set } });
          const cpu = new Cpu8080(ram, before);
          const nextPc = (pc + 1) % 0x10000;
          const record = cpu.step();
          assert.deepEqual(record, {
            instruction: { address: pc, bytes: [opcode] }, before,
            after: { ...before, pc: target, sp: (sp + 0xfffe) % 0x10000 },
            accesses: [
              { kind: "read", address: pc, value: opcode },
              { kind: "write", address: (sp + 0xffff) % 0x10000, value: Math.floor(nextPc / 256) },
              { kind: "write", address: (sp + 0xfffe) % 0x10000, value: nextPc % 256 },
            ], outcome: "executed",
          });
          assert.deepEqual(ram.accesses, record.accesses);
        }
      }
    }
  }
});

test("8080 nested CALL and RST return in order across the stack boundary", () => {
  const ram = new ObservedRam();
  for (const [address, bytes] of [
    [0x2000, [0xcd, 0x00, 0x30, 0x76]], // CALL 3000H; HLT
    [0x3000, [0xcf, 0xc9]],             // RST 1; RET
    [0x0008, [0xcd, 0x00, 0x40, 0xc9]], // CALL 4000H; RET
    [0x4000, [0xc9]],                   // RET
  ] as const) {
    for (const [offset, byte] of bytes.entries()) ram.write(address + offset, byte);
  }
  const before = expectedSnapshot({ pc: 0x2000, sp: 1 });
  const cpu = new Cpu8080(ram, before);
  const expected = [
    { pc: 0x3000, sp: 0xffff }, { pc: 0x0008, sp: 0xfffd }, { pc: 0x4000, sp: 0xfffb },
    { pc: 0x000b, sp: 0xfffd }, { pc: 0x3001, sp: 0xffff }, { pc: 0x2003, sp: 1 },
  ];
  for (const state of expected) {
    ram.accesses.length = 0;
    const record = cpu.step();
    assert.equal(record.outcome, "executed");
    assert.deepEqual(record.after, { ...before, ...state });
    assert.deepEqual(ram.accesses, record.accesses);
  }
  assert.equal(cpu.step().outcome, "halted");
  assert.deepEqual(cpu.snapshot(), { ...before, pc: 0x2004, halted: true });
  for (const [address, value] of [
    [0x0000, 0x20], [0xffff, 0x03], [0xfffe, 0x30],
    [0xfffd, 0x01], [0xfffc, 0x00], [0xfffb, 0x0b],
  ] as const) assert.equal(ram.read(address), value);
});

test("8080 PCHL uses HL changed by preceding instructions and can jump to its own opcode", () => {
  const ram = new ObservedRam();
  for (const [offset, byte] of [0x21, 0xfe, 0xff, 0x23, 0xe9].entries()) ram.write(0x2000 + offset, byte);
  ram.write(0xffff, 0xe9);
  const cpu = new Cpu8080(ram, initialState({ pc: 0x2000 }));
  cpu.step(); // LXI H,FFFEH
  cpu.step(); // INX H
  for (const pc of [0x2004, 0xffff]) {
    const before = cpu.snapshot();
    ram.accesses.length = 0;
    const record = cpu.step();
    assert.deepEqual(record, {
      instruction: { address: pc, bytes: [0xe9] }, before, after: { ...before, pc: 0xffff },
      accesses: [{ kind: "read", address: pc, value: 0xe9 }], outcome: "executed",
    });
    assert.deepEqual(ram.accesses, record.accesses);
  }
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
    if (opcode >= 0x40 && opcode <= 0xbf) continue; // MOV, HLT, and register/memory ALU forms.
    if ([
      0x02, 0x06, 0x0a, 0x0e, 0x12, 0x16, 0x1a, 0x1e, 0x22, 0x26, 0x2a, 0x2e, 0x36, 0x3a,
      0xe3, 0xeb, 0xf9,
      0x01, 0x03, 0x11, 0x13, 0x21, 0x23, 0x31, 0x32, 0x33,
      0x3e, 0xc1, 0xc5, 0xc6, 0xd1, 0xd5, 0xe1, 0xe5,
      0xc0, 0xc2, 0xc3, 0xc4, 0xc7, 0xc8, 0xc9, 0xca, 0xcc, 0xcd, 0xcf,
      0xd0, 0xd2, 0xd4, 0xd7, 0xd8, 0xda, 0xdc, 0xdf,
      0xe0, 0xe2, 0xe4, 0xe7, 0xe8, 0xe9, 0xea, 0xec, 0xef,
      0xf0, 0xf2, 0xf4, 0xf7, 0xf8, 0xfa, 0xfc, 0xff,
      0xce, 0xd6, 0xde, 0xe6, 0xee, 0xf6, 0xfe,
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
