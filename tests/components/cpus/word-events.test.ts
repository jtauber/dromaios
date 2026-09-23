import assert from "node:assert/strict";
import { test } from "node:test";
import { wordEvents } from "../../../src/components/cpus/word-events.js";
import type { WordBusFault, WordEventPolicy } from "../../../src/components/cpus/word-events.js";

const memory = { fetchByte: () => 0, readProgramByte: () => 0, readByte: () => 0, writeByte() {} };
function fixture() {
  const log: unknown[][] = [], failures = new Map<string, unknown>();
  let terminal = false, initialTerminal = false, stack = 100, gate = 0;
  const hit = (name: string, ...args: unknown[]) => { log.push([name, ...args]); if (failures.has(name)) throw failures.get(name); };
  class Failure { readonly source = "bus-error"; readonly operation = "read"; readonly address = 99; }
  const policy: WordEventPolicy<"software", "blocked", 13, 11, 9> = {
    exceptions: { software: { vector: 19, completed: true } },
    capture: () => ({ stack, status: 0x1234 }), instruction: () => 0x5678,
    prepare: (old, bytes) => { hit("prepare", old, bytes); stack = old - bytes; },
    checkStack: old => { hit("check", old); }, shortBytes: 4,
    shortFrame: (old, status, pc) => { hit("short", old, status, pc); },
    vector: vector => { hit("vector", vector); }, complete: (processing, vector) => { hit("complete", processing, vector); },
    entryReturn: (pc, vector, phase) => { hit("entry-return", phase); return phase ? 0x100 + vector : pc; },
    memory: { addressVector: 13, busVector: 11, bytes: 10, codes: [9], functionCode: program => { hit("space", program); return 9; },
      begin: vector => { hit("fault-begin", vector); },
      frame: (old, status, pc, address, write, processing, code) => { hit("fault-frame", old, status, pc, address, write, processing, code); },
    },
    terminal: () => terminal, halt: () => { hit("halt"); terminal = true; },
    initial: { terminal: () => initialTerminal, returnPc: () => 42, processing: () => false },
    interrupt: { minimum: 2, maximum: 5, gate: () => gate, reasons: ["blocked"], accept: level => { hit("accept", level); },
      autovector: level => 40 + level, spurious: 12, vectorMaximum: 127, returnPc: () => 84, processing: false },
  };
  const events = wordEvents(policy, error => error instanceof Failure ? error : undefined);
  return { events, policy, log, failures, Failure, setGate(value: number) { gate = value; }, setInitialTerminal() { initialTerminal = true; } };
}

test("word entries use declared sizes and preserve capture, acknowledgement, frame, vector, and completion order", () => {
  const f = fixture();
  const result = f.events.interrupt(3, () => { f.log.push(["host"]); return "autovector"; }, memory, value => f.log.push(["ack", value]));
  assert.deepEqual(result, { outcome: "accepted", vector: 43, returnPc: 84 });
  assert.deepEqual(f.log, [["prepare", 100, 4], ["check", 100], ["accept", 3], ["host"], ["ack", "autovector"],
    ["short", 100, 0x1234, 84], ["vector", 43], ["complete", false, 43]]);
  const completed = fixture();
  completed.events.exception({ source: "software", vector: 19, returnPc: 20 }, memory);
  assert.deepEqual(completed.log.at(-1), ["complete", true, 19]);
});

