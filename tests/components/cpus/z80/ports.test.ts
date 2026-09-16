import assert from "node:assert/strict";
import { test } from "node:test";
import { CpuZ80 } from "../../../../src/components/cpus/z80.js";
import type { CpuZ80Flags, CpuZ80Access } from "../../../../src/components/cpus/z80.js";
import { Ram } from "../../../../src/components/memory/ram.js";
import { initialState, snapshot, flagPattern, unpackFlags, readAccess, writeAccess, refreshTwice, IoRam } from "./helpers.js";

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
      assert.throws(() => cpu[nested](), /Z80 step, reset, and interrupt calls must not be reentrant/);
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
    ram.write(0xffff, 0xed); ram.write(0, opcode); ram.input = 0xcb;
    const cpu = new CpuZ80(ram, initialState({ pc: 0xffff, b: 2, h: 0xff, l: 0xff }), ram.ports);
    const record = cpu.step();
    assert.deepEqual(record.instruction, { address: 0xffff, bytes: [0xed, opcode] });
    assert.equal(record.after.pc, 0xffff);
    ram.write(0, 0x30); // SLL B is an undocumented CB form.
    const next = cpu.step();
    assert.equal(next.outcome, "unsupported");
    assert.deepEqual(next.before, next.after);
    assert.deepEqual(next.accesses, [readAccess(0xffff, 0xcb), readAccess(0, 0x30)]);
    assert.deepEqual(record.accesses, [readAccess(0xffff, 0xed), readAccess(0, opcode),
      { kind: "input", port: 0x0233, value: 0xcb }, writeAccess(0xffff, 0xcb)]);
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
