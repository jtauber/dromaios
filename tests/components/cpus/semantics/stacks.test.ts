import assert from "node:assert/strict";
import { test } from "node:test";
import { instructions as mos } from "../../../../src/components/cpus/generated/6502.js";
import { instructions as m6800 } from "../../../../src/components/cpus/generated/6800.js";
import { bodies6809 as m6809 } from "../../../helpers/6809-bodies.js";
import { instructions as intel } from "../../../../src/components/cpus/generated/8080.js";
import { bodiesZ80 as zilog } from "../../../helpers/z80-bodies.js";
import type { ByteInstructionContext } from "../../../../src/components/cpus/instruction-context.js";
import { byteStack } from "../../../../src/components/cpus/semantics/stack.js";
import { cpuSymbols } from "../../../../src/components/cpus/semantics/model.js";
import { cpu6502StateDescription } from "../../../../src/components/cpus/semantics/generated/state/6502.js";
import { stackState } from "../../../helpers/stack-forms.js";
import type { StackCpu } from "../../../helpers/stack-forms.js";

type State = ReturnType<typeof stackState>;
type Field = "a" | "b" | "c" | "d" | "e" | "h" | "l" | "ix" | "iy" | "pc";
type Execute = (state: State, instruction: ByteInstructionContext) => void;
interface Probe { readonly cpu: StackCpu; readonly fields: readonly Field[]; readonly word?: boolean; readonly push?: Execute; readonly pop: Execute; readonly increment?: number }
const probes: readonly Probe[] = [
  { cpu: "6502", fields: ["a"], push: mos[0x48], pop: mos[0x68] },
  { cpu: "6502", fields: ["pc"], word: true, pop: mos[0x60], increment: 1 },
  { cpu: "6800", fields: ["a"], push: m6800[0x36], pop: m6800[0x32] },
  { cpu: "6800", fields: ["b"], push: m6800[0x37], pop: m6800[0x33] },
  { cpu: "6800", fields: ["pc"], word: true, pop: m6800[0x39] },
  { cpu: "6809", fields: ["pc"], word: true, pop: m6809.rts },
  ...(["8080", "z80"] as const).flatMap(cpu => {
    const generated = cpu === "8080" ? intel : zilog;
    return [
      ...([[0xc5, 0xc1, ["b", "c"]], [0xd5, 0xd1, ["d", "e"]], [0xe5, 0xe1, ["h", "l"]]] as const)
        .map(([push, pop, fields]): Probe => ({ cpu, fields, word: true, push: generated[push], pop: generated[pop] })),
      { cpu, fields: ["pc"], word: true, pop: generated[0xc9] } satisfies Probe,
    ];
  }),
  { cpu: "z80", fields: ["ix"], word: true, push: zilog.pushIX, pop: zilog.popIX },
  { cpu: "z80", fields: ["iy"], word: true, push: zilog.pushIY, pop: zilog.popIY },
];

