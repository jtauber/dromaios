import assert from "node:assert/strict";
import { test } from "node:test";
import { CpuZ80 } from "../../../src/components/cpus/z80.js";
import type { CpuZ80Flags, CpuZ80RegisterBank, CpuZ80State } from "../../../src/components/cpus/z80.js";
import { Cpu8080 } from "../../../src/components/cpus/8080.js";
import { Ram } from "../../../src/components/memory/ram.js";
import { ObservedRam } from "../../helpers/observed-ram.js";

function initialState(overrides: Partial<CpuZ80State> = {}): CpuZ80State {
  return {
    a: 0x11, b: 0x22, c: 0x33, d: 0x44, e: 0x55, h: 0x66, l: 0x77,
    flags: { s: true, z: false, h: true, pv: false, n: true, c: false },
    alternate: {
      a: 0x88, b: 0x99, c: 0xaa, d: 0xbb, e: 0xcc, h: 0xdd, l: 0xee,
      flags: { s: false, z: true, h: false, pv: true, n: false, c: true },
    },
    ix: 0x1234, iy: 0x5678, pc: 0x2000, sp: 0xabcd, i: 0x42, r: 0xfe,
    iff1: true, iff2: false, im: 2, halted: false,
    ...overrides,
  };
}

function bankSnapshot(bank: CpuZ80RegisterBank) {
  return { ...bank, flags: { ...bank.flags }, bc: bank.b * 256 + bank.c,
    de: bank.d * 256 + bank.e, hl: bank.h * 256 + bank.l };
}

function snapshot(state: CpuZ80State) {
  return { ...state, ...bankSnapshot(state), alternate: bankSnapshot(state.alternate) };
}

function flagPattern(bits: number): CpuZ80Flags {
  return { s: Boolean(bits & 1), z: Boolean(bits & 2), h: Boolean(bits & 4),
    pv: Boolean(bits & 8), n: Boolean(bits & 16), c: Boolean(bits & 32) };
}

// Literal encodings from the manual; the memory selector (HL) is outside this slice.
const byteRegisterCases = [
  { register: "a", load: 0x3e, increment: 0x3c, decrement: 0x3d },
  { register: "b", load: 0x06, increment: 0x04, decrement: 0x05 },
  { register: "c", load: 0x0e, increment: 0x0c, decrement: 0x0d },
  { register: "d", load: 0x16, increment: 0x14, decrement: 0x15 },
  { register: "e", load: 0x1e, increment: 0x1c, decrement: 0x1d },
  { register: "h", load: 0x26, increment: 0x24, decrement: 0x25 },
  { register: "l", load: 0x2e, increment: 0x2c, decrement: 0x2d },
] as const;

test("Z80 owns both banks, flags, and snapshots without reset or memory access", () => {
  const ram = new ObservedRam();
  const supplied = initialState();
  const cpu = new CpuZ80(ram, supplied);
  const first = cpu.snapshot();
  const second = cpu.snapshot();
  const restored = new CpuZ80(ram, first);
  supplied.b = 0;
  supplied.flags.s = false;
  supplied.alternate.h = 0;
  supplied.alternate.flags.pv = false;
  // Deliberately bypass readonly typing to verify isolation for JavaScript callers.
  Reflect.set(first, "bc", 0);
  Reflect.set(first.flags, "h", false);
  Reflect.set(first.alternate, "a", 0);
  Reflect.set(first.alternate.flags, "z", false);
  assert.deepEqual(second, snapshot(initialState()));
  assert.deepEqual(cpu.snapshot(), second);
  assert.deepEqual(restored.snapshot(), second);
  assert.deepEqual(ram.accesses, []);
});

