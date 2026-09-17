import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu8008 } from "../../../src/components/cpus/8008.js";
import type { Cpu8008AddressStack, Cpu8008Flags, Cpu8008MemoryAccess, Cpu8008Snapshot, Cpu8008State } from "../../../src/components/cpus/8008.js";
import type { PortAccess } from "../../../src/components/cpus/port-access.ts";
import { runCpu } from "../../../src/runtime/run-cpu.js";
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

function interruptBytes(cpu: Cpu8008, ...bytes: number[]) {
  let index = 0;
  const record = cpu.interrupt(() => {
    assert.ok(index < bytes.length, "No extra acknowledgement");
    return bytes[index++]!;
  });
  assert.equal(index, bytes.length, "Every supplied byte is used");
  assert.deepEqual(record.instruction, { source: "interrupt", bytes });
  return record;
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

// Literal rows from Intel's ALU table; register columns are A/B/C/D/E/H/L/M.
const aluRows = [
  { operation: "add", immediate: 0x04, opcodes: [0x80, 0x81, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87] },
  { operation: "adc", immediate: 0x0c, opcodes: [0x88, 0x89, 0x8a, 0x8b, 0x8c, 0x8d, 0x8e, 0x8f] },
  { operation: "sub", immediate: 0x14, opcodes: [0x90, 0x91, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97] },
  { operation: "sbb", immediate: 0x1c, opcodes: [0x98, 0x99, 0x9a, 0x9b, 0x9c, 0x9d, 0x9e, 0x9f] },
  { operation: "and", immediate: 0x24, opcodes: [0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7] },
  { operation: "xor", immediate: 0x2c, opcodes: [0xa8, 0xa9, 0xaa, 0xab, 0xac, 0xad, 0xae, 0xaf] },
  { operation: "or", immediate: 0x34, opcodes: [0xb0, 0xb1, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7] },
  { operation: "compare", immediate: 0x3c, opcodes: [0xb8, 0xb9, 0xba, 0xbb, 0xbc, 0xbd, 0xbe, 0xbf] },
] as const;
type AluOperation = typeof aluRows[number]["operation"];

// Intel's port selectors in numeric order: inputs 00..07, outputs 08..1F.
const inputOpcodes = [0x41, 0x43, 0x45, 0x47, 0x49, 0x4b, 0x4d, 0x4f];
const outputOpcodes = [
  0x51, 0x53, 0x55, 0x57, 0x59, 0x5b, 0x5d, 0x5f,
  0x61, 0x63, 0x65, 0x67, 0x69, 0x6b, 0x6d, 0x6f,
  0x71, 0x73, 0x75, 0x77, 0x79, 0x7b, 0x7d, 0x7f,
];

// Literal encodings and truth conditions from Intel's instruction table.
const conditions = [
  { flag: "c", value: false, jump: 0x40, call: 0x42, ret: 0x03 },
  { flag: "z", value: false, jump: 0x48, call: 0x4a, ret: 0x0b },
  { flag: "s", value: false, jump: 0x50, call: 0x52, ret: 0x13 },
  { flag: "p", value: false, jump: 0x58, call: 0x5a, ret: 0x1b },
  { flag: "c", value: true, jump: 0x60, call: 0x62, ret: 0x23 },
  { flag: "z", value: true, jump: 0x68, call: 0x6a, ret: 0x2b },
  { flag: "s", value: true, jump: 0x70, call: 0x72, ret: 0x33 },
  { flag: "p", value: true, jump: 0x78, call: 0x7a, ret: 0x3b },
] as const;

// Literal encodings from Intel's index-register, rotate, and restart tables.
const adjustments = [
  { register: "b", increment: 0x08, decrement: 0x09 },
  { register: "c", increment: 0x10, decrement: 0x11 },
  { register: "d", increment: 0x18, decrement: 0x19 },
  { register: "e", increment: 0x20, decrement: 0x21 },
  { register: "h", increment: 0x28, decrement: 0x29 },
  { register: "l", increment: 0x30, decrement: 0x31 },
] as const;
const rotations = [
  { mnemonic: "RLC", opcode: 0x02, direction: "left", throughCarry: false },
  { mnemonic: "RRC", opcode: 0x0a, direction: "right", throughCarry: false },
  { mnemonic: "RAL", opcode: 0x12, direction: "left", throughCarry: true },
  { mnemonic: "RAR", opcode: 0x1a, direction: "right", throughCarry: true },
] as const;
const restarts = [
  { opcode: 0x05, address: 0x00 }, { opcode: 0x0d, address: 0x08 },
  { opcode: 0x15, address: 0x10 }, { opcode: 0x1d, address: 0x18 },
  { opcode: 0x25, address: 0x20 }, { opcode: 0x2d, address: 0x28 },
  { opcode: 0x35, address: 0x30 }, { opcode: 0x3d, address: 0x38 },
] as const;

// Independent oracle: decimal ranges, logical truth tables, and binary-digit counts.
function alu(operation: AluOperation, a: number, operand: number, carry: boolean) {
  let total: number;
  switch (operation) {
    case "add": total = a + operand; break;
    case "adc": total = a + operand + Number(carry); break;
    case "sub": case "compare": total = a - operand; break;
    case "sbb": total = a - operand - Number(carry); break;
    default: {
      const left = a.toString(2).padStart(8, "0");
      const right = operand.toString(2).padStart(8, "0");
      total = Number.parseInt([...left].map((digit, index) => {
        const l = digit === "1", r = right[index] === "1";
        return Number(operation === "and" ? l && r : operation === "xor" ? l !== r : l || r);
      }).join(""), 2);
    }
  }
  const result = ((total % 256) + 256) % 256;
  const ones = [...result.toString(2)].filter(bit => bit === "1").length;
  return { a: operation === "compare" ? a : result,
    flags: { s: result >= 128, z: result === 0, p: ones % 2 === 0, c: total < 0 || total >= 256 } };
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

for (const { operation, immediate, opcodes } of aluRows) {
  test(`8008 immediate ${operation} checks every byte pair and both carry inputs against independent arithmetic`, () => {
    const ram = new ObservedRam(0x4000);
    ram.write(0x3fff, immediate);
    for (const oldFlags of [flags(0), flags(15)]) {
      for (let a = 0; a < 256; a++) {
        for (let operand = 0; operand < 256; operand++) {
          const before = atPc(0x3fff, operand % 8, { a, flags: oldFlags });
          ram.write(0, operand);
          ram.accesses.length = 0;
          const expected = { before: snapshot(before), after: advanced(before, 1, alu(operation, a, operand, oldFlags.c)),
            outcome: "executed", instruction: { address: 0x3fff, bytes: [immediate, operand] },
            accesses: [{ kind: "read", address: 0x3fff, value: immediate }, { kind: "read", address: 0, value: operand }] };
          assert.deepEqual(new Cpu8008(ram, before).step(), expected);
          assert.deepEqual(ram.accesses, expected.accesses);
        }
      }
    }
  });

  test(`8008 ${operation} covers every source byte, all flags, and the accumulator self-source at arithmetic boundaries`, () => {
    const ram = new ObservedRam(0x4000);
    // Add the immediate to the eight literal source encodings to check all 72 forms.
    for (const [column, source] of [...transferColumns, "immediate" as const].entries()) {
      const opcode = source === "immediate" ? immediate : opcodes[column]!;
      for (let bits = 0; bits < 16; bits++) {
        for (let operand = 0; operand < 256; operand++) {
          for (const a of [0, 1, 0x7f, 0x80, 0xff]) {
            const before = atPc(0x3fff, bits % 8, { a, flags: flags(bits) });
            if (source !== "immediate" && source !== "m") before[source] = operand;
            const address = (before.h % 64) * 256 + before.l;
            ram.write(address, operand);
            ram.write(0, operand);
            ram.write(0x3fff, opcode);
            ram.accesses.length = 0;
            const value = source === "a" ? before.a : operand;
            const accesses: Cpu8008MemoryAccess[] = [{ kind: "read", address: 0x3fff, value: opcode }];
            if (source === "m") accesses.push({ kind: "read", address, value });
            if (source === "immediate") accesses.push({ kind: "read", address: 0, value });
            const expected = { before: snapshot(before),
              after: advanced(before, source === "immediate" ? 1 : 0, alu(operation, before.a, value, before.flags.c)),
              outcome: "executed", instruction: { address: 0x3fff, bytes: source === "immediate" ? [opcode, value] : [opcode] }, accesses };
            assert.deepEqual(new Cpu8008(ram, before).step(), expected);
            assert.deepEqual(ram.accesses, accesses);
          }
        }
      }
    }
  });
}

test("8008 memory ALU forms mask H:L, keep code reads distinct, and never write through the operand", () => {
  const ram = new ObservedRam(0x4000);
  for (const { operation, opcodes } of aluRows) {
    const opcode = opcodes[7];
    for (const pc of [0, 0x2000, 0x3fff]) {
      for (const address of [0, 0xff, 0x100, 0x3fff, pc, (pc + 1) % 0x4000]) {
        for (const highBits of [0, 0x40, 0x80, 0xc0]) {
          for (const carry of [false, true]) {
            const before = atPc(pc, highBits / 64, { a: 0x7f, h: highBits + Math.floor(address / 256), l: address % 256,
              flags: { s: true, z: true, p: false, c: carry } });
            ram.write(address, 0xff);
            ram.write(pc, opcode);
            ram.accesses.length = 0;
            const value = address === pc ? opcode : 0xff;
            const expected = { before: snapshot(before), after: advanced(before, (pc + 1) % 0x4000, alu(operation, 0x7f, value, carry)),
              outcome: "executed", instruction: { address: pc, bytes: [opcode] },
              accesses: [{ kind: "read", address: pc, value: opcode }, { kind: "read", address, value }] };
            assert.deepEqual(new Cpu8008(ram, before).step(), expected);
            assert.deepEqual(ram.accesses, expected.accesses);
            assert.equal(ram.read(address), value);
          }
        }
      }
    }
  }
});

test("8008 ALU forms retain completed reads and native address slots at every ordinary or supplied failure", () => {
  const failure = new Error("ALU access failure");
  for (const { operation, immediate, opcodes } of aluRows) {
    for (const [index, source] of [...transferColumns, "immediate" as const].entries()) for (const external of [false, true]) {
      for (let slot = 0; slot < 8; slot++) for (const bits of [0, 15]) for (const address of [0, 0x3fff]) {
        const opcode = source === "immediate" ? immediate : opcodes[index]!;
        const bytes = source === "immediate" ? [opcode, 0x81] : [opcode], count = bytes.length + Number(source === "m");
        for (let failAt = -1; failAt < count; failAt++) {
          let attempts = 0;
          const completed: ({ kind: "acknowledge"; value: number } | Cpu8008MemoryAccess)[] = [];
          const attempt = () => { if (attempts++ === failAt) throw failure; };
          class FaultRam extends ObservedRam {
            override read(address: number): number {
              attempt(); const value = super.read(address); completed.push({ kind: "read", address, value }); return value;
            }
          }
          const ram = new FaultRam(0x4000), state = atPc(0x3fff, slot, {
            h: (slot % 4) * 64 + Math.floor(address / 256), l: address % 256, flags: flags(bits), halted: external });
          ram.write(address, 0x81);
          if (!external) bytes.forEach((value, i) => ram.write((0x3fff + i) % 0x4000, value));
          ram.accesses.length = 0;
          const cpu = new Cpu8008(ram, state);
          const overlap = external ? -1 : bytes.findIndex((_, i) => (0x3fff + i) % 0x4000 === address);
          const operand = source === "immediate" ? 0x81 : source === "m" ? (overlap < 0 ? 0x81 : bytes[overlap]!) : state[source];
          const accesses = [
            ...bytes.map((value, i) => external ? { kind: "acknowledge", value }
              : { kind: "read", address: (0x3fff + i) % 0x4000, value }),
            ...(source === "m" ? [{ kind: "read", address, value: operand }] : []),
          ];
          const run = () => {
            let next = 0;
            return external ? cpu.interrupt(() => {
              attempt(); const value = bytes[next++]!; completed.push({ kind: "acknowledge", value }); return value;
            }) : cpu.step();
          };
          if (failAt >= 0) assert.throws(run, error => error === failure);
          else {
            const record = run();
            assert.equal(record.outcome, "executed"); assert.deepEqual(record.accesses, accesses);
            assert.deepEqual(record.instruction?.bytes, bytes);
          }
          const fetched = failAt < 0 ? bytes.length : Math.min(failAt, bytes.length);
          assert.deepEqual(cpu.snapshot(), advanced(state, external ? 0x3fff : (0x3fff + fetched) % 0x4000,
            { halted: false, ...(failAt < 0 ? alu(operation, state.a, operand, state.flags.c) : {}) }),
          `${operation} ${source}, supplied=${external}, slot=${slot}, fail=${failAt}`);
          assert.deepEqual(completed, accesses.slice(0, failAt < 0 ? count : failAt));
          assert.deepEqual(ram.accesses, completed.filter(access => access.kind === "read"));
          assert.equal(attempts, failAt < 0 ? count : failAt + 1);
          if (failAt >= 0) { cpu.reset(); assert.equal(cpu.snapshot().pc, 0); }
        }
      }
    }
  }
});

for (const { register, increment, decrement } of adjustments) {
  test(`8008 IN${register.toUpperCase()}/DC${register.toUpperCase()} cover every byte and flag pattern, preserving carry and wrapping only the selected register`, () => {
    const ram = new ObservedRam(0x4000);
    for (const opcode of [increment, decrement]) {
      ram.write(0x3fff, opcode);
      for (let value = 0; value < 256; value++) {
        const result = opcode === increment ? (value + 1) % 256 : (value + 255) % 256;
        const ones = [...result.toString(2)].filter(bit => bit === "1").length;
        for (let bits = 0; bits < 16; bits++) {
          const before = atPc(0x3fff, bits % 8, { [register]: value, flags: flags(bits) });
          const after = advanced(before, 0, { [register]: result,
            flags: { s: result >= 128, z: result === 0, p: ones % 2 === 0, c: before.flags.c } });
          const cpu = new Cpu8008(ram, before);
          ram.accesses.length = 0;
          const expected = { before: snapshot(before), after, outcome: "executed",
            instruction: { address: 0x3fff, bytes: [opcode] }, accesses: [{ kind: "read", address: 0x3fff, value: opcode }] };
          assert.deepEqual(cpu.step(), expected);
          assert.deepEqual(cpu.snapshot(), after);
          assert.deepEqual(ram.accesses, expected.accesses);
        }
      }
    }
  });
}

for (const { mnemonic, opcode, direction, throughCarry } of rotations) {
  test(`8008 ${mnemonic} covers every accumulator and flag pattern against bit-string rotation, preserving S/Z/P`, () => {
    const ram = new ObservedRam(0x4000);
    ram.write(0x3fff, opcode);
    for (let a = 0; a < 256; a++) {
      const binary = a.toString(2).padStart(8, "0");
      const outgoing = direction === "left" ? binary[0]! : binary[7]!;
      for (let bits = 0; bits < 16; bits++) {
        const before = atPc(0x3fff, bits % 8, { a, flags: flags(bits) });
        const incoming = throughCarry ? String(Number(before.flags.c)) : outgoing;
        const rotated = direction === "left" ? binary.slice(1) + incoming : incoming + binary.slice(0, 7);
        const after = advanced(before, 0, { a: Number.parseInt(rotated, 2), flags: { ...before.flags, c: outgoing === "1" } });
        const cpu = new Cpu8008(ram, before);
        ram.accesses.length = 0;
        const expected = { before: snapshot(before), after, outcome: "executed",
          instruction: { address: 0x3fff, bytes: [opcode] }, accesses: [{ kind: "read", address: 0x3fff, value: opcode }] };
        assert.deepEqual(cpu.step(), expected);
        assert.deepEqual(cpu.snapshot(), after);
        assert.deepEqual(ram.accesses, expected.accesses);
      }
    }
  });
}

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

for (const family of ["jump", "call"] as const) {
  test(`8008 conditional ${family} covers every condition, flag pattern, slot, and address alias on both paths`, () => {
    const ram = new ObservedRam(0x4000);
    // PC, operand locations, low/high bytes, destination, and fall-through PC.
    const cases = [
      [0x2000, 0x2001, 0x2002, 0x12, 0x23, 0x2312, 0x2003],
      [0x00fe, 0x00ff, 0x0100, 0xff, 0x00, 0x00ff, 0x0101],
      [0x3ffd, 0x3ffe, 0x3fff, 0xfe, 0x3f, 0x3ffe, 0x0000],
      [0x3ffe, 0x3fff, 0x0000, 0xff, 0x3f, 0x3fff, 0x0001],
      [0x3fff, 0x0000, 0x0001, 0x00, 0x00, 0x0000, 0x0002],
      [0x2000, 0x2001, 0x2002, 0x00, 0x20, 0x2000, 0x2003],
    ] as const;
    for (const condition of conditions) {
      const opcode = condition[family];
      for (let bits = 0; bits < 16; bits++) {
        for (let stackIndex = 0; stackIndex < 8; stackIndex++) {
          for (const [pc, lowAt, highAt, low, high, destination, fallThrough] of cases) {
            for (const ignoredBits of [0, 0x40, 0x80, 0xc0]) {
              ram.write(pc, opcode);
              ram.write(lowAt, low);
              ram.write(highAt, high + ignoredBits);
              ram.accesses.length = 0;
              const before = atPc(pc, stackIndex, { flags: flags(bits) });
              const taken = before.flags[condition.flag] === condition.value;
              const nextIndex = taken && family === "call" ? [1, 2, 3, 4, 5, 6, 7, 0][stackIndex]! : stackIndex;
              const addressStack: Cpu8008AddressStack = [...before.addressStack];
              addressStack[stackIndex] = fallThrough;
              if (taken) addressStack[nextIndex] = destination;
              const after = snapshot({ ...before, addressStack, stackIndex: nextIndex });
              const expected = { before: snapshot(before), after, outcome: "executed",
                instruction: { address: pc, bytes: [opcode, low, high + ignoredBits] },
                accesses: [{ kind: "read", address: pc, value: opcode }, { kind: "read", address: lowAt, value: low },
                  { kind: "read", address: highAt, value: high + ignoredBits }] };
              const cpu = new Cpu8008(ram, before);
              assert.deepEqual(cpu.step(), expected);
              assert.deepEqual(cpu.snapshot(), after);
              assert.deepEqual(ram.accesses, expected.accesses);
            }
          }
        }
      }
    }
  });
}

test("8008 conditional returns cover all conditions, flags, and slots, retaining the advanced outgoing PC only in its own slot", () => {
  const ram = new ObservedRam(0x4000);
  for (const { flag, value, ret: opcode } of conditions) {
    for (let bits = 0; bits < 16; bits++) {
      for (let stackIndex = 0; stackIndex < 8; stackIndex++) {
        for (const [pc, fallThrough] of [[0, 1], [0x2000, 0x2001], [0x3fff, 0]] as const) {
          for (const destination of [0, 0x2000, 0x3fff, pc, fallThrough]) {
            const before = atPc(pc, stackIndex, { flags: flags(bits) });
            const previousIndex = [7, 0, 1, 2, 3, 4, 5, 6][stackIndex]!;
            const originalSlots: Cpu8008AddressStack = [...before.addressStack];
            originalSlots[previousIndex] = destination;
            before.addressStack = originalSlots;
            const nextIndex = before.flags[flag] === value ? previousIndex : stackIndex;
            const addressStack: Cpu8008AddressStack = [...originalSlots];
            addressStack[stackIndex] = fallThrough;
            const after = snapshot({ ...before, addressStack, stackIndex: nextIndex });
            ram.write(pc, opcode);
            ram.accesses.length = 0;
            const expected = { before: snapshot(before), after, outcome: "executed",
              instruction: { address: pc, bytes: [opcode] }, accesses: [{ kind: "read", address: pc, value: opcode }] };
            const cpu = new Cpu8008(ram, before);
            assert.deepEqual(cpu.step(), expected);
            assert.deepEqual(cpu.snapshot(), after);
            assert.deepEqual(ram.accesses, expected.accesses);
          }
        }
      }
    }
  }
});

test("8008 conditional jumps reread edited addresses and current flags while retaining earlier records", () => {
  const ram = new ObservedRam(0x4000);
  // JFZ loops to itself, then is redirected to XRA; XRA changes Z before the next JFZ.
  for (const [address, value] of [[0x2000, 0x48], [0x2001, 0], [0x2002, 0xe0], [0x2100, 0xa8],
    [0x2101, 0x48], [0x2102, 0], [0x2103, 0xc0]] as const) ram.write(address, value);
  const before = initialState();
  const cpu = new Cpu8008(ram, before);
  const first = cpu.step();
  const saved = structuredClone(first);
  assert.deepEqual(first, { before: snapshot(before), after: snapshot(before), outcome: "executed",
    instruction: { address: 0x2000, bytes: [0x48, 0, 0xe0] },
    accesses: [{ kind: "read", address: 0x2000, value: 0x48 }, { kind: "read", address: 0x2001, value: 0 },
      { kind: "read", address: 0x2002, value: 0xe0 }] });
  ram.write(0x2002, 0xe1);
  assert.equal(cpu.step().after.pc, 0x2100);
  assert.equal(cpu.step().after.flags.z, true);
  const changed = cpu.snapshot();
  ram.accesses.length = 0;
  const expected = { before: changed, after: advanced(changed, 0x2104), outcome: "executed",
    instruction: { address: 0x2101, bytes: [0x48, 0, 0xc0] },
    accesses: [{ kind: "read", address: 0x2101, value: 0x48 }, { kind: "read", address: 0x2102, value: 0 },
      { kind: "read", address: 0x2103, value: 0xc0 }] };
  assert.deepEqual(cpu.step(), expected);
  assert.deepEqual(ram.accesses, expected.accesses);
  const reset = cpu.reset();
  Reflect.set(reset.before.flags, "z", false);
  Reflect.set(reset.before.addressStack, 3, 0);
  assert.deepEqual(first, saved);
});

test("8008 RST covers every vector, flag pattern, and stack slot with one-byte fetches, wrapping, and overlapping targets", () => {
  const ram = new ObservedRam(0x4000);
  for (const { opcode, address } of restarts) {
    for (const pc of [0, address, address + 1, 0xff, 0x100, 0x3ffe, 0x3fff]) {
      ram.write(pc, opcode);
      for (let stackIndex = 0; stackIndex < 8; stackIndex++) {
        for (let bits = 0; bits < 16; bits++) {
          const before = atPc(pc, stackIndex, { flags: flags(bits) });
          const nextIndex = [1, 2, 3, 4, 5, 6, 7, 0][stackIndex]!;
          const addressStack: Cpu8008AddressStack = [...before.addressStack];
          addressStack[stackIndex] = pc === 0x3fff ? 0 : pc + 1;
          addressStack[nextIndex] = address;
          const after = snapshot({ ...before, addressStack, stackIndex: nextIndex });
          const cpu = new Cpu8008(ram, before);
          ram.accesses.length = 0;
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

test("8008 RST reaches every vector from every PC and RET uses the one-byte return address", () => {
  const ram = new Ram(0x4000);
  for (const { opcode, address } of restarts) {
    for (let pc = 0; pc < 0x4000; pc++) {
      ram.write(pc, opcode);
      const before = atPc(pc, pc % 8);
      const cpu = new Cpu8008(ram, before);
      const call = cpu.step();
      assert.equal(call.after.pc, address);
      const returnAddress = (pc + 1) % 0x4000;
      assert.equal(call.after.addressStack[before.stackIndex], returnAddress);
      // RAM may be edited at the target, even if it held the RST just fetched.
      ram.write(address, 0x07);
      const returned = cpu.step();
      assert.equal(returned.outcome, "executed");
      assert.equal(returned.after.stackIndex, before.stackIndex);
      assert.equal(returned.after.pc, returnAddress);
      assert.equal(returned.after.addressStack[call.after.stackIndex], address + 1);
      assert.deepEqual(call.instruction, { address: pc, bytes: [opcode] });
    }
  }
});

test("8008 eight nested RST calls overwrite the oldest return and leave advanced slots intact on return", () => {
  const ram = new ObservedRam(0x4000);
  ram.write(0x100, 0x05); // RST 00H
  for (const [address, opcode] of [[0, 0x0d], [8, 0x15], [0x10, 0x1d], [0x18, 0x25],
    [0x20, 0x2d], [0x28, 0x35], [0x30, 0x3d]] as const) {
    ram.write(address, opcode);
    ram.write(address + 1, 0x07);
  }
  ram.write(0x38, 0x07);
  const initial = atPc(0x100, 0);
  const cpu = new Cpu8008(ram, initial);
  ram.accesses.length = 0;
  const records = Array.from({ length: 8 }, () => cpu.step());
  const saved = structuredClone(records);
  assert.deepEqual(cpu.snapshot(), snapshot({ ...initial, stackIndex: 0,
    addressStack: [0x38, 1, 9, 0x11, 0x19, 0x21, 0x29, 0x31] }));
  assert.deepEqual(ram.accesses, [
    [0x100, 0x05], [0, 0x0d], [8, 0x15], [0x10, 0x1d],
    [0x18, 0x25], [0x20, 0x2d], [0x28, 0x35], [0x30, 0x3d],
  ].map(([address, value]) => ({ kind: "read", address, value })));
  for (const pc of [0x31, 0x29, 0x21, 0x19, 0x11, 9, 1, 0x39]) {
    ram.accesses.length = 0;
    const before = cpu.snapshot();
    const record = cpu.step();
    assert.equal(record.outcome, "executed");
    assert.equal(record.after.pc, pc);
    assert.deepEqual(record.accesses, [{ kind: "read", address: before.pc, value: 0x07 }]);
    assert.deepEqual(ram.accesses, record.accesses);
  }
  assert.deepEqual(cpu.snapshot(), snapshot({ ...initial, stackIndex: 0,
    addressStack: [0x39, 2, 0x0a, 0x12, 0x1a, 0x22, 0x2a, 0x32] }));
  assert.deepEqual(records, saved);
});

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

for (const [index, opcode] of [...inputOpcodes, ...outputOpcodes].entries()) {
  const input = index < 8;
  test(`8008 ${input ? "INP" : "OUT"} port ${index} transfers every byte, preserves flags and slots, and fetches only its opcode`, () => {
    const ram = new ObservedRam(0x4000);
    for (const pc of [0x1fff, 0x3fff]) ram.write(pc, opcode);
    for (let value = 0; value < 256; value++) {
      const pc = value % 2 ? 0x3fff : 0x1fff;
      const next = pc === 0x3fff ? 0 : 0x2000;
      const before = atPc(pc, value % 8, { a: input ? 255 - value : value, flags: flags(value % 16) });
      const transfers: PortAccess[] = [];
      const fetches = [{ kind: "read", address: pc, value: opcode }];
      const cpu = new Cpu8008(ram, before, {
        readPort: port => {
          assert.equal(input, true);
          assert.deepEqual(ram.accesses, fetches);
          assert.deepEqual(cpu.snapshot(), advanced(before, next));
          transfers.push({ kind: "input", port, value });
          return value;
        },
        writePort: (port, byte) => {
          assert.equal(input, false);
          assert.deepEqual(ram.accesses, fetches);
          assert.deepEqual(cpu.snapshot(), advanced(before, next));
          transfers.push({ kind: "output", port, value: byte });
        },
      });
      ram.accesses.length = 0;
      const transfer = { kind: input ? "input" : "output", port: index, value };
      assert.deepEqual(cpu.step(), {
        before: snapshot(before), after: advanced(before, next, { a: value }), outcome: "executed",
        instruction: { address: pc, bytes: [opcode] }, accesses: [...fetches, transfer],
      });
      assert.deepEqual(transfers, [transfer]);
      assert.deepEqual(ram.accesses, fetches);
    }
  });
}

test("8008 port callbacks see live A and device state; repeated transfers retain separate records", () => {
  const ram = new Ram(0x4000);
  [0x41, 0x51, 0x41, 0x51, 0x41, 0x51].forEach((byte, i) => ram.write(0x2000 + i, byte));
  let incoming = 0x81;
  const outgoing: number[] = [];
  const cpu = new Cpu8008(ram, initialState(), {
    readPort: () => incoming,
    writePort: (_, value) => { outgoing.push(value); incoming = 0x42; },
  });
  const first = cpu.step(); // Loading A with its existing value is still a transfer.
  const retained = structuredClone(first);
  cpu.step();
  cpu.step();
  cpu.step();
  assert.deepEqual(outgoing, [0x81, 0x42]);
  assert.deepEqual(first, retained);
  Reflect.set(first.accesses[1]!, "value", 0xff);
  Reflect.set(first.after.addressStack, 3, 0);
  const next = cpu.step();
  assert.equal(next.after.a, 0x42);
  assert.equal(next.after.pc, 0x2005);
  assert.deepEqual(next.accesses[1], { kind: "input", port: 0, value: 0x42 });
});

for (const opcode of [0x41, 0x7f]) {
  test(`8008 port ${opcode.toString(16)} failures retain the completed fetch and propagate without a record`, () => {
    const error = new Error("Device failed after an external effect");
    for (const connected of [false, true]) {
      const ram = new ObservedRam(0x4000);
      ram.write(0x3fff, opcode);
      ram.write(0, 0xc0); // LAA is available after a failed transfer.
      const before = atPc(0x3fff, 7);
      let effects = 0;
      const fail = (): never => { effects++; throw error; };
      const cpu = new Cpu8008(ram, before, connected ? { readPort: fail, writePort: fail } : undefined);
      ram.accesses.length = 0;
      assert.throws(() => cpu.step(), connected ? error : /Port I\/O requires a connected device/);
      assert.equal(effects, connected ? 1 : 0);
      assert.deepEqual(cpu.snapshot(), advanced(before, 0));
      assert.deepEqual(ram.accesses, [{ kind: "read", address: 0x3fff, value: opcode }]);
      assert.equal(cpu.step().outcome, "executed"); // A thrown callback releases the guard.
      assert.equal(cpu.snapshot().pc, 1);
    }
  });
}

test("8008 rejects invalid input bytes without replacing A or rolling back device effects", () => {
  for (const value of [-1, 256, 1.5, NaN, Infinity, -Infinity]) {
    const ram = new Ram(0x4000);
    ram.write(0x3fff, 0x4f);
    const before = atPc(0x3fff);
    let reads = 0;
    const cpu = new Cpu8008(ram, before, {
      readPort: () => { reads++; return value; }, writePort: () => assert.fail("Unexpected output"),
    });
    assert.throws(() => cpu.step(), /Port input byte/);
    assert.equal(reads, 1);
    assert.deepEqual(cpu.snapshot(), advanced(before, 0));
    cpu.reset();
  }
});

test("8008 construction, inspection, halted steps, undefined opcodes, and reset never call ports", () => {
  const ram = new ObservedRam(0x4000);
  ram.write(0x2000, 0x41);
  const forbidden = (): never => assert.fail("Unexpected port access");
  const cpu = new Cpu8008(ram, initialState({ halted: true }), { readPort: forbidden, writePort: forbidden });
  ram.accesses.length = 0;
  cpu.snapshot();
  cpu.step();
  cpu.reset();
  cpu.step();
  assert.deepEqual(ram.accesses, []);
  ram.write(0, 0x22);
  const restored = new Cpu8008(ram, { ...cpu.snapshot(), halted: false }, { readPort: forbidden, writePort: forbidden });
  assert.equal(restored.step().outcome, "unsupported");
});

for (const opcode of [0x41, 0x51]) {
  test(`8008 port ${opcode.toString(16)} callbacks may inspect state but cannot nest step, reset, or interrupt`, () => {
    const ram = new Ram(0x4000);
    ram.write(0x2000, opcode);
    const before = initialState();
    const transfer = (): number => {
      const during = cpu.snapshot();
      assert.deepEqual(during, advanced(before, 0x2001));
      for (const mutate of [() => cpu.step(), () => cpu.reset(), () => cpu.interrupt(() => 0xc0)]) {
        assert.throws(mutate, /must not be reentrant/);
        assert.deepEqual(cpu.snapshot(), during);
      }
      return 0xa5;
    };
    const cpu = new Cpu8008(ram, before, { readPort: transfer, writePort: transfer });
    assert.equal(cpu.step().outcome, "executed");
    assert.equal(cpu.reset().after.halted, true);
  });
}

test("8008 ports combine with wrapped calls and arithmetic, and resume with an explicitly reconnected device", () => {
  const create = () => {
    const ram = new Ram(0x4000);
    ram.write(0x3ffe, 0x47); // INP 3
    ram.write(0x3fff, 0x46); // CAL 0100, wrapping its operand fetches
    ram.write(0, 0x00);
    ram.write(1, 0x01);
    ram.write(2, 0xff); // HLT after return
    [0x04, 0x01, 0x7f, 0x07].forEach((byte, i) => ram.write(0x100 + i, byte)); // ADI 1; OUT 1F; RET
    const transfers: PortAccess[] = [];
    const ports = {
      readPort: (port: number) => { transfers.push({ kind: "input", port, value: 0xfe }); return 0xfe; },
      writePort: (port: number, value: number) => { transfers.push({ kind: "output", port, value }); },
    };
    return { ram, ports, transfers, cpu: new Cpu8008(ram, atPc(0x3ffe, 7), ports) };
  };
  const whole = create();
  const result = runCpu(whole.cpu, { maxSteps: 6 });
  assert.equal(result.stopReason, "halted");
  assert.deepEqual(result.records.map(record => record.after.pc), [0x3fff, 0x100, 0x102, 0x103, 2, 3]);
  assert.deepEqual(result.records.map(record => record.after.stackIndex), [7, 0, 0, 0, 7, 7]);
  assert.deepEqual(whole.transfers, [{ kind: "input", port: 3, value: 0xfe }, { kind: "output", port: 31, value: 0xff }]);
  assert.deepEqual(whole.cpu.snapshot().flags, { s: true, z: false, p: true, c: false });
  const paused = create();
  const first = runCpu(paused.cpu, { maxSteps: 2 });
  assert.equal(first.stopReason, "step-limit");
  const restored = new Cpu8008(paused.ram, paused.cpu.snapshot(), paused.ports);
  const rest = runCpu(restored, { maxSteps: 4 });
  assert.equal(rest.stopReason, "halted");
  assert.deepEqual([...first.records, ...rest.records], result.records);
  assert.deepEqual(paused.transfers, whole.transfers);
  assert.deepEqual(restored.snapshot(), whole.cpu.snapshot());
});

test("8008 supports all 250 documented forms and atomically rejects only the six undefined encodings", () => {
  const supported = new Set([
    0x00, 0x01, 0x04, 0x06, 0x07, 0x0e, 0x0f, 0x16, 0x17, 0x1e, 0x1f, 0x26, 0x27, 0x2e, 0x2f, 0x36, 0x37, 0x3e, 0x3f,
    0x44, 0x46, 0x4c, 0x4e, 0x54, 0x56, 0x5c, 0x5e, 0x64, 0x66, 0x6c, 0x6e, 0x74, 0x76, 0x7c, 0x7e,
    ...transferRows.flatMap(row => [...row.opcodes]),
    ...aluRows.flatMap(row => [row.immediate, ...row.opcodes]),
    ...conditions.flatMap(condition => [condition.jump, condition.call, condition.ret]),
    ...adjustments.flatMap(({ increment, decrement }) => [increment, decrement]),
    ...rotations.map(({ opcode }) => opcode),
    ...restarts.map(({ opcode }) => opcode),
    ...inputOpcodes, ...outputOpcodes,
  ]);
  assert.equal(supported.size, 250);
  const undefinedOpcodes = [0x22, 0x2a, 0x32, 0x38, 0x39, 0x3a];
  assert.equal(new Set([...supported, ...undefinedOpcodes]).size, 256);
  const ram = new ObservedRam(0x4000);
  for (let opcode = 0; opcode < 256; opcode++) {
    ram.write(0x3fff, opcode);
    ram.write(0, 0xa5);
    const before = atPc(0x3fff, opcode % 8);
    const cpu = new Cpu8008(ram, before, { readPort: () => 0xa5, writePort: () => {} });
    if (supported.has(opcode)) {
      assert.notEqual(cpu.step().outcome, "unsupported", `documented opcode ${opcode.toString(16)}`);
      continue;
    }
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

// Intel's November 1973 manual, pp. 18–20: T1I does not increment PC;
// supplied instructions may start a stopped CPU without necessarily calling a routine.
test("8008 interrupt RST preserves the interrupted PC in every slot, including stopped and boundary PCs", () => {
  const ram = new ObservedRam(0x4000);
  for (const { opcode, address } of restarts) {
    for (let slot = 0; slot < 8; slot++) {
      for (const pc of [0, 0x1234, 0x3fff]) {
        for (const halted of [false, true]) {
          for (let bits = 0; bits < 16; bits++) {
            const before = atPc(pc, slot, { halted, flags: flags(bits) });
            const addressStack: Cpu8008AddressStack = [...before.addressStack];
            const stackIndex = (slot + 1) % 8;
            addressStack[stackIndex] = address;
            const cpu = new Cpu8008(ram, before);
            assert.deepEqual(interruptBytes(cpu, opcode), {
              before: snapshot(before), after: snapshot({ ...before, addressStack, stackIndex, halted: false }),
              instruction: { source: "interrupt", bytes: [opcode] }, outcome: "executed",
              accesses: [{ kind: "acknowledge", value: opcode }],
            });
            // A supplied RET changes only the selector; even its outgoing slot is not incremented.
            const ret = interruptBytes(cpu, 0x07);
            assert.deepEqual(ret.after, snapshot({ ...before, addressStack, halted: false }));
          }
        }
      }
    }
  }
  assert.deepEqual(ram.accesses, []);
});

test("8008 supplied CAL/JMP aliases consume all address bytes without advancing the caller", () => {
  const ram = new ObservedRam(0x4000);
  for (const opcode of [0x44, 0x4c, 0x54, 0x5c, 0x64, 0x6c, 0x74, 0x7c, 0x46, 0x4e, 0x56, 0x5e, 0x66, 0x6e, 0x76, 0x7e]) {
    const call = [0x46, 0x4e, 0x56, 0x5e, 0x66, 0x6e, 0x76, 0x7e].includes(opcode);
    for (let slot = 0; slot < 8; slot++) {
      for (const target of [0, 0xff, 0x100, 0x3fff]) {
        for (const highBits of [0, 0x40, 0x80, 0xc0]) {
          const before = atPc(0x3fff, slot, { halted: true });
          const addressStack: Cpu8008AddressStack = [...before.addressStack];
          const stackIndex = call ? (slot + 1) % 8 : slot;
          addressStack[stackIndex] = target;
          const bytes = [opcode, target % 256, Math.floor(target / 256) + highBits];
          const cpu = new Cpu8008(ram, before);
          const record = interruptBytes(cpu, ...bytes);
          assert.deepEqual(record.after, snapshot({ ...before, addressStack, stackIndex, halted: false }));
          assert.deepEqual(record.accesses, bytes.map(value => ({ kind: "acknowledge", value })));
          assert.equal(record.outcome, "executed");
        }
      }
    }
  }
  assert.deepEqual(ram.accesses, []);
});

test("8008 supplied conditional transfers preserve every slot on untaken paths and use current flags", () => {
  const ram = new ObservedRam(0x4000);
  for (const condition of conditions) {
    for (let bits = 0; bits < 16; bits++) {
      for (let slot = 0; slot < 8; slot++) {
        const before = atPc(0x3fff, slot, { halted: true, flags: flags(bits) });
        const taken = before.flags[condition.flag] === condition.value;
        for (const operation of ["jump", "call", "ret"] as const) {
          const cpu = new Cpu8008(ram, before);
          const bytes = operation === "ret" ? [condition.ret] : [condition[operation], 0x34, 0xd2];
          const addressStack: Cpu8008AddressStack = [...before.addressStack];
          const stackIndex = !taken || operation === "jump" ? slot : (slot + (operation === "call" ? 1 : 7)) % 8;
          if (taken && operation !== "ret") addressStack[stackIndex] = 0x1234;
          const record = interruptBytes(cpu, ...bytes);
          assert.deepEqual(record.after, snapshot({ ...before, addressStack, stackIndex, halted: false }));
          assert.deepEqual(record.accesses, bytes.map(value => ({ kind: "acknowledge", value })));
          assert.equal(record.outcome, "executed");
        }
      }
    }
  }
  assert.deepEqual(ram.accesses, []);
});

test("8008 successive interrupt offers need no intervening step and wrap the native address stack", () => {
  const cpu = new Cpu8008(new Ram(0x4000), atPc(0x3fff, 0, { halted: true }));
  const addresses = [0x08, 0x10, 0x18, 0x20, 0x28, 0x30, 0x38, 0x00];
  for (const [i, opcode] of [0x0d, 0x15, 0x1d, 0x25, 0x2d, 0x35, 0x3d, 0x05].entries()) {
    const record = interruptBytes(cpu, opcode);
    assert.equal(record.after.pc, addresses[i]);
    assert.equal(record.after.stackIndex, (i + 1) % 8);
  }
  assert.deepEqual(cpu.snapshot().addressStack, [0, 8, 16, 24, 32, 40, 48, 56]);
  for (const [i, opcode] of [0x07, 0x0f, 0x17, 0x1f, 0x27, 0x2f, 0x37, 0x3f].entries()) {
    const ret = interruptBytes(cpu, opcode);
    assert.equal(ret.after.stackIndex, 7 - i);
    assert.equal(ret.after.pc, (7 - i) * 8);
    assert.deepEqual(ret.after.addressStack, [0, 8, 16, 24, 32, 40, 48, 56]);
  }
});

test("8008 supplied LAA starts execution at the unchanged PC, as in Intel's power-on example", () => {
  const ram = new ObservedRam(0x4000);
  ram.write(0, 0xc0); // Intel's startup NOP, LAA.
  ram.write(1, 0x06); // LAI 2A
  ram.write(2, 0x2a);
  const cpu = new Cpu8008(ram, initialState());
  const before = cpu.reset().after;
  ram.accesses.length = 0;
  assert.deepEqual(interruptBytes(cpu, 0xc0).after, { ...before, halted: false });
  assert.deepEqual(ram.accesses, []);
  assert.deepEqual(cpu.step().instruction, { address: 0, bytes: [0xc0] });
  const load = cpu.step();
  assert.equal(load.after.pc, 3);
  assert.equal(load.after.a, 0x2a);
  assert.equal(load.after.stackIndex, 0);
  assert.deepEqual(load.after.flags, before.flags);
});

test("8008 supplied immediate and memory instructions distinguish acknowledgements from data accesses", () => {
  const ram = new ObservedRam(0x4000);
  // Deliberately overlap data and PC; the only RAM reads/writes are through H:L.
  const before = atPc(0x3fff, 7, { h: 0xff, l: 0xff, halted: true });
  const cpu = new Cpu8008(ram, before);
  const store = interruptBytes(cpu, 0x3e, 0xa5); // LMI A5
  assert.deepEqual(store.after, snapshot({ ...before, halted: false }));
  assert.deepEqual(store.accesses, [{ kind: "acknowledge", value: 0x3e }, { kind: "acknowledge", value: 0xa5 },
    { kind: "write", address: 0x3fff, value: 0xa5 }]);
  const load = interruptBytes(cpu, 0xc7); // LAM
  assert.deepEqual(load.after, { ...store.after, a: 0xa5 });
  assert.deepEqual(load.accesses, [{ kind: "acknowledge", value: 0xc7 }, { kind: "read", address: 0x3fff, value: 0xa5 }]);
  const add = interruptBytes(cpu, 0x04, 0x5b); // ADI 5B
  assert.deepEqual(add.after, { ...load.after, a: 0, flags: { s: false, z: true, p: true, c: true } });
  assert.deepEqual(add.accesses, [{ kind: "acknowledge", value: 0x04 }, { kind: "acknowledge", value: 0x5b }]);
  const memoryAdd = interruptBytes(cpu, 0x87); // ADM
  assert.deepEqual(memoryAdd.after, { ...load.after, flags: { s: true, z: false, p: true, c: false } });
  assert.deepEqual(memoryAdd.accesses, [{ kind: "acknowledge", value: 0x87 }, { kind: "read", address: 0x3fff, value: 0xa5 }]);
  assert.deepEqual(ram.accesses, [{ kind: "write", address: 0x3fff, value: 0xa5 },
    { kind: "read", address: 0x3fff, value: 0xa5 }, { kind: "read", address: 0x3fff, value: 0xa5 }]);
});

test("8008 supplied INP/OUT use native selectors, acknowledge before devices, and preserve PC and flags", () => {
  const ram = new ObservedRam(0x4000);
  const observed: unknown[] = [];
  const before = atPc(0x3fff, 7, { halted: true });
  const cpu = new Cpu8008(ram, before, {
    readPort: port => { observed.push({ kind: "input", port, value: 0xa5 }); return 0xa5; },
    writePort: (port, value) => { observed.push({ kind: "output", port, value }); },
  });
  for (const [port, opcode] of inputOpcodes.entries()) {
    const record = cpu.interrupt(() => { observed.push({ kind: "acknowledge", value: opcode }); return opcode; });
    assert.deepEqual(record.accesses, [{ kind: "acknowledge", value: opcode }, { kind: "input", port, value: 0xa5 }]);
    assert.deepEqual(record.after, snapshot({ ...before, a: 0xa5, halted: false }));
    assert.deepEqual(observed.splice(0), record.accesses);
  }
  for (const [index, opcode] of outputOpcodes.entries()) {
    const record = cpu.interrupt(() => { observed.push({ kind: "acknowledge", value: opcode }); return opcode; });
    assert.deepEqual(record.accesses, [{ kind: "acknowledge", value: opcode }, { kind: "output", port: index + 8, value: 0xa5 }]);
    assert.deepEqual(record.after, snapshot({ ...before, a: 0xa5, halted: false }));
    assert.deepEqual(observed.splice(0), record.accesses);
  }
  assert.deepEqual(ram.accesses, []);
});

test("8008 supplied HLT reenters STOPPED without advancing PC; undefined bytes retain acceptance effects", () => {
  const ram = new ObservedRam(0x4000);
  for (const halted of [false, true]) {
    for (const opcode of [0x00, 0x01, 0xff, 0x22, 0x2a, 0x32, 0x38, 0x39, 0x3a]) {
      const before = atPc(0x3fff, 7, { halted });
      const cpu = new Cpu8008(ram, before);
      const halt = [0, 1, 0xff].includes(opcode);
      assert.deepEqual(interruptBytes(cpu, opcode), {
        before: snapshot(before), after: snapshot({ ...before, halted: halt }),
        instruction: { source: "interrupt", bytes: [opcode] }, accesses: [{ kind: "acknowledge", value: opcode }],
        outcome: halt ? "halted" : "unsupported", ...(halt ? {} : { reason: "opcode" }),
      });
      if (halt) assert.equal(cpu.step().instruction, null);
      // The CPU has no internal mask, even after an injected HLT or rejected byte.
      assert.equal(interruptBytes(cpu, 0xc0).after.halted, false);
    }
  }
  assert.deepEqual(ram.accesses, []);
});

test("8008 interrupt validates its callback before acceptance, but byte failures retain STOPPED release", () => {
  const ram = new ObservedRam(0x4000);
  const before = initialState({ halted: true });
  const cpu = new Cpu8008(ram, before);
  for (const callback of [undefined, null, 0, [], {}]) {
    assert.throws(() => Reflect.apply(cpu.interrupt, cpu, [callback]), /acknowledgement callback/);
    assert.deepEqual(cpu.snapshot(), snapshot(before));
  }
  for (let failureAt = 0; failureAt < 3; failureAt++) {
    for (const invalid of [-1, 256, 1.5, NaN, Infinity, "0", null, undefined]) {
      const attempt = new Cpu8008(ram, before);
      let calls = 0;
      const acknowledge = () => calls++ === failureAt ? invalid : [0x46, 0x34, 0x12][calls - 1];
      assert.throws(() => Reflect.apply(attempt.interrupt, attempt, [acknowledge]), /Interrupt instruction byte/);
      assert.equal(calls, failureAt + 1);
      assert.deepEqual(attempt.snapshot(), snapshot({ ...before, halted: false }));
      assert.equal(interruptBytes(attempt, 0xc0).outcome, "executed");
    }
    const attempt = new Cpu8008(ram, before);
    const error = new Error("acknowledgement failed");
    let calls = 0;
    assert.throws(() => attempt.interrupt(() => {
      if (calls++ === failureAt) throw error;
      return [0x46, 0x34, 0x12][calls - 1]!;
    }), value => value === error);
    assert.equal(calls, failureAt + 1);
    assert.deepEqual(attempt.snapshot(), snapshot({ ...before, halted: false }));
    assert.equal(attempt.reset().after.halted, true);
  }
  assert.deepEqual(ram.accesses, []);
});

test("8008 acknowledgement, data-memory, and port callbacks cannot nest mutating operations", () => {
  for (const operation of ["acknowledge", "read", "write", "input", "output"] as const) {
    const before = initialState({ halted: true });
    const inspect = () => {
      const during = cpu.snapshot();
      assert.deepEqual(during, snapshot({ ...before, halted: false }));
      for (const mutate of [() => cpu.step(), () => cpu.reset(), () => cpu.interrupt(() => assert.fail("nested acknowledgement"))]) {
        assert.throws(mutate, /must not be reentrant/);
        assert.deepEqual(cpu.snapshot(), during);
      }
    };
    class InspectingRam extends Ram {
      override read(address: number): number { if (operation === "read") inspect(); return super.read(address); }
      override write(address: number, value: number): void { if (operation === "write") inspect(); super.write(address, value); }
    }
    const ram = new InspectingRam(0x4000);
    const cpu = new Cpu8008(ram, before, {
      readPort: () => { inspect(); return 0xa5; }, writePort: () => { inspect(); },
    });
    const opcode = { acknowledge: 0xc0, read: 0xc7, write: 0xf8, input: 0x41, output: 0x51 }[operation];
    assert.equal(cpu.interrupt(() => { if (operation === "acknowledge") inspect(); return opcode; }).outcome, "executed");
    assert.equal(cpu.reset().after.halted, true);
  }
});

test("8008 supplied memory and port failures propagate unchanged and release the execution guard", () => {
  const before = initialState({ halted: true });
  const error = new Error("device failed");
  class FailingRam extends Ram {
    override read(): number { throw error; }
    override write(): void { throw error; }
  }
  for (const opcode of [0xc7, 0xf8, 0x41, 0x51]) {
    const cpu = new Cpu8008(new FailingRam(0x4000), before, {
      readPort: () => { throw error; }, writePort: () => { throw error; },
    });
    assert.throws(() => cpu.interrupt(() => opcode), value => value === error);
    assert.deepEqual(cpu.snapshot(), snapshot({ ...before, halted: false }));
    assert.equal(cpu.reset().after.halted, true);
  }
  for (const readPort of [undefined, () => 256]) {
    const cpu = new Cpu8008(new Ram(0x4000), before, readPort && { readPort, writePort: () => {} });
    assert.throws(() => cpu.interrupt(() => 0x41));
    assert.deepEqual(cpu.snapshot(), snapshot({ ...before, halted: false }));
    assert.equal(interruptBytes(cpu, 0xc0).outcome, "executed");
  }
});

test("8008 supplied instruction records own bytes, address slots, flags, and access lists", () => {
  const cpu = new Cpu8008(new Ram(0x4000), initialState({ halted: true }));
  const load = interruptBytes(cpu, 0x06, 0xa5);
  const call = interruptBytes(cpu, 0x46, 0x34, 0x12);
  const saved = structuredClone([load, call]);
  cpu.reset();
  interruptBytes(cpu, 0x0d);
  assert.deepEqual([load, call], saved);
  Reflect.set(load.after.addressStack, 3, 0);
  Reflect.set(load.after.flags, "c", true);
  Reflect.set(load.instruction.bytes, 0, 0xff);
  Reflect.set(load.accesses[0]!, "value", 0xff);
  assert.deepEqual(call, saved[1]);
  assert.deepEqual(load.before, saved[0]!.before);
  assert.equal(cpu.snapshot().pc, 8);
});
