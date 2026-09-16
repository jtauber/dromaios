import assert from "node:assert/strict";
import { test } from "node:test";
import { opcodePattern, opcodeFamily, opcodeTable } from "../../../src/components/cpus/opcodes.js";

test("opcode tables keep explicit entries and unsupported gaps without executing handlers", () => {
  let calls = 0;
  const handler = () => calls++;
  const table = opcodeTable([[0x00, handler], [0xff, handler]]);
  assert.deepEqual(Object.keys(table), ["0", "255"]);
  assert.equal(table[0x00], handler);
  assert.equal(table[0xff], handler);
  assert.equal(table[0x01], undefined);
  assert.equal(calls, 0);
  table[0xff]!();
  assert.equal(calls, 1);
  assert.deepEqual(opcodeTable([]), {});
});

test("opcode tables reject invalid byte values and duplicate explicit entries", () => {
  const handler = () => {};
  for (const opcode of [-1, 256, 0.5, NaN, Infinity]) {
    assert.throws(() => opcodeTable([[opcode, handler]]), RangeError);
  }
  assert.throws(() => opcodeTable([[0x76, handler], [0x76, handler]]), /Duplicate opcode 0x76/);
});

test("sixteen-bit patterns preserve high bits, selectors, aliases, and explicit table bounds", () => {
  const handler = () => {};
  assert.deepEqual(opcodePattern("0000 0110 10 000 000", handler), [[0x0680, handler]]);
  assert.deepEqual(opcodePattern("00 10 000 000 111 100", handler), [[0x203c, handler]]);
  assert.deepEqual(opcodePattern("00 10 001 111 000 000", handler), [[0x23c0, handler]]);
  assert.deepEqual(opcodePattern("1111 1111 1111 1111", handler), [[0xffff, handler]]);
  const entries = opcodeFamily("f000_0000_0000_00xf", { f: [0, 1, 2, 3] }, selected => () => selected);
  const table = opcodeTable(entries, 16);
  assert.deepEqual(Object.entries(table).map(([opcode, handler]) => [Number(opcode), handler!()]), [
    [0, { f: 0 }], [1, { f: 1 }], [2, { f: 0 }], [3, { f: 1 }],
    [0x8000, { f: 2 }], [0x8001, { f: 3 }], [0x8002, { f: 2 }], [0x8003, { f: 3 }],
  ]);
  assert.throws(() => opcodeTable(entries), RangeError);
  assert.throws(() => opcodeTable([[0xffff, handler], [0xffff, handler]], 16), /Duplicate opcode/);
  assert.throws(() => opcodeTable([[0x0680, handler], [0x0680, handler]], 16), /Duplicate opcode 0x0680/);
  for (const opcode of [-1, 65536, 0.5, NaN, Infinity]) assert.throws(() => opcodeTable([[opcode, handler]], 16), RangeError);
  for (const width of [0, 7, 15, 32, NaN, "16"]) assert.throws(() => Reflect.apply(opcodeTable, undefined, [[], width]), /Opcode width/);
  for (const pattern of ["0".repeat(15), "0".repeat(17), "0".repeat(32)]) assert.throws(() => opcodePattern(pattern, handler), /must contain/);
});

test("8008 alias patterns produce only their documented opcode bytes and share the handler", () => {
  const handler = () => { throw new Error("Execution during construction"); };
  for (const [pattern, expected] of [
    ["00 000 00x", [0x00, 0x01]],
    ["00 xxx 111", [0x07, 0x0f, 0x17, 0x1f, 0x27, 0x2f, 0x37, 0x3f]],
    ["01 xxx 100", [0x44, 0x4c, 0x54, 0x5c, 0x64, 0x6c, 0x74, 0x7c]],
    ["01 xxx 110", [0x46, 0x4e, 0x56, 0x5e, 0x66, 0x6e, 0x76, 0x7e]],
  ] as const) {
    const entries = opcodePattern(pattern, handler);
    assert.deepEqual(entries.map(([opcode]) => opcode), expected);
    assert.ok(entries.every(([, bound]) => bound === handler));
  }
  assert.deepEqual(opcodePattern("00 000 100", handler), [[0x04, handler]]);
  assert.deepEqual(opcodePattern("1111_1111", handler), [[0xff, handler]]);
  assert.equal(opcodePattern("xxxxxxxx", handler).length, 256);
});

test("6502 branch selectors bind flag names and values to independently listed encodings", () => {
  const table = opcodeTable(opcodeFamily("ff v 100 00", {
    f: ["n", "v", "c", "z"], v: [false, true],
  }, selected => () => selected));
  assert.deepEqual(Object.entries(table).map(([opcode, handler]) => [Number(opcode), handler!()]), [
    [0x10, { f: "n", v: false }], [0x30, { f: "n", v: true }],
    [0x50, { f: "v", v: false }], [0x70, { f: "v", v: true }],
    [0x90, { f: "c", v: false }], [0xb0, { f: "c", v: true }],
    [0xd0, { f: "z", v: false }], [0xf0, { f: "z", v: true }],
  ]);
});

test("separated field bits read most significant first and ignored bits do not enter bindings", () => {
  const table = opcodeTable(opcodeFamily("f x 01 f 0 01", {
    f: ["00", "01", "10", "11"],
  }, selected => () => selected));
  assert.deepEqual(Object.entries(table).map(([opcode, handler]) => [Number(opcode), handler!()]), [
    [0x11, { f: "00" }], [0x19, { f: "01" }],
    [0x51, { f: "00" }], [0x59, { f: "01" }],
    [0x91, { f: "10" }], [0x99, { f: "11" }],
    [0xd1, { f: "10" }], [0xd9, { f: "11" }],
  ]);
});