test("Z80 reads declared getters once, including nested non-enumerable fields, and ignores metadata", () => {
  const supplied = initialState();
  const expected = snapshot(supplied);
  const calls = new Map<string, number>();
  for (const [label, object] of [["state", supplied], ["flags", supplied.flags],
    ["alternate", supplied.alternate], ["alternate.flags", supplied.alternate.flags]] as const) {
    for (const [name, value] of Object.entries(object)) {
      const key = `${label}.${name}`;
      Object.defineProperty(object, name, { enumerable: false, get: () => {
        calls.set(key, (calls.get(key) ?? 0) + 1);
        return value;
      } });
    }
    for (const name of ["metadata", "bc", "de", "hl"]) {
      Object.defineProperty(object, name, { get: () => { throw new Error(`Unexpected ${label}.${name} read`); } });
    }
  }
  const cpu = new CpuZ80(new Ram(0x10000), supplied);
  assert.deepEqual(cpu.snapshot(), expected);
  assert.equal(calls.size, 39);
  assert.ok([...calls.values()].every(count => count === 1));
});

test("Z80 separates initially shared banks and flags", () => {
  const supplied = initialState();
  supplied.alternate = supplied;
  const ram = new Ram(0x10000);
  ram.write(0x2000, 0xc6);
  ram.write(0x2001, 0x6f);
  const cpu = new CpuZ80(ram, supplied);
  const alternate = bankSnapshot(supplied);
  // Avoid copying the caller's intentionally circular object in expectations.
  const { a, b, c, d, e, h, l, flags, bc, de, hl } = alternate;
  const expected = { a, b, c, d, e, h, l, flags, bc, de, hl };
  const record = cpu.step();
  assert.equal(record.after.a, 0x80);
  assert.deepEqual(record.after.alternate, expected);
  assert.notStrictEqual(record.after.flags, record.after.alternate.flags);
});

test("Z80 validates both banks, control fields, and RAM size before accessing memory", () => {
  const ram = new ObservedRam();
  for (const alternate of [false, true]) {
    for (const name of ["a", "b", "c", "d", "e", "h", "l"]) {
      for (const value of [-1, 256, 0.5, NaN, Infinity, "00"]) {
        const state = initialState();
        Reflect.set(alternate ? state.alternate : state, name, value);
        assert.throws(() => new CpuZ80(ram, state), RangeError);
      }
    }
    for (const name of ["s", "z", "h", "pv", "n", "c"]) {
      for (const value of [0, 1, undefined, "false"]) {
        const state = initialState();
        Reflect.set(alternate ? state.alternate.flags : state.flags, name, value);
        assert.throws(() => new CpuZ80(ram, state), TypeError);
      }
    }
  }
  for (const [name, maximum] of [["ix", 0xffff], ["iy", 0xffff], ["pc", 0xffff], ["sp", 0xffff],
    ["i", 0xff], ["r", 0xff], ["im", 2]] as const) {
    for (const value of [0, maximum]) {
      const state = initialState();
      Reflect.set(state, name, value);
      assert.equal(new CpuZ80(ram, state).snapshot()[name], value);
    }
    for (const value of [-1, maximum + 1, 0.5, NaN, Infinity, "00"]) {
      const state = initialState();
      Reflect.set(state, name, value);
      assert.throws(() => new CpuZ80(ram, state), RangeError);
    }
  }
  for (const name of ["iff1", "iff2", "halted"]) {
    for (const value of [0, 1, undefined, "false"]) {
      const state = initialState();
      Reflect.set(state, name, value);
      assert.throws(() => new CpuZ80(ram, state), TypeError);
    }
  }
  for (const size of [0x100, 0xffff, 0x10001]) {
    assert.throws(() => new CpuZ80(new Ram(size), initialState()), /exactly 64 KiB/);
  }
  assert.deepEqual(ram.accesses, []);
});

