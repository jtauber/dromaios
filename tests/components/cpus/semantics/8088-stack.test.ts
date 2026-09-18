import assert from "node:assert/strict";
import { test } from "node:test";
import { instructions, opcodeEntries } from "../../../../src/components/cpus/generated/8088.js";
import { instructions as stack } from "../../../../src/components/cpus/generated/8088-stack.js";
import { instructions8088, stack8088 } from "../../../../src/components/cpus/semantics/definitions.js";
import { describeInstruction } from "../../../../src/components/cpus/semantics/describe.js";
import { cpuSymbols, deferInterrupt } from "../../../../src/components/cpus/semantics/model.js";
import { cpu8088StateDescription } from "../../../../src/components/cpus/state/8088.js";
import { cpu6502StateDescription } from "../../../../src/components/cpus/state/6502.js";
import { defineInstruction } from "../../../../src/components/cpus/semantics/validate.js";
import { segmentedWordStack } from "../../../../src/components/cpus/semantics/stack.js";
import type { Statement } from "../../../../src/components/cpus/semantics/model.js";
import type { Cpu8088State, Cpu8088Flags } from "../../../../src/components/cpus/state/8088.js";
import { address, flags, initialState, words } from "../8088/helpers.js";

type Register = typeof words[number] | "cs" | "ss" | "ds" | "es" | "ip";
type Operation = "PUSH" | "POP" | "PUSHF" | "POPF" | "CALL" | "JMP" | "RET";
interface Form { key: number | string; operation: Operation; register?: Register; memory?: true; far?: true; relative?: true; discard?: true }
type Context = { fetchByte(): number; readByte(address: number): number; writeByte(address: number, byte: number): void; deferInterrupt(scope: "intr" | "all"): void };
type Body = (state: Cpu8088State, context: Context) => void;
type MemoryBody = (state: Cpu8088State, segment: number, offset: number, context: Context) => void;
const bodies: Readonly<Partial<Record<number, Body>>> = instructions;
const resolved: Readonly<Record<string, Body | MemoryBody | ((state: Cpu8088State, value: number, context: Context) => void)>> = stack;
const forms: readonly Form[] = [
  ...words.flatMap((register, i): Form[] => [{ key: 0x50 + i, operation: "PUSH", register }, { key: 0x58 + i, operation: "POP", register }]),
  ...([[0x06, "es"], [0x0e, "cs"], [0x16, "ss"], [0x1e, "ds"]] as const).map(([key, register]): Form => ({ key, register, operation: "PUSH" })),
  ...([[0x07, "es"], [0x17, "ss"], [0x1f, "ds"]] as const).map(([key, register]): Form => ({ key, register, operation: "POP" })),
  { key: 0x9c, operation: "PUSHF" }, { key: 0x9d, operation: "POPF" },
  { key: 0xe8, operation: "CALL", relative: true }, { key: 0x9a, operation: "CALL", far: true }, { key: 0xea, operation: "JMP", far: true },
  { key: 0xc2, operation: "RET", discard: true }, { key: 0xc3, operation: "RET" },
  { key: 0xca, operation: "RET", discard: true, far: true }, { key: 0xcb, operation: "RET", far: true },
  ...words.flatMap((register, i): Form[] => [{ key: "CALL_" + i, operation: "CALL", register }, { key: "JMP_" + i, operation: "JMP", register }]),
  ...(["PUSH", "POP", "CALL", "JMP"] as const).map((operation): Form => ({ key: operation + "_memory", operation, memory: true })),
  ...(["CALL", "JMP"] as const).map((operation): Form => ({ key: operation + "_far_memory", operation, memory: true, far: true })),
  { key: "pushWord", operation: "PUSH" },
];
const positions = { cf: 0, pf: 2, af: 4, zf: 6, sf: 7, tf: 8, if: 9, df: 10, of: 11 } as const;
function decoded(word: number): Cpu8088Flags {
  const result = flags(0);
  for (const field of Object.keys(positions) as (keyof Cpu8088Flags)[]) result[field] = Boolean(Math.floor(word / 2 ** positions[field]) % 2);
  return result;
}
const wrap = (value: number) => (value + 65536) % 65536;
const immediate = [0x10, 0xff, 0x34, 0x12];

function execute(form: Form, state: Cpu8088State, segment: number, offset: number, context: Context) {
  if (typeof form.key === "number") bodies[form.key]!(state, context);
  else if (form.key === "pushWord") stack.pushWord(state, 0xabcd, context);
  else if (form.memory) (resolved[form.key] as MemoryBody)(state, segment, offset, context);
  else (resolved[form.key] as Body)(state, context);
}

