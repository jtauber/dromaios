import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu8008 } from "../../../src/components/cpus/8008.js";
import type { Cpu8008AddressStack, Cpu8008Flags, Cpu8008MemoryAccess, Cpu8008Snapshot, Cpu8008State } from "../../../src/components/cpus/8008.js";
import { Ram } from "../../../src/components/memory/ram.js";
import { ObservedRam } from "../../helpers/observed-ram.js";

function initialState(overrides: Partial<Cpu8008State> = {}): Cpu8008State {
  return {
    a: 0x81, b: 0x22, c: 0x33, d: 0x44, e: 0x55, h: 0xe6, l: 0x77,
    flags: { s: true, z: false, p: true, c: false },
    addressStack: [0x0111, 0x1222, 0x2333, 0x2000, 0x3444, 0x0555, 0x1666, 0x3777],
    stackIndex: 3, halted: false, ...overrides,
  };
}

function atPc(pc: number, stackIndex = 3, overrides: Partial<Cpu8008State> = {}): Cpu8008State {
  const state = initialState({ ...overrides, stackIndex });
  const addressStack: Cpu8008AddressStack = [...state.addressStack];
  addressStack[stackIndex] = pc;
  return { ...state, addressStack };
}

function snapshot(state: Cpu8008State): Cpu8008Snapshot {
  return { ...state, flags: { ...state.flags }, addressStack: [...state.addressStack],
    pc: state.addressStack[state.stackIndex]!, hl: state.h * 256 + state.l };
}

function advanced(state: Cpu8008State, pc: number, changes: Partial<Cpu8008State> = {}) {
  const addressStack: Cpu8008AddressStack = [...state.addressStack];
  addressStack[state.stackIndex] = pc;
  return snapshot({ ...state, ...changes, addressStack });
}

function flags(bits: number): Cpu8008Flags {
  return { s: Boolean(bits & 1), z: Boolean(bits & 2), p: Boolean(bits & 4), c: Boolean(bits & 8) };
}

// Literal rows from Intel's load matrix; columns are A/B/C/D/E/H/L/M.
const transferColumns = ["a", "b", "c", "d", "e", "h", "l", "m"] as const;
const transferRows = [
  { destination: "a", opcodes: [0xc0, 0xc1, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7] },
  { destination: "b", opcodes: [0xc8, 0xc9, 0xca, 0xcb, 0xcc, 0xcd, 0xce, 0xcf] },
  { destination: "c", opcodes: [0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7] },
  { destination: "d", opcodes: [0xd8, 0xd9, 0xda, 0xdb, 0xdc, 0xdd, 0xde, 0xdf] },
  { destination: "e", opcodes: [0xe0, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7] },
  { destination: "h", opcodes: [0xe8, 0xe9, 0xea, 0xeb, 0xec, 0xed, 0xee, 0xef] },
  { destination: "l", opcodes: [0xf0, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7] },
  { destination: "m", opcodes: [0xf8, 0xf9, 0xfa, 0xfb, 0xfc, 0xfd, 0xfe, 0xff] },
] as const;

// Independent arithmetic oracle: decimal range and a count of binary digits.
function addition(a: number, operand: number) {
  const total = a + operand;
  const result = total % 256;
  const ones = [...result.toString(2)].filter(bit => bit === "1").length;
  return { a: result, flags: { s: result >= 128, z: result === 0, p: ones % 2 === 0, c: total >= 256 } };
}

test("8008 copies physical address slots and flags; snapshots derive PC and raw HL without RAM access", () => {
  const ram = new ObservedRam(0x4000);
  const state = initialState();
  const cpu = new Cpu8008(ram, state);
  const first = cpu.snapshot();
  const second = cpu.snapshot();
  const restored = new Cpu8008(ram, first);
  state.a = 0;
  state.flags.s = false;
  Reflect.set(state.addressStack, 3, 0);
  Reflect.set(first.addressStack, 3, 1);
  Reflect.set(first.flags, "p", false);
  Reflect.set(first, "pc", 2);
  Reflect.set(first, "hl", 3);
  assert.deepEqual(second, snapshot(initialState()));
  assert.deepEqual(cpu.snapshot(), second);
  assert.deepEqual(restored.snapshot(), second);
  assert.deepEqual(ram.accesses, []);
});