for (const { register, load, increment, decrement } of byteRegisterCases) {
  test(`Z80 LD ${register.toUpperCase()},n handles every byte and preserves every flag combination and alternate state`, () => {
    const ram = new ObservedRam();
    for (const [pc, operandAddress, nextPc] of [[0x2000, 0x2001, 0x2002], [0xffff, 0, 1]] as const) {
      ram.write(pc, load);
      for (let bits = 0; bits < 64; bits++) {
        for (let value = 0; value < 256; value++) {
          ram.write(operandAddress, value);
          ram.accesses.length = 0;
          const before = initialState({ pc, flags: flagPattern(bits) });
          const cpu = new CpuZ80(ram, before);
          const record = cpu.step();
          assert.deepEqual(record, {
            before: snapshot(before), after: snapshot({ ...before, [register]: value, pc: nextPc, r: 0xff }),
            instruction: { address: pc, bytes: [load, value] }, outcome: "executed",
            accesses: [{ kind: "read", address: pc, value: load }, { kind: "read", address: operandAddress, value }],
          });
          assert.deepEqual(cpu.snapshot(), record.after);
          assert.deepEqual(ram.accesses, record.accesses);
        }
      }
    }
  });

  for (const [mnemonic, opcode, delta] of [["INC", increment, 1], ["DEC", decrement, -1]] as const) {
    test(`Z80 ${mnemonic} ${register.toUpperCase()} handles every byte and flag pattern, preserving carry and the alternate bank`, () => {
      const ram = new ObservedRam();
      ram.write(0xffff, opcode);
      for (let value = 0; value < 256; value++) {
        const result = (value + delta + 256) % 256;
        const signedResult = (value < 128 ? value : value - 256) + delta;
        const lowDigitResult = value % 16 + delta;
        for (let bits = 0; bits < 64; bits++) {
          const flags = flagPattern(bits);
          const before = initialState({ [register]: value, flags, pc: 0xffff, r: 0xff });
          const cpu = new CpuZ80(ram, before);
          ram.accesses.length = 0;
          const record = cpu.step();
          assert.deepEqual(record, {
            before: snapshot(before),
            after: snapshot({ ...before, [register]: result, pc: 0, r: 0x80,
              flags: { s: result >= 128, z: result === 0, h: lowDigitResult < 0 || lowDigitResult > 15,
                pv: signedResult < -128 || signedResult > 127, n: delta === -1, c: flags.c } }),
            instruction: { address: 0xffff, bytes: [opcode] }, outcome: "executed",
            accesses: [{ kind: "read", address: 0xffff, value: opcode }],
          });
          assert.deepEqual(cpu.snapshot(), record.after);
          assert.deepEqual(ram.accesses, record.accesses);
        }
      }
    });
  }
}

// Independent reference: decimal signed range for overflow and column addition for carries.
function addition(a: number, value: number) {
  let left = a;
  let right = value;
  let carry = 0;
  let half = false;
  let result = 0;
  for (let bit = 0; bit < 8; bit++) {
    const column = left % 2 + right % 2 + carry;
    result += (column % 2) * 2 ** bit;
    carry = Math.floor(column / 2);
    if (bit === 3) half = carry === 1;
    left = Math.floor(left / 2);
    right = Math.floor(right / 2);
  }
  const signed = (a < 128 ? a : a - 256) + (value < 128 ? value : value - 256);
  return { a: result, flags: { s: result >= 128, z: result === 0, h: half,
    pv: signed < -128 || signed > 127, n: false, c: carry === 1 } };
}

test("Z80 ADD A,n matches independent arithmetic for every operand pair with old flags clear and set", () => {
  const ram = new ObservedRam();
  ram.write(0x2000, 0xc6);
  for (const bits of [0, 63]) {
    for (let a = 0; a < 256; a++) {
      for (let value = 0; value < 256; value++) {
        ram.write(0x2001, value);
        ram.accesses.length = 0;
        const before = initialState({ a, flags: flagPattern(bits) });
        const cpu = new CpuZ80(ram, before);
        const record = cpu.step();
        assert.deepEqual(record.after, snapshot({ ...before, ...addition(a, value), pc: 0x2002, r: 0xff }));
        assert.deepEqual(record.before, snapshot(before));
        assert.deepEqual(record.instruction, { address: 0x2000, bytes: [0xc6, value] });
        assert.equal(record.outcome, "executed");
        assert.deepEqual(record.accesses, [
          { kind: "read", address: 0x2000, value: 0xc6 }, { kind: "read", address: 0x2001, value },
        ]);
        assert.deepEqual(ram.accesses, record.accesses);
      }
    }
  }
});

