import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { instructions } from "../../../../src/components/cpus/generated/8088.js";
import { compileResolved } from "../../../helpers/8088-resolved.js";
import { control8088 } from "../../../helpers/8088-external.js";
import { instructions8088 } from "../../../../src/components/cpus/semantics/definitions.js";
import { recordCoprocessor } from "../../../../src/components/cpus/coprocessor-access.js";
import type { CoprocessorEscape as Cpu8088Escape } from "../../../../src/components/cpus/coprocessor-access.js";
import type { Cpu8088State } from "../../../../src/components/cpus/semantics/generated/state/8088.js";
import { cpu8088StateDescription } from "../../../../src/components/cpus/semantics/generated/state/8088.js";
import { cpuZ80StateDescription } from "../../../../src/components/cpus/semantics/generated/state/z80.js";
import { cpuSymbols, flagLiteral, flagValue, literal, projectAddress, readTest, reportInterrupt, sendEscape, value, when, writeLatch } from "../../../../src/components/cpus/semantics/model.js";
import type { Statement } from "../../../../src/components/cpus/semantics/model.js";
import { defineInstruction } from "../../../../src/components/cpus/semantics/validate.js";
import { describeInstruction } from "../../../../src/components/cpus/semantics/describe.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";
import { flags, initialState } from "../8088/helpers.js";

interface Context {
  fetchByte(): number;
  readByte(address: number): number;
  writeByte(address: number, value: number): void;
  readTest(): boolean;
  sendEscape(request: Cpu8088Escape): void;
  reportInterrupt(vector: number): void;
  deferInterrupt(scope: "intr" | "all"): void;
}
type Body = (state: Cpu8088State, context: Context) => void;
interface Probe { name: string; generated: Body; reference: Body }
const control = await compileResolved<{
  enterInterrupt(state: Cpu8088State, vector: number, context: Context): void;
  resumeWait: Body;
  escapeRegister(state: Cpu8088State, high: number, modRM: number, context: Context): void;
  escapeMemory(state: Cpu8088State, high: number, modRM: number, segment: number, offset: number, context: Context): void;
}>(control8088);
const wrap = (n: number) => (n + 65536) % 65536;
const physical = (segment: number, offset: number) => (segment * 16 + offset) % 1048576;
const positions = { cf: 0, pf: 2, af: 4, zf: 6, sf: 7, tf: 8, if: 9, df: 10, of: 11 } as const;