test("8008 reads declared getters once and ignores derived fields and extra metadata", () => {
  const state = initialState();
  const expected = snapshot(state);
  const calls = new Map<string, number>();
  for (const [label, object] of [["state", state], ["flags", state.flags], ["stack", state.addressStack]] as const) {
    for (const [name, value] of Object.entries(object)) {
      const key = `${label}.${name}`;
      Object.defineProperty(object, name, { enumerable: false, get: () => {
        calls.set(key, (calls.get(key) ?? 0) + 1);
        return value;
      } });
    }
    for (const name of ["metadata", "pc", "hl"]) {
      Object.defineProperty(object, name, { get: () => { throw new Error(`Unexpected ${label}.${name}`); } });
    }
  }
  assert.deepEqual(new Cpu8008(new Ram(0x4000), state).snapshot(), expected);
  assert.equal(calls.size, 23);
  assert.ok([...calls.values()].every(count => count === 1));
});

test("8008 validates RAM size, all register widths, eight complete address slots, selector, and flags", () => {
  const ram = new ObservedRam(0x4000);
  for (const name of ["a", "b", "c", "d", "e", "h", "l", "stackIndex"] as const) {
    const maximum = name === "stackIndex" ? 7 : 255;
    for (const value of [0, maximum]) assert.equal(new Cpu8008(ram, initialState({ [name]: value })).snapshot()[name], value);
    for (const value of [-1, maximum + 1, 0.5, NaN, Infinity, "00", undefined]) {
      const state = initialState();
      Reflect.set(state, name, value);
      assert.throws(() => new Cpu8008(ram, state), RangeError);
    }
  }
  for (let index = 0; index < 8; index++) {
    for (const value of [-1, 0x4000, 0.5, NaN, Infinity, "0", undefined]) {
      const state = initialState();
      Reflect.set(state.addressStack, index, value);
      assert.throws(() => new Cpu8008(ram, state), RangeError);
    }
  }
  for (const value of [[], Array(7).fill(0), Array(9).fill(0), null, {}, new Uint16Array(8)]) {
    const state = initialState();
    Reflect.set(state, "addressStack", value);
    assert.throws(() => new Cpu8008(ram, state), /exactly 8 values/);
  }
  const sparse = initialState();
  Reflect.set(sparse, "addressStack", Array(8));
  assert.throws(() => new Cpu8008(ram, sparse), RangeError);
  for (const name of ["s", "z", "p", "c"]) {
    for (const value of [0, 1, "false", undefined]) {
      const state = initialState();
      Reflect.set(state.flags, name, value);
      assert.throws(() => new Cpu8008(ram, state), TypeError);
    }
  }
  for (const halted of [0, 1, "false", undefined]) {
    const state = initialState();
    Reflect.set(state, "halted", halted);
    assert.throws(() => new Cpu8008(ram, state), TypeError);
  }
  for (const size of [1, 0x3fff, 0x4001, 0x10000]) {
    assert.throws(() => new Cpu8008(new Ram(size), initialState()), /exactly 16 KiB/);
  }
  assert.deepEqual(ram.accesses, []);
});

for (const [opcode, register] of [
  [0x06, "a"], [0x0e, "b"], [0x16, "c"], [0x1e, "d"], [0x26, "e"], [0x2e, "h"], [0x36, "l"],
] as const) {
  test(`8008 immediate ${register.toUpperCase()} load preserves all flag patterns and inactive address registers`, () => {
    const ram = new ObservedRam(0x4000);
    ram.write(0x3fff, opcode);
    for (let bits = 0; bits < 16; bits++) {
      for (let value = 0; value < 256; value++) {
        const before = atPc(0x3fff, value % 8, { flags: flags(bits) });
        ram.write(0, value);
        ram.accesses.length = 0;
        const cpu = new Cpu8008(ram, before);
        const expected = { before: snapshot(before), after: advanced(before, 1, { [register]: value }),
          outcome: "executed", instruction: { address: 0x3fff, bytes: [opcode, value] },
          accesses: [{ kind: "read", address: 0x3fff, value: opcode }, { kind: "read", address: 0, value }] };
        assert.deepEqual(cpu.step(), expected);
        assert.deepEqual(ram.accesses, expected.accesses);
      }
    }
  });
}