test("generated stacks read live pointers at each stage, capture pushed words, and defer pop destinations until complete", () => {
  for (const probe of probes) for (const operation of probe.push ? ["push", "pop"] as const : ["pop"] as const) {
    const mosCpu = probe.cpu === "6502", free = mosCpu || probe.cpu === "6800", little = mosCpu || probe.cpu === "8080" || probe.cpu === "z80";
    const pointer = probe.cpu === "6809" ? "s" : "sp", size = mosCpu ? 256 : 65536, count = probe.word ? 2 : 1;
    for (let failAt = -1; failAt < count; failAt++) {
      const state = stackState(probe.cpu, 0, 0x1234, 0), expected = structuredClone(state), events: string[] = [], expectedEvents: string[] = [];
      const failure = new Error("stack effect failure"), accesses: { kind: "read" | "write"; address: number; value: number }[] = [];
      const original = probe.fields.length === 1 ? state[probe.fields[0]!] : state[probe.fields[0]!] * 256 + state[probe.fields[1]!]!;
      const bytes = !probe.word ? [original] : little ? [Math.floor(original / 256), original % 256] : [original % 256, Math.floor(original / 256)];
      if (operation === "push") expectedEvents.push(...probe.fields.map(field => `read ${field}`));
      for (let i = 0; i < count; i++) {
        const adjustFirst = operation === "push" ? !free : free, delta = operation === "push" ? -1 : 1;
        const adjust = () => { expectedEvents.push(`read ${pointer}`, `write ${pointer}`); expected[pointer] = (expected[pointer] + delta + size) % size; };
        if (adjustFirst) adjust();
        const kind = operation === "push" ? "write" : "read";
        expectedEvents.push(`read ${pointer}`, `${kind} memory`);
        accesses.push({ kind, address: (mosCpu ? 0x100 : 0) + expected[pointer], value: operation === "push" ? bytes[i]! : [0x80, 0x42][i]! });
        if (i === failAt) break;
        expected[pointer] = i === 0 ? size - 1 : 0; // Successful callbacks replace live state.
        for (const field of probe.fields) expected[field] = probe.word && probe.fields.length === 1 ? 0x5555 : 0x55;
        expected.flags = stackState(probe.cpu, 15, 0, 0).flags;
        if (!adjustFirst) adjust();
      }
      if (operation === "pop" && failAt < 0) {
        const loaded = ((probe.word ? little ? 0x4280 : 0x8042 : 0x80) + (probe.increment ?? 0)) % 65536;
        if (probe.fields.length === 1) expected[probe.fields[0]!] = loaded;
        else { expected[probe.fields[0]!] = Math.floor(loaded / 256); expected[probe.fields[1]!] = loaded % 256; }
        expectedEvents.push(...probe.fields.map(field => `write ${field}`));
        if (mosCpu && !probe.word) { expected.flags.n = true; expected.flags.z = false; expectedEvents.push("flag n", "flag z"); }
      }
      const observed = new Proxy(state, {
        get(target, key, receiver) {
          assert.ok(key === pointer || (operation === "push" && probe.fields.some(field => field === key)) || (mosCpu && operation === "pop" && !probe.word && key === "flags"));
          if (key !== "flags") events.push(`read ${String(key)}`); return Reflect.get(target, key, receiver);
        },
        set(target, key, value) {
          assert.ok(key === pointer || (operation === "pop" && probe.fields.some(field => field === key)));
          events.push(`write ${String(key)}`); return Reflect.set(target, key, value);
        },
      });
      let attempts = 0;
      const access = (kind: "read" | "write", address: number, byte?: number) => {
        const expectedAccess = accesses[attempts]!;
        assert.equal(kind, expectedAccess.kind); assert.equal(address, expectedAccess.address);
        if (kind === "write") assert.equal(byte, expectedAccess.value);
        events.push(`${kind} memory`); const index = attempts++; if (index === failAt) throw failure;
        state[pointer] = index === 0 ? size - 1 : 0;
        for (const field of probe.fields) state[field] = probe.word && probe.fields.length === 1 ? 0x5555 : 0x55;
        state.flags = new Proxy(stackState(probe.cpu, 15, 0, 0).flags, { set(target, key, value) {
          events.push(`flag ${String(key)}`); return Reflect.set(target, key, value);
        } });
        return expectedAccess.value;
      };
      const execute = operation === "push" ? probe.push! : probe.pop;
      const run = () => execute(observed, { fetchByte() { assert.fail("no operand fetch"); }, readByte: address => access("read", address), writeByte: (address, byte) => { access("write", address, byte); } });
      if (failAt < 0) run(); else assert.throws(run, error => error === failure);
      assert.deepEqual(events, expectedEvents, `${probe.cpu} ${operation} ${probe.fields.join("")} failure=${failAt}`);
      assert.deepEqual(state, expected); assert.equal(attempts, accesses.length);
    }
  }
});

