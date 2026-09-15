import assert from "node:assert/strict";
import { test } from "node:test";
import type { BytePorts } from "../../../src/components/cpus/port-access.js";
import { CpuZ80 } from "../../../src/components/cpus/z80.js";
import type { CpuZ80Flags, CpuZ80RegisterBank, CpuZ80State, CpuZ80MemoryAccess, CpuZ80Access } from "../../../src/components/cpus/z80.js";
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

// Literal register encodings from the manual; memory INC/DEC have separate access tests.
const byteRegisterCases = [
  { register: "a", load: 0x3e, increment: 0x3c, decrement: 0x3d },
  { register: "b", load: 0x06, increment: 0x04, decrement: 0x05 },
  { register: "c", load: 0x0e, increment: 0x0c, decrement: 0x0d },
  { register: "d", load: 0x16, increment: 0x14, decrement: 0x15 },
  { register: "e", load: 0x1e, increment: 0x1c, decrement: 0x1d },
  { register: "h", load: 0x26, increment: 0x24, decrement: 0x25 },
  { register: "l", load: 0x2e, increment: 0x2c, decrement: 0x2d },
] as const;

// Literal rows from the documented load matrix; columns are B/C/D/E/H/L/(HL)/A.
const transferColumns = ["b", "c", "d", "e", "h", "l", "(hl)", "a"] as const;
const transferRows = [
  { destination: "b", opcodes: [0x40, 0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47] },
  { destination: "c", opcodes: [0x48, 0x49, 0x4a, 0x4b, 0x4c, 0x4d, 0x4e, 0x4f] },
  { destination: "d", opcodes: [0x50, 0x51, 0x52, 0x53, 0x54, 0x55, 0x56, 0x57] },
  { destination: "e", opcodes: [0x58, 0x59, 0x5a, 0x5b, 0x5c, 0x5d, 0x5e, 0x5f] },
  { destination: "h", opcodes: [0x60, 0x61, 0x62, 0x63, 0x64, 0x65, 0x66, 0x67] },
  { destination: "l", opcodes: [0x68, 0x69, 0x6a, 0x6b, 0x6c, 0x6d, 0x6e, 0x6f] },
  { destination: "(hl)", opcodes: [0x70, 0x71, 0x72, 0x73, 0x74, 0x75, 0x76, 0x77] },
  { destination: "a", opcodes: [0x78, 0x79, 0x7a, 0x7b, 0x7c, 0x7d, 0x7e, 0x7f] },
] as const;

for (const { destination, opcodes } of transferRows) {
  test(`Z80 load-matrix destination ${destination.toUpperCase()} covers every source and byte, including self-transfers and HALT`, () => {
    const ram = new ObservedRam();
    for (const [column, source] of transferColumns.entries()) {
      const opcode = opcodes[column]!;
      for (let value = 0; value < 256; value++) {
        const before = initialState({ flags: flagPattern(value % 64) });
        if (source !== "(hl)") before[source] = value;
        const address = before.h * 256 + before.l;
        ram.write(address, value);
        ram.write(before.pc, opcode);
        ram.accesses.length = 0;
        const after = { ...before, pc: 0x2001, r: 0xff, halted: opcode === 0x76 };
        const accesses: CpuZ80MemoryAccess[] = [{ kind: "read", address: before.pc, value: opcode }];
        if (opcode !== 0x76) {
          if (source === "(hl)") accesses.push({ kind: "read", address, value });
          if (destination === "(hl)") accesses.push({ kind: "write", address, value });
          else after[destination] = value;
        }
        const record = new CpuZ80(ram, before).step();
        assert.deepEqual(record, {
          before: snapshot(before), after: snapshot(after), instruction: { address: before.pc, bytes: [opcode] },
          accesses, outcome: after.halted ? "halted" : "executed",
        });
        assert.deepEqual(ram.accesses, accesses);
        // A store still writes when the byte at its destination already matches.
        assert.equal(ram.read(address), value);
      }
    }
  });
}

test("Z80 indirect loads use the original HL and distinguish data reads from instruction bytes at address-space and code overlaps", () => {
  for (const { destination, opcodes } of transferRows) {
    for (const [column, source] of transferColumns.entries()) {
      const opcode = opcodes[column]!;
      if (opcode === 0x76 || (destination !== "(hl)" && source !== "(hl)")) continue;
      for (const pc of [0, 0x2000, 0xffff]) {
        for (const address of [0, 0xffff, 0x1234, pc, (pc + 1) % 0x10000]) {
          const ram = new ObservedRam();
          const before = initialState({ pc, h: Math.floor(address / 256), l: address % 256 });
          ram.write(address, 0xa5);
          ram.write(pc, opcode);
          const value = source === "(hl)" ? ram.read(address) : before[source];
          ram.accesses.length = 0;
          const after = { ...before, pc: (pc + 1) % 0x10000, r: 0xff };
          if (destination !== "(hl)") after[destination] = value;
          const accesses: CpuZ80MemoryAccess[] = [
            { kind: "read", address: pc, value: opcode },
            { kind: destination === "(hl)" ? "write" : "read", address, value },
          ];
          assert.deepEqual(new CpuZ80(ram, before).step(), {
            before: snapshot(before), after: snapshot(after), instruction: { address: pc, bytes: [opcode] },
            accesses, outcome: "executed",
          });
          assert.deepEqual(ram.accesses, accesses);
          assert.equal(ram.read(address), value);
        }
      }
    }
  }
});

test("Z80 LD (HL),n stores every byte with every incoming flag pattern, including wrapped fetches", () => {
  const ram = new ObservedRam();
  ram.write(0xffff, 0x36);
  for (let bits = 0; bits < 64; bits++) {
    for (let value = 0; value < 256; value++) {
      ram.write(0, value);
      ram.accesses.length = 0;
      const before = initialState({ pc: 0xffff, flags: flagPattern(bits) });
      const record = new CpuZ80(ram, before).step();
      assert.deepEqual(record, {
        before: snapshot(before), after: snapshot({ ...before, pc: 1, r: 0xff }),
        instruction: { address: 0xffff, bytes: [0x36, value] }, outcome: "executed",
        accesses: [{ kind: "read", address: 0xffff, value: 0x36 }, { kind: "read", address: 0, value },
          { kind: "write", address: 0x6677, value }],
      });
      assert.deepEqual(ram.accesses, record.accesses);
      assert.equal(ram.read(0x6677), value);
    }
  }
});

test("Z80 LD (HL),n fetches its operand before an overlapping write and retains captured bytes", () => {
  for (const pc of [0, 0x2000, 0xffff]) {
    for (const address of [0, 0xffff, pc, (pc + 1) % 0x10000]) {
      const ram = new ObservedRam();
      ram.write(pc, 0x36);
      ram.write((pc + 1) % 0x10000, 0x76);
      ram.accesses.length = 0;
      const before = initialState({ pc, h: Math.floor(address / 256), l: address % 256 });
      const cpu = new CpuZ80(ram, before);
      const record = cpu.step();
      const saved = structuredClone(record);
      assert.deepEqual(record, {
        before: snapshot(before), after: snapshot({ ...before, pc: (pc + 2) % 0x10000, r: 0xff }),
        instruction: { address: pc, bytes: [0x36, 0x76] }, outcome: "executed",
        accesses: [{ kind: "read", address: pc, value: 0x36 },
          { kind: "read", address: (pc + 1) % 0x10000, value: 0x76 }, { kind: "write", address, value: 0x76 }],
      });
      assert.deepEqual(ram.accesses, record.accesses);
      assert.equal(ram.read(address), 0x76);
      ram.write(address, 0);
      cpu.reset();
      assert.deepEqual(record, saved);
    }
  }
});

for (const { opcode, high, low } of [
  { opcode: 0x01, high: "b", low: "c" }, { opcode: 0x11, high: "d", low: "e" },
  { opcode: 0x21, high: "h", low: "l" }, { opcode: 0x31, high: null, low: null },
] as const) {
  test(`Z80 pair load ${opcode.toString(16)} reads low then high, updates only its stored registers, and preserves flags`, () => {
    const ram = new ObservedRam();
    for (const pc of [0x2000, 0xfffe, 0xffff]) {
      for (const value of [0, 1, 0x00ff, 0x0100, 0x1234, 0x7fff, 0x8000, 0xff00, 0xffff]) {
        for (let bits = 0; bits < 64; bits++) {
          const bytes = [opcode, value % 256, Math.floor(value / 256)];
          bytes.forEach((byte, offset) => ram.write((pc + offset) % 0x10000, byte));
          ram.accesses.length = 0;
          const before = initialState({ pc, flags: flagPattern(bits) });
          const after = { ...before, pc: (pc + 3) % 0x10000, r: 0xff };
          if (high !== null) {
            after[high] = Math.floor(value / 256);
            after[low] = value % 256;
          } else after.sp = value;
          const record = new CpuZ80(ram, before).step();
          assert.deepEqual(record, {
            before: snapshot(before), after: snapshot(after), instruction: { address: pc, bytes }, outcome: "executed",
            accesses: bytes.map((byte, offset) => ({ kind: "read", address: (pc + offset) % 0x10000, value: byte })),
          });
          assert.deepEqual(ram.accesses, record.accesses);
        }
      }
    }
  });
}

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

// Manual encodings, with register columns B/C/D/E/H/L/(HL)/A and a separate immediate form.
const aluForms = [
  { name: "ADD", opcodes: [0x80, 0x81, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87], immediate: 0xc6 },
  { name: "ADC", opcodes: [0x88, 0x89, 0x8a, 0x8b, 0x8c, 0x8d, 0x8e, 0x8f], immediate: 0xce },
  { name: "SUB", opcodes: [0x90, 0x91, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97], immediate: 0xd6 },
  { name: "SBC", opcodes: [0x98, 0x99, 0x9a, 0x9b, 0x9c, 0x9d, 0x9e, 0x9f], immediate: 0xde },
  { name: "AND", opcodes: [0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7], immediate: 0xe6 },
  { name: "XOR", opcodes: [0xa8, 0xa9, 0xaa, 0xab, 0xac, 0xad, 0xae, 0xaf], immediate: 0xee },
  { name: "OR", opcodes: [0xb0, 0xb1, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7], immediate: 0xf6 },
  { name: "CP", opcodes: [0xb8, 0xb9, 0xba, 0xbb, 0xbc, 0xbd, 0xbe, 0xbf], immediate: 0xfe },
] as const;

type AluName = typeof aluForms[number]["name"];

function expectedAlu(name: AluName, a: number, value: number, carry: boolean) {
  if (name === "AND" || name === "XOR" || name === "OR") {
    const result = name === "AND" ? a & value : name === "XOR" ? a ^ value : a | value;
    const setBits = result.toString(2).split("1").length - 1;
    return { a: result, flags: { s: result >= 128, z: result === 0, h: name === "AND",
      pv: setBits % 2 === 0, n: false, c: false } };
  }
  // Signed/unsigned arithmetic and decimal low-digit comparisons, independent of the shared ALU helpers.
  const signed = (value: number) => value < 128 ? value : value - 256;
  const input = (name === "ADC" || name === "SBC") && carry ? 1 : 0;
  const subtract = name === "SUB" || name === "SBC" || name === "CP";
  const total = subtract ? a - value - input : a + value + input;
  const signedTotal = subtract ? signed(a) - signed(value) - input : signed(a) + signed(value) + input;
  const lowTotal = subtract ? a % 16 - value % 16 - input : a % 16 + value % 16 + input;
  const result = (total + 256) % 256;
  return { a: name === "CP" ? a : result, flags: { s: result >= 128, z: result === 0,
    h: lowTotal < 0 || lowTotal > 15, pv: signedTotal < -128 || signedTotal > 127,
    n: subtract, c: total < 0 || total > 255 } };
}