for (const { destination, opcodes } of transferRows) {
  test(`8008 transfers into ${destination.toUpperCase()} cover every source, byte, and flag pattern, including self-transfers and HLT`, () => {
    const ram = new ObservedRam(0x4000);
    for (const [column, source] of transferColumns.entries()) {
      const opcode = opcodes[column]!;
      for (let bits = 0; bits < 16; bits++) {
        for (let value = 0; value < 256; value++) {
          const before = atPc(0x3fff, bits % 8, { flags: flags(bits) });
          if (source !== "m") before[source] = value;
          const address = (before.h % 64) * 256 + before.l;
          // Exercise both changed-value and unchanged-value stores.
          const memoryBefore = source === "m" || bits % 2 === 0 ? value : 255 - value;
          ram.write(address, memoryBefore);
          ram.write(0x3fff, opcode);
          ram.accesses.length = 0;
          const changes: Partial<Cpu8008State> = { halted: opcode === 0xff };
          const accesses: Cpu8008MemoryAccess[] = [{ kind: "read", address: 0x3fff, value: opcode }];
          if (opcode !== 0xff) {
            if (source === "m") accesses.push({ kind: "read", address, value });
            if (destination === "m") accesses.push({ kind: "write", address, value });
            else changes[destination] = value;
          }
          const expected = { before: snapshot(before), after: advanced(before, 0, changes),
            instruction: { address: 0x3fff, bytes: [opcode] }, accesses,
            outcome: opcode === 0xff ? "halted" : "executed" };
          assert.deepEqual(new Cpu8008(ram, before).step(), expected);
          assert.deepEqual(ram.accesses, accesses);
          assert.equal(ram.read(address), destination === "m" && opcode !== 0xff ? value : memoryBefore);
        }
      }
    }
  });
}

test("8008 memory transfers use the original H:L for every register at aliased boundaries and instruction overlaps", () => {
  for (const { destination, opcodes } of transferRows) {
    for (const [column, source] of transferColumns.entries()) {
      const opcode = opcodes[column]!;
      if (opcode === 0xff || (destination !== "m" && source !== "m")) continue;
      for (const pc of [0, 0x2000, 0x3fff]) {
        for (const address of [0, 0x00ff, 0x0100, 0x3fff, pc, (pc + 1) % 0x4000]) {
          for (const highBits of [0, 0x40, 0x80, 0xc0]) {
            const ram = new ObservedRam(0x4000);
            const before = atPc(pc, highBits / 64, { h: highBits + Math.floor(address / 256), l: address % 256 });
            ram.write(address, 0xa5);
            ram.write(pc, opcode);
            const value: number = source === "m" ? (address === pc ? opcode : 0xa5) : before[source];
            ram.accesses.length = 0;
            const changes: Partial<Cpu8008State> = {};
            if (destination !== "m") changes[destination] = value;
            const accesses: Cpu8008MemoryAccess[] = [{ kind: "read", address: pc, value: opcode },
              { kind: destination === "m" ? "write" : "read", address, value }];
            assert.deepEqual(new Cpu8008(ram, before).step(), {
              before: snapshot(before), after: advanced(before, (pc + 1) % 0x4000, changes),
              instruction: { address: pc, bytes: [opcode] }, accesses, outcome: "executed",
            });
            assert.deepEqual(ram.accesses, accesses);
            assert.equal(ram.read(address), value);
          }
        }
      }
    }
  }
});

test("8008 LMI stores every immediate byte and preserves every flag pattern with wrapped fetches", () => {
  const ram = new ObservedRam(0x4000);
  ram.write(0x3fff, 0x3e);
  for (let bits = 0; bits < 16; bits++) {
    for (let value = 0; value < 256; value++) {
      const before = atPc(0x3fff, value % 8, { flags: flags(bits) });
      ram.write(0, value);
      ram.accesses.length = 0;
      const accesses: Cpu8008MemoryAccess[] = [{ kind: "read", address: 0x3fff, value: 0x3e },
        { kind: "read", address: 0, value }, { kind: "write", address: 0x2677, value }];
      assert.deepEqual(new Cpu8008(ram, before).step(), {
        before: snapshot(before), after: advanced(before, 1), outcome: "executed",
        instruction: { address: 0x3fff, bytes: [0x3e, value] }, accesses,
      });
      assert.deepEqual(ram.accesses, accesses);
      assert.equal(ram.read(0x2677), value);
    }
  }
});