test("conditional Intel calls fetch complete targets before flags and untaken calls/returns never access PC or SP", () => {
  const calls = [0xc4, 0xcc, 0xd4, 0xdc, 0xe4, 0xec, 0xf4, 0xfc] as const;
  const returns = [0xc0, 0xc8, 0xd0, 0xd8, 0xe0, 0xe8, 0xf0, 0xf8] as const;
  for (const cpu of ["8080", "z80"] as const) for (const operation of ["call", "return"] as const) for (let code = 0; code < 8; code++) {
    const execute = (cpu === "8080" ? intel : zilog)[(operation === "call" ? calls : returns)[code]!];
    for (const take of [false, true]) {
      const set = Boolean(code % 2) === take, bit = 2 ** Math.floor(code / 2);
      const state = stackState(cpu, operation === "call" ? set ? 0 : 15 : set ? bit : 0, 0xffff, 0), events: string[] = [];
      let fetched = 0;
      const flags = (mask: number) => new Proxy(stackState(cpu, mask, 0, 0).flags, {
        get(target, key, receiver) { events.push(`flag ${String(key)}`); return Reflect.get(target, key, receiver); },
        set() { assert.fail("no flag writes"); },
      });
      state.flags = flags(set ? bit : 0);
      const observed = new Proxy(state, {
        get(target, key, receiver) { if (key !== "flags") { assert.ok(take); events.push(`read ${String(key)}`); } return Reflect.get(target, key, receiver); },
        set(target, key, value) { assert.ok(take); events.push(`write ${String(key)}`); return Reflect.set(target, key, value); },
      });
      execute(observed, {
        fetchByte() { assert.equal(operation, "call"); events.push("fetch"); state.pc = 0x5678;
          state.flags = flags(set ? bit : 0); return [0x34, 0x12][fetched++]!; },
        readByte() { assert.equal(operation, "return"); assert.ok(take); events.push("read memory"); return 0x42; },
        writeByte() { assert.equal(operation, "call"); assert.ok(take); events.push("write memory"); },
      });
      const selected = (cpu === "8080" ? ["z", "cy", "p", "s"] : ["z", "c", "pv", "s"])[Math.floor(code / 2)]!;
      const prefix = [...(operation === "call" ? ["fetch", "fetch"] : []), `flag ${selected}`];
      assert.deepEqual(events.slice(0, prefix.length), prefix);
      if (!take) assert.deepEqual(events, prefix);
      assert.equal(state.pc, take ? operation === "call" ? 0x1234 : 0x4242 : operation === "call" ? 0x5678 : 0xffff);
    }
  }
});

test("6502 JSR captures its low target first and each return byte at its own stage", () => {
  for (let failAt = -1; failAt < 4; failAt++) {
    const state = stackState("6502", 15, 0x0101, 0), before = structuredClone(state), events: string[] = [], writes: number[][] = [];
    let attempts = 0;
    const failure = new Error("JSR effect failure"), attempt = () => { if (attempts++ === failAt) throw failure; };
    const observed = new Proxy(state, { get(target, key, receiver) {
      if (key === "pc") events.push("read PC"); return Reflect.get(target, key, receiver);
    } });
    const run = () => mos[0x20](observed, {
      fetchByte() { events.push("fetch"); const index = attempts; attempt(); state.pc = index === 0 ? 0x12ff : 0x6000; return index === 0 ? 0x56 : 0x78; },
      writeByte(address, byte) { events.push("write"); const index = attempts; attempt(); writes.push([address, byte]); state.pc = index === 1 ? 0x34cd : 0xab00; },
    });
    if (failAt < 0) run(); else assert.throws(run, error => error === failure);
    assert.deepEqual(events, ["fetch", "read PC", "write", "read PC", "write", "fetch"].slice(0, [6, 1, 3, 5, 6][failAt + 1]));
    assert.deepEqual(writes, [[0x100, 0x12], [0x1ff, 0xcd]].slice(0, failAt < 0 ? 2 : Math.max(0, failAt - 1)));
    assert.deepEqual(state, { ...before, pc: [0x7856, 0x0101, 0x12ff, 0x34cd, 0xab00][failAt + 1], sp: [0xfe, 0, 0, 0xff, 0xfe][failAt + 1] });
  }
});

test("stack pages must fit the address word without overlapping pointer bits", () => {
  const cpu = cpuSymbols("6502", cpu6502StateDescription);
  for (const page of [-1, 1, 0x10000, NaN, Infinity]) assert.throws(() => byteStack(cpu.register("sp"), "free", page), /stack page/);
  assert.throws(() => byteStack(cpu.register("pc"), "occupied", 0x100), /stack page/);
});