test("Z80 immediate instructions wrap PC and fetch current RAM", () => {
  for (const opcode of [0x3e, 0xc6]) {
    for (const pc of [0xfffe, 0xffff]) {
      const ram = new ObservedRam();
      ram.write(pc, opcode);
      ram.write((pc + 1) % 0x10000, 0x12);
      const before = initialState({ pc, a: 0 });
      const cpu = new CpuZ80(ram, before);
      ram.write((pc + 1) % 0x10000, 0x34);
      ram.accesses.length = 0;
      const record = cpu.step();
      assert.deepEqual(record.after, snapshot({ ...before, a: 0x34, pc: (pc + 2) % 0x10000, r: 0xff,
        flags: opcode === 0x3e ? before.flags : addition(0, 0x34).flags }));
      assert.deepEqual(record.instruction, { address: pc, bytes: [opcode, 0x34] });
      assert.deepEqual(record.accesses, [{ kind: "read", address: pc, value: opcode },
        { kind: "read", address: (pc + 1) % 0x10000, value: 0x34 }]);
      assert.deepEqual(ram.accesses, record.accesses);
    }
  }
});

test("Z80 LD (nn),A reads low then high, wraps PC, and records overlapping and unchanged stores", () => {
  for (const pc of [0x2000, 0xfffd, 0xfffe, 0xffff]) {
    for (const address of [0, 0xffff, 0x1234, pc, (pc + 1) % 0x10000, (pc + 2) % 0x10000]) {
      for (const bits of [0, 63, 21, 42]) {
        const ram = new ObservedRam();
        const bytes = [0x32, address % 256, Math.floor(address / 256)];
        ram.write(address, 0xa5);
        bytes.forEach((value, offset) => ram.write((pc + offset) % 0x10000, value));
        ram.accesses.length = 0;
        const before = initialState({ pc, a: 0xa5, flags: flagPattern(bits) });
        const record = new CpuZ80(ram, before).step();
        assert.deepEqual(record, {
          before: snapshot(before), after: snapshot({ ...before, pc: (pc + 3) % 0x10000, r: 0xff }),
          instruction: { address: pc, bytes }, outcome: "executed",
          accesses: [...bytes.map((value, offset) => ({ kind: "read", address: (pc + offset) % 0x10000, value })),
            { kind: "write", address, value: 0xa5 }],
        });
        assert.deepEqual(ram.accesses, record.accesses);
        assert.equal(ram.read(address), 0xa5);
      }
    }
  }
});

test("Z80 executes self-modified code and keeps earlier records detached", () => {
  const ram = new ObservedRam();
  [0x32, 0x03, 0x20, 0x00].forEach((value, offset) => ram.write(0x2000 + offset, value));
  const cpu = new CpuZ80(ram, initialState({ a: 0x76 }));
  const first = cpu.step();
  const saved = structuredClone(first);
  ram.accesses.length = 0;
  const next = cpu.step();
  assert.equal(next.outcome, "halted");
  assert.deepEqual(next.instruction, { address: 0x2003, bytes: [0x76] });
  assert.deepEqual(ram.accesses, [{ kind: "read", address: 0x2003, value: 0x76 }]);
  const reset = cpu.reset();
  Reflect.set(next.before.flags, "s", false);
  Reflect.set(next.after.alternate.flags, "z", false);
  Reflect.set(reset.before.alternate, "h", 0);
  assert.deepEqual(first, saved);
  assert.equal(cpu.snapshot().alternate.h, 0xdd);
  assert.equal(cpu.snapshot().alternate.flags.z, true);
});

