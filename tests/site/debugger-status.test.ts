import assert from "node:assert/strict";
import { test } from "node:test";
import { debuggerStatus } from "../../site/interactive/debugger-status.js";

test("debugger reports retain the stop location, mapping, and captured explanation across processors", () => {
  const location = { address: 0xa080, space: "rom" };
  assert.equal(debuggerStatus({ kind: "over", location }, undefined, false), "Step over complete at $A080 (rom).");
  assert.equal(debuggerStatus({ kind: "watchpoint", location: { address: 0x203, space: "ram" }, detail: "Wrote $00 → $20." }, undefined, false),
    "Watchpoint at $0203 (ram). Wrote $00 → $20.");
  assert.match(debuggerStatus({ kind: "tracking-lost", location, detail: "Return changed." }, undefined, false), /Caller tracking lost.*Return changed/);
  assert.match(debuggerStatus({ kind: "limit", location }, undefined, false), /Execution limit/);
  assert.equal(debuggerStatus(undefined, "over", true), "Running · step over…");
  assert.equal(debuggerStatus(undefined, "target", true), "Running · to address…");
  assert.equal(debuggerStatus(undefined, "target", false), "");
  assert.equal(debuggerStatus(undefined, undefined, true), "");
});