test("a classified fault remembers the failed phase; an error during recovery halts with both failures", () => {
  for (const phase of ["short", "vector"]) {
    const f = fixture(); f.failures.set(phase, new f.Failure());
    const result = f.events.exception({ source: "software", vector: 19, returnPc: 20 }, memory);
    assert.equal(result.delivered, false);
    assert.ok("fault" in result.exception);
    assert.equal(result.exception.returnPc, phase === "short" ? 20 : 0x113);
    assert.deepEqual(result.exception.fault, { operation: "read", address: 99, instructionRegister: 0x5678, functionCode: 9, processingInstruction: true });
    assert.equal(result.exception.source, "bus-error"); assert.equal(result.exception.vector, 11);
    assert.equal("entryFault" in result.exception, phase === "vector");
    assert.equal(f.log.some(([name]) => name === "halt"), phase === "vector");
    assert.deepEqual(f.log.find(([name]) => name === "entry-return"), ["entry-return", phase === "vector"]);
    assert.deepEqual(f.log.find(([name]) => name === "fault-frame"), ["fault-frame", 96, 0x1234, phase === "short" ? 20 : 0x113, 99, false, true, 9]);
  }
});

test("memory-error hooks retain Boolean access and processing decisions through recovery", () => {
  for (const processing of [false, true]) for (const [operation, programSpace, program, write] of [
    ["fetch", undefined, true, false], ["read", undefined, false, false],
    ["read", false, false, false], ["read", true, true, false], ["write", undefined, false, true],
  ] as const) {
    const f = fixture();
    const result = f.events.memoryError({ operation, address: 99, programSpace }, 42, processing, memory);
    assert.equal(result.fault.processingInstruction, processing);
    assert.deepEqual(f.log, [["space", program], ["prepare", 100, 10], ["fault-begin", 13], ["check", 100],
      ["fault-frame", 100, 0x1234, 42, 99, write, processing, 9], ["vector", 13]]);
  }
  const initial = fixture();
  const result = initial.events.initialFetch({ operation: "fetch", address: 99 }, memory);
  assert.ok(result.exception);
  assert.equal(result.exception.fault.processingInstruction, false);
  assert.deepEqual(initial.log.find(([name]) => name === "fault-frame"), ["fault-frame", 100, 0x1234, 42, 99, false, false, 9]);
});

test("an initial fetch can halt without stacking, and public fault records omit internal access-space metadata", () => {
  const f = fixture(); f.setInitialTerminal();
  const fault: WordBusFault = { source: "bus-error", operation: "fetch", address: 1, programSpace: true };
  assert.deepEqual(f.events.initialFetch(fault, memory), { fault: { source: "bus-error", operation: "fetch", address: 1 } });
  assert.deepEqual(f.log, [["halt"]]);
});

test("gates precede callback validation; host throws and invalid acknowledgements keep completed effects without recovery", () => {
  const blocked = fixture(); blocked.setGate(1);
  assert.deepEqual(blocked.events.interrupt(3, null!, memory, () => assert.fail()), { outcome: "ignored", reason: "blocked" });
  assert.deepEqual(blocked.log, []);
  for (const value of ["bus-error", new Error("host"), { operation: "read", address: 99 }]) {
    const f = fixture(); f.failures.set("short", value);
    assert.throws(() => f.events.exception({ source: "software", vector: 19, returnPc: 20 }, memory), error => error === value);
    assert.deepEqual(f.log.map(([name]) => name), ["prepare", "check", "short"]);
  }
  const invalid = fixture();
  assert.throws(() => invalid.events.interrupt(1, assert.fail, memory, () => assert.fail()), /2\.\.5/);
  assert.throws(() => invalid.events.interrupt(3, () => 128, memory, () => assert.fail()), RangeError);
  assert.deepEqual(invalid.log.map(([name]) => name), ["prepare", "check", "accept"]);
});

test("invalid policy selectors fail before they can produce an invalid record", () => {
  const f = fixture(); f.setGate(2);
  assert.throws(() => f.events.interrupt(3, assert.fail, memory, () => assert.fail()), /declared reasons/);
  assert.deepEqual(f.log, []);
  const events = wordEvents({ ...f.policy, memory: { ...f.policy.memory, functionCode: () => 10 } }, () => undefined);
  assert.throws(() => events.initialFetch({ operation: "fetch", address: 1 }, memory), /declared choices/);
  assert.deepEqual(f.log, []);
});