test("Z80 increments only R bits 0–6 once per supported opcode, including HALT", () => {
  const ram = new ObservedRam();
  // Initial Z/C are clear, B is 22, and the displacement is 80 (-128).
  for (const [opcodes, nextPc] of [
    [[0x04, 0x05, 0x0c, 0x0d, 0x14, 0x15, 0x1c, 0x1d, 0x24, 0x25, 0x2c, 0x2d, 0x3c, 0x3d, 0x76], 0],
    [[0x06, 0x0e, 0x16, 0x1e, 0x26, 0x2e, 0x3e, 0xc6, 0x28, 0x38], 1],
    [[0x10, 0x18, 0x20, 0x30], 0xff81],
    [[0x32], 2],
  ] as const) {
    for (const opcode of opcodes) {
      for (let r = 0; r < 256; r++) {
        ram.write(0xffff, opcode);
        ram.write(0, 0x80);
        ram.write(1, 0);
        ram.accesses.length = 0;
        const before = initialState({ pc: 0xffff, r, iff1: false, iff2: true });
        const cpu = new CpuZ80(ram, before);
        const record = cpu.step();
        assert.equal(record.after.r, Math.floor(r / 128) * 128 + (r % 128 + 1) % 128);
        assert.equal(record.after.pc, nextPc);
        assert.equal(record.after.iff1, false);
        assert.equal(record.after.iff2, true);
        assert.equal(record.outcome, opcode === 0x76 ? "halted" : "executed");
        if (opcode === 0x76) {
          assert.deepEqual(record.after, snapshot({ ...before, pc: 0, r: record.after.r, halted: true }));
        }
        assert.deepEqual(ram.accesses, record.accesses);
      }
    }
  }
});

// Truth sets use Z:C as a two-bit value, independent of the CPU's condition selectors.
const relativeJumps: readonly { mnemonic: string; opcode: number; takenConditions: readonly number[] }[] = [
  { mnemonic: "JR", opcode: 0x18, takenConditions: [0, 1, 2, 3] },
  { mnemonic: "JR NZ", opcode: 0x20, takenConditions: [0, 1] },
  { mnemonic: "JR Z", opcode: 0x28, takenConditions: [2, 3] },
  { mnemonic: "JR NC", opcode: 0x30, takenConditions: [0, 2] },
  { mnemonic: "JR C", opcode: 0x38, takenConditions: [1, 3] },
];

for (const { mnemonic, opcode, takenConditions } of relativeJumps) {
  test(`Z80 ${mnemonic} checks the correct flags and wraps signed targets while fetching both bytes on every path`, () => {
    const ram = new ObservedRam();
    for (const [pc, operandAddress, displacement, fallthrough, target] of [
      [0x1234, 0x1235, 0x00, 0x1236, 0x1236],
      [0x1234, 0x1235, 0x7f, 0x1236, 0x12b5],
      [0x1234, 0x1235, 0x80, 0x1236, 0x11b6],
      [0x1234, 0x1235, 0xfe, 0x1236, 0x1234],
      [0x1234, 0x1235, 0xff, 0x1236, 0x1235],
      [0x12fd, 0x12fe, 0x01, 0x12ff, 0x1300],
      [0x0000, 0x0001, 0x80, 0x0002, 0xff82],
      [0xfffd, 0xfffe, 0x01, 0xffff, 0x0000],
      [0xfffe, 0xffff, 0xff, 0x0000, 0xffff],
      [0xffff, 0x0000, 0xfe, 0x0001, 0xffff],
    ] as const) {
      ram.write(pc, opcode);
      ram.write(operandAddress, displacement);
      for (let bits = 0; bits < 64; bits++) {
        const flags = flagPattern(bits);
        const before = initialState({ pc, flags, r: 0x7f });
        const take = takenConditions.includes(Number(flags.z) * 2 + Number(flags.c));
        const cpu = new CpuZ80(ram, before);
        ram.accesses.length = 0;
        const record = cpu.step();
        assert.deepEqual(record, {
          before: snapshot(before), after: snapshot({ ...before, pc: take ? target : fallthrough, r: 0 }),
          instruction: { address: pc, bytes: [opcode, displacement] }, outcome: "executed",
          accesses: [
            { kind: "read", address: pc, value: opcode },
            { kind: "read", address: operandAddress, value: displacement },
          ],
        });
        assert.deepEqual(cpu.snapshot(), record.after);
        assert.deepEqual(ram.accesses, record.accesses);
      }
    }
  });
}