test("8088 stack definitions add exactly 32 encoded bodies, 22 resolved bodies, and one shared interrupt push", () => {
  const opcodes = forms.filter(f => typeof f.key === "number").map(f => f.key);
  const keys = forms.filter(f => typeof f.key === "string").map(f => f.key).sort();
  assert.equal(opcodes.length, 32); assert.equal(keys.length, 23); assert.equal(Object.keys(instructions8088).length, 125);
  assert.ok(opcodes.every(key => key in instructions8088));
  assert.deepEqual(Object.keys(stack8088).sort(), keys); assert.deepEqual(Object.keys(stack).sort(), keys);
  const forbidden = new Proxy(initialState(), { get() { assert.fail("Binding must not read state"); } });
  assert.deepEqual(opcodeEntries(forbidden).map(([opcode]) => opcode), Object.keys(instructions8088).map(Number));
});

type Event = readonly [name: string, value?: number | Cpu8088Flags];
interface Snapshot { state: Cpu8088State; bytes: Map<number, number>; deferred: string[] }

// Independent schedule with plain word arithmetic; no semantic recipes, definitions, or generated code.
function expected(form: Form, before: Cpu8088State, initialBytes: Map<number, number>, segment: number, offset: number) {
  const state = structuredClone(before), bytes = new Map(initialBytes), deferred: string[] = [], events: Event[] = [], snapshots: Snapshot[] = [];
  const effect = (event: Event) => { events.push(event); snapshots.push({ state: structuredClone(state), bytes: new Map(bytes), deferred: [...deferred] }); };
  const read = (field: Register) => { effect(["read " + field]); return state[field]; };
  const write = (field: Register, value: number) => { effect(["write " + field, value]); state[field] = value; };
  const readFlag = (field: keyof Cpu8088Flags) => { effect(["read flag " + field]); return state.flags[field]; };
  const defer = (scope: "intr" | "all") => { effect(["defer " + scope]); deferred.push(scope); };
  const readWord = (segment: number, offset: number) => {
    const read = (a: number) => { effect(["read memory " + a]); assert.ok(bytes.has(a)); return bytes.get(a)!; };
    const low = read(address(segment, offset)), high = read(address(segment, offset + 1));
    return low + high * 256;
  };
  const writeWord = (segment: number, offset: number, value: number) => {
    for (let i = 0; i < 2; i++) {
      const a = address(segment, offset + i), byte = Math.floor(value / 256 ** i) % 256;
      effect(["write memory " + a, byte]); bytes.set(a, byte);
    }
  };
  const push = (value: number) => { write("sp", wrap(read("sp") - 2)); writeWord(read("ss"), read("sp"), value); };
  const pop = () => { const value = readWord(read("ss"), read("sp")); write("sp", wrap(read("sp") + 2)); return value; };
  let fetched = 0;
  const fetchWord = () => { effect(["fetch"]); const low = immediate[fetched++]!; effect(["fetch"]); return low + immediate[fetched++]! * 256; };
  const { operation, register } = form;
  if (operation === "PUSHF") {
    let status = 0xf002;
    for (const field of Object.keys(positions) as (keyof Cpu8088Flags)[]) status += Number(readFlag(field)) * 2 ** positions[field];
    push(status);
  } else if (operation === "POPF") {
    const status = decoded(pop());
    if (!readFlag("if") && status.if) defer("intr");
    effect(["replace flags", status]); state.flags = status;
  } else if (operation === "PUSH") {
    const source = register ? read(register) : form.memory ? readWord(segment, offset) : 0xabcd;
    push(register === "sp" ? wrap(source - 2) : source);
  } else if (operation === "POP") {
    const value = pop();
    if (register) { write(register, value); if (["es", "ss", "ds"].includes(register)) defer("all"); }
    else writeWord(segment, offset, value);
  } else if (operation === "RET") {
    const discard = form.discard ? fetchWord() : 0, ip = pop(), cs = form.far ? pop() : undefined;
    write("ip", ip); if (cs !== undefined) write("cs", cs);
    write("sp", wrap(read("sp") + discard));
  } else {
    const target = register ? read(register) : form.memory ? readWord(segment, offset) : fetchWord();
    const cs = form.far ? form.memory ? readWord(segment, wrap(offset + 2)) : fetchWord() : undefined;
    if (operation === "CALL") {
      if (form.far) push(read("cs"));
      push(read("ip"));
    }
    if (cs !== undefined) write("cs", cs);
    write("ip", form.relative ? wrap(read("ip") + target) : target);
  }
  return { events, snapshots, after: { state, bytes, deferred } };
}

