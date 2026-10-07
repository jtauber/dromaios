import assert from "node:assert/strict";
import { test } from "node:test";
import { createInspectorHistory } from "../../site/interactive/inspector-history.js";
import type { InspectorLocation } from "../../site/interactive/inspector-history.js";

const memory = (address: number): InspectorLocation => ({ tool: "memory", address });
const code = (address: number): InspectorLocation => ({ tool: "code", address });

test("inspector history returns across tools and keeps forward navigation until a new destination is chosen", () => {
  const history = createInspectorHistory(), source = memory(0x36), target = memory(0xfdf0);
  const routine: InspectorLocation = { tool: "rom", address: 0xfdf0 };
  assert.equal(history.move(-1), undefined); assert.equal(history.move(1), undefined);
  history.visit(source, target); history.visit(target, code(0xfdf0)); history.visit(code(0xfdf0), routine);
  assert.deepEqual(history.move(-1), code(0xfdf0)); assert.deepEqual(history.move(-1), target);
  history.visit(target, target); // A no-op does not destroy Forward.
  assert.deepEqual(history.forward, code(0xfdf0));
  assert.deepEqual(history.move(1), code(0xfdf0)); assert.deepEqual(history.move(1), routine);
  history.move(-1); history.visit(code(0xfdf0), memory(0x28));
  assert.equal(history.forward, undefined); assert.deepEqual(history.move(-1), code(0xfdf0));
  assert.deepEqual(history.move(-1), target); assert.deepEqual(history.move(-1), source);
  assert.equal(history.move(-1), undefined);
});

test("a departure captures the displayed address after automatic following, while retained history stays bounded", () => {
  const history = createInspectorHistory(3);
  history.visit(code(0xfd21), memory(0x36));
  // Memory may have scrolled or followed PC since the previous explicit navigation.
  history.visit(memory(0x300), code(0xfdf0));
  assert.deepEqual(history.move(-1), memory(0x300));
  assert.deepEqual(history.move(-1), memory(0x36));
  assert.equal(history.move(-1), undefined);
  for (const capacity of [0, 1, 1.5, NaN, Infinity]) assert.throws(() => createInspectorHistory(capacity), RangeError);
});