test("8008 LMI fetches its immediate before an overlapping write and preserves the full H byte", () => {
  for (const pc of [0, 0x2000, 0x3fff]) {
    for (const address of [0, 0x3fff, pc, (pc + 1) % 0x4000]) {
      for (const highBits of [0, 0x40, 0x80, 0xc0]) {
        const ram = new ObservedRam(0x4000);
        ram.write(pc, 0x3e);
        ram.write((pc + 1) % 0x4000, 0xff);
        ram.accesses.length = 0;
        const before = atPc(pc, highBits / 64, { h: highBits + Math.floor(address / 256), l: address % 256 });
        const cpu = new Cpu8008(ram, before);
        const record = cpu.step();
        const saved = structuredClone(record);
        assert.deepEqual(record, {
          before: snapshot(before), after: advanced(before, (pc + 2) % 0x4000), outcome: "executed",
          instruction: { address: pc, bytes: [0x3e, 0xff] },
          accesses: [{ kind: "read", address: pc, value: 0x3e },
            { kind: "read", address: (pc + 1) % 0x4000, value: 0xff }, { kind: "write", address, value: 0xff }],
        });
        assert.deepEqual(ram.accesses, record.accesses);
        assert.equal(ram.read(address), 0xff);
        ram.write(address, 0);
        cpu.reset();
        assert.deepEqual(record, saved);
      }
    }
  }
});

test("8008 memory loads use current RAM and the L changed by a preceding LLM", () => {
  const ram = new ObservedRam(0x4000);
  [0xc7, 0xf7, 0xc7].forEach((byte, offset) => ram.write(0x2000 + offset, byte));
  ram.write(0x80, 0x5a);
  const before = initialState({ h: 0xc0, l: 0x80 });
  const cpu = new Cpu8008(ram, before);
  const first = cpu.step();
  const saved = structuredClone(first);
  assert.deepEqual(first.after, advanced(before, 0x2001, { a: 0x5a }));
  ram.write(0x80, 0x81);
  ram.accesses.length = 0;
  const pointer = cpu.step();
  assert.deepEqual(pointer.after, advanced(before, 0x2002, { a: 0x5a, l: 0x81 }));
  assert.deepEqual(ram.accesses, [{ kind: "read", address: 0x2001, value: 0xf7 }, { kind: "read", address: 0x80, value: 0x81 }]);
  ram.write(0x81, 0xa5);
  ram.accesses.length = 0;
  const last = cpu.step();
  assert.deepEqual(last.after, advanced(before, 0x2003, { a: 0xa5, l: 0x81 }));
  assert.deepEqual(ram.accesses, [{ kind: "read", address: 0x2002, value: 0xc7 }, { kind: "read", address: 0x81, value: 0xa5 }]);
  cpu.reset();
  Reflect.set(last.after.addressStack, 3, 0);
  Reflect.set(last.after.flags, "s", false);
  assert.deepEqual(first, saved);
});

test("8008 ADI checks every operand pair, ignores incoming carry, and sets sign, zero, even parity, and carry", () => {
  const ram = new ObservedRam(0x4000);
  ram.write(0x2000, 0x04);
  for (const oldFlags of [flags(0), flags(15)]) {
    for (let a = 0; a < 256; a++) {
      for (let operand = 0; operand < 256; operand++) {
        const before = initialState({ a, flags: oldFlags });
        ram.write(0x2001, operand);
        ram.accesses.length = 0;
        const cpu = new Cpu8008(ram, before);
        const expected = { before: snapshot(before), after: advanced(before, 0x2002, addition(a, operand)),
          outcome: "executed", instruction: { address: 0x2000, bytes: [0x04, operand] },
          accesses: [{ kind: "read", address: 0x2000, value: 0x04 }, { kind: "read", address: 0x2001, value: operand }] };
        assert.deepEqual(cpu.step(), expected);
        assert.deepEqual(ram.accesses, expected.accesses);
      }
    }
  }
});

