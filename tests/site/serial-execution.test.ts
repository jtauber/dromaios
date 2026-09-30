import assert from "node:assert/strict";
import { test } from "node:test";
import { SerialSession } from "../../src/runtime/serial-session.js";
import { createSerialExecution } from "../../site/interactive/serial-execution.js";

test("serial scheduling yields bounded batches, keeps twelve records, and cancels stale work across STOP and clear", () => {
  const jobs: (() => void)[] = [], bytes: number[] = [];
  let count = 0, cancelled = 0;
  const session = new SerialSession(output => ({
    cpu: { step() { output(65); return { outcome: "executed" as const, count: ++count }; } },
    serial: { offer: () => true }, reset() {},
  }));
  const execution = createSerialExecution(session, {
    schedule(callback) { jobs.push(callback); return () => { cancelled++; }; },
    output(output) { bytes.push(...output); }, onChange() {},
  });
  execution.run(); execution.run();
  assert.equal(jobs.length, 1); assert.equal(count, 0);
  jobs.shift()!();
  assert.equal(count, 2000); assert.equal(bytes.length, 2000);
  assert.equal(execution.records.length, 12); assert.equal(execution.records[0]!.count, 1989);
  const old = jobs.shift()!;
  execution.stop(); old();
  assert.equal(count, 2000); assert.equal(cancelled, 1);
  execution.run(); old();
  assert.equal(jobs.length, 1);
  jobs.shift()!();
  assert.equal(count, 4000); assert.equal(execution.steps, 4000);
  const beforeClear = jobs.shift()!;
  execution.clear(); session.reload(); execution.run(); beforeClear();
  assert.equal(execution.steps, 0); assert.deepEqual(execution.records, []);
  assert.equal(count, 4000);
  jobs.shift()!();
  assert.equal(count, 6000); assert.equal(execution.steps, 2000);
});

test("serial scheduling stops on guest outcomes and failures while draining completed output", () => {
  for (const outcome of ["halted", "waiting", "unsupported", "throw"] as const) {
    const jobs: (() => void)[] = [], bytes: number[] = [];
    const session = new SerialSession(output => ({
      cpu: { step() { output(42); if (outcome === "throw") throw new Error("Guest failure"); return { outcome }; } },
      serial: { offer: () => true }, reset() {},
    }));
    const execution = createSerialExecution(session, {
      schedule(callback) { jobs.push(callback); return () => {}; },
      output(output) { bytes.push(...output); }, onChange() {},
    });
    execution.run(); jobs.shift()!();
    assert.deepEqual(bytes, [42]); assert.equal(session.running, false); assert.equal(jobs.length, 0);
    if (outcome === "throw") {
      assert.equal(execution.error, "Guest failure");
      execution.run(); assert.equal(jobs.length, 0);
      execution.clear(); assert.equal(execution.error, undefined);
    } else {
      assert.equal(execution.status, outcome); assert.equal(execution.records.length, 1);
    }
  }
});
