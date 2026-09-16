import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { sourceReaders } from "../../../../src/components/cpus/generated/6502.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";
import { cpu6502StateDescription } from "../../../../src/components/cpus/state/6502.js";
import type { Cpu6502State } from "../../../../src/components/cpus/state/6502.js";
import type { SourceDefinitions, ValueSource } from "../../../../src/components/cpus/semantics/model.js";
import { literal, value } from "../../../../src/components/cpus/semantics/model.js";

function state(): Cpu6502State {
  return { a: 0x11, x: 2, y: 3, pc: 0x4000, sp: 0xff,
    flags: { n: true, z: false, v: true, d: true, i: false, c: true } };
}

type Access = readonly [kind: "fetch", byte: number] | readonly [kind: "read", address: number, byte: number];
type Context = { fetchByte(): number; readByte(address: number): number };
type Reader = (context: Context) => number;

test("address and operand readers wrap correctly, distinguish pointer/data reads, and stop at every failure", () => {
  const cpu = state(), before = structuredClone(cpu), readers = sourceReaders(cpu);
  const cases: readonly [Reader, number, readonly Access[]][] = [
    [readers.addresses.zeroPage, 0xff, [["fetch", 0xff]]],
    [readers.addresses.zeroPageX, 1, [["fetch", 0xff]]],
    [readers.addresses.zeroPageY, 2, [["fetch", 0xff]]],
    [readers.addresses.absolute, 0xffff, [["fetch", 0xff], ["fetch", 0xff]]],
    [readers.addresses.absoluteX, 1, [["fetch", 0xff], ["fetch", 0xff]]],
    [readers.addresses.absoluteY, 2, [["fetch", 0xff], ["fetch", 0xff]]],
    [readers.addresses.indexedIndirect, 0xffff, [["fetch", 0xfe], ["read", 0, 0xff], ["read", 1, 0xff]]],
    [readers.addresses.indirectIndexed, 2, [["fetch", 0xff], ["read", 0xff, 0xff], ["read", 0, 0xff]]],
    // bbb is specified independently here; the operand appends exactly one final data read.
    [readers.operands[0], 0x80, [["fetch", 0xfe], ["read", 0, 0xff], ["read", 1, 0xff], ["read", 0xffff, 0x80]]],
    [readers.operands[1], 0x80, [["fetch", 0xff], ["read", 0xff, 0x80]]],
    [readers.operands[2], 0x80, [["fetch", 0x80]]],
    [readers.operands[3], 0x80, [["fetch", 0xff], ["fetch", 0xff], ["read", 0xffff, 0x80]]],
    [readers.operands[4], 0x80, [["fetch", 0xff], ["read", 0xff, 0xff], ["read", 0, 0xff], ["read", 2, 0x80]]],
    [readers.operands[5], 0x80, [["fetch", 0xff], ["read", 1, 0x80]]],
    [readers.operands[6], 0x80, [["fetch", 0xff], ["fetch", 0xff], ["read", 2, 0x80]]],
    [readers.operands[7], 0x80, [["fetch", 0xff], ["fetch", 0xff], ["read", 1, 0x80]]],
  ];
  for (const [read, expected, sequence] of cases) for (let failAt = -1; failAt < sequence.length; failAt++) {
    const completed: Access[] = [], failure = new Error("source access failed");
    let attempts = 0;
    const access = (kind: "fetch" | "read", address?: number): number => {
      assert.deepEqual(cpu, before); // Readers neither update flags/registers nor own the fetch cursor.
      const entry = sequence[attempts++];
      assert.ok(entry, "unexpected extra access");
      assert.equal(entry[0], kind);
      if (entry[0] === "read") assert.equal(address, entry[1]);
      if (completed.length === failAt) throw failure;
      completed.push(entry);
      return entry[0] === "fetch" ? entry[1] : entry[2];
    };
    const run = () => read({ fetchByte: () => access("fetch"), readByte: address => access("read", address) });
    if (failAt < 0) assert.equal(run(), expected);
    else assert.throws(run, error => error === failure);
    assert.equal(attempts, failAt < 0 ? sequence.length : failAt + 1);
    assert.deepEqual(completed, sequence.slice(0, failAt < 0 ? sequence.length : failAt));
    assert.deepEqual(cpu, before);
  }
});

test("bound readers observe live indices at their specified fetch/pointer boundaries and retain instance ownership", () => {
  const first = state(), second = state();
  let x = 0, reads = 0;
  Object.defineProperty(first, "x", { get() { reads++; return x; } });
  const a = sourceReaders(first).addresses, b = sourceReaders(second).addresses;
  assert.equal(reads, 0);
  assert.equal(a.zeroPageX({ fetchByte() { x = 2; return 0xff; } }), 1);
  assert.equal(reads, 1);
  second.x = 4;
  assert.equal(b.zeroPageX({ fetchByte: () => 0xff }), 3);
  assert.equal(reads, 1);
  let fetches = 0;
  assert.equal(a.absoluteX({ fetchByte() { if (++fetches === 2) x = 3; return 0xff; } }), 2);
  const pointers: number[] = [];
  assert.equal(a.indexedIndirect({ fetchByte() { x = 2; return 0xfe; }, readByte(address) {
    pointers.push(address); x = 0x55; return 0xff;
  } }), 0xffff);
  assert.deepEqual(pointers, [0, 1]); // Capture X before either pointer byte; never recalculate the pointer.
  pointers.length = 0;
  assert.equal(a.indirectIndexed({ fetchByte: () => 0xff, readByte(address) {
    pointers.push(address); first.y = pointers.length === 1 ? 1 : 3; return 0xff;
  } }), 2);
  assert.deepEqual(pointers, [0xff, 0]); // Capture Y only after both pointer reads complete.
});

test("standalone source generation validates widths and CPU symbols and keeps returned captures scoped", async () => {
  const returned: ValueSource = { name: "returned local", width: 8,
    steps: [{ kind: "capture", name: "result", value: literal(8, 7) }], result: value("result") };
  const sources: SourceDefinitions = { cpu: { name: "6502", state: cpu6502StateDescription }, groups: {
    ["__proto__"]: { constructor: returned },
  } };
  const before = JSON.stringify(sources);
  const source = generateInstructions("6502", {}, { sources });
  assert.equal(JSON.stringify(sources), before);
  assert.equal(generateInstructions("6502", {}, { sources }), source);
  const compiled: { sourceReaders(state: Cpu6502State): Record<string, Record<string, () => number>> } =
    await import(`data:text/javascript,${encodeURIComponent(stripTypeScriptTypes(source))}`);
  const readers = compiled.sourceReaders(state());
  assert.equal(Object.getPrototypeOf(readers), Object.prototype);
  assert.equal(Object.hasOwn(readers, "__proto__"), true);
  assert.equal(readers["__proto__"]!["constructor"]!(), 7);
  assert.throws(() => generateInstructions("8080", {}, { sources }), /expected a 8080 definition/);
  const invalid: SourceDefinitions = { ...sources, groups: { operands: {
    bad: { name: "wrong width", width: 16, steps: [], result: literal(8, 0) },
  } } };
  assert.throws(() => generateInstructions("6502", {}, { sources: invalid }), /source result width/);
});