test("8008 ADI replaces every flag pattern at carry, parity, sign, and zero boundaries", () => {
  const ram = new Ram(0x4000);
  ram.write(0x3fff, 0x04);
  for (let bits = 0; bits < 16; bits++) {
    for (const [a, operand] of [[0, 0], [0, 1], [2, 3], [0x7f, 1], [0x80, 0x80], [0xff, 1], [0xff, 0xff]] as const) {
      ram.write(0, operand);
      const before = atPc(0x3fff, bits % 8, { a, flags: flags(bits) });
      assert.deepEqual(new Cpu8008(ram, before).step().after, advanced(before, 1, addition(a, operand)));
    }
  }
});

test("8008 LMA masks all H:L combinations to 14 bits and records unchanged-value and overlapping writes", () => {
  const ram = new ObservedRam(0x4000);
  for (let h = 0; h < 256; h++) {
    for (let l = 0; l < 256; l++) {
      const address = (h % 64) * 256 + l;
      const a = (h + l) % 256;
      // Initialize the destination to the same value; at 2000 the opcode takes precedence.
      ram.write(address, a);
      ram.write(0x2000, 0xf8);
      ram.accesses.length = 0;
      const before = initialState({ a, h, l, flags: flags(l % 16) });
      const cpu = new Cpu8008(ram, before);
      const expected = { before: snapshot(before), after: advanced(before, 0x2001), outcome: "executed",
        instruction: { address: 0x2000, bytes: [0xf8] },
        accesses: [{ kind: "read", address: 0x2000, value: 0xf8 }, { kind: "write", address, value: a }] };
      assert.deepEqual(cpu.step(), expected);
      assert.deepEqual(ram.accesses, expected.accesses);
      assert.equal(ram.read(address), a);
    }
  }
});

test("8008 LAM reads through all H:L combinations while retaining the raw pair and inactive PC slots", () => {
  const ram = new ObservedRam(0x4000);
  for (let h = 0; h < 256; h++) {
    for (let l = 0; l < 256; l++) {
      const address = (h % 64) * 256 + l;
      const value = address === 0x2000 ? 0xc7 : (h + l) % 256;
      ram.write(address, value);
      ram.write(0x2000, 0xc7);
      ram.accesses.length = 0;
      const before = atPc(0x2000, l % 8, { h, l, flags: flags(h % 16) });
      const accesses: Cpu8008MemoryAccess[] = [{ kind: "read", address: 0x2000, value: 0xc7 },
        { kind: "read", address, value }];
      assert.deepEqual(new Cpu8008(ram, before).step(), {
        before: snapshot(before), after: advanced(before, 0x2001, { a: value }), outcome: "executed",
        instruction: { address: 0x2000, bytes: [0xc7] }, accesses,
      });
      assert.deepEqual(ram.accesses, accesses);
    }
  }
});

test("8008 fetches wrap from every PC using the selected slot without changing the other seven", () => {
  const ram = new Ram(0x4000);
  for (let pc = 0; pc < 0x4000; pc++) {
    ram.write(pc, 0x06);
    ram.write((pc + 1) % 0x4000, 0xa5);
    const before = atPc(pc, pc % 8);
    const record = new Cpu8008(ram, before).step();
    assert.deepEqual(record.after, advanced(before, (pc + 2) % 0x4000, { a: 0xa5 }));
    assert.deepEqual(record.accesses, [{ kind: "read", address: pc, value: 0x06 },
      { kind: "read", address: (pc + 1) % 0x4000, value: 0xa5 }]);
  }
});