// Independent imperative schedules; no production stack, status, or semantic construction supplies the oracle.
function entry(state: Cpu8088State, vector: number, c: Context): void {
  const targetIP = c.readByte(vector * 4) + 256 * c.readByte(vector * 4 + 1);
  const targetCS = c.readByte(vector * 4 + 2) + 256 * c.readByte(vector * 4 + 3);
  let status = 0xf002;
  for (const field of Object.keys(positions) as (keyof typeof positions)[]) if (state.flags[field]) status += 2 ** positions[field];
  state.flags.if = state.flags.tf = false;
  state.halted = state.waiting = state.interruptDeferred = state.recognitionDeferred = false;
  const push = (word: number) => {
    state.sp = wrap(state.sp - 2);
    const segment = state.ss, offset = state.sp;
    c.writeByte(physical(segment, offset), word % 256);
    c.writeByte(physical(segment, wrap(offset + 1)), Math.floor(word / 256));
  };
  push(status); push(state.cs); push(state.ip); state.cs = targetCS; state.ip = targetIP;
}
const interrupts: readonly Probe[] = [
  { name: "INT3", generated: instructions[0xcc], reference(s, c) { entry(s, 3, c); c.reportInterrupt(3); } },
  { name: "INT n", generated: instructions[0xcd], reference(s, c) { const vector = c.fetchByte(); entry(s, vector, c); c.reportInterrupt(vector); } },
  { name: "INTO", generated: instructions[0xce], reference(s, c) { if (s.flags.of) { entry(s, 4, c); c.reportInterrupt(4); } } },
  ...[0, 1, 2, 255].map(vector => ({ name: "entry " + vector, generated: (s: Cpu8088State, c: Context) => control.enterInterrupt(s, vector, c),
    reference: (s: Cpu8088State, c: Context) => entry(s, vector, c) })),
];
const waits: readonly Probe[] = [false, true].map(resuming => ({ name: resuming ? "resume WAIT" : "WAIT",
  generated: resuming ? control.resumeWait : instructions[0x9b], reference(s, c) {
    const high = c.readTest(); s.waiting = high;
    if (high && !resuming) s.ip = wrap(s.ip - 1);
    if (!high && resuming) s.ip = wrap(s.ip + 1);
    if (!high) c.deferInterrupt("all");
  },
}));
function escape(high: number, modRM: number, segment: number, offset: number): Probe {
  return { name: ["ESC", high, modRM, segment, offset].join(":"),
    generated: (s, c) => modRM < 192 ? control.escapeMemory(s, high, modRM, segment, offset, c) : control.escapeRegister(s, high, modRM, c),
    reference(_s, c) {
      const memory = modRM < 192 ? { segment, offset, address: physical(segment, offset),
        value: c.readByte(physical(segment, offset)) + c.readByte(physical(segment, wrap(offset + 1))) * 256 } : null;
      c.sendEscape({ opcode: high * 8 + Math.floor(modRM / 8) % 8, modRM, memory });
    },
  };
}
function observe(before: Cpu8088State, high: boolean, failAt: number, mutate: (state: Cpu8088State) => void, execute: Body) {
  const state = structuredClone(before), memory = new Map<number, number>(), events: unknown[][] = [], originalFlags = state.flags;
  const failure = Error("injected effect failure");
  const effect = (...event: unknown[]) => { events.push(event); if (events.length - 1 === failAt) throw failure; };
  const observed = new Proxy(state, {
    get(target, key, receiver) {
      if (key === "flags") return new Proxy(target.flags, {
        get(target, key, receiver) { const contents = Reflect.get(target, key, receiver); effect("flag read", key, contents); return contents; },
        set(target, key, contents) { effect("flag write", key, contents); return Reflect.set(target, key, contents); },
      });
      const contents = Reflect.get(target, key, receiver); effect("read", key, contents); return contents;
    },
    set(target, key, contents) { effect("write", key, contents); return Reflect.set(target, key, contents); },
  });
  let failed = false;
  try {
    execute(observed, {
      fetchByte() { effect("fetch"); mutate(state); return 255; },
      readByte(address) { effect("memory read", address); mutate(state); return memory.get(address) ?? ((address * 3 + 17) % 256); },
      writeByte(address, byte) { effect("memory write", address, byte); mutate(state); memory.set(address, byte); },
      readTest() { effect("TEST", high); mutate(state); return high; },
      sendEscape(request) { effect("ESC", request); mutate(state); },
      reportInterrupt(vector) { effect("report", vector); mutate(state); },
      deferInterrupt(scope) { effect("defer", scope); mutate(state); },
    });
  } catch (error) { if (error !== failure) throw error; failed = true; }
  return { state, memory, events, failed, replacedFlags: state.flags !== originalFlags };
}
function compare(probes: readonly Probe[], states: readonly Cpu8088State[], mutation: (state: Cpu8088State) => void) {
  for (const probe of probes) for (const before of states) for (const high of [false, true]) for (const mutate of [() => {}, mutation]) {
    const complete = observe(before, high, -1, mutate, probe.reference);
    assert.deepEqual(observe(before, high, -1, mutate, probe.generated), complete, probe.name);
    for (let failAt = 0; failAt < complete.events.length; failAt++) assert.deepEqual(
      observe(before, high, failAt, mutate, probe.generated), observe(before, high, failAt, mutate, probe.reference), probe.name + " failure " + failAt);
  }
}

test("8088 generated control inventory covers the final twelve forms with shared entry and resumption", () => {
  assert.equal(Object.keys(instructions8088).length, 143);
  assert.deepEqual([0x9b, 0xcc, 0xcd, 0xce].map(opcode => instructions8088[opcode]!.name), ["WAIT", "INT3", "INT n", "INTO"]);
  assert.deepEqual(Object.keys(control8088), ["enterInterrupt", "resumeWait", "escapeRegister", "escapeMemory"]);
  assert.deepEqual(Object.keys(control), Object.keys(control8088));
});

test("8088 generated interrupt bodies retain vector/frame overlap, live CS/IP/SS/SP, latch order, and every partial failure", () => {
  compare(interrupts, [0, 1, 18, 0xffff].flatMap(sp => [0, 511].map(bits => initialState({ sp, ss: sp === 18 ? 0 : 0xffff,
    flags: flags(bits), halted: true, waiting: true, interruptDeferred: true, recognitionDeferred: true, trapPending: true }))),
    s => { s.cs = wrap(s.cs + 0x101); s.ip = wrap(s.ip + 3); s.sp = wrap(s.sp + 1); s.ss = wrap(s.ss + 1); s.flags.if = !s.flags.if; });
});

test("8088 WAIT and resumption use captured TEST levels, live IP, and successful-sample deferral", () => {
  compare(waits, [0, 0xffff, 0x1234].flatMap(ip => [false, true].map(waiting => initialState({ ip, waiting, trapPending: true }))),
    s => { s.ip = wrap(s.ip + 4); s.waiting = !s.waiting; s.flags.tf = !s.flags.tf; });
});

test("8088 generated ESC bodies cover every external opcode and ModR/M without reading CPU registers", () => {
  const probes = Array.from({ length: 8 }, (_, high) => Array.from({ length: 256 }, (_, modRM) => escape(high, modRM, 0xffff, modRM % 2 ? 0xffff : 0xf))).flat();
  compare(probes, [initialState()], s => { s.ds = 0; s.ss = 0; s.ax = 0; s.flags.cf = !s.flags.cf; });
});