test("binding captures selectors while handlers read current state at execution", () => {
  let state = false;
  let reads = 0;
  const testCondition = () => { reads++; return state; };
  const table = opcodeTable(opcodeFamily("0010 ttt p", {
    t: Array.from({ length: 8 }, () => testCondition),
    p: [false, true],
  }, ({ t: condition, p: invert }) => () => condition() !== invert));
  assert.equal(reads, 0);
  assert.equal(table[0x20]!(), false);
  assert.equal(table[0x21]!(), true);
  state = true;
  assert.equal(table[0x20]!(), true);
  assert.equal(table[0x21]!(), false);
  assert.equal(table[0x2e]!(), true);
  assert.equal(table[0x2f]!(), false);
  assert.equal(reads, 6);
});

test("opcode construction rejects overlaps between families, aliases, and explicit entries", () => {
  const handler = () => {};
  const aliases = opcodePattern("00 xxx 111", handler);
  const family = opcodeFamily("00 fff 111", { f: [0, 1, 2, 3, 4, 5, 6, 7] }, () => handler);
  for (const entries of [
    [...aliases, ...family],
    [...family, ...aliases],
    [...aliases, [0x0f, handler] as const],
    [[0x0f, handler] as const, ...aliases],
  ]) {
    assert.throws(() => opcodeTable(entries), /Duplicate opcode/);
  }
});

test("malformed patterns and incomplete or extraneous selector maps fail before binding", () => {
  const bind = () => { throw new Error("Binding an invalid definition"); };
  for (const pattern of ["", "0000000", "000000000", "00000002", "FF010000", "0b00000000", "00---111"]) {
    assert.throws(() => opcodeFamily(pattern, {}, bind), /must contain eight bits/);
  }
  assert.throws(() => opcodeFamily("ff v 100 00", { v: [false, true] }, bind), /Selector f.*requires 4 values/);
  for (const values of [[], ["n"], ["n", "v", "c"], ["n", "v", "c", "z", "i"]]) {
    assert.throws(() => opcodeFamily("ff010000", { f: values }, bind), /Selector f.*requires 4 values/);
  }
  const sparse = ["n", "v", "c", "z"];
  delete sparse[2];
  assert.throws(() => opcodeFamily("ff010000", { f: sparse }, bind), /Selector f.*missing value 2/);
  assert.throws(() => opcodeFamily("00000000", { f: [0] }, bind), /Selector f is absent/);
  assert.throws(() => opcodeFamily("00xxx111", { x: [0, 1, 2, 3, 4, 5, 6, 7] }, bind), /Selector x is absent/);
  assert.throws(() => opcodePattern("ff010000", bind), /Selector f.*requires 4 values/);
});

test("repeated patterns share no selector values, captured field maps, handlers, or returned entries", () => {
  const values = ["first", "second", "third", "fourth"];
  const first = opcodeFamily("f x 01 f 0 01", { f: values }, selected => () => selected);
  const second = opcodeFamily("f x 01 f 0 01", { f: [10, 20, 30, 40] }, selected => () => selected);
  assert.deepEqual(first.map(([opcode, handler]) => [opcode, handler().f]), [
    [0x11, "first"], [0x19, "second"], [0x51, "first"], [0x59, "second"],
    [0x91, "third"], [0x99, "fourth"], [0xd1, "third"], [0xd9, "fourth"],
  ]);
  values[0] = "changed";
  Reflect.set(first[0]![1](), "f", "mutated binding");
  Reflect.set(first[0]!, 0, 0xff);
  assert.equal(first[2]![1]().f, "first", "Even alias bindings own separate field maps");
  const expected = [[0x11, 10], [0x19, 20], [0x51, 10], [0x59, 20], [0x91, 30], [0x99, 40], [0xd1, 30], [0xd9, 40]];
  assert.deepEqual(second.map(([opcode, handler]) => [opcode, handler().f]), expected);
  const third = opcodeFamily("f x 01 f 0 01", { f: [10, 20, 30, 40] }, selected => () => selected);
  assert.deepEqual(third.map(([opcode, handler]) => [opcode, handler().f]), expected);
  assert.notEqual(third[0]![1], second[0]![1]);
});

test("cached patterns still validate each selector map and recover from failed bindings", () => {
  const pattern = "0000 0000 ffxx ffff";
  const values = Array.from({ length: 64 }, (_, index) => index);
  assert.equal(opcodeFamily(pattern, { f: values }, selected => selected.f).length, 256);
  const forbidden = () => assert.fail("Invalid selectors must fail before binding");
  assert.throws(() => opcodeFamily(pattern, {}, forbidden), /Selector f.*requires 64 values/);
  assert.throws(() => opcodeFamily(pattern, { f: values, a: [0] }, forbidden), /Selector a is absent/);
  const sparse = [...values];
  delete sparse[10];
  assert.throws(() => opcodeFamily(pattern, { f: sparse }, forbidden), /Selector f.*missing value 10/);
  const error = new Error("binding failed");
  let calls = 0;
  assert.throws(() => opcodeFamily(pattern, { f: values }, () => {
    if (++calls === 3) throw error;
  }), failure => failure === error);
  assert.equal(calls, 3);
  const entries = opcodeFamily(pattern, { f: values }, selected => selected.f);
  // Interpret the field directly from independently numbered opcode bits 7,6,3,2,1,0.
  assert.deepEqual(entries, Array.from({ length: 256 }, (_, opcode) => [opcode,
    Number.parseInt(opcode.toString(2).padStart(8, "0").replace(/^(.{2}).{2}/, "$1"), 2)]));
});