for (const [mnemonic, opcodes] of [
  ["JMP", [0x44, 0x4c, 0x54, 0x5c, 0x64, 0x6c, 0x74, 0x7c]],
  ["CAL", [0x46, 0x4e, 0x56, 0x5e, 0x66, 0x6e, 0x76, 0x7e]],
] as const) {
  test(`8008 ${mnemonic} aliases preserve every flag pattern and use 14-bit destinations and circular address slots`, () => {
    const ram = new ObservedRam(0x4000);
    // Literal byte-fetch positions, encoded destinations, and fall-through addresses.
    const cases = [
      [0x2000, 0x2001, 0x2002, 0x12, 0x23, 0x2312, 0x2003],
      [0x00fe, 0x00ff, 0x0100, 0x45, 0x40, 0x0045, 0x0101],
      [0x3ffd, 0x3ffe, 0x3fff, 0xfe, 0xbf, 0x3ffe, 0x0000],
      [0x3ffe, 0x3fff, 0x0000, 0xff, 0xff, 0x3fff, 0x0001],
      [0x3fff, 0x0000, 0x0001, 0x00, 0x80, 0x0000, 0x0002],
      [0x2000, 0x2001, 0x2002, 0x00, 0x20, 0x2000, 0x2003],
    ] as const;
    for (const opcode of opcodes) {
      for (let stackIndex = 0; stackIndex < 8; stackIndex++) {
        for (let bits = 0; bits < 16; bits++) {
          for (const [pc, lowAt, highAt, low, high, destination, returnAddress] of cases) {
            ram.write(pc, opcode);
            ram.write(lowAt, low);
            ram.write(highAt, high);
            ram.accesses.length = 0;
            const before = atPc(pc, stackIndex, { flags: flags(bits) });
            const addressStack: Cpu8008AddressStack = [...before.addressStack];
            const nextIndex = mnemonic === "CAL" ? [1, 2, 3, 4, 5, 6, 7, 0][stackIndex]! : stackIndex;
            addressStack[stackIndex] = returnAddress;
            addressStack[nextIndex] = destination;
            const after = snapshot({ ...before, addressStack, stackIndex: nextIndex });
            const expected = { before: snapshot(before), after, outcome: "executed",
              instruction: { address: pc, bytes: [opcode, low, high] },
              accesses: [{ kind: "read", address: pc, value: opcode },
                { kind: "read", address: lowAt, value: low }, { kind: "read", address: highAt, value: high }] };
            const cpu = new Cpu8008(ram, before);
            assert.deepEqual(cpu.step(), expected);
            assert.deepEqual(cpu.snapshot(), after);
            assert.deepEqual(ram.accesses, expected.accesses);
          }
        }
      }
    }
  });

  test(`8008 ${mnemonic} reaches every 14-bit address with each combination of ignored operand bits`, () => {
    const ram = new Ram(0x4000);
    ram.write(0x2000, opcodes[0]);
    for (let encoded = 0; encoded < 0x10000; encoded++) {
      ram.write(0x2001, encoded % 256);
      ram.write(0x2002, Math.floor(encoded / 256));
      const cpu = new Cpu8008(ram, initialState());
      assert.equal(cpu.step().after.pc, encoded % 0x4000);
    }
  });
}

test("8008 RET aliases select the previous physical slot and retain the advanced outgoing PC for every flag pattern", () => {
  const ram = new ObservedRam(0x4000);
  for (const opcode of [0x07, 0x0f, 0x17, 0x1f, 0x27, 0x2f, 0x37, 0x3f]) {
    for (let stackIndex = 0; stackIndex < 8; stackIndex++) {
      for (let bits = 0; bits < 16; bits++) {
        for (const [pc, nextPc] of [[0, 1], [0x2000, 0x2001], [0x3fff, 0]] as const) {
          ram.write(pc, opcode);
          ram.accesses.length = 0;
          const before = atPc(pc, stackIndex, { flags: flags(bits) });
          const addressStack: Cpu8008AddressStack = [...before.addressStack];
          addressStack[stackIndex] = nextPc;
          const previousIndex = [7, 0, 1, 2, 3, 4, 5, 6][stackIndex]!;
          const after = snapshot({ ...before, addressStack, stackIndex: previousIndex });
          const cpu = new Cpu8008(ram, before);
          const expected = { before: snapshot(before), after, outcome: "executed",
            instruction: { address: pc, bytes: [opcode] }, accesses: [{ kind: "read", address: pc, value: opcode }] };
          assert.deepEqual(cpu.step(), expected);
          assert.deepEqual(cpu.snapshot(), after);
          assert.deepEqual(ram.accesses, expected.accesses);
        }
      }
    }
  }
});