for (const { name, opcodes, immediate } of aluForms) {
  test(`Z80 ${name} covers every operand form and incoming flag pattern with exact records`, () => {
    const ram = new ObservedRam();
    const forms = [...opcodes.map((opcode, index) => ({ opcode, source: transferColumns[index]! })),
      { opcode: immediate, source: "immediate" as const }];
    for (const { opcode, source } of forms) {
      for (const value of [0, 1, 0x0f, 0x10, 0x7f, 0x80, 0xfe, 0xff]) {
        for (const a of source === "a" ? [value] : [0, 0x11, 0x7f, 0x80, 0xff]) {
          for (let bits = 0; bits < 64; bits++) {
            const before = initialState({ a, flags: flagPattern(bits), pc: 0xffff });
            if (source !== "(hl)" && source !== "immediate") before[source] = value;
            const address = before.h * 256 + before.l;
            ram.write(address, value);
            ram.write(0xffff, opcode);
            ram.write(0, value);
            ram.accesses.length = 0;
            const bytes = source === "immediate" ? [opcode, value] : [opcode];
            const reads = [[0xffff, opcode], ...(source === "(hl)" ? [[address, value]]
              : source === "immediate" ? [[0, value]] : [])];
            const cpu = new CpuZ80(ram, before);
            const record = cpu.step();
            assert.deepEqual(record, { before: snapshot(before),
              after: snapshot({ ...before, ...expectedAlu(name, before.a, value, before.flags.c), pc: bytes.length - 1, r: 0xff }),
              instruction: { address: 0xffff, bytes }, outcome: "executed",
              accesses: reads.map(([address, value]) => ({ kind: "read", address, value })),
            }, `${name} ${source}: A=${before.a}, operand=${value}, flags=${bits}`);
            assert.deepEqual(ram.accesses, record.accesses);
            assert.deepEqual(cpu.snapshot(), record.after);
          }
        }
      }
    }
  });

  test(`Z80 ${name} exhausts every accumulator/operand pair and both carry inputs`, () => {
    const ram = new Ram(0x10000);
    for (const carry of [false, true]) {
      for (let a = 0; a < 256; a++) {
        // CP establishes C before each independent case; LD preserves it for ADC/SBC.
        // One CPU executes a full row, avoiding a fresh decoder for every pair.
        for (let value = 0; value < 256; value++) {
          [0x3e, 0, 0xfe, carry ? 1 : 0, 0x3e, a, immediate, value].forEach((byte, offset) =>
            ram.write(0x2000 + value * 8 + offset, byte));
        }
        const before = initialState({ r: 0xfe });
        const cpu = new CpuZ80(ram, before);
        for (let value = 0; value < 256; value++) {
          cpu.step(); // LD A,0
          const setup = cpu.step(); // CP 00/01: no borrow / borrow
          assert.equal(setup.after.flags.c, carry);
          cpu.step(); // LD A,a
          const record = cpu.step();
          assert.equal(record.outcome, "executed");
          assert.deepEqual(record.after, snapshot({ ...before, ...expectedAlu(name, a, value, carry),
            pc: 0x2008 + value * 8, r: 0x80 + (126 + (value + 1) * 4) % 128,
          }), `${name}: A=${a}, operand=${value}, C=${carry}`);
        }
      }
    }
  });

  test(`Z80 ${name} (HL) retains repeated reads when data overlaps the opcode`, () => {
    for (const pc of [0, 0x2000, 0xffff]) {
      const opcode = opcodes[6];
      const ram = new ObservedRam();
      ram.write(pc, opcode);
      ram.accesses.length = 0;
      const before = initialState({ pc, h: Math.floor(pc / 256), l: pc % 256, a: 0x7f });
      const record = new CpuZ80(ram, before).step();
      assert.deepEqual(record, { before: snapshot(before),
        after: snapshot({ ...before, ...expectedAlu(name, before.a, opcode, before.flags.c), pc: (pc + 1) % 65536, r: 0xff }),
        instruction: { address: pc, bytes: [opcode] }, outcome: "executed",
        accesses: [{ kind: "read", address: pc, value: opcode }, { kind: "read", address: pc, value: opcode }] });
      assert.deepEqual(ram.accesses, record.accesses);
    }
  });

  test(`Z80 ${name} uses live registers, pointers, operands, and carry while retaining earlier records`, () => {
    const ram = new ObservedRam();
    const program = [0x06, 0x80, opcodes[0], 0x21, 0xff, 0xff, opcodes[6], immediate, 0];
    program.forEach((byte, offset) => ram.write(0x2000 + offset, byte));
    ram.write(0xffff, 1);
    const cpu = new CpuZ80(ram, initialState({ a: 0x7f, flags: flagPattern(63) }));
    cpu.step(); // LD B,80 changes the source register after decoder construction.
    const first = cpu.step();
    assert.deepEqual(first.after, snapshot({ ...first.before, ...expectedAlu(name, 0x7f, 0x80, true), pc: 0x2003, r: 0x80 }));
    const savedFirst = structuredClone(first);
    cpu.step(); // LD HL,FFFF selects a new data address.
    ram.write(0xffff, 0xff);
    ram.write(0x2008, 9);
    for (const [opcode, operand, address, length] of [[opcodes[6], 0xff, 0xffff, 1], [immediate, 9, 0x2008, 2]] as const) {
      const before = cpu.snapshot();
      ram.accesses.length = 0;
      const record = cpu.step();
      assert.deepEqual(record, { before,
        after: snapshot({ ...before, ...expectedAlu(name, before.a, operand, before.flags.c), pc: before.pc + length, r: before.r + 1 }),
        instruction: { address: before.pc, bytes: length === 1 ? [opcode] : [opcode, operand] }, outcome: "executed",
        accesses: [{ kind: "read", address: before.pc, value: opcode }, { kind: "read", address, value: operand }] });
      assert.deepEqual(ram.accesses, record.accesses);
    }
    assert.deepEqual(first, savedFirst);
    const live = cpu.snapshot();
    Reflect.set(first.after.flags, "c", !live.flags.c);
    Reflect.set(first.after.alternate, "a", 0);
    assert.deepEqual(cpu.snapshot(), live);
    cpu.reset();
    ram.write(0xffff, 0);
    assert.deepEqual(first.before, savedFirst.before);
  });
}

test("Z80 SBC and ADC pass live borrow/carry into the next operation, including A as its own source", () => {
  const ram = new Ram(0x10000);
  [0xde, 0, 0xce, 0, 0x9f, 0xbf, 0xee, 0xff].forEach((byte, offset) => ram.write(0x2000 + offset, byte));
  const cpu = new CpuZ80(ram, initialState({ a: 0, flags: flagPattern(63) }));
  const expected = [
    { a: 0xff, flags: { s: true, z: false, h: true, pv: false, n: true, c: true } },
    { a: 0, flags: { s: false, z: true, h: true, pv: false, n: false, c: true } },
    { a: 0xff, flags: { s: true, z: false, h: true, pv: false, n: true, c: true } },
    { a: 0xff, flags: { s: false, z: true, h: false, pv: false, n: true, c: false } },
    { a: 0, flags: { s: false, z: true, h: false, pv: true, n: false, c: false } },
  ];
  for (const next of expected) {
    const record = cpu.step();
    assert.equal(record.outcome, "executed");
    assert.equal(record.after.a, next.a);
    assert.deepEqual(record.after.flags, next.flags);
  }
});