test("Z80 DJNZ decrements every B value, ignores and preserves all flags, and updates the BC view", () => {
  const ram = new ObservedRam();
  ram.write(0xffff, 0x10);
  ram.write(0, 0xfe);
  for (let b = 0; b < 256; b++) {
    for (let bits = 0; bits < 64; bits++) {
      const before = initialState({ b, pc: 0xffff, r: 0x7f, flags: flagPattern(bits) });
      const cpu = new CpuZ80(ram, before);
      ram.accesses.length = 0;
      const record = cpu.step();
      assert.deepEqual(record, {
        before: snapshot(before),
        after: snapshot({ ...before, b: (b + 255) % 256, pc: b === 1 ? 1 : 0xffff, r: 0 }),
        instruction: { address: 0xffff, bytes: [0x10, 0xfe] }, outcome: "executed",
        accesses: [{ kind: "read", address: 0xffff, value: 0x10 }, { kind: "read", address: 0, value: 0xfe }],
      });
      assert.deepEqual(cpu.snapshot(), record.after);
      assert.deepEqual(ram.accesses, record.accesses);
    }
  }
});

test("Z80 JR and DJNZ decode every displacement from PC after the operand, on each available path", () => {
  const ram = new ObservedRam();
  const operand = new DataView(new ArrayBuffer(1));
  // Opcode, B, flagPattern input, taken. DJNZ includes wrap from B=00 to FF.
  for (const [opcode, b, bits, take] of [
    [0x18, 0x22, 0, true],
    [0x20, 0x22, 0, true], [0x20, 0x22, 2, false],
    [0x28, 0x22, 2, true], [0x28, 0x22, 0, false],
    [0x30, 0x22, 0, true], [0x30, 0x22, 32, false],
    [0x38, 0x22, 32, true], [0x38, 0x22, 0, false],
    [0x10, 0, 63, true], [0x10, 1, 0, false],
  ] as const) {
    for (const pc of [0, 0x2000, 0xffff]) {
      ram.write(pc, opcode);
      for (let displacement = 0; displacement < 256; displacement++) {
        ram.write((pc + 1) % 65536, displacement);
        operand.setUint8(0, displacement);
        const before = initialState({ b, pc, r: 0xff, flags: flagPattern(bits) });
        const target = (pc + 2 + (take ? operand.getInt8(0) : 0) + 65536) % 65536;
        const cpu = new CpuZ80(ram, before);
        ram.accesses.length = 0;
        const record = cpu.step();
        assert.deepEqual(record, {
          before: snapshot(before),
          after: snapshot({ ...before, b: opcode === 0x10 ? (b + 255) % 256 : b, pc: target, r: 0x80 }),
          instruction: { address: pc, bytes: [opcode, displacement] }, outcome: "executed",
          accesses: [
            { kind: "read", address: pc, value: opcode },
            { kind: "read", address: (pc + 1) % 65536, value: displacement },
          ],
        });
        assert.deepEqual(ram.accesses, record.accesses);
      }
    }
  }
});