test("8008 eight nested calls overwrite the oldest return; unbalanced returns keep cycling without clearing slots", () => {
  const ram = new ObservedRam(0x4000);
  // Each subroutine calls the next, then returns. The eighth call reuses slot zero.
  for (const [caller, calleeHigh] of [
    [0x100, 2], [0x200, 3], [0x300, 4], [0x400, 5],
    [0x500, 6], [0x600, 7], [0x700, 8], [0x800, 9],
  ] as const) {
    ram.write(caller, 0x46);
    ram.write(caller + 1, 0);
    ram.write(caller + 2, calleeHigh);
    ram.write(caller + 3, 0x07);
  }
  ram.write(0x900, 0x07);
  ram.write(0x901, 0x07);
  ram.write(0x804, 0x07);
  ram.accesses.length = 0;
  const initial = atPc(0x100, 0);
  const cpu = new Cpu8008(ram, initial);
  const transitions: readonly (readonly [number, Cpu8008AddressStack])[] = [
    [1, [0x103, 0x200, 0x2333, 0x2000, 0x3444, 0x555, 0x1666, 0x3777]],
    [2, [0x103, 0x203, 0x300, 0x2000, 0x3444, 0x555, 0x1666, 0x3777]],
    [3, [0x103, 0x203, 0x303, 0x400, 0x3444, 0x555, 0x1666, 0x3777]],
    [4, [0x103, 0x203, 0x303, 0x403, 0x500, 0x555, 0x1666, 0x3777]],
    [5, [0x103, 0x203, 0x303, 0x403, 0x503, 0x600, 0x1666, 0x3777]],
    [6, [0x103, 0x203, 0x303, 0x403, 0x503, 0x603, 0x700, 0x3777]],
    [7, [0x103, 0x203, 0x303, 0x403, 0x503, 0x603, 0x703, 0x800]],
    [0, [0x900, 0x203, 0x303, 0x403, 0x503, 0x603, 0x703, 0x803]],
    [7, [0x901, 0x203, 0x303, 0x403, 0x503, 0x603, 0x703, 0x803]],
    [6, [0x901, 0x203, 0x303, 0x403, 0x503, 0x603, 0x703, 0x804]],
    [5, [0x901, 0x203, 0x303, 0x403, 0x503, 0x603, 0x704, 0x804]],
    [4, [0x901, 0x203, 0x303, 0x403, 0x503, 0x604, 0x704, 0x804]],
    [3, [0x901, 0x203, 0x303, 0x403, 0x504, 0x604, 0x704, 0x804]],
    [2, [0x901, 0x203, 0x303, 0x404, 0x504, 0x604, 0x704, 0x804]],
    [1, [0x901, 0x203, 0x304, 0x404, 0x504, 0x604, 0x704, 0x804]],
    [0, [0x901, 0x204, 0x304, 0x404, 0x504, 0x604, 0x704, 0x804]],
    [7, [0x902, 0x204, 0x304, 0x404, 0x504, 0x604, 0x704, 0x804]],
    [6, [0x902, 0x204, 0x304, 0x404, 0x504, 0x604, 0x704, 0x805]],
  ];
  let before = snapshot(initial);
  for (const [stackIndex, addressStack] of transitions) {
    const after = snapshot({ ...initial, stackIndex, addressStack });
    const bytes = before.pc < 0x900 && before.pc % 256 === 0 ? [0x46, 0, before.pc / 256 + 1] : [0x07];
    const accesses = bytes.map((value, offset) => ({ kind: "read", address: before.pc + offset, value }));
    ram.accesses.length = 0;
    assert.deepEqual(cpu.step(), { before, after, instruction: { address: before.pc, bytes }, outcome: "executed", accesses });
    assert.deepEqual(ram.accesses, accesses);
    before = after;
  }
});

for (const opcode of [0x00, 0x01, 0xff]) {
  test(`8008 documented HLT ${opcode.toString(16)} advances PC once, preserves flags, and stops further reads`, () => {
    const ram = new ObservedRam(0x4000);
    ram.write(0x3fff, opcode);
    for (let bits = 0; bits < 16; bits++) {
      const before = atPc(0x3fff, bits % 8, { flags: flags(bits) });
      ram.accesses.length = 0;
      const cpu = new Cpu8008(ram, before);
      const after = advanced(before, 0, { halted: true });
      const accesses = [{ kind: "read", address: 0x3fff, value: opcode }];
      assert.deepEqual(cpu.step(), { before: snapshot(before), after, outcome: "halted",
        instruction: { address: 0x3fff, bytes: [opcode] }, accesses });
      assert.deepEqual(cpu.step(), { before: after, after, instruction: null, accesses: [], outcome: "halted" });
      assert.deepEqual(ram.accesses, accesses);
    }
  });
}