test("8080 and Z80 ALU encodings retain their distinct half-carry and parity/overflow rules", () => {
  for (const [opcode, a, operand, carry, result, h, ac, pv, p, n, c] of [
    [0xce, 0x7f, 0, true, 0x80, true, true, true, false, false, false],
    [0xde, 0x80, 0, true, 0x7f, true, false, true, false, true, false],
    [0xd6, 0x10, 1, true, 0x0f, true, false, false, true, true, false],
    [0xd6, 0, 1, false, 0xff, true, false, false, true, true, true],
    [0xe6, 0, 0, true, 0, true, false, true, true, false, false],
    [0xee, 0x80, 0x80, true, 0, false, false, true, true, false, false],
    [0xf6, 0x80, 1, true, 0x81, false, false, true, true, false, false],
  ] as const) {
    const ram = new Ram(0x10000);
    ram.write(0x2000, opcode);
    ram.write(0x2001, operand);
    const z80 = new CpuZ80(ram, initialState({ a, flags: { ...flagPattern(63), c: carry } })).step();
    const intel = new Cpu8080(ram, { a, b: 0, c: 0, d: 0, e: 0, h: 0, l: 0, pc: 0x2000, sp: 0,
      flags: { s: true, z: true, ac: true, p: true, cy: carry }, interruptEnabled: false, interruptDeferred: false, halted: false }).step();
    assert.equal(z80.outcome, "executed");
    assert.equal(intel.outcome, "executed");
    assert.deepEqual(z80.instruction, intel.instruction);
    assert.deepEqual(z80.accesses, intel.accesses);
    assert.equal(z80.after.a, result);
    assert.equal(intel.after.a, result);
    assert.deepEqual(z80.after.flags, { s: result >= 128, z: result === 0, h, pv, n, c });
    assert.deepEqual(intel.after.flags, { s: result >= 128, z: result === 0, ac, p, cy: c });
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
    [[0x04, 0x05, 0x0c, 0x0d, 0x14, 0x15, 0x1c, 0x1d, 0x24, 0x25, 0x2c, 0x2d, 0x3c, 0x3d,
      ...transferRows.flatMap(row => [...row.opcodes]), ...aluForms.flatMap(form => [...form.opcodes])], 0],
    [[0x06, 0x0e, 0x16, 0x1e, 0x26, 0x2e, 0x36, 0x3e, 0x28, 0x38, ...aluForms.map(form => form.immediate)], 1],
    [[0x10, 0x18, 0x20, 0x30], 0xff81],
    [[0x01, 0x11, 0x21, 0x31, 0x32], 2],
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

test("Z80 rejects deferred unprefixed interrupt controls atomically", () => {
  const ram = new ObservedRam();
  const before = initialState({ pc: 0xffff, r: 0xff });
  for (let opcode = 0; opcode < 256; opcode++) {
    if (![0xf3, 0xfb].includes(opcode)) continue;
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
        flags: { s: false, z: false, ac: false, p: false, cy: false }, interruptEnabled: false, interruptDeferred: false, halted: false,
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

// CB rows from the manual. The undocumented 30–37 SLL row is deliberately absent.
const cbRows = [
  { name: "RLC", bit: 0, base: 0x00 }, { name: "RRC", bit: 0, base: 0x08 },
  { name: "RL", bit: 0, base: 0x10 }, { name: "RR", bit: 0, base: 0x18 },
  { name: "SLA", bit: 0, base: 0x20 }, { name: "SRA", bit: 0, base: 0x28 },
  { name: "SRL", bit: 0, base: 0x38 },
  ...[0x40, 0x48, 0x50, 0x58, 0x60, 0x68, 0x70, 0x78].map((base, bit) => ({ name: "BIT", bit, base })),
  ...[0x80, 0x88, 0x90, 0x98, 0xa0, 0xa8, 0xb0, 0xb8].map((base, bit) => ({ name: "RES", bit, base })),
  ...[0xc0, 0xc8, 0xd0, 0xd8, 0xe0, 0xe8, 0xf0, 0xf8].map((base, bit) => ({ name: "SET", bit, base })),
];

function expectedCb(name: string, bit: number, value: number, flags: CpuZ80Flags) {
  // Use character movement to specify bit behavior independently of the core's shifts and masks.
  const digits = value.toString(2).padStart(8, "0").split("");
  if (name === "BIT") {
    const clear = digits[7 - bit] === "0";
    return { value, flags: { s: bit === 7 && !clear, z: clear, h: true, pv: clear, n: false, c: flags.c } };
  }
  if (name === "RES" || name === "SET") {
    digits[7 - bit] = name === "SET" ? "1" : "0";
    return { value: Number.parseInt(digits.join(""), 2), flags };
  }
  const left = ["RLC", "RL", "SLA"].includes(name);
  const outgoing = left ? digits.shift()! : digits.pop()!;
  const incoming = name === "RLC" || name === "RRC" ? outgoing
    : name === "RL" || name === "RR" ? (flags.c ? "1" : "0")
    : name === "SRA" ? digits[0]! : "0";
  if (left) digits.push(incoming);
  else digits.unshift(incoming);
  const result = Number.parseInt(digits.join(""), 2);
  return { value: result, flags: { s: digits[0] === "1", z: result === 0, h: false,
    pv: digits.filter(digit => digit === "1").length % 2 === 0, n: false, c: outgoing === "1" } };
}

for (const { name, bit, base } of cbRows) {
  test(`Z80 CB ${name} ${bit} covers every operand, byte, and carry input`, () => {
    const ram = new ObservedRam();
    for (const [column, operand] of transferColumns.entries()) {
      const opcode = base + column;
      for (let value = 0; value < 256; value++) {
        for (const carry of [false, true]) {
          const flags = { ...flagPattern(value % 32), c: carry };
          const before = initialState({ flags, r: value });
          if (operand !== "(hl)") before[operand] = value;
          ram.write(0x6677, value);
          ram.write(0x2000, 0xcb);
          ram.write(0x2001, opcode);
          ram.accesses.length = 0;
          const expected = expectedCb(name, bit, value, flags);
          const after = { ...before, flags: expected.flags, pc: 0x2002, r: Math.floor(value / 128) * 128 + (value + 2) % 128 };
          if (operand !== "(hl)") after[operand] = expected.value;
          const accesses: CpuZ80MemoryAccess[] = [{ kind: "read", address: 0x2000, value: 0xcb },
            { kind: "read", address: 0x2001, value: opcode }];
          if (operand === "(hl)") {
            accesses.push({ kind: "read", address: 0x6677, value });
            if (name !== "BIT") accesses.push({ kind: "write", address: 0x6677, value: expected.value });
          }
          const record = new CpuZ80(ram, before).step();
          assert.deepEqual(record, { before: snapshot(before), after: snapshot(after), accesses,
            instruction: { address: 0x2000, bytes: [0xcb, opcode] }, outcome: "executed" });
          assert.deepEqual(ram.accesses, accesses);
          if (operand === "(hl)") assert.equal(ram.read(0x6677), expected.value);
        }
      }
    }
  });
}

test("Z80 CB operations exhaust byte/flag combinations through POP AF, including ignored F bits", () => {
  const ram = new Ram(0x10000);
  for (const { name, bit, base } of cbRows) {
    for (let f = 0; f < 256; f++) {
      // POP AF supplies each independent input, including bits omitted from stored state.
      const flags = unpackFlags(f);
      for (let value = 0; value < 256; value++) {
        [0xf1, 0xcb, base + 7].forEach((byte, offset) => ram.write(0x2000 + value * 3 + offset, byte));
        ram.write(0x8000 + value * 2, f);
        ram.write(0x8001 + value * 2, value);
      }
      const cpu = new CpuZ80(ram, initialState({ sp: 0x8000 }));
      for (let value = 0; value < 256; value++) {
        const loaded = cpu.step();
        assert.equal(loaded.after.a, value);
        assert.deepEqual(loaded.after.flags, flags);
        const expected = expectedCb(name, bit, value, flags);
        const record = cpu.step();
        assert.equal(record.outcome, "executed");
        assert.deepEqual(record.after, { ...loaded.after, a: expected.value, flags: expected.flags,
          pc: loaded.after.pc + 2, r: 0x80 + (loaded.after.r + 2) % 128 });
      }
    }
  }
});

test("Z80 CB memory operations wrap instruction fetches and retain overlapping reads and writes", () => {
  for (const { name, bit, base } of cbRows) {
    const opcode = base + 6;
    for (const pc of [0, 0xfffe, 0xffff]) {
      for (const address of [0, 0xffff, pc, (pc + 1) % 65536, 0x1234]) {
        const ram = new ObservedRam();
        ram.write(address, 0xa5);
        ram.write(pc, 0xcb);
        ram.write((pc + 1) % 65536, opcode);
        const value = ram.read(address);
        const before = initialState({ pc, r: 0xff, h: Math.floor(address / 256), l: address % 256 });
        const expected = expectedCb(name, bit, value, before.flags);
        const accesses: CpuZ80MemoryAccess[] = [
          { kind: "read", address: pc, value: 0xcb }, { kind: "read", address: (pc + 1) % 65536, value: opcode },
          { kind: "read", address, value },
        ];
        if (name !== "BIT") accesses.push({ kind: "write", address, value: expected.value });
        ram.accesses.length = 0;
        const cpu = new CpuZ80(ram, before);
        const record = cpu.step();
        assert.deepEqual(record, { before: snapshot(before), after: snapshot({ ...before, flags: expected.flags,
          pc: (pc + 2) % 65536, r: 0x81 }), accesses,
          instruction: { address: pc, bytes: [0xcb, opcode] }, outcome: "executed" });
        assert.deepEqual(ram.accesses, accesses);
        assert.equal(ram.read(address), expected.value);
        const saved = structuredClone(record);
        ram.write(address, 0);
        cpu.reset();
        assert.deepEqual(record, saved);
      }
    }
  }
});

test("Z80 CB SLL encodings reject both fetched bytes atomically and read current RAM on retry", () => {
  for (let opcode = 0x30; opcode <= 0x37; opcode++) {
    for (const pc of [0x2000, 0xffff]) {
      const ram = new ObservedRam();
      const before = initialState({ pc, r: 0x7f });
      ram.write(pc, 0xcb);
      ram.write((pc + 1) % 65536, opcode);
      const cpu = new CpuZ80(ram, before);
      for (let attempt = 0; attempt < 2; attempt++) {
        ram.accesses.length = 0;
        const record = cpu.step();
        assert.deepEqual(record, { before: snapshot(before), after: snapshot(before), outcome: "unsupported", reason: "opcode",
          instruction: { address: pc, bytes: [0xcb, opcode] }, accesses: [
            { kind: "read", address: pc, value: 0xcb }, { kind: "read", address: (pc + 1) % 65536, value: opcode },
          ] });
        assert.deepEqual(ram.accesses, record.accesses);
      }
      ram.write((pc + 1) % 65536, 0xff); // SET 7,A
      const executed = cpu.step();
      assert.equal(executed.outcome, "executed");
      assert.deepEqual(executed.after, snapshot({ ...before, a: 0x91, pc: (pc + 2) % 65536, r: 1 }));
    }
  }
});

function unpackFlags(value: number): CpuZ80Flags {
  // Positions in F are independent of flagPattern's compact test-case numbering.
  return { s: Math.floor(value / 128) % 2 === 1, z: Math.floor(value / 64) % 2 === 1,
    h: Math.floor(value / 16) % 2 === 1, pv: Math.floor(value / 4) % 2 === 1,
    n: Math.floor(value / 2) % 2 === 1, c: value % 2 === 1 };
}

const stackForms = [
  { high: "b", low: "c", push: 0xc5, pop: 0xc1 }, { high: "d", low: "e", push: 0xd5, pop: 0xd1 },
  { high: "h", low: "l", push: 0xe5, pop: 0xe1 }, { high: "a", low: "flags", push: 0xf5, pop: 0xf1 },
] as const;
const callReturnForms = [
  { call: 0xcd, ret: 0xc9, take: (_flags: CpuZ80Flags) => true },
  { call: 0xc4, ret: 0xc0, take: (flags: CpuZ80Flags) => !flags.z },
  { call: 0xcc, ret: 0xc8, take: (flags: CpuZ80Flags) => flags.z },
  { call: 0xd4, ret: 0xd0, take: (flags: CpuZ80Flags) => !flags.c },
  { call: 0xdc, ret: 0xd8, take: (flags: CpuZ80Flags) => flags.c },
  { call: 0xe4, ret: 0xe0, take: (flags: CpuZ80Flags) => !flags.pv },
  { call: 0xec, ret: 0xe8, take: (flags: CpuZ80Flags) => flags.pv },
  { call: 0xf4, ret: 0xf0, take: (flags: CpuZ80Flags) => !flags.s },
  { call: 0xfc, ret: 0xf8, take: (flags: CpuZ80Flags) => flags.s },
];

for (const { high, low, push, pop } of stackForms) {
  test(`Z80 PUSH/POP ${high.toUpperCase()}${low === "flags" ? "F" : low.toUpperCase()} covers word boundaries, flags, and SP wrap`, () => {
    for (const sp of [0, 1, 0xff, 0x100, 0xfffe, 0xffff]) {
      for (const word of [0, 1, 0x7f80, 0x80ff, 0xff00, 0xffff]) {
        for (let bits = 0; bits < 64; bits++) {
          const ram = new ObservedRam();
          const before = initialState({ sp, flags: flagPattern(bits) });
          before[high] = Math.floor(word / 256);
          const flags = before.flags;
          const lowByte = low === "flags" ? Number(flags.s) * 128 + Number(flags.z) * 64 + Number(flags.h) * 16
            + Number(flags.pv) * 4 + Number(flags.n) * 2 + Number(flags.c) : word % 256;
          if (low !== "flags") before[low] = lowByte;
          ram.write(0x2000, push);
          ram.write(0x2001, pop);
          // A same-value push must still issue both writes.
          ram.write((sp + 65535) % 65536, before[high]);
          ram.write((sp + 65534) % 65536, lowByte);
          ram.accesses.length = 0;
          const cpu = new CpuZ80(ram, before);
          const pushed = cpu.step();
          assert.deepEqual(pushed, { before: snapshot(before), after: snapshot({ ...before, pc: 0x2001,
            sp: (sp + 65534) % 65536, r: 0xff }), outcome: "executed", instruction: { address: 0x2000, bytes: [push] },
            accesses: [{ kind: "read", address: 0x2000, value: push },
              { kind: "write", address: (sp + 65535) % 65536, value: before[high] },
              { kind: "write", address: (sp + 65534) % 65536, value: lowByte }] });
          assert.deepEqual(ram.accesses, pushed.accesses);
          ram.accesses.length = 0;
          const popped = cpu.step();
          assert.deepEqual(popped, { before: pushed.after, after: snapshot({ ...before, pc: 0x2002, r: 0x80 }),
            outcome: "executed", instruction: { address: 0x2001, bytes: [pop] },
            accesses: [{ kind: "read", address: 0x2001, value: pop },
              { kind: "read", address: (sp + 65534) % 65536, value: lowByte },
              { kind: "read", address: (sp + 65535) % 65536, value: before[high] }] });
          assert.deepEqual(ram.accesses, popped.accesses);
        }
      }
    }
  });
}

for (const { call, ret, take } of callReturnForms) {
  test(`Z80 CALL ${call.toString(16)} and RET ${ret.toString(16)} cover every flag pattern and wrapped/overlapping stack accesses`, () => {
    for (let bits = 0; bits < 64; bits++) {
      for (const pc of [0x2000, 0xfffd, 0xfffe, 0xffff]) {
        for (const sp of [0, 1, 0xffff, pc, (pc + 1) % 65536, (pc + 3) % 65536]) {
          const ram = new ObservedRam();
          const before = initialState({ pc, sp, r: bits * 4, flags: flagPattern(bits) });
          const taken = take(before.flags);
          const next = (pc + 3) % 65536;
          const bytes = [call, 0x34, 0x12];
          bytes.forEach((byte, offset) => ram.write((pc + offset) % 65536, byte));
          ram.accesses.length = 0;
          const cpu = new CpuZ80(ram, before);
          const record = cpu.step();
          const accesses: CpuZ80MemoryAccess[] = bytes.map((value, offset) => ({ kind: "read", address: (pc + offset) % 65536, value }));
          if (taken) accesses.push({ kind: "write", address: (sp + 65535) % 65536, value: Math.floor(next / 256) },
            { kind: "write", address: (sp + 65534) % 65536, value: next % 256 });
          assert.deepEqual(record, { before: snapshot(before), after: snapshot({ ...before,
            pc: taken ? 0x1234 : next, sp: taken ? (sp + 65534) % 65536 : sp,
            r: Math.floor(before.r / 128) * 128 + (before.r + 1) % 128 }), outcome: "executed",
            instruction: { address: pc, bytes }, accesses });
          assert.deepEqual(ram.accesses, accesses);
          // Test RET independently, so untaken calls do not hide a broken return condition.
          ram.write(sp, 0x78);
          ram.write((sp + 1) % 65536, 0x56);
          ram.write(pc, ret);
          const low = ram.read(sp), high = ram.read((sp + 1) % 65536);
          ram.accesses.length = 0;
          const returned = new CpuZ80(ram, before).step();
          const returnAccesses: CpuZ80MemoryAccess[] = [{ kind: "read", address: pc, value: ret }];
          if (taken) returnAccesses.push({ kind: "read", address: sp, value: low },
            { kind: "read", address: (sp + 1) % 65536, value: high });
          assert.deepEqual(returned, { before: snapshot(before), after: snapshot({ ...before,
            pc: taken ? high * 256 + low : (pc + 1) % 65536, sp: taken ? (sp + 2) % 65536 : sp,
            r: Math.floor(before.r / 128) * 128 + (before.r + 1) % 128 }), outcome: "executed",
            instruction: { address: pc, bytes: [ret] }, accesses: returnAccesses });
          assert.deepEqual(ram.accesses, returnAccesses);
        }
      }
    }
  });
}

test("Z80 stack and call/return forms increment R once for every initial R value", () => {
  const ram = new Ram(65536);
  const opcodes = [...stackForms.flatMap(form => [form.push, form.pop]), ...callReturnForms.flatMap(form => [form.call, form.ret])];
  for (const opcode of opcodes) {
    for (let r = 0; r < 256; r++) {
      ram.write(0x2000, opcode);
      const record = new CpuZ80(ram, initialState({ r })).step();
      assert.equal(record.outcome, "executed");
      assert.equal(record.after.r, Math.floor(r / 128) * 128 + (r + 1) % 128);
    }
  }
});

test("Z80 CB memory forms follow live HL and RAM; POP reads caller edits to the current stack", () => {
  const ram = new ObservedRam();
  [0x21, 0, 0x10, 0xcb, 0x86, 0xcb, 0x3e, 0x21, 0xff, 0xff, 0xcb, 0xfe, 0xe5, 0xe1]
    .forEach((byte, offset) => ram.write(0x2000 + offset, byte));
  ram.write(0x1000, 0xff);
  ram.write(0xffff, 0);
  const cpu = new CpuZ80(ram, initialState());
  cpu.step(); // LD HL,1000
  const resetBit = cpu.step(); // RES 0,(HL)
  assert.equal(ram.read(0x1000), 0xfe);
  const saved = structuredClone(resetBit);
  ram.write(0x1000, 0x81);
  const shifted = cpu.step(); // SRL (HL)
  assert.deepEqual(shifted.accesses.slice(2), [{ kind: "read", address: 0x1000, value: 0x81 },
    { kind: "write", address: 0x1000, value: 0x40 }]);
  assert.equal(shifted.after.flags.c, true);
  cpu.step(); // LD HL,FFFF
  const setBit = cpu.step(); // SET 7,(HL)
  assert.deepEqual(setBit.accesses.slice(2), [{ kind: "read", address: 0xffff, value: 0 },
    { kind: "write", address: 0xffff, value: 0x80 }]);
  assert.deepEqual(setBit.after.flags, shifted.after.flags);
  const pushed = cpu.step(); // PUSH HL
  ram.write(pushed.after.sp, 0x34);
  ram.write(pushed.after.sp + 1, 0x12);
  const popped = cpu.step(); // POP HL
  assert.equal(popped.after.hl, 0x1234);
  assert.equal(popped.after.sp, 0xabcd);
  assert.deepEqual(popped.accesses.slice(1), [{ kind: "read", address: 0xabcb, value: 0x34 },
    { kind: "read", address: 0xabcc, value: 0x12 }]);
  assert.deepEqual(resetBit, saved);
});

// The 53 remaining non-I/O, non-interrupt unprefixed forms, listed independently of the decoder.
const baseAdditions = [
  0x00, 0x08, 0x09, 0x19, 0x29, 0x39, 0x02, 0x12, 0x0a, 0x1a, 0x22, 0x2a, 0x3a,
  0x03, 0x13, 0x23, 0x33, 0x0b, 0x1b, 0x2b, 0x3b, 0x34, 0x35, 0x07, 0x0f, 0x17, 0x1f,
  0x27, 0x2f, 0x37, 0x3f, 0xd9, 0xe9, 0xf9, 0xc2, 0xca, 0xd2, 0xda, 0xe2, 0xea, 0xf2, 0xfa,
  0xc3, 0xe3, 0xeb, 0xc7, 0xcf, 0xd7, 0xdf, 0xe7, 0xef, 0xf7, 0xff,
];

function checkBaseStep(ram: ObservedRam, before: CpuZ80State, bytes: readonly number[], changes: Partial<CpuZ80State> = {}, data: readonly CpuZ80MemoryAccess[] = []): void {
  bytes.forEach((value, i) => ram.write((before.pc + i) % 65536, value));
  ram.accesses.length = 0;
  const cpu = new CpuZ80(ram, before);
  const accesses = [...bytes.map((value, i) => ({ kind: "read" as const, address: (before.pc + i) % 65536, value })), ...data];
  const after = snapshot({ ...before, pc: (before.pc + bytes.length) % 65536,
    r: Math.floor(before.r / 128) * 128 + (before.r % 128 + 1) % 128, ...changes });
  assert.deepEqual(cpu.step(), { before: snapshot(before), after, instruction: { address: before.pc, bytes }, accesses, outcome: "executed" });
  assert.deepEqual(cpu.snapshot(), after);
  assert.deepEqual(ram.accesses, accesses);
}

test("Z80 has 250 implemented unprefixed forms, and every new form increments only R bits 0–6 once", () => {
  const ram = new ObservedRam();
  assert.equal(new Set(baseAdditions).size, 53);
  let unprefixed = 0;
  for (let opcode = 0; opcode < 256; opcode++) {
    ram.write(0x2000, opcode); ram.write(0x2001, 0); ram.write(0x2002, 0);
    const record = new CpuZ80(ram, initialState(), { readPort: () => 0, writePort: () => {} }).step();
    if (![0xcb, 0xdd, 0xed, 0xfd].includes(opcode) && record.outcome !== "unsupported") unprefixed++;
  }
  assert.equal(unprefixed, 250);
  for (const opcode of baseAdditions) for (let r = 0; r < 256; r++) {
    const before = initialState({ pc: 0xffff, r });
    ram.write(0xffff, opcode); ram.write(0, 0x80); ram.write(1, 0);
    const record = new CpuZ80(ram, before).step();
    assert.equal(record.outcome, "executed");
    assert.equal(record.after.r, Math.floor(r / 128) * 128 + (r % 128 + 1) % 128);
    assert.equal(record.after.iff1, before.iff1); assert.equal(record.after.iff2, before.iff2);
    assert.equal(record.after.im, before.im); assert.equal(record.after.i, before.i);
    assert.equal(record.after.ix, before.ix); assert.equal(record.after.iy, before.iy);
  }
});

for (const [name, opcode] of [["RLCA", 0x07], ["RRCA", 0x0f], ["RLA", 0x17], ["RRA", 0x1f], ["CPL", 0x2f], ["SCF", 0x37], ["CCF", 0x3f]] as const) {
  test(`Z80 ${name} exhausts A and flag combinations, preserving exactly its documented flags`, () => {
    const ram = new ObservedRam();
    for (let a = 0; a < 256; a++) for (let bits = 0; bits < 64; bits++) {
      const before = initialState({ a, pc: 0xffff, r: 0xff, flags: flagPattern(bits) });
      let result = a;
      const flags = { ...before.flags, h: false, n: false };
      if (name === "CPL") { result = 255 - a; flags.h = flags.n = true; }
      else if (name === "SCF") flags.c = true;
      else if (name === "CCF") { flags.h = before.flags.c; flags.c = !before.flags.c; }
      else {
        const digits = a.toString(2).padStart(8, "0");
        const left = name === "RLCA" || name === "RLA";
        const outgoing = left ? digits[0]! : digits[7]!;
        const incoming = name === "RLCA" || name === "RRCA" ? outgoing : String(Number(before.flags.c));
        result = parseInt(left ? digits.slice(1) + incoming : incoming + digits.slice(0, -1), 2);
        flags.c = outgoing === "1";
      }
      checkBaseStep(ram, before, [opcode], { a: result, flags });
    }
  });
}

test("Z80 accumulator rotates preserve S/Z/PV while their CB counterparts derive them from the result", () => {
  const ram = new ObservedRam();
  for (const [unprefixed, cb] of [[0x07, 0x07], [0x0f, 0x0f], [0x17, 0x17], [0x1f, 0x1f]]) {
    const before = initialState({ a: 0, flags: { s: true, z: false, h: true, pv: false, n: true, c: false } });
    checkBaseStep(ram, before, [unprefixed!], { flags: { ...before.flags, h: false, n: false } });
    ram.write(before.pc, 0xcb); ram.write(before.pc + 1, cb!);
    const record = new CpuZ80(ram, before).step();
    assert.deepEqual(record.after.flags, { s: false, z: true, h: false, pv: true, n: false, c: false });
  }
});

function adjustedDecimal(a: number, old: CpuZ80Flags) {
  const units = a % 16, tens = Math.floor(a / 16);
  // Decimal columns select one of four adjustments; the table also defines arbitrary caller-supplied states.
  const lowCorrection = old.h || units >= 10;
  const carry = old.c || tens * 10 + units >= 100;
  const amount = [0, 6, 96, 102][Number(lowCorrection) + 2 * Number(carry)]!;
  const result = (a + (old.n ? -amount : amount) + 256) % 256;
  const lowTotal = units + (old.n ? -amount % 16 : amount % 16);
  return { a: result, flags: { s: result >= 128, z: result === 0, h: lowTotal < 0 || lowTotal >= 16,
    pv: result.toString(2).replaceAll("0", "").length % 2 === 0, n: old.n, c: carry } };
}

test("Z80 DAA covers every A and flag state, including subtraction states outside valid BCD arithmetic", () => {
  const ram = new ObservedRam();
  for (let a = 0; a < 256; a++) for (let bits = 0; bits < 64; bits++) {
    const before = initialState({ a, flags: flagPattern(bits), pc: 0xffff });
    checkBaseStep(ram, before, [0x27], adjustedDecimal(a, before.flags));
  }
});

test("Z80 ADC/SBC followed by DAA matches decimal arithmetic for every valid packed-BCD pair and carry/borrow", () => {
  const ram = new ObservedRam();
  const bcd = (value: number) => Math.floor(value / 10) * 16 + value % 10;
  for (const subtract of [false, true]) for (let left = 0; left < 100; left++) for (let right = 0; right < 100; right++) for (const carry of [false, true]) {
    const total = left + (subtract ? -right - Number(carry) : right + Number(carry));
    const result = bcd((total + 100) % 100);
    const before = initialState({ a: bcd(left), flags: { ...flagPattern(63), c: carry } });
    const bytes = [subtract ? 0xde : 0xce, bcd(right), 0x27];
    bytes.forEach((value, i) => ram.write(before.pc + i, value));
    const cpu = new CpuZ80(ram, before);
    cpu.step();
    const decimal = cpu.step();
    assert.equal(decimal.after.a, result);
    assert.equal(decimal.after.flags.c, total < 0 || total >= 100);
    assert.equal(decimal.after.flags.n, subtract);
    assert.equal(decimal.after.flags.s, result >= 128);
    assert.equal(decimal.after.flags.z, result === 0);
    assert.equal(decimal.after.flags.pv, result.toString(2).replaceAll("0", "").length % 2 === 0);
    assert.deepEqual(decimal.after.alternate, snapshot(before).alternate);
  }
});

const wordPairForms = [
  { high: "b", low: "c", inc: 0x03, dec: 0x0b, add: 0x09 },
  { high: "d", low: "e", inc: 0x13, dec: 0x1b, add: 0x19 },
  { high: "h", low: "l", inc: 0x23, dec: 0x2b, add: 0x29 },
  { high: null, low: null, inc: 0x33, dec: 0x3b, add: 0x39 },
] as const;

function withPair(state: CpuZ80State, form: typeof wordPairForms[number], value: number): CpuZ80State {
  return form.high === null ? { ...state, sp: value } : { ...state, [form.high]: Math.floor(value / 256), [form.low]: value % 256 };
}

for (const form of wordPairForms) {
  test(`Z80 pair INC/DEC ${form.high ?? "SP"} wraps every word and preserves every flag and the alternate bank`, () => {
    const ram = new ObservedRam();
    for (let value = 0; value < 65536; value++) for (const delta of [1, -1]) {
      const before = withPair(initialState({ pc: 0xffff, flags: flagPattern(value % 64) }), form, value);
      checkBaseStep(ram, before, [delta === 1 ? form.inc : form.dec],
        { ...withPair(before, form, (value + delta + 65536) % 65536), pc: 0, r: 0xff });
    }
  });

  test(`Z80 ADD HL form ${form.add.toString(16)} covers every word and half-carry boundaries while preserving S/Z/PV`, () => {
    const ram = new ObservedRam();
    const check = (left: number, right: number, flags: CpuZ80Flags) => {
      const before = withPair(initialState({ h: Math.floor(left / 256), l: left % 256, flags, pc: 0xffff }), form, right);
      const hl = before.h * 256 + before.l;
      const total = hl + right, result = total % 65536;
      checkBaseStep(ram, before, [form.add], { h: Math.floor(result / 256), l: result % 256,
        flags: { ...flags, h: hl % 4096 + right % 4096 >= 4096, n: false, c: total >= 65536 } });
    };
    const boundaries = [0, 1, 0x0fff, 0x1000, 0x7fff, 0x8000, 0xffff];
    for (let value = 0; value < 65536; value++) {
      check(value, form.high === "h" ? value : boundaries[value % boundaries.length]!, flagPattern(value % 64));
      if (form.high !== "h") check(boundaries[value % boundaries.length]!, value, flagPattern(63 - value % 64));
    }
    for (const left of boundaries) for (const right of boundaries) for (let bits = 0; bits < 64; bits++) check(left, right, flagPattern(bits));
  });
}

for (const [opcode, delta] of [[0x34, 1], [0x35, -1]] as const) {
  test(`Z80 ${delta === 1 ? "INC" : "DEC"} (HL) exhausts byte/flag values and records an explicit read then write`, () => {
    const ram = new ObservedRam();
    for (let value = 0; value < 256; value++) for (let bits = 0; bits < 64; bits++) {
      const before = initialState({ h: 0xff, l: 0xff, flags: flagPattern(bits) });
      const result = (value + delta + 256) % 256;
      const signed = (value < 128 ? value : value - 256) + delta;
      ram.write(0xffff, value);
      checkBaseStep(ram, before, [opcode], { flags: { s: result >= 128, z: result === 0,
        h: value % 16 + delta < 0 || value % 16 + delta > 15,
        pv: signed < -128 || signed > 127, n: delta < 0, c: before.flags.c } },
      [{ kind: "read", address: 0xffff, value }, { kind: "write", address: 0xffff, value: result }]);
    }
    const before = initialState({ pc: 0xffff, h: 0xff, l: 0xff });
    const result = opcode + delta;
    checkBaseStep(ram, before, [opcode], { flags: { s: false, z: false, h: false, pv: false, n: delta < 0, c: false } },
      [{ kind: "read", address: 0xffff, value: opcode }, { kind: "write", address: 0xffff, value: result }]);
  });
}

test("Z80 BC/DE and absolute A transfers cover bytes, flags, wrapping, code overlap, and unchanged writes", () => {
  const ram = new ObservedRam();
  for (const opcode of [0x02, 0x12, 0x0a, 0x1a, 0x3a]) for (const pc of [0x2000, 0xffff]) {
    for (const address of [0, 1, 0xffff, pc, (pc + 1) % 65536, (pc + 2) % 65536]) for (let value = 0; value < 256; value++) {
      const store = opcode === 0x02 || opcode === 0x12;
      let before = initialState({ a: value, pc, flags: flagPattern(value % 64) });
      if (opcode !== 0x3a) before = withPair(before, wordPairForms[opcode === 0x02 || opcode === 0x0a ? 0 : 1], address);
      const bytes = opcode === 0x3a ? [opcode, address % 256, Math.floor(address / 256)] : [opcode];
      const image = new Map([[address, value]]);
      bytes.forEach((byte, i) => image.set((pc + i) % 65536, byte));
      ram.write(address, value);
      checkBaseStep(ram, before, bytes, store ? {} : { a: image.get(address)! },
        [{ kind: store ? "write" : "read", address, value: store ? value : image.get(address)! }]);
    }
  }
});

for (const opcode of [0x22, 0x2a]) {
  test(`Z80 ${opcode === 0x22 ? "LD (nn),HL" : "LD HL,(nn)"} covers every word and wrapped or overlapping instruction/data bytes`, () => {
    const ram = new ObservedRam();
    for (let value = 0; value < 65536; value++) {
      const pc = value % 2 === 0 ? 0xffff : 0x2000;
      const address = [0, 1, 0xffff, pc, (pc + 1) % 65536, (pc + 2) % 65536][value % 6]!;
      const highAddress = (address + 1) % 65536;
      const before = initialState({ h: Math.floor(value / 256), l: value % 256, flags: flagPattern(value % 64), pc });
      const bytes = [opcode, address % 256, Math.floor(address / 256)];
      const image = new Map([[address, value % 256], [highAddress, Math.floor(value / 256)]]);
      bytes.forEach((byte, i) => image.set((pc + i) % 65536, byte));
      for (const [a, v] of image) ram.write(a, v);
      const store = opcode === 0x22;
      const low = store ? value % 256 : image.get(address)!;
      const high = store ? Math.floor(value / 256) : image.get(highAddress)!;
      checkBaseStep(ram, before, bytes, store ? {} : { h: high, l: low }, [
        { kind: store ? "write" : "read", address, value: low },
        { kind: store ? "write" : "read", address: highAddress, value: high },
      ]);
    }
  });
}

test("Z80 EX AF,AF' and EXX swap disjoint register sets, restore both banks, and preserve detached snapshots", () => {
  const ram = new ObservedRam();
  for (const opcode of [0x08, 0xd9]) for (let mainBits = 0; mainBits < 64; mainBits++) for (let alternateBits = 0; alternateBits < 64; alternateBits++) {
    const before = initialState({ flags: flagPattern(mainBits) });
    before.alternate.flags = flagPattern(alternateBits);
    const after = structuredClone(before);
    if (opcode === 0x08) {
      after.a = before.alternate.a; after.alternate.a = before.a;
      after.flags = before.alternate.flags; after.alternate.flags = before.flags;
    } else for (const register of ["b", "c", "d", "e", "h", "l"] as const) {
      after[register] = before.alternate[register]; after.alternate[register] = before[register];
    }
    checkBaseStep(ram, before, [opcode], { ...after, pc: before.pc + 1, r: 0xff });
    ram.write(before.pc + 1, opcode);
    const cpu = new CpuZ80(ram, before);
    const first = cpu.step();
    const saved = structuredClone(first);
    const restored = new CpuZ80(ram, cpu.snapshot());
    assert.deepEqual(restored.step().after, snapshot({ ...before, pc: before.pc + 2, r: 0x80 }));
    assert.deepEqual(first, saved);
  }
  // A later ALU flag replacement must affect only the currently selected AF bank.
  const before = initialState();
  [0x08, 0xc6, 1, 0x08].forEach((byte, i) => ram.write(before.pc + i, byte));
  const cpu = new CpuZ80(ram, before);
  const swapped = cpu.step();
  const saved = structuredClone(swapped);
  cpu.step();
  const restored = cpu.step();
  assert.equal(restored.after.a, before.a);
  assert.deepEqual(restored.after.flags, before.flags);
  assert.equal(restored.after.alternate.a, 0x89);
  assert.deepEqual(restored.after.alternate.flags, addition(0x88, 1).flags);
  cpu.reset();
  assert.deepEqual(swapped, saved);
});

test("Z80 EX DE,HL, JP (HL), and LD SP,HL handle all word values without data accesses or flag changes", () => {
  const ram = new ObservedRam();
  for (let hl = 0; hl < 65536; hl++) {
    const de = 65535 - hl;
    const before = initialState({ h: Math.floor(hl / 256), l: hl % 256, d: Math.floor(de / 256), e: de % 256,
      pc: 0xffff, flags: flagPattern(hl % 64) });
    checkBaseStep(ram, before, [0xeb], { d: before.h, e: before.l, h: before.d, l: before.e });
    checkBaseStep(ram, before, [0xe9], { pc: hl });
    checkBaseStep(ram, before, [0xf9], { sp: hl });
  }
});

test("Z80 EX (SP),HL covers every stack address with low/high reads, high/low writes, and unchanged SP", () => {
  const ram = new ObservedRam();
  for (let sp = 0; sp < 65536; sp++) {
    const highAddress = (sp + 1) % 65536;
    const before = initialState({ sp, h: sp % 256, l: Math.floor(sp / 256), flags: flagPattern(sp % 64), pc: 0xffff });
    const low = sp === before.pc ? 0xe3 : 0xa5;
    const high = highAddress === before.pc ? 0xe3 : 0x5a;
    ram.write(sp, low); ram.write(highAddress, high);
    checkBaseStep(ram, before, [0xe3], { h: high, l: low }, [
      { kind: "read", address: sp, value: low }, { kind: "read", address: highAddress, value: high },
      { kind: "write", address: highAddress, value: before.h }, { kind: "write", address: sp, value: before.l },
    ]);
  }
});

// Truth sets encode Z,C,PV,S as bits 0,1,2,3, independently of the decoder's condition callbacks.
const absoluteJumps = [
  [0xc2, [0, 2, 4, 6, 8, 10, 12, 14]], [0xca, [1, 3, 5, 7, 9, 11, 13, 15]],
  [0xd2, [0, 1, 4, 5, 8, 9, 12, 13]], [0xda, [2, 3, 6, 7, 10, 11, 14, 15]],
  [0xe2, [0, 1, 2, 3, 8, 9, 10, 11]], [0xea, [4, 5, 6, 7, 12, 13, 14, 15]],
  [0xf2, [0, 1, 2, 3, 4, 5, 6, 7]], [0xfa, [8, 9, 10, 11, 12, 13, 14, 15]],
  [0xc3, Array.from({ length: 16 }, (_, i) => i)],
] as const;

test("Z80 absolute jumps test all conditions and flags, fetch both address bytes on each path, and do not read targets", () => {
  const ram = new ObservedRam();
  for (const [opcode, truthSet] of absoluteJumps) for (let bits = 0; bits < 64; bits++) {
    for (const pc of [0x2000, 0xfffe, 0xffff]) for (const target of [0, 1, 0x2000, 0x2001, 0x7fff, 0x8000, 0xffff]) {
      const flags = flagPattern(bits);
      const code = Number(flags.z) + 2 * Number(flags.c) + 4 * Number(flags.pv) + 8 * Number(flags.s);
      const take = (truthSet as readonly number[]).includes(code);
      checkBaseStep(ram, initialState({ pc, flags }), [opcode, target % 256, Math.floor(target / 256)], { pc: take ? target : (pc + 3) % 65536 });
    }
  }
});

test("Z80 RST uses every fixed vector as an ordinary call with wrapped return addresses and overlapping stack writes", () => {
  const ram = new ObservedRam();
  for (const [opcode, target] of [[0xc7, 0], [0xcf, 8], [0xd7, 0x10], [0xdf, 0x18], [0xe7, 0x20], [0xef, 0x28], [0xf7, 0x30], [0xff, 0x38]]) {
    for (let bits = 0; bits < 64; bits++) for (const pc of [0x2000, 0xffff, target!]) {
      for (const sp of [0, 1, 0xffff, pc, (pc + 1) % 65536, (pc + 2) % 65536]) {
        const before = initialState({ pc, sp, flags: flagPattern(bits), iff1: false, iff2: true });
        const next = (pc + 1) % 65536;
        checkBaseStep(ram, before, [opcode!], { pc: target!, sp: (sp + 65534) % 65536 }, [
          { kind: "write", address: (sp + 65535) % 65536, value: Math.floor(next / 256) },
          { kind: "write", address: (sp + 65534) % 65536, value: next % 256 },
        ]);
      }
    }
  }
});

test("Z80 word loads and stack exchanges observe edited RAM and leave earlier records detached through reset", () => {
  const ram = new ObservedRam();
  const before = initialState({ sp: 0x3000 });
  [0x2a, 0, 0x30, 0xe3, 0xe9].forEach((value, i) => ram.write(before.pc + i, value));
  ram.write(0x3000, 0x34); ram.write(0x3001, 0x12);
  const cpu = new CpuZ80(ram, before);
  const load = cpu.step(), saved = structuredClone(load);
  assert.equal(load.after.hl, 0x1234);
  ram.write(0x3000, 0x78); ram.write(0x3001, 0x56);
  const resumed = new CpuZ80(ram, cpu.snapshot());
  assert.equal(resumed.step().after.hl, 0x5678);
  assert.equal(ram.read(0x3000), 0x34); assert.equal(ram.read(0x3001), 0x12);
  assert.equal(resumed.step().after.pc, 0x5678);
  resumed.reset();
  assert.deepEqual(load, saved);
  assert.equal(cpu.snapshot().hl, 0x1234);
});

// Documented prefix-page inventories transcribed independently of the implementation's patterns.
const indexOpcodes = [0x09, 0x19, 0x21, 0x22, 0x23, 0x29, 0x2a, 0x2b, 0x34, 0x35, 0x36, 0x39,
  0x46, 0x4e, 0x56, 0x5e, 0x66, 0x6e, 0x70, 0x71, 0x72, 0x73, 0x74, 0x75, 0x77, 0x7e,
  0x86, 0x8e, 0x96, 0x9e, 0xa6, 0xae, 0xb6, 0xbe, 0xe1, 0xe3, 0xe5, 0xe9, 0xf9];
const edOpcodes = [
  0x40, 0x48, 0x50, 0x58, 0x60, 0x68, 0x78, 0x41, 0x49, 0x51, 0x59, 0x61, 0x69, 0x79,
  0xa2, 0xa3, 0xaa, 0xab, 0xb2, 0xb3, 0xba, 0xbb,
  0x42, 0x43, 0x44, 0x47, 0x4a, 0x4b, 0x4f, 0x52, 0x53, 0x57, 0x5a, 0x5b, 0x5f,
  0x62, 0x63, 0x67, 0x6a, 0x6b, 0x6f, 0x72, 0x73, 0x7a, 0x7b, 0xa0, 0xa1, 0xa8, 0xa9, 0xb0, 0xb1, 0xb8, 0xb9];
const indexes = [{ prefix: 0xdd, index: "ix" }, { prefix: 0xfd, index: "iy" }] as const;
const readAccess = (address: number, value: number): CpuZ80MemoryAccess => ({ kind: "read", address, value });
const writeAccess = (address: number, value: number): CpuZ80MemoryAccess => ({ kind: "write", address, value });
const refreshTwice = (r: number): number => Math.floor(r / 128) * 128 + (r + 2) % 128;

function checkPrefixedStep(ram: ObservedRam, before: CpuZ80State, bytes: readonly number[], changes: Partial<CpuZ80State> = {}, data: readonly CpuZ80MemoryAccess[] = []): void {
  checkBaseStep(ram, before, bytes, { r: refreshTwice(before.r), ...changes }, data);
}

test("Z80 completes 691 documented forms; every other prefix encoding rejects atomically", () => {
  const ram = new ObservedRam();
  const pages = [
    { prefix: [0xed], codes: edOpcodes },
    ...indexes.flatMap(({ prefix }) => [{ prefix: [prefix], codes: indexOpcodes },
      { prefix: [prefix, 0xcb, 0x80], codes: cbRows.map(row => row.base + 6) }]),
  ];
  assert.equal(250 + 248 + pages.reduce((sum, page) => sum + new Set(page.codes).size, 0), 691);
  for (const { prefix, codes } of pages) for (let opcode = 0; opcode < 256; opcode++) {
    // CB on DD/FD is a further page selector, checked separately with all final bytes.
    if (prefix.length === 1 && prefix[0] !== 0xed && opcode === 0xcb) continue;
    const bytes = [...prefix, opcode];
    const before = initialState({ pc: 0xffff, r: 0xff });
    [...bytes, 0, 0].forEach((byte, i) => ram.write((before.pc + i) % 65536, byte));
    const cpu = new CpuZ80(ram, before, { readPort: () => 0, writePort: () => {} });
    ram.accesses.length = 0;
    if (codes.includes(opcode)) {
      const record = cpu.step();
      assert.equal(record.outcome, "executed", bytes.toString());
      assert.equal(record.after.r, prefix[0] === 0xed && opcode === 0x4f ? before.a : 0x81);
    } else for (let attempt = 0; attempt < 2; attempt++) {
      ram.accesses.length = 0;
      const accesses = bytes.map((value, i) => readAccess((before.pc + i) % 65536, value));
      assert.deepEqual(cpu.step(), { before: snapshot(before), after: snapshot(before), outcome: "unsupported", reason: "opcode",
        instruction: { address: before.pc, bytes }, accesses });
      assert.deepEqual(ram.accesses, accesses);
    }
  }
  // Every supported new form observes all 256 initial R values, including LD A,R and LD R,A.
  for (const { prefix, codes } of pages) for (const opcode of codes) for (let r = 0; r < 256; r++) {
    const before = initialState({ r });
    [...prefix, opcode, 0, 0].forEach((byte, i) => ram.write(before.pc + i, byte));
    const record = new CpuZ80(ram, before, { readPort: () => 0, writePort: () => {} }).step();
    assert.equal(record.outcome, "executed");
    assert.equal(record.after.r, prefix[0] === 0xed && opcode === 0x4f ? before.a : refreshTwice(r));
    assert.equal(record.after.iff1, before.iff1); assert.equal(record.after.iff2, before.iff2);
    assert.equal(record.after.im, before.im);
  }
});

for (const { prefix, index } of indexes) {
  test(`Z80 ${index.toUpperCase()} byte transfers use signed displacement, real H/L, and captured immediate bytes`, () => {
    const ram = new ObservedRam();
    const transfers = [
      { register: "b", load: 0x46, store: 0x70 }, { register: "c", load: 0x4e, store: 0x71 },
      { register: "d", load: 0x56, store: 0x72 }, { register: "e", load: 0x5e, store: 0x73 },
      { register: "h", load: 0x66, store: 0x74 }, { register: "l", load: 0x6e, store: 0x75 },
      { register: "a", load: 0x7e, store: 0x77 },
    ] as const;
    for (let displacement = 0; displacement < 256; displacement++) for (const pointer of [0, 0xffff]) {
      const target = (pointer + (displacement < 128 ? displacement : displacement - 256) + 65536) % 65536;
      const value = (displacement * 37 + 11) % 256;
      const before = initialState({ [index]: pointer, flags: flagPattern(displacement % 64) });
      for (const { register, load, store } of transfers) {
        ram.write(target, value);
        checkPrefixedStep(ram, before, [prefix, load, displacement], { [register]: value }, [readAccess(target, value)]);
        checkPrefixedStep(ram, { ...before, [register]: value }, [prefix, store, displacement], {}, [writeAccess(target, value)]);
      }
      checkPrefixedStep(ram, before, [prefix, 0x36, displacement, value], {}, [writeAccess(target, value)]);
    }
    for (const target of [0xffff, 0, 1, 2]) {
      // The immediate store can overwrite its prefix, opcode, displacement, or immediate.
      const before = initialState({ pc: 0xffff, [index]: target });
      checkPrefixedStep(ram, before, [prefix, 0x36, 0, 0x9a], {}, [writeAccess(target, 0x9a)]);
    }
  });

  test(`Z80 ${index.toUpperCase()} memory ALU and INC/DEC share byte semantics without changing the pointer`, () => {
    const ram = new ObservedRam();
    for (let value = 0; value < 256; value++) for (const carry of [false, true]) {
      const before = initialState({ a: (value * 73 + 7) % 256, [index]: 0x80, flags: { ...flagPattern(value % 32), c: carry } });
      ram.write(0, value);
      for (const { name, opcodes } of aluForms) {
        checkPrefixedStep(ram, before, [prefix, opcodes[6]!, 0x80], expectedAlu(name, before.a, value, carry), [readAccess(0, value)]);
      }
      for (const [opcode, delta] of [[0x34, 1], [0x35, -1]] as const) {
        ram.write(0, value);
        const result = (value + delta + 256) % 256;
        const signed = (value < 128 ? value : value - 256) + delta;
        checkPrefixedStep(ram, before, [prefix, opcode, 0x80], { flags: {
          s: result >= 128, z: result === 0, h: value % 16 + delta < 0 || value % 16 + delta > 15,
          pv: signed < -128 || signed > 127, n: delta < 0, c: carry,
        } }, [readAccess(0, value), writeAccess(0, result)]);
      }
    }
  });

  test(`Z80 ${index.toUpperCase()} word operations preserve byte registers and flags, with wrapped data and stack order`, () => {
    const ram = new ObservedRam();
    const boundaries = [0, 1, 0xff, 0x0fff, 0x1000, 0x7fff, 0x8000, 0xffff];
    for (const value of boundaries) for (let bits = 0; bits < 64; bits++) {
      const before = initialState({ pc: 0xfffe, [index]: value, sp: 0xffff, flags: flagPattern(bits) });
      const immediate = value ^ 0xffff;
      checkPrefixedStep(ram, before, [prefix, 0x21, immediate % 256, Math.floor(immediate / 256)], { [index]: immediate });
      checkPrefixedStep(ram, before, [prefix, 0x23], { [index]: (value + 1) % 65536 });
      checkPrefixedStep(ram, before, [prefix, 0x2b], { [index]: (value + 65535) % 65536 });
      checkPrefixedStep(ram, before, [prefix, 0xe9], { pc: value });
      checkPrefixedStep(ram, before, [prefix, 0xf9], { sp: value });
      for (const [pair, opcode] of [["bc", 0x09], ["de", 0x19], [index, 0x29], ["sp", 0x39]] as const) {
        const right = pair === "bc" ? 0x2233 : pair === "de" ? 0x4455 : before[pair];
        const sum = value + right;
        checkPrefixedStep(ram, before, [prefix, opcode], { [index]: sum % 65536,
          flags: { ...before.flags, h: value % 4096 + right % 4096 >= 4096, n: false, c: sum >= 65536 } });
      }
      // Data/stack wraps across FFFF; code is elsewhere for these cases.
      const state = { ...before, pc: 0x2000 };
      ram.write(0xffff, 0x34); ram.write(0, 0x12);
      checkPrefixedStep(ram, state, [prefix, 0x2a, 0xff, 0xff], { [index]: 0x1234 }, [readAccess(0xffff, 0x34), readAccess(0, 0x12)]);
      checkPrefixedStep(ram, state, [prefix, 0xe1], { [index]: 0x1234, sp: 1 }, [readAccess(0xffff, 0x34), readAccess(0, 0x12)]);
      checkPrefixedStep(ram, state, [prefix, 0xe3], { [index]: 0x1234 },
        [readAccess(0xffff, 0x34), readAccess(0, 0x12), writeAccess(0, Math.floor(value / 256)), writeAccess(0xffff, value % 256)]);
      checkPrefixedStep(ram, state, [prefix, 0x22, 0xff, 0xff], {}, [writeAccess(0xffff, value % 256), writeAccess(0, Math.floor(value / 256))]);
      checkPrefixedStep(ram, { ...state, sp: 1 }, [prefix, 0xe5], { sp: 0xffff }, [writeAccess(0, Math.floor(value / 256)), writeAccess(0xffff, value % 256)]);
    }
    // Stack can contain either encoding byte; both fetches precede data access.
    for (const sp of [0xffff, 0, 1]) {
      const before = initialState({ pc: 0xffff, sp, [index]: 0x7e9a });
      ram.write(1, 0x56); ram.write(2, 0x34);
      const low = sp === 0xffff ? prefix : sp === 0 ? 0xe3 : 0x56;
      const high = sp === 0xffff ? 0xe3 : sp === 0 ? 0x56 : 0x34;
      checkPrefixedStep(ram, before, [prefix, 0xe3], { [index]: high * 256 + low },
        [readAccess(sp, low), readAccess((sp + 1) % 65536, high), writeAccess((sp + 1) % 65536, 0x7e), writeAccess(sp, 0x9a)]);
    }
  });

  test(`Z80 ${index.toUpperCase()} CB covers every documented operation, byte, displacement, and carry`, () => {
    const ram = new ObservedRam();
    for (const { name, bit, base } of cbRows) for (let value = 0; value < 256; value++) for (const carry of [false, true]) {
      const displacement = (value * 17) % 256;
      const target = (displacement < 128 ? displacement : displacement - 256) + 1;
      const address = (target + 65536) % 65536;
      const before = initialState({ [index]: 1, r: value, flags: { ...flagPattern(value % 32), c: carry } });
      const expected = expectedCb(name, bit, value, before.flags);
      ram.write(address, value);
      checkPrefixedStep(ram, before, [prefix, 0xcb, displacement, base + 6], { flags: expected.flags },
        [readAccess(address, value), ...(name === "BIT" ? [] : [writeAccess(address, expected.value)])]);
    }
    for (const { name, bit, base } of cbRows) for (let overlap = 0; overlap < 4; overlap++) {
      const bytes = [prefix, 0xcb, 0, base + 6];
      const address = (0xfffe + overlap) % 65536;
      const before = initialState({ pc: 0xfffe, [index]: address });
      const value = bytes[overlap]!;
      const expected = expectedCb(name, bit, value, before.flags);
      checkPrefixedStep(ram, before, bytes, { flags: expected.flags },
        [readAccess(address, value), ...(name === "BIT" ? [] : [writeAccess(address, expected.value)])]);
    }
  });
}

const edWords = [
  { ...wordPairForms[0], adc: 0x4a, sbc: 0x42, load: 0x4b, store: 0x43 },
  { ...wordPairForms[1], adc: 0x5a, sbc: 0x52, load: 0x5b, store: 0x53 },
  { ...wordPairForms[2], adc: 0x6a, sbc: 0x62, load: 0x6b, store: 0x63 },
  { ...wordPairForms[3], adc: 0x7a, sbc: 0x72, load: 0x7b, store: 0x73 },
] as const;

for (const form of edWords) {
  test(`Z80 ED word arithmetic ${form.high ?? "SP"} uses full-word S/Z/overflow and bit-11 half carry`, () => {
    const ram = new ObservedRam();
    const boundaries = [0, 1, 0x0ffe, 0x0fff, 0x1000, 0x7ffe, 0x7fff, 0x8000, 0x8001, 0xfffe, 0xffff];
    const signed = (value: number): number => value < 32768 ? value : value - 65536;
    for (const left of boundaries) for (const right of boundaries) for (let bits = 0; bits < 64; bits++) for (const subtract of [false, true]) {
      const before = withPair(initialState({ h: Math.floor(left / 256), l: left % 256, flags: flagPattern(bits), pc: 0xffff }), form, right);
      const hl = before.h * 256 + before.l, carry = Number(before.flags.c);
      const total = subtract ? hl - right - carry : hl + right + carry;
      const signedTotal = subtract ? signed(hl) - signed(right) - carry : signed(hl) + signed(right) + carry;
      const lowTotal = subtract ? hl % 4096 - right % 4096 - carry : hl % 4096 + right % 4096 + carry;
      const result = (total + 65536) % 65536;
      checkPrefixedStep(ram, before, [0xed, subtract ? form.sbc : form.adc], {
        h: Math.floor(result / 256), l: result % 256,
        flags: { s: result >= 32768, z: result === 0, h: lowTotal < 0 || lowTotal >= 4096,
          pv: signedTotal < -32768 || signedTotal > 32767, n: subtract, c: total < 0 || total >= 65536 },
      });
    }
  });

  test(`Z80 ED word transfers ${form.high ?? "SP"} capture addresses and transfer low/high across wrap and code overlap`, () => {
    const ram = new ObservedRam();
    for (const target of [0, 0xffff, 0x2000, 0x2001, 0x2002, 0x2003]) for (let bits = 0; bits < 64; bits++) {
      const before = withPair(initialState({ flags: flagPattern(bits) }), form, 0x9a7e);
      const addressBytes = [target % 256, Math.floor(target / 256)];
      const bytes = [0xed, form.load, ...addressBytes];
      const initialByte = (address: number) => address >= 0x2000 && address < 0x2004 ? bytes[address - 0x2000]!
        : address === target ? 0x34 : 0x12;
      ram.write(target, 0x34); ram.write((target + 1) % 65536, 0x12);
      const low = initialByte(target), high = initialByte((target + 1) % 65536);
      const loaded = withPair(before, form, high * 256 + low);
      checkPrefixedStep(ram, before, bytes, { ...loaded, pc: 0x2004, r: refreshTwice(before.r) },
        [readAccess(target, low), readAccess((target + 1) % 65536, high)]);
      checkPrefixedStep(ram, before, [0xed, form.store, ...addressBytes], {},
        [writeAccess(target, 0x7e), writeAccess((target + 1) % 65536, 0x9a)]);
    }
  });
}

test("Z80 NEG checks every A and flag pattern, including zero and signed overflow", () => {
  const ram = new ObservedRam();
  for (let a = 0; a < 256; a++) for (let bits = 0; bits < 64; bits++) {
    checkPrefixedStep(ram, initialState({ a, flags: flagPattern(bits) }), [0xed, 0x44], expectedAlu("SUB", 0, a, false));
  }
});

test("Z80 special-register transfers distinguish IFF2 from IFF1 and observe R after opcode fetches", () => {
  const ram = new ObservedRam();
  for (let value = 0; value < 256; value++) for (let bits = 0; bits < 64; bits++) for (const iff2 of [false, true]) {
    const before = initialState({ a: value, i: value ^ 0xff, r: (value + 51) % 256, iff1: !iff2, iff2, flags: flagPattern(bits), pc: 0xffff });
    checkPrefixedStep(ram, before, [0xed, 0x47], { i: value });
    checkPrefixedStep(ram, before, [0xed, 0x4f], { r: value });
    for (const [opcode, a] of [[0x57, before.i], [0x5f, refreshTwice(before.r)]] as const) {
      checkPrefixedStep(ram, before, [0xed, opcode], { a, flags: { s: a >= 128, z: a === 0, h: false, pv: iff2, n: false, c: before.flags.c } });
    }
  }
  [0xed, 0x4f, 0xed, 0x5f, 0x00].forEach((value, i) => ram.write(0x2000 + i, value));
  const cpu = new CpuZ80(ram, initialState({ a: 0xff, r: 0 }));
  assert.equal(cpu.step().after.r, 0xff);
  const saved = cpu.step();
  assert.equal(saved.after.a, 0x81); assert.equal(saved.after.r, 0x81);
  const retained = structuredClone(saved);
  assert.equal(cpu.step().after.r, 0x82);
  cpu.reset();
  assert.deepEqual(saved, retained);
});

for (const [opcode, left] of [[0x67, false], [0x6f, true]] as const) {
  test(`Z80 ${left ? "RLD" : "RRD"} covers every A/memory pair and preserves carry`, () => {
    const ram = new ObservedRam();
    const check = (a: number, value: number, flags: CpuZ80Flags, address = 0xffff) => {
      const before = initialState({ a, flags, h: Math.floor(address / 256), l: address % 256 });
      // Rotate the three hexadecimal digits as characters, independently of core nibble masks.
      const digits = (a % 16).toString(16) + value.toString(16).padStart(2, "0");
      const rotated = left ? digits.slice(1) + digits[0] : digits[2] + digits.slice(0, 2);
      const nextA = Math.floor(a / 16) * 16 + Number.parseInt(rotated[0]!, 16);
      const nextMemory = Number.parseInt(rotated.slice(1), 16);
      ram.write(address, value);
      checkPrefixedStep(ram, before, [0xed, opcode], { a: nextA, flags: {
        s: nextA >= 128, z: nextA === 0, h: false,
        pv: nextA.toString(2).replaceAll("0", "").length % 2 === 0, n: false, c: flags.c,
      } }, [readAccess(address, value), writeAccess(address, nextMemory)]);
    };
    for (let a = 0; a < 256; a++) for (let value = 0; value < 256; value++) check(a, value, flagPattern((a + value) % 64));
    for (let bits = 0; bits < 64; bits++) for (const a of [0, 0x11, 0x7f, 0x80, 0xff]) for (const value of [0, 0x11, 0x7f, 0x80, 0xff]) check(a, value, flagPattern(bits));
    check(0xed, 0xed, flagPattern(63), 0x2000);
    check(0x11, opcode, flagPattern(0), 0x2001);
  });
}

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

// Observe the real RAM/device calls in one order, independently of the CPU's recorders.
class IoRam extends Ram {
  readonly accesses: CpuZ80Access[] = [];
  input = 0;
  observe?: (kind: CpuZ80Access["kind"], address: number, value?: number) => void;
  constructor() { super(0x10000); }
  override read(address: number): number {
    this.observe?.("read", address);
    const value = super.read(address);
    this.accesses.push({ kind: "read", address, value });
    return value;
  }
  override write(address: number, value: number): void {
    this.observe?.("write", address, value);
    super.write(address, value);
    this.accesses.push({ kind: "write", address, value });
  }
  readonly ports: BytePorts = {
    readPort: port => {
      this.observe?.("input", port);
      this.accesses.push({ kind: "input", port, value: this.input });
      return this.input;
    },
    writePort: (port, value) => {
      this.observe?.("output", port, value);
      this.accesses.push({ kind: "output", port, value });
    },
  };
}

const ioRegisters = [
  { register: "b", input: 0x40, output: 0x41 }, { register: "c", input: 0x48, output: 0x49 },
  { register: "d", input: 0x50, output: 0x51 }, { register: "e", input: 0x58, output: 0x59 },
  { register: "h", input: 0x60, output: 0x61 }, { register: "l", input: 0x68, output: 0x69 },
  { register: "a", input: 0x78, output: 0x79 },
] as const;
const blockIoForms = [
  { name: "INI", opcode: 0xa2, output: false, delta: 1, repeat: false },
  { name: "IND", opcode: 0xaa, output: false, delta: -1, repeat: false },
  { name: "INIR", opcode: 0xb2, output: false, delta: 1, repeat: true },
  { name: "INDR", opcode: 0xba, output: false, delta: -1, repeat: true },
  { name: "OUTI", opcode: 0xa3, output: true, delta: 1, repeat: false },
  { name: "OUTD", opcode: 0xab, output: true, delta: -1, repeat: false },
  { name: "OTIR", opcode: 0xb3, output: true, delta: 1, repeat: true },
  { name: "OTDR", opcode: 0xbb, output: true, delta: -1, repeat: true },
] as const;

function parityByDigits(value: number): boolean {
  return [...value.toString(2)].filter(bit => bit === "1").length % 2 === 0;
}

for (const output of [false, true]) {
  test(`Z80 immediate ${output ? "OUT" : "IN"} uses old A and every low address byte, preserving all flags`, () => {
    const ram = new IoRam();
    const opcode = output ? 0xd3 : 0xdb;
    for (const a of [0, 0x7f, 0x80, 0xff]) for (let low = 0; low < 256; low++) for (let f = 0; f < 64; f++) {
      const state = initialState({ a, pc: 0xffff, r: f * 4 + low % 4, flags: flagPattern(f) });
      ram.write(0xffff, opcode); ram.write(0, low); ram.input = 255 - low;
      const cpu = new CpuZ80(ram, state, ram.ports);
      ram.accesses.length = 0;
      const record = cpu.step();
      const accesses = [readAccess(0xffff, opcode), readAccess(0, low),
        { kind: output ? "output" : "input", port: a * 256 + low, value: output ? a : ram.input }];
      assert.deepEqual(record, { before: snapshot(state), after: snapshot({ ...state, pc: 1,
        r: Math.floor(state.r / 128) * 128 + (state.r + 1) % 128, a: output ? a : ram.input }),
        instruction: { address: 0xffff, bytes: [opcode, low] }, accesses, outcome: "executed" });
      assert.deepEqual(ram.accesses, accesses);
    }
  });
}

for (const { register, input, output } of ioRegisters) {
  test(`Z80 IN/OUT ${register.toUpperCase()} through BC covers every byte and flag pattern, including address-register aliases`, () => {
    const ram = new IoRam();
    for (let value = 0; value < 256; value++) for (let f = 0; f < 64; f++) {
      for (const isOutput of [false, true]) {
        const opcode = isOutput ? output : input;
        const state = initialState({ pc: 0xffff, flags: flagPattern(f), [register]: isOutput ? value : 255 - value });
        ram.write(0xffff, 0xed); ram.write(0, opcode); ram.input = value;
        const cpu = new CpuZ80(ram, state, ram.ports);
        ram.accesses.length = 0;
        const record = cpu.step();
        assert.deepEqual(record.after, snapshot({ ...state, pc: 1, r: 0x80, [register]: value,
          flags: isOutput ? state.flags : { s: value >= 128, z: value === 0, h: false, pv: parityByDigits(value), n: false, c: state.flags.c } }));
        assert.deepEqual(record.before, snapshot(state));
        assert.equal(record.outcome, "executed");
        assert.deepEqual(record.instruction, { address: 0xffff, bytes: [0xed, opcode] });
        assert.deepEqual(record.accesses, [readAccess(0xffff, 0xed), readAccess(0, opcode),
          { kind: isOutput ? "output" : "input", port: state.b * 256 + state.c, value }]);
        assert.deepEqual(record.accesses, ram.accesses);
      }
    }
  });
}

// Range/parity expectations are independent of the CPU's bitwise ALU helpers.
function blockIoFlags(b: number, value: number, added: number, repeating: boolean): CpuZ80Flags {
  const sum = value + added;
  const carry = sum >= 256;
  let half = carry;
  let parity = parityByDigits(sum % 8) === parityByDigits(b);
  if (repeating) {
    let adjustment = b;
    if (carry && value >= 128) { adjustment = b + 255; half = b % 16 === 0; }
    if (carry && value < 128) { adjustment = b + 1; half = b % 16 === 15; }
    const oddAdjustment = !parityByDigits(adjustment % 8);
    if (oddAdjustment) parity = !parity;
  }
  return { s: b >= 128, z: b === 0, h: half, pv: parity, n: value >= 128, c: carry };
}

for (const { name, opcode, delta, repeat, output } of blockIoForms) {
  test(`Z80 ${name} checks every count/data byte, native port order, wrapping, and intermediate flags`, () => {
    const ram = new IoRam();
    for (let originalB = 0; originalB < 256; originalB++) for (let value = 0; value < 256; value++) {
      // Spread C and L across every value; explicitly exercise address-space edges too.
      const c = (value + originalB) % 256;
      const address = originalB === 0 ? 0xffff : originalB === 1 ? 0 : 0x4000 + (255 - c);
      const state = initialState({ b: originalB, c, h: Math.floor(address / 256), l: address % 256,
        flags: flagPattern(value % 64), r: value, pc: 0x2000 });
      ram.write(0x2000, 0xed); ram.write(0x2001, opcode); ram.write(address, value); ram.input = value;
      const cpu = new CpuZ80(ram, state, ram.ports);
      const b = (originalB + 255) % 256, hl = (address + delta + 65536) % 65536;
      const repeats = repeat && b !== 0;
      const flags = blockIoFlags(b, value, output ? hl % 256 : (c + delta + 256) % 256, repeats);
      ram.accesses.length = 0;
      const record = cpu.step();
      assert.deepEqual(record.after, snapshot({ ...state, b, h: Math.floor(hl / 256), l: hl % 256,
        pc: repeats ? 0x2000 : 0x2002, r: refreshTwice(value), flags }));
      const transfers: CpuZ80Access[] = output
        ? [readAccess(address, value), { kind: "output", port: b * 256 + c, value }]
        : [{ kind: "input", port: originalB * 256 + c, value }, writeAccess(address, value)];
      assert.deepEqual(record.accesses, [readAccess(0x2000, 0xed), readAccess(0x2001, opcode), ...transfers]);
      assert.deepEqual(record.accesses, ram.accesses);
      assert.deepEqual(record.before, snapshot(state));
      assert.deepEqual(record.instruction, { address: 0x2000, bytes: [0xed, opcode] });
      assert.equal(record.outcome, "executed");
    }
  });
}

const ioEncodings = [
  { bytes: [0xdb, 0x20], output: false, block: false }, { bytes: [0xd3, 0x20], output: true, block: false },
  ...ioRegisters.flatMap(({ input, output }) => [
    { bytes: [0xed, input], output: false, block: false }, { bytes: [0xed, output], output: true, block: false },
  ]),
  ...blockIoForms.map(({ opcode, output }) => ({ bytes: [0xed, opcode], output, block: true })),
];

test("Z80 I/O failures preserve completed work, expose transfer order, and release the execution guard", () => {
  for (const { bytes, output, block } of ioEncodings) for (let failAt = 0; failAt < (block ? 4 : 3); failAt++) {
    const ram = new IoRam();
    bytes.forEach((value, i) => ram.write(0x2000 + i, value));
    ram.write(0x4000, 0x81); ram.input = 0x81;
    const state = initialState({ b: 2, c: 0x20, h: 0x40, l: 0 });
    const cpu = new CpuZ80(ram, state, ram.ports);
    const failure = new Error(`transfer ${failAt} in ${bytes}`);
    let calls = 0;
    const prefixed = bytes[0] === 0xed;
    // Unprefixed operand fetches advance PC/R after the opcode; ED decoding commits both together.
    const decoded = failAt >= (prefixed ? 2 : 1);
    const expected = snapshot({ ...state, pc: decoded ? 0x2000 + (failAt === 1 ? 1 : 2) : state.pc,
      r: decoded ? (prefixed ? 0x80 : 0xff) : state.r, b: block && failAt === 3 ? 1 : 2 });
    ram.accesses.length = 0;
    ram.observe = () => {
      if (calls++ === failAt) {
        assert.deepEqual(cpu.snapshot(), expected);
        throw failure;
      }
    };
    assert.throws(() => cpu.step(), error => error === failure);
    assert.deepEqual(cpu.snapshot(), expected);
    assert.equal(calls, failAt + 1);
    assert.equal(ram.accesses.length, failAt);
    if (block && failAt === 3) {
      assert.deepEqual(ram.accesses[2], output ? readAccess(0x4000, 0x81) : { kind: "input", port: 0x0220, value: 0x81 });
    }
    ram.observe = undefined;
    ram.write(expected.pc, 0x00);
    assert.equal(cpu.step().outcome, "executed");
    assert.equal(cpu.reset().after.pc, 0);
  }
});

test("Z80 ports are optional until an I/O transfer, and malformed input never changes its destination", () => {
  for (const { bytes, output, block } of ioEncodings) {
    const ram = new IoRam();
    bytes.forEach((value, i) => ram.write(0x2000 + i, value));
    const state = initialState({ b: 2, h: 0x40, l: 0 });
    const cpu = new CpuZ80(ram, state);
    assert.throws(() => cpu.step(), /Port I\/O requires a connected device/);
    assert.deepEqual(cpu.snapshot(), snapshot({ ...state, pc: 0x2002, r: bytes[0] === 0xed ? 0x80 : 0xff,
      b: block && output ? 1 : 2 }));
    assert.deepEqual(cpu.reset().accesses, []);
    ram.write(0, 0); ram.write(1, 0x76);
    assert.equal(cpu.step().outcome, "executed");
    assert.equal(cpu.step().outcome, "halted");
    assert.deepEqual(cpu.step().accesses, []);
  }
  for (const bytes of [[0xdb, 0x20], [0xed, 0x40], [0xed, 0xb2]]) {
    for (const value of [-1, 256, 0.5, NaN, Infinity, "7", null, undefined]) {
      const ram = new Ram(65536);
      bytes.forEach((byte, i) => ram.write(0x2000 + i, byte));
      ram.write(0x4000, 0x55);
      const state = initialState({ b: 2, h: 0x40, l: 0 });
      let inputs = 0;
      const cpu = new CpuZ80(ram, state, {
        // @ts-expect-error Invalid JavaScript device returns must not be coerced to bytes.
        readPort: () => { inputs++; return value; }, writePort: () => assert.fail("unexpected output"),
      });
      assert.throws(() => cpu.step(), /Port input byte/);
      assert.equal(inputs, 1);
      assert.deepEqual(cpu.snapshot(), snapshot({ ...state, pc: 0x2002, r: bytes[0] === 0xed ? 0x80 : 0xff }));
      assert.equal(ram.read(0x4000), 0x55);
    }
  }
});

test("Z80 RAM and port callbacks may inspect state but cannot reenter step or reset", () => {
  for (const opcode of [0xb2, 0xb3]) for (const nested of ["step", "reset"] as const) {
    const ram = new IoRam();
    ram.write(0x2000, 0xed); ram.write(0x2001, opcode);
    const cpu = new CpuZ80(ram, initialState({ b: 2, h: 0x40, l: 0 }), ram.ports);
    let calls = 0;
    ram.observe = () => {
      const before = cpu.snapshot();
      assert.throws(() => cpu[nested](), /Z80 step and reset calls must not be reentrant/);
      assert.deepEqual(cpu.snapshot(), before);
      calls++;
    };
    assert.equal(cpu.step().outcome, "executed");
    assert.equal(calls, 4);
    ram.observe = undefined;
    assert.equal(cpu.step().after.b, 0);
  }
});

test("Z80 repeating I/O refetches current code after wrap and preserves captured bytes when input overwrites code", () => {
  for (const opcode of [0xb2, 0xba]) {
    const ram = new IoRam();
    ram.write(0xffff, 0xed); ram.write(0, opcode); ram.input = 0xf3;
    const cpu = new CpuZ80(ram, initialState({ pc: 0xffff, b: 2, h: 0xff, l: 0xff }), ram.ports);
    const record = cpu.step();
    assert.deepEqual(record.instruction, { address: 0xffff, bytes: [0xed, opcode] });
    assert.equal(record.after.pc, 0xffff);
    const next = cpu.step();
    assert.equal(next.outcome, "unsupported");
    assert.deepEqual(next.before, next.after);
    assert.deepEqual(next.accesses, [readAccess(0xffff, 0xf3)]);
    assert.deepEqual(record.accesses, [readAccess(0xffff, 0xed), readAccess(0, opcode),
      { kind: "input", port: 0x0233, value: 0xf3 }, writeAccess(0xffff, 0xf3)]);
  }
  const ram = new IoRam();
  ram.write(0xffff, 0xed); ram.write(0, 0xb3); ram.write(0x4000, 0x12); ram.write(0x4001, 0x34);
  const cpu = new CpuZ80(ram, initialState({ pc: 0xffff, b: 2, h: 0x40, l: 0 }), ram.ports);
  ram.observe = kind => { if (kind === "output") ram.write(0, 0xab); }; // Next iteration becomes OUTD.
  const first = cpu.step();
  assert.deepEqual(first.instruction?.bytes, [0xed, 0xb3]);
  assert.equal(first.after.pc, 0xffff);
  ram.observe = undefined;
  const next = cpu.step();
  assert.deepEqual(next.instruction?.bytes, [0xed, 0xab]);
  assert.equal(next.after.hl, 0x4000);
  assert.equal(next.after.pc, 1);
  assert.deepEqual(next.accesses.at(-1), { kind: "output", port: 0x0033, value: 0x34 });
  const saved = structuredClone(first);
  cpu.reset(); cpu.step();
  assert.deepEqual(first, saved);
  // @ts-expect-error Deliberately bypass readonly typing to check detached record entries.
  first.accesses[2]!.value = 0;
  assert.deepEqual(next.accesses[2], readAccess(0x4001, 0x34));
});

for (const { name, opcode, output, delta } of blockIoForms.filter(form => form.repeat)) {
  test(`Z80 ${name} with B=0 performs exactly 256 iterations, including native port and refresh wrapping`, () => {
    const ram = new IoRam();
    ram.write(0x2000, 0xed); ram.write(0x2001, opcode); ram.input = 0x55;
    const cpu = new CpuZ80(ram, initialState({ b: 0, h: 0x40, l: 0 }), ram.ports);
    for (let i = 0; i < 256; i++) {
      const record = cpu.step();
      const b = 255 - i;
      assert.equal(record.after.b, b);
      assert.equal(record.after.pc, i === 255 ? 0x2002 : 0x2000);
      assert.equal(record.after.hl, 0x4000 + delta * (i + 1));
      assert.deepEqual(record.accesses[output ? 3 : 2], {
        kind: output ? "output" : "input", port: (output ? b : (256 - i) % 256) * 256 + 0x33, value: output ? 0 : 0x55,
      });
    }
    assert.equal(cpu.snapshot().r, 0xfe);
    assert.equal(cpu.snapshot().flags.z, true);
  });
}

test("Z80 block-I/O repeat phase has distinct H/PV results before its final iteration", () => {
  // Literal flag bytes for selected carry/sign/nibble boundaries; F bits 5/3 are omitted.
  for (const { b, c, value, single, repeat } of [
    { b: 0x11, c: 0x7f, value: 0x80, single: 0x13, repeat: 0x17 },
    { b: 0x12, c: 0x7f, value: 0x80, single: 0x17, repeat: 0x07 },
    { b: 0x10, c: 0xfe, value: 0x01, single: 0x15, repeat: 0x15 },
    { b: 0x0f, c: 0xfe, value: 0x01, single: 0x11, repeat: 0x05 },
    { b: 0x03, c: 0x00, value: 0x01, single: 0x04, repeat: 0x00 },
    { b: 0x04, c: 0x00, value: 0x01, single: 0x00, repeat: 0x00 },
    { b: 0x01, c: 0x7f, value: 0x80, single: 0x57, repeat: 0x57 },
  ]) {
    for (const opcode of [0xa2, 0xb2]) {
      const ram = new IoRam();
      ram.write(0x2000, 0xed); ram.write(0x2001, opcode); ram.input = value;
      const record = new CpuZ80(ram, initialState({ b, c }), ram.ports).step();
      assert.deepEqual(record.after.flags, unpackFlags(opcode === 0xa2 ? single : repeat));
    }
  }
});