function observed(state: Cpu8088State, effect: (event: Event) => void): Cpu8088State {
  return new Proxy(state, {
    get(target, key, receiver) {
      if (key === "flags") return new Proxy(target.flags, {
        get(target, key, receiver) { effect(["read flag " + String(key)]); return Reflect.get(target, key, receiver); },
        set() { assert.fail("These bodies replace FLAGS or preserve it; no individual flag writes"); },
      });
      effect(["read " + String(key)]); return Reflect.get(target, key, receiver);
    },
    set(target, key, value) { effect([key === "flags" ? "replace flags" : "write " + String(key), value]); return Reflect.set(target, key, value); },
  });
}

test("every 8088 stack/control body retains exact read/write/deferral ordering and all completed effects at every failure", () => {
  for (const form of forms) for (const bits of [0, 511]) for (const sp of [1, 0xf, 0xffff]) {
    const before = initialState({ ss: 0xffff, sp, flags: flags(bits), interruptDeferred: true, recognitionDeferred: true });
    const segment = 0xffff, offset = sp === 0xf ? 0xf : 0xffff, initialBytes = new Map<number, number>();
    for (let i = 0; i < 4; i++) initialBytes.set(address(before.ss, sp + i), [0x02, bits ? 0 : 0x02, 0xef, 0xbe][i]!);
    for (let i = 0; i < 4; i++) initialBytes.set(address(segment, offset + i), [0x34, 0x12, 0x78, 0x56][i]!);
    const oracle = expected(form, before, initialBytes, segment, offset);
    for (let failAt = -1; failAt < oracle.events.length; failAt++) {
      const state = structuredClone(before), bytes = new Map(initialBytes), deferred: string[] = [], events: Event[] = [], failure = Error("effect failed");
      const oldFlags = state.flags;
      const effect = (event: Event) => { events.push(event); if (events.length - 1 === failAt) throw failure; };
      let fetched = 0;
      const run = () => execute(form, observed(state, effect), segment, offset, {
        fetchByte() { effect(["fetch"]); return immediate[fetched++]!; },
        readByte(a) { effect(["read memory " + a]); assert.ok(bytes.has(a)); return bytes.get(a)!; },
        writeByte(a, byte) { effect(["write memory " + a, byte]); bytes.set(a, byte); },
        deferInterrupt(scope) { effect(["defer " + scope]); deferred.push(scope); },
      });
      if (failAt < 0) run(); else assert.throws(run, error => error === failure);
      const label = [form.key, bits, sp, failAt].join(":");
      assert.deepEqual(events, oracle.events.slice(0, failAt < 0 ? undefined : failAt + 1), label);
      assert.deepEqual({ state, bytes, deferred }, failAt < 0 ? oracle.after : oracle.snapshots[failAt], label);
      assert.equal(state.flags === oldFlags, form.operation !== "POPF" || failAt >= 0);
    }
  }
});

test("8088 word-stack callbacks cannot retarget a word but later words and pointer adjustments observe live state", () => {
  const state = initialState({ ss: 0xffff, sp: 1, cs: 0x1234, ip: 0x100 }), writes: number[][] = [];
  stack.pushWord(state, 0xabcd, { writeByte(a, byte) {
    writes.push([a, byte]); state.ss = 0x2000; state.sp = 0x300;
  } });
  assert.deepEqual(writes, [[0xffef, 0xcd], [0xffff0, 0xab]]); assert.equal(state.sp, 0x300);

  const reads: number[] = [];
  state.ss = 0xffff; state.sp = 0xf;
  instructions[0x5b](state, { readByte(a) { reads.push(a); state.ss = 0x1234; state.sp = 0x400; return a === 0xfffff ? 0x78 : 0x56; } });
  assert.deepEqual(reads, [0xfffff, 0]); assert.equal(state.sp, 0x402); assert.equal(state.bx, 0x5678);

  state.ss = 0xffff; state.sp = 1; state.cs = 0x1111; state.ip = 0x2222; writes.length = 0;
  let fetched = 0;
  instructions[0x9a](state, {
    fetchByte() { return [0x78, 0x56, 0xbc, 0x9a][fetched++]!; },
    writeByte(a, byte) {
      writes.push([a, byte]);
      if (writes.length === 1) { state.ss = 0x2000; state.sp = 0x300; state.ip = 0xabcd; }
    },
  });
  assert.deepEqual(writes, [[0xffef, 0x11], [0xffff0, 0x11], [0x202fe, 0xcd], [0x202ff, 0xab]]);
  assert.equal(state.cs, 0x9abc); assert.equal(state.ip, 0x5678); assert.equal(state.sp, 0x2fe);
});