test("8008 rejects every other opcode atomically, including conditional control flow, RST, and I/O", () => {
  const supported = new Set([
    0x00, 0x01, 0x04, 0x06, 0x07, 0x0e, 0x0f, 0x16, 0x17, 0x1e, 0x1f, 0x26, 0x27, 0x2e, 0x2f, 0x36, 0x37, 0x3e, 0x3f,
    0x44, 0x46, 0x4c, 0x4e, 0x54, 0x56, 0x5c, 0x5e, 0x64, 0x66, 0x6c, 0x6e, 0x74, 0x76, 0x7c, 0x7e,
    ...transferRows.flatMap(row => [...row.opcodes]),
  ]);
  assert.equal(supported.size, 99);
  const ram = new ObservedRam(0x4000);
  for (let opcode = 0; opcode < 256; opcode++) {
    if (supported.has(opcode)) continue;
    ram.write(0x3fff, opcode);
    ram.write(0, 0xa5);
    const before = atPc(0x3fff, opcode % 8);
    const cpu = new Cpu8008(ram, before);
    const expected = { before: snapshot(before), after: snapshot(before), outcome: "unsupported", reason: "opcode",
      instruction: { address: 0x3fff, bytes: [opcode] }, accesses: [{ kind: "read", address: 0x3fff, value: opcode }] };
    for (let attempt = 0; attempt < 2; attempt++) {
      ram.accesses.length = 0;
      assert.deepEqual(cpu.step(), expected);
      assert.deepEqual(ram.accesses, expected.accesses);
    }
  }
});

test("8008 reset clears registers and address stack, selects slot zero, preserves unspecified flags and RAM, and stays stopped", () => {
  const ram = new ObservedRam(0x4000);
  ram.write(0, 0x06);
  ram.write(0x3fff, 0xab);
  ram.accesses.length = 0;
  for (const halted of [false, true]) {
    for (let bits = 0; bits < 16; bits++) {
      const before = initialState({ halted, flags: flags(bits), stackIndex: bits % 8 });
      const cpu = new Cpu8008(ram, before);
      const after = snapshot({ a: 0, b: 0, c: 0, d: 0, e: 0, h: 0, l: 0, flags: flags(bits),
        addressStack: [0, 0, 0, 0, 0, 0, 0, 0], stackIndex: 0, halted: true });
      const record = cpu.reset();
      assert.deepEqual(record, { before: snapshot(before), after, accesses: [] });
      assert.deepEqual(cpu.reset(), { before: after, after, accesses: [] });
      assert.deepEqual(cpu.step(), { before: after, after, instruction: null, accesses: [], outcome: "halted" });
      Reflect.set(record.after.addressStack, 0, 0x1111);
      Reflect.set(record.after.flags, "s", !after.flags.s);
      assert.deepEqual(cpu.snapshot(), after);
    }
  }
  assert.deepEqual(ram.accesses, []);
  assert.equal(ram.read(0), 0x06);
  assert.equal(ram.read(0x3fff), 0xab);
});

test("8008 executes current operands and self-modified code while retaining detached records", () => {
  const ram = new Ram(0x4000);
  // Patch LAI to load FF, then LMA overwrites ADI with the HLT FF encoding.
  for (const [offset, byte] of [0x06, 0x01, 0xf8, 0x04, 0x02, 0x00].entries()) ram.write(0x2000 + offset, byte);
  const cpu = new Cpu8008(ram, initialState({ h: 0xe0, l: 3 }));
  ram.write(0x2001, 0xff);
  const load = cpu.step();
  assert.equal(load.after.a, 0xff);
  const store = cpu.step();
  assert.deepEqual(store.accesses, [{ kind: "read", address: 0x2002, value: 0xf8 },
    { kind: "write", address: 0x2003, value: 0xff }]);
  const saved = structuredClone([load, store]);
  assert.deepEqual(cpu.step().instruction, { address: 0x2003, bytes: [0xff] });
  cpu.reset();
  ram.write(0x2001, 0);
  assert.deepEqual([load, store], saved);
  Reflect.set(load.after.addressStack, 3, 0);
  assert.equal(store.before.pc, 0x2002);
  assert.equal(store.before.addressStack[3], 0x2002);
});