test("8088 device adapters preserve receiver, ownership, and failed-access recording", () => {
  const events: unknown[] = [], marker = Error("device failure");
  const request: Cpu8088Escape = { opcode: 63, modRM: 63, memory: { segment: 0xffff, offset: 0xffff, address: 0xffef, value: 0xabcd } };
  const original = structuredClone(request);
  const device = {
    test() { assert.equal(this, device); return true; },
    escape(value: Cpu8088Escape) {
      assert.equal(this, device); assert.notEqual(value, request); assert.notEqual(value.memory, request.memory);
      Object.assign(value, { opcode: 0 }); Object.assign(value.memory!, { value: 0 });
    },
  };
  const adapter = recordCoprocessor("8088", device, effect => events.push(effect));
  assert.equal(adapter.readTest(), true); adapter.sendEscape(request);
  assert.deepEqual(events, [{ kind: "test", high: true }, { kind: "escape", ...original }]);
  assert.deepEqual(request, original);
  for (const high of [false, true, null, 0, 1, undefined, "false"]) {
    events.length = 0;
    const effect = recordCoprocessor("8088", { test: () => high as boolean }, event => events.push(event));
    if (typeof high === "boolean") { assert.equal(effect.readTest(), high); assert.deepEqual(events, [{ kind: "test", high }]); }
    else { assert.throws(effect.readTest, /Boolean pin level/); assert.equal(events.length, 0); }
  }
  events.length = 0;
  const failed = recordCoprocessor("8088", { test() { throw marker; }, escape() { throw marker; } }, event => events.push(event));
  assert.throws(failed.readTest, error => error === marker); assert.throws(() => failed.sendEscape(request), error => error === marker);
  assert.equal(events.length, 0);
  const absent = recordCoprocessor("8088", undefined, event => events.push(event));
  assert.throws(absent.readTest, /TEST input connection/); absent.sendEscape(request);
  assert.deepEqual(events, [{ kind: "escape", ...original }]);
});

test("8088 control effects validate widths, ownership and scopes, and infer only requested capabilities", async () => {
  const cpu = cpuSymbols("8088", cpu8088StateDescription), other = cpuSymbols("z80", cpuZ80StateDescription);
  const define = (steps: readonly Statement[]) => defineInstruction({ cpu: { ...cpu.declaration, segmentedBoundary: true }, name: "device probe", explanation: "External effect probe.", steps });
  const escape = sendEscape({ opcode: literal(8, 63), modRM: literal(8, 0xc7) });
  for (const step of [readTest("high"), escape, reportInterrupt(literal(8, 255))]) {
    assert.throws(() => defineInstruction({ ...define([step]), cpu: other.declaration }), /segmented/);
  }
  const memory = { segment: literal(16, 0), offset: literal(16, 0), address: projectAddress(literal(16, 0), literal(16, 0), 4, 20), value: literal(16, 0) };
  for (const steps of [
    [reportInterrupt(literal(16, 3))], [reportInterrupt(value("missing"))],
    [sendEscape({ opcode: literal(16, 0), modRM: literal(8, 0) })],
    [sendEscape({ opcode: literal(8, 0), modRM: literal(16, 0) })],
    ...(["segment", "offset", "value", "address"] as const).map(field => [sendEscape({ opcode: literal(8, 0), modRM: literal(8, 0), memory: { ...memory, [field]: literal(8, 0) } })]),
    [readTest("high"), readTest("high")], [readTest("high"), reportInterrupt(value("high"))],
    [when(flagLiteral(true), [readTest("high")]), writeLatch(cpu.latch("waiting"), flagValue("high"))],
  ]) assert.throws(() => define(steps));
  const probe = define([readTest("high"), writeLatch(cpu.latch("waiting"), flagValue("high")), when(flagValue("high"), [escape, reportInterrupt(literal(8, 3))])]);
  const description = describeInstruction(probe);
  assert.match(description, /sample and record physical TEST/); assert.match(description, /register selector only/);
  assert.match(description, /report completed software interrupt delivery/);
  const source = generateInstructions("8088", { probe });
  assert.match(source, /"readTest" \| "sendEscape" \| "reportInterrupt"/);
  assert.doesNotMatch(source, /"fetchByte"|"readByte"|"writeByte"|deferInterrupt/);
  const compiled: { instructions: { probe: Body } } = await import("data:text/javascript," + encodeURIComponent(stripTypeScriptTypes(source)));
  for (const high of [false, true]) {
    const state = initialState(), events: unknown[] = [];
    compiled.instructions.probe(state, { readTest() { events.push("test"); return high; },
      sendEscape(request) { events.push(request); state.waiting = false; }, reportInterrupt(vector) { events.push(vector); },
      fetchByte() { assert.fail(); }, readByte() { assert.fail(); }, writeByte() { assert.fail(); }, deferInterrupt() { assert.fail(); } });
    assert.deepEqual(events, high ? ["test", { opcode: 63, modRM: 0xc7, memory: null }, 3] : ["test"]);
    assert.equal(state.waiting, false);
  }
});