test("8088 relative CALL reads live IP after both writes while resolved CALL retains its earlier operand", () => {
  for (const relative of [false, true]) {
    const state = initialState({ ip: 0x100, ax: 0x5555 }), writes: number[] = [];
    const context = { fetchByte: () => 1, writeByte(_a: number, byte: number) { writes.push(byte); state.ip = 0xff00; state.ax = 0xaaaa; } };
    if (relative) instructions[0xe8](state, context); else stack.CALL_0(state, context);
    assert.deepEqual(writes, [0, 1]); assert.equal(state.ip, relative ? 1 : 0x5555);
  }
});

test("8088 POPF reads IF after the whole pop and defers before replacing flags without committing boundary latches", () => {
  for (const originalIF of [false, true]) {
    const state = initialState({ flags: flags(0) }), oldFlags = state.flags, scopes: string[] = [];
    let read = 0;
    instructions[0x9d](state, {
      readByte() { state.flags.if = originalIF; return read++ ? 0x02 : 0; },
      deferInterrupt(scope) { assert.equal(state.flags, oldFlags); scopes.push(scope); },
    });
    assert.deepEqual(scopes, originalIF ? [] : ["intr"]); assert.notEqual(state.flags, oldFlags);
    assert.deepEqual(state.flags, decoded(0x200)); assert.equal(state.interruptDeferred, false);
  }
});

test("segmented stack and deferral construction reject unsupported widths, CPUs, and scopes", () => {
  const intel = cpuSymbols("8088", cpu8088StateDescription), mos = cpuSymbols("6502", cpu6502StateDescription);
  assert.throws(() => segmentedWordStack(intel.register("ss"), mos.register("sp")), /word registers/);
  const definition = { cpu: intel.declaration, name: "defer", explanation: "Boundary request.", steps: [deferInterrupt("intr")] };
  defineInstruction(definition);
  assert.throws(() => defineInstruction({ ...definition, cpu: mos.declaration }), /8088 boundary/);
  for (const scope of ["irq", "", false, 1]) assert.throws(() =>
    defineInstruction({ ...definition, steps: [{ kind: "defer-interrupt", scope } as unknown as Statement] }), /scope/);
  assert.match(describeInstruction(definition), /INTR deferral at successful retirement/);
  assert.match(describeInstruction(instructions8088[0x17]!), /all interrupt deferral at successful retirement/);
  // A full word status layout produces a word, never a truncated status byte.
  assert.match(describeInstruction(instructions8088[0x9c]!), /u16 := source "packed status"/);
  assert.match(describeInstruction(instructions8088[0x9d]!), /Replace the complete flag object/);
});


test("8088 word status packing covers every flag pattern and POPF decodes every word with both incoming IF states", () => {
  const state = initialState();
  for (let bits = 0; bits < 512; bits++) {
    state.flags = flags(bits); state.sp = 0;
    const expected = 0xf002 + Object.entries(positions).reduce((word, [field, bit]) => word + Number(state.flags[field as keyof Cpu8088Flags]) * 2 ** bit, 0);
    const bytes: number[] = [];
    instructions[0x9c](state, { writeByte(_a, byte) { bytes.push(byte); state.flags = flags(511 - bits); } });
    assert.deepEqual(bytes, [expected % 256, Math.floor(expected / 256)]);
  }
  for (const incomingIF of [false, true]) for (let word = 0; word < 65536; word++) {
    state.flags = { ...flags(511), if: incomingIF }; state.sp = 0xffff;
    let reads = 0, deferred = false;
    instructions[0x9d](state, {
      readByte() { return reads++ ? Math.floor(word / 256) : word % 256; },
      deferInterrupt(scope) { assert.equal(scope, "intr"); deferred = true; },
    });
    const expected = decoded(word);
    assert.deepEqual(state.flags, expected); assert.equal(state.sp, 1);
    assert.equal(deferred, !incomingIF && expected.if);
  }
});