test("Z80 jumps use live flags after ADD replaces them, DJNZ preserves them, and INC changes them", () => {
  const ram = new ObservedRam();
  for (const [offset, byte] of [
    0xc6, 1, 0x10, 2, 0x28, 2, 0, 0, 0x0c, 0x30, 2, 0x20, 2, 0, 0,
  ].entries()) ram.write(0x2000 + offset, byte);
  const before = initialState({ a: 0xff, b: 1 });
  const cpu = new CpuZ80(ram, before);
  const afterAdd = { ...before, a: 0, pc: 0x2002, r: 0xff,
    flags: { s: false, z: true, h: true, pv: false, n: false, c: true } };
  assert.deepEqual(cpu.step().after, snapshot(afterAdd));
  const afterDjnz = { ...afterAdd, b: 0, pc: 0x2004, r: 0x80 };
  assert.deepEqual(cpu.step().after, snapshot(afterDjnz));
  assert.deepEqual(cpu.step().after, snapshot({ ...afterDjnz, pc: 0x2008, r: 0x81 }));
  const afterIncrement = { ...afterDjnz, c: 0x34, pc: 0x2009, r: 0x82,
    flags: { s: false, z: false, h: false, pv: false, n: false, c: true } };
  assert.deepEqual(cpu.step().after, snapshot(afterIncrement));
  assert.deepEqual(cpu.step().after, snapshot({ ...afterIncrement, pc: 0x200b, r: 0x83 })); // JR NC untaken
  assert.deepEqual(cpu.step().after, snapshot({ ...afterIncrement, pc: 0x200f, r: 0x84 })); // JR NZ taken
});

test("Z80 relative jumps and loads fetch current operands and retain independent records across reset and caller edits", () => {
  const ram = new ObservedRam();
  ram.write(0x2000, 0x10);
  ram.write(0x2001, 0xfe);
  ram.write(0x2002, 0x2e); // LD L,n
  ram.write(0x2003, 0);
  const cpu = new CpuZ80(ram, initialState({ b: 3 }));
  const first = cpu.step();
  const savedFirst = structuredClone(first);
  assert.equal(first.after.b, 2);
  assert.equal(first.after.pc, 0x2000);
  ram.write(0x2001, 0);
  const second = cpu.step();
  assert.equal(second.after.b, 1);
  assert.equal(second.after.pc, 0x2002);
  assert.deepEqual(second.instruction?.bytes, [0x10, 0]);
  ram.write(0x2003, 0x80);
  const loaded = cpu.step();
  assert.equal(loaded.after.l, 0x80);
  assert.equal(loaded.after.hl, 0x6680);
  assert.deepEqual(loaded.after.alternate, bankSnapshot(initialState().alternate));
  assert.deepEqual(first, savedFirst);
  const savedSecond = structuredClone(second);
  Reflect.set(first.after.flags, "z", true);
  Reflect.set(first.after.alternate, "l", 0);
  Reflect.set(first.after, "bc", 0);
  assert.ok(first.instruction);
  Reflect.set(first.instruction.bytes, 1, 0xff);
  assert.deepEqual(cpu.snapshot(), loaded.after);
  cpu.reset();
  ram.write(0x2001, 0xff);
  assert.deepEqual(second, savedSecond);
});

test("Z80 rejects every unsupported first byte atomically, including prefixes", () => {
  const ram = new ObservedRam();
  const before = initialState({ pc: 0xffff, r: 0xff });
  for (let opcode = 0; opcode < 256; opcode++) {
    if ([
      0x04, 0x05, 0x06, 0x0c, 0x0d, 0x0e, 0x10, 0x14, 0x15, 0x16, 0x18, 0x1c, 0x1d, 0x1e,
      0x20, 0x24, 0x25, 0x26, 0x28, 0x2c, 0x2d, 0x2e, 0x30, 0x32, 0x38, 0x3c, 0x3d, 0x3e, 0x76, 0xc6,
    ].includes(opcode)) continue;
    ram.write(0xffff, opcode);
    ram.write(0, 0x3e);
    const cpu = new CpuZ80(ram, before);
    for (let attempt = 0; attempt < 2; attempt++) {
      ram.accesses.length = 0;
      const record = cpu.step();
      assert.deepEqual(record, {
        before: snapshot(before), after: snapshot(before), outcome: "unsupported", reason: "opcode",
        instruction: { address: 0xffff, bytes: [opcode] },
        accesses: [{ kind: "read", address: 0xffff, value: opcode }],
      });
      assert.deepEqual(ram.accesses, record.accesses);
    }
  }
});

