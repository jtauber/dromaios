import assert from "node:assert/strict";
import { test } from "node:test";
import { createProcessorChanges } from "../../site/interactive/change-log.js";
import { boolean, choices, defineState, flag, group, unsigned } from "../../src/components/cpus/state.js";

test("prepared comparisons retain declaration order, nested register names, flag values and CPU-specific counters", () => {
  const compare = createProcessorChanges(defineState({
    ip: unsigned(16), a: unsigned(8), flags: group({ z: flag, c: flag }),
    alternate: group({ a: unsigned(8) }), halted: boolean, mode: choices(0, 1),
  }), ["ip"]);
  const before = { ip: 0xffff, a: 0x80, flags: { z: false, c: true }, alternate: { a: 0x12 }, halted: false, mode: 0 };
  const after = { ip: 0, a: 0, flags: { z: true, c: false }, alternate: { a: 0x34 }, halted: true, mode: 1 };
  const expected = [
    { kind: "pc", target: "IP", before: 0xffff, after: 0, width: 4 },
    { kind: "register", target: "A", before: 0x80, after: 0, width: 2 },
    { kind: "flag", target: "Z", before: 0, after: 1, width: 1 },
    { kind: "flag", target: "C", before: 1, after: 0, width: 1 },
    { kind: "register", target: "ALTERNATE.A", before: 0x12, after: 0x34, width: 2 },
  ];
  assert.deepEqual(compare(before, after), expected);
  assert.deepEqual(compare(after, after), []);
  assert.deepEqual(compare(before, after), expected, "Comparisons retain no values from the previous boundary");
});
