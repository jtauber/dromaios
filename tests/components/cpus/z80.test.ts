import assert from "node:assert/strict";
import { test } from "node:test";
import { CpuZ80 } from "../../../src/components/cpus/z80.js";
import type { CpuZ80Flags, CpuZ80RegisterBank, CpuZ80State, CpuZ80MemoryAccess } from "../../../src/components/cpus/z80.js";
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

// Literal encodings from the manual; INC/DEC (HL) remain outside this subset.
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
  // Signed/unsigned arithmetic and decimal low-digit comparisons, independent of add8.
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
      flags: { s: true, z: true, ac: true, p: true, cy: carry }, interruptEnabled: false, halted: false }).step();
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

test("Z80 rejects every unsupported first byte atomically, including DD/ED/FD", () => {
  const ram = new ObservedRam();
  const before = initialState({ pc: 0xffff, r: 0xff });
  for (let opcode = 0; opcode < 256; opcode++) {
    if (opcode >= 0x40 && opcode <= 0xbf) continue;
    if ([
      0xcb, ...stackForms.flatMap(form => [form.push, form.pop]), ...callReturnForms.flatMap(form => [form.call, form.ret]),
      0x01, 0x11, 0x21, 0x31, 0x36,
      0x04, 0x05, 0x06, 0x0c, 0x0d, 0x0e, 0x10, 0x14, 0x15, 0x16, 0x18, 0x1c, 0x1d, 0x1e,
      0x20, 0x24, 0x25, 0x26, 0x28, 0x2c, 0x2d, 0x2e, 0x30, 0x32, 0x38, 0x3c, 0x3d, 0x3e, 0x76, ...aluForms.map(form => form.immediate),
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