test("Z80 already-halted steps do not fetch, refresh, or change any state", () => {
  const ram = new ObservedRam();
  const before = initialState({ halted: true });
  const cpu = new CpuZ80(ram, before);
  const first = cpu.step();
  const next = cpu.step();
  assert.deepEqual(first, { before: snapshot(before), after: snapshot(before), outcome: "halted", instruction: null, accesses: [] });
  assert.deepEqual(next, first);
  assert.notStrictEqual(next, first);
  assert.notStrictEqual(first.before.alternate.flags, first.after.alternate.flags);
  assert.deepEqual(ram.accesses, []);
});

test("Z80 reset clears documented control state, releases HALT, and preserves unspecified registers and RAM", () => {
  for (const iff1 of [false, true]) {
    for (const iff2 of [false, true]) {
      for (const im of [0, 1, 2] as const) {
        const ram = new ObservedRam();
        ram.write(0, 0x76);
        ram.write(0xffff, 0xa5);
        ram.accesses.length = 0;
        const before = initialState({ iff1, iff2, im, halted: true });
        const after = snapshot({ ...before, pc: 0, i: 0, r: 0, iff1: false, iff2: false, im: 0, halted: false });
        const cpu = new CpuZ80(ram, before);
        const record = cpu.reset();
        assert.deepEqual(record, { before: snapshot(before), after, accesses: [] });
        assert.deepEqual(cpu.reset(), { before: after, after, accesses: [] });
        assert.deepEqual(ram.accesses, []);
        assert.equal(cpu.step().outcome, "halted");
        assert.equal(cpu.snapshot().r, 1);
        assert.equal(ram.read(0xffff), 0xa5);
        assert.deepEqual(record.after, after);
      }
    }
  }
});

test("8080 and Z80 share these instruction bytes but arithmetic P and P/V mean different things", () => {
  for (const [a, value, result, p, pv, h, c] of [
    [2, 3, 5, true, false, false, false],
    [0x7f, 1, 0x80, false, true, true, false],
    [0x80, 0x80, 0, true, true, false, true],
    [0xff, 1, 0, true, false, true, true],
    [1, 1, 2, false, false, false, false],
  ] as const) {
    for (let bits = 0; bits < 64; bits++) {
      const intelRam = new ObservedRam();
      const zilogRam = new ObservedRam();
      const program = [0x3e, a, 0xc6, value, 0x32, 0x80, 0, 0x76];
      for (const ram of [intelRam, zilogRam]) {
        program.forEach((byte, address) => ram.write(address, byte));
        ram.accesses.length = 0;
      }
      const zilog = new CpuZ80(zilogRam, initialState({ pc: 0, r: 0, flags: flagPattern(bits) }));
      const intel = new Cpu8080(intelRam, {
        a: 0, b: 0, c: 0, d: 0, e: 0, h: 0, l: 0, pc: 0, sp: 0,
        flags: { s: false, z: false, ac: false, p: false, cy: false }, interruptEnabled: false, halted: false,
      });
      for (let step = 0; step < 4; step++) {
        const i = intel.step();
        const z = zilog.step();
        assert.deepEqual(z.instruction, i.instruction);
        assert.deepEqual(z.accesses, i.accesses);
        assert.equal(z.after.a, step === 0 ? a : result);
        assert.equal(i.after.a, z.after.a);
        assert.equal(z.after.pc, i.after.pc);
        assert.equal(z.after.r, step + 1);
        if (step >= 1) {
          assert.deepEqual(z.after.flags, { s: result >= 128, z: result === 0, h, pv, n: false, c });
          assert.deepEqual(i.after.flags, { s: result >= 128, z: result === 0, ac: h, p, cy: c });
        }
      }
      assert.deepEqual(zilogRam.accesses, intelRam.accesses);
      assert.equal(zilogRam.read(0x80), result);
      assert.equal(intelRam.read(0x80), result);
      assert.equal(zilog.snapshot().halted, true);
      assert.equal(intel.snapshot().halted, true);
    }
  }
});
