import assert from "node:assert/strict";
import { test } from "node:test";
import { wordExecution } from "../../../src/components/cpus/word-execution.js";
import type { WordExecutionPolicy, WordMemory, WordMemoryFault, WordException } from "../../../src/components/cpus/word-execution.js";

const exceptions = { illegal: { vector: 4, completed: false }, trap: { vector: 32, offset: { shift: 0, mask: 15 }, completed: true }, trace: { vector: 9, completed: false } };
type Source = keyof typeof exceptions;
function fixture() {
  const state = { pc: 0x100, ir: 0xaaaa, trace: true, pending: false, stopped: false, terminal: false };
  const events: unknown[] = [], bytes = new Map<number, number>([[0x100, 0x12], [0x101, 0x34], [0x102, 0x56], [0x103, 0x78]]);
  const signal = Symbol("bus fault");
  let failAt = -1, count = 0, delivered = true;
  const memory: WordMemory = {
    fetchByte(address) { events.push(["fetch", address]); if (count++ === failAt) throw signal; return bytes.get(address) ?? 0; },
    readByte() { assert.fail(); }, writeByte() { assert.fail(); }, readProgramByte() { assert.fail(); },
  };
  const policy: WordExecutionPolicy<Source> = {
    bits: 16, order: "big", alignment: 2, counter: () => state.pc, terminal: () => state.terminal,
    stopped: () => state.stopped, pending: () => state.pending, sample: () => state.trace, pendingException: "trace",
    fetched(opcode) { state.ir = opcode; }, retire(pc, sample) { state.pc = pc; state.pending = sample; },
    trace(sample) { state.pending = sample; }, unsupported: "illegal", exceptions,
    dispatch(opcode, context) { assert.equal(opcode, 0x1234); events.push(["extension", context.fetchWord()]); },
  };
  const execute = (overrides: Partial<WordExecutionPolicy<Source>> = {}) => wordExecution<Source, WordException<string>, WordMemoryFault>({ ...policy, ...overrides }, {
    exception(request: WordException<Source>) { events.push(["exception", request]); return { exception: request, delivered }; },
    initialFetch(fault: WordMemoryFault) { events.push(["initial", fault]); return { fault }; },
    memoryError(fault: WordMemoryFault, cursor: number) { events.push(["memory", fault, cursor]); return { source: "memory", vector: 2, returnPc: cursor }; },
    faultFromError(error) { return error === signal ? { operation: "fetch" as const, address: 0x100 + failAt } : undefined; },
  })(memory, () => { events.push("reset"); });
  return { state, events, bytes, memory, execute, fail(at: number) { failAt = at; }, deliveryFails() { delivered = false; } };
}

test("word fetches commit complete words only, including every partial operation/extension failure", () => {
  for (let failure = -1; failure < 4; failure++) {
    const f = fixture(); f.fail(failure); const result = f.execute();
    assert.equal(f.state.ir, failure === 0 || failure === 1 ? 0xaaaa : 0x1234);
    assert.deepEqual(result.instruction, failure === 0 || failure === 1 ? null : { address: 0x100, bytes: failure < 0 ? [0x12, 0x34, 0x56, 0x78] : [0x12, 0x34] });
    assert.equal(f.state.pc, failure < 0 ? 0x104 : 0x100);
    assert.equal(f.state.pending, failure < 0);
    assert.equal(f.events.filter(event => Array.isArray(event) && event[0] === "fetch").length, failure < 0 ? 4 : failure + 1);
    if (failure > 1) assert.equal(result.exception?.returnPc, 0x102);
  }
});

test("word execution arbitrates terminal halt, pending events, STOP, and initial alignment in order", () => {
  for (const terminal of [false, true]) for (const pending of [false, true]) for (const stopped of [false, true]) {
    const f = fixture(); Object.assign(f.state, { terminal, pending, stopped }); f.state.pc = 0x101;
    const result = f.execute(); assert.equal(result.instruction, null);
    assert.equal(result.outcome, terminal || (!pending && stopped) ? "halted" : "executed");
    assert.deepEqual(f.events, terminal || (!pending && stopped) ? [] : pending ? [["exception", { source: "trace", vector: 9, returnPc: 0x101 }]]
      : [["initial", { operation: "fetch", address: 0x101 }]]);
  }
});

test("targets do not replace the fetch cursor, and trace is sampled before memory callbacks", () => {
  const f = fixture(), original = f.memory.fetchByte;
  const memory = f.memory as { fetchByte: (address: number) => number };
  memory.fetchByte = address => { f.state.trace = false; return original(address); };
  const result = f.execute({ dispatch(_opcode, context) {
    context.jump(0x900); assert.equal(context.nextAddress(), 0x102);
    assert.equal(context.fetchWord(), 0x5678); assert.equal(context.nextAddress(), 0x104);
    f.state.stopped = true;
  } });
  assert.equal(result.outcome, "executed"); assert.equal(f.state.pc, 0x900); assert.equal(f.state.pending, true);
  const failing = fixture(); failing.fail(3);
  const fault = failing.execute({ dispatch(_opcode, context) { context.jump(0x900); context.fetchWord(); } });
  assert.equal(fault.exception?.returnPc, 0x102); assert.equal(failing.state.pc, 0x100);
});

test("exception policy controls restart/complete PCs, vector fields, unsupported decoding, and successful trace scheduling", () => {
  for (const source of ["illegal", "trap", "unsupported"] as const) for (const failed of [false, true]) for (const sampled of [false, true]) {
    const f = fixture(); if (failed) f.deliveryFails(); f.state.trace = sampled;
    const result = f.execute({ dispatch(_opcode, context) { context.fetchWord(); return source; } });
    assert.deepEqual(result.exception, source === "trap" ? { source: "trap", vector: 36, returnPc: 0x104 } : { source: "illegal", vector: 4, returnPc: 0x100 });
    assert.equal(f.state.pending, source === "trap" && !failed && sampled);
  }
});

test("word order and logical cursor width are policies; arbitrary host throws never become modeled faults", () => {
  const f = fixture(); f.state.pc = 0xfffe; f.bytes.set(0xfffe, 0x12); f.bytes.set(0xffff, 0x34);
  const result = f.execute({ order: "little", dispatch(opcode, context) { assert.equal(opcode, 0x3412); assert.equal(context.nextAddress(), 0); } });
  assert.equal(f.state.pc, 0); assert.deepEqual(result.instruction?.bytes, [0x12, 0x34]);
  for (const value of ["bus-error", { operation: "fetch", address: 0 }, Error("host"), undefined]) {
    const throwing = fixture(); let caught = false;
    try { throwing.execute({ dispatch() { throw value; } }); } catch (error) { caught = true; assert.equal(error, value); }
    assert.equal(caught, true); assert.equal(throwing.state.pc, 0x100); assert.equal(throwing.state.pending, false);
  }
});
