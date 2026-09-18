import assert from "node:assert/strict";
import { test } from "node:test";
import { instructions, opcodeEntries } from "../../../../src/components/cpus/generated/8088.js";
import { instructions as unary } from "../../../../src/components/cpus/generated/8088-unary.js";
import { instructions8088, unary8088 } from "../../../../src/components/cpus/semantics/definitions.js";
import { describeInstruction } from "../../../../src/components/cpus/semantics/describe.js";
import type { Cpu8088State } from "../../../../src/components/cpus/state/8088.js";
import { address, aluResult, byteMoves, flags, initialState, registerValue, replaceRegister, unaryForms, words } from "../8088/helpers.js";

type Context = { deferInterrupt(scope: "intr" | "all"): void; fetchByte(): number; readByte(address: number): number; writeByte(address: number, byte: number): void };
type Body = (state: Cpu8088State, context: Context) => void;
type MemoryBody = (state: Cpu8088State, segment: number, offset: number, context: Context) => void;
const bodies: Readonly<Partial<Record<number, Body>>> = instructions;
const unaryBodies: Readonly<Record<string, Body | MemoryBody>> = unary;
const names: Readonly<Record<number, string>> = {
  0x70: "JO rel8", 0x71: "JNO rel8", 0x72: "JB rel8", 0x73: "JAE rel8",
  0x74: "JE rel8", 0x75: "JNE rel8", 0x76: "JBE rel8", 0x77: "JA rel8",
  0x78: "JS rel8", 0x79: "JNS rel8", 0x7a: "JP rel8", 0x7b: "JNP rel8",
  0x7c: "JL rel8", 0x7d: "JGE rel8", 0x7e: "JLE rel8", 0x7f: "JG rel8",
  0x98: "CBW", 0x99: "CWD", 0x9e: "SAHF", 0x9f: "LAHF",
  0xe0: "LOOPNE rel8", 0xe1: "LOOPE rel8", 0xe2: "LOOP rel8", 0xe3: "JCXZ rel8",
  0xe9: "JMP rel16", 0xeb: "JMP rel8", 0xf4: "HLT", 0xf5: "CMC",
  0xf8: "CLC", 0xf9: "STC", 0xfc: "CLD", 0xfd: "STD",
};
const unaryCases = unaryForms.flatMap(([operation]) => ([8, 16] as const).flatMap(width =>
  [...words.map((_, i) => i), "memory" as const].map(selector => ({
    operation, width, selector, key: [operation, width, selector].join("_"),
  }))));

test("8088 ordinary inventory adds exactly 32 opcode bodies and 72 specializations for eight unary forms", () => {
  assert.equal(Object.keys(names).length, 32);
  assert.equal(Object.keys(instructions8088).length, 131);
  assert.deepEqual(Object.fromEntries(Object.entries(instructions8088).filter(([opcode]) => Number(opcode) in names).map(([opcode, d]) => [opcode, d.name])), names);
  const forbidden = new Proxy(initialState(), { get() { assert.fail("Binding must not read state"); } });
  assert.deepEqual(opcodeEntries(forbidden).map(([opcode]) => opcode), Object.keys(instructions8088).map(Number));
  assert.equal(unaryCases.length, 72);
  const keys = unaryCases.map(form => form.key).sort();
  assert.deepEqual(Object.keys(unary).sort(), keys);
  assert.deepEqual(Object.keys(unary8088).sort(), keys);
});

interface Effect { readonly name: string; readonly apply?: (state: Cpu8088State, bytes: Map<number, number>) => void }
const read = (field: string): Effect => ({ name: "read " + field });
const fetch: Effect = { name: "fetch" };
function write<K extends Exclude<keyof Cpu8088State, "flags">>(field: K, contents: Cpu8088State[K]): Effect {
  return { name: "write " + field, apply: state => { state[field] = contents; } };
}
const writeFlag = (field: keyof Cpu8088State["flags"], contents: boolean): Effect =>
  ({ name: "write flag " + field, apply: state => { state.flags[field] = contents; } });

function observed(state: Cpu8088State, effect: (name: string) => void): Cpu8088State {
  return new Proxy(state, {
    get(target, key, receiver) {
      if (key === "flags") return new Proxy(target.flags, {
        get(target, key, receiver) { effect("read flag " + String(key)); return Reflect.get(target, key, receiver); },
        set(target, key, contents) { effect("write flag " + String(key)); return Reflect.set(target, key, contents); },
      });
      effect("read " + String(key)); return Reflect.get(target, key, receiver);
    },
    set(target, key, contents) { effect("write " + String(key)); return Reflect.set(target, key, contents); },
  });
}

// Expected effects are independently specified below; no generated code or definition tree is consulted.
function checkFailures(before: Cpu8088State, initialBytes: Map<number, number>, expected: readonly Effect[], run: Body, label: string) {
  for (let failAt = -1; failAt < expected.length; failAt++) {
    const state = structuredClone(before), bytes = new Map(initialBytes), events: string[] = [], failure = Error("effect failed");
    const flagsObject = state.flags;
    const effect = (name: string) => { events.push(name); if (events.length - 1 === failAt) throw failure; };
    let fetched = 0;
    const invoke = () => run(observed(state, effect), {
      deferInterrupt() { assert.fail("Unexpected deferral"); },
      fetchByte() { effect("fetch"); assert.ok(fetched < 2); return [0x80, 0xff][fetched++]!; },
      readByte(a) { effect("read memory " + a); assert.ok(bytes.has(a)); return bytes.get(a)!; },
      writeByte(a, byte) { effect("write memory " + a); bytes.set(a, byte); },
    });
    if (failAt < 0) invoke(); else assert.throws(invoke, error => error === failure);
    assert.deepEqual(events, expected.slice(0, failAt < 0 ? undefined : failAt + 1).map(e => e.name), label);
    const after = structuredClone(before), afterBytes = new Map(initialBytes);
    expected.slice(0, failAt < 0 ? undefined : failAt).forEach(e => e.apply?.(after, afterBytes));
    assert.deepEqual(state, after, label); assert.deepEqual(bytes, afterBytes, label);
    assert.equal(state.flags, flagsObject);
  }
}

function controlEffects(opcode: number, state: Cpu8088State): Effect[] {
  const f = state.flags, branch = [read("ip"), write("ip", (state.ip + 65536 - 128) % 65536)];
  if (opcode >= 0x70 && opcode <= 0x7f) {
    const index = Math.floor((opcode - 0x70) / 2);
    const positive = [f.of, f.cf, f.zf, f.cf || f.zf, f.sf, f.pf, f.sf !== f.of, f.zf || f.sf !== f.of][index]!;
    const fields = [["of"], ["cf"], ["zf"], f.cf ? ["cf"] : ["cf", "zf"], ["sf"], ["pf"],
      ["sf", "of"], f.zf ? ["zf"] : ["zf", "sf", "of"]][index]!;
    return [fetch, ...fields.map(field => read("flag " + field)), ...(positive !== Boolean(opcode % 2) ? branch : [])];
  }
  if (opcode >= 0xe0 && opcode <= 0xe3) {
    const counter = opcode === 0xe3 ? state.cx : (state.cx + 65535) % 65536;
    const take = opcode === 0xe3 ? counter === 0 : counter !== 0 && (opcode === 0xe2 || f.zf === (opcode === 0xe1));
    return [fetch, read("cx"), ...(opcode === 0xe3 ? [] : [write("cx", counter), read("cx")]),
      ...(counter !== 0 && opcode < 0xe2 ? [read("flag zf")] : []), ...(take ? branch : [])];
  }
  if (opcode === 0xe9 || opcode === 0xeb) return [fetch, ...(opcode === 0xe9 ? [fetch] : []), ...branch];
  if (opcode === 0x98) return [read("ax"), write("ax", state.ax % 256 + (state.ax % 256 >= 128 ? 0xff00 : 0))];
  if (opcode === 0x99) return [read("ax"), write("dx", state.ax >= 0x8000 ? 0xffff : 0)];
  const packedBits = [["cf", 0], ["pf", 2], ["af", 4], ["zf", 6], ["sf", 7]] as const;
  if (opcode === 0x9e) return [read("ax"), ...packedBits.map(([field, bit]) => writeFlag(field, Boolean(Math.floor(state.ax / 256 / 2 ** bit) % 2)))];
  if (opcode === 0x9f) {
    const status = packedBits.reduce((n, [field, bit]) => n + Number(f[field]) * 2 ** bit, 2);
    return [...packedBits.map(([field]) => read("flag " + field)), read("ax"), write("ax", status * 256 + state.ax % 256)];
  }
  if (opcode === 0xf4) return [write("halted", true)];
  if (opcode === 0xf5) return [read("flag cf"), writeFlag("cf", !f.cf)];
  return [writeFlag(opcode < 0xfc ? "cf" : "df", Boolean(opcode % 2))];
}

test("all 32 8088 control/status bodies preserve ordered effects and every failure prefix across all flag combinations", () => {
  for (const key of Object.keys(names)) for (let bits = 0; bits < 512; bits++) {
    const opcode = Number(key), before = initialState({ ip: 0x40, cx: [0, 1, 2, 0xffff][bits % 4]!, ax: (bits % 256) * 257, flags: flags(bits) });
    checkFailures(before, new Map(), controlEffects(opcode, before), bodies[opcode]!, names[opcode]!);
  }
});

test("every 8088 unary specialization retains operand/carry/flag/write order and partial effects at each failure", () => {
  for (const { operation, width, selector, key } of unaryCases) for (const bits of [0, 511]) {
    const before = initialState({ flags: flags(bits) }), segment = 0xffff, offset = bits ? 0xffff : 0xf;
    const addresses = Array.from({ length: width / 8 }, (_, i) => address(segment, offset + i));
    const initialBytes = new Map(addresses.map((a, i) => [a, [0xff, 0x7f][i]!]));
    const operand = selector === "memory" ? width === 8 ? 0xff : 0x7fff : registerValue(before, width, selector);
    const arithmetic = aluResult(operation === "INC" ? "ADD" : "SUB", width, operation === "NEG" ? 0 : operand, operation === "NEG" ? operand : 1, before.flags);
    const result = operation === "NOT" ? 2 ** width - 1 - operand : arithmetic.result;
    const field = typeof selector === "number" ? width === 8 ? byteMoves[selector]![1] : words[selector]! : undefined;
    const expected: Effect[] = selector === "memory" ? addresses.map(a => read("memory " + a)) : [read(field!)];
    if (operation === "INC" || operation === "DEC") expected.push(read("flag cf"));
    if (operation !== "NOT") {
      expected.push(...(["cf", "af", "of", "zf", "sf", "pf"] as const).map(flag => writeFlag(flag, arithmetic.flags[flag])));
      if (operation !== "NEG") expected.push(writeFlag("cf", before.flags.cf));
    }
    if (selector === "memory") addresses.forEach((a, i) => expected.push({ name: "write memory " + a,
      apply: (_, bytes) => { bytes.set(a, Math.floor(result / 256 ** i) % 256); } }));
    else {
      if (width === 8) expected.push(read(field!));
      expected.push(write(field!, replaceRegister(before, width, selector, result)[field!]));
    }
    const body = unaryBodies[key]!;
    checkFailures(before, initialBytes, expected, (state, context) => {
      if (selector === "memory") (body as MemoryBody)(state, segment, offset, context);
      else (body as Body)(state, context);
    }, key);
  }
});

test("8088 branch bodies observe flags, CX and IP after fetches, skip unnecessary reads, and reread decremented CX", () => {
  for (const opcode of [0x76, 0x77, 0x7e, 0x7f]) {
    const state = initialState({ ip: 0, flags: flags(0) }), events: string[] = [];
    bodies[opcode]!(observed(state, name => {
      events.push(name);
      if (name === "read flag " + (opcode < 0x7e ? "cf" : "zf")) state.ip = 0xffff;
      if (name === "read flag sf" || name === "read flag of" || (opcode < 0x7e && name === "read flag zf")) assert.fail("short-circuited flag read");
    }), { fetchByte() { state.flags = flags(511); return 2; }, readByte() { assert.fail(); }, writeByte() { assert.fail(); }, deferInterrupt() { assert.fail(); } });
    assert.equal(state.ip, opcode % 2 ? 0xffff : 1);
    assert.equal(events.includes("read ip"), opcode % 2 === 0);
  }
  for (const opcode of [0xe0, 0xe1, 0xe2]) {
    const state = initialState({ cx: 3, ip: 0x100, flags: flags(0) });
    let countReads = 0;
    bodies[opcode]!(observed(state, name => {
      if (name === "read cx" && ++countReads === 2) state.cx = 0;
      if (name === "read flag zf") assert.fail("zero counter must skip ZF");
    }), { fetchByte() { state.cx = 7; return 2; }, readByte() { assert.fail(); }, writeByte() { assert.fail(); }, deferInterrupt() { assert.fail(); } });
    assert.equal(countReads, 2); assert.equal(state.cx, 0); assert.equal(state.ip, 0x100);
  }
  const state = initialState({ cx: 1, ip: 0 });
  instructions[0xe3](state, { fetchByte() { state.cx = 0; state.ip = 0xffff; return 2; } });
  assert.equal(state.ip, 1);
});

test("8088 byte/status and unary writebacks retain live halves and carry captured after a complete operand", () => {
  const state = initialState({ ax: 0x1234, flags: flags(0) });
  instructions[0x9f](observed(state, name => { if (name === "read flag sf") state.ax = 0xabee; }));
  assert.equal(state.ax, 0x02ee);
  unary.INC_8_4(observed(state, name => { if (name === "write flag pf") state.ax = 0xa555; }));
  assert.equal(state.ax, 0x0355);

  const oldFlags = state.flags, accesses: number[] = [], writes: number[] = [];
  unary.DEC_16_memory(state, 0xffff, 0xffff, {
    readByte(a) { accesses.push(a); state.flags = flags(511); state.ds = 0; return a === 0xffef ? 0 : 0x80; },
    writeByte(a, byte) { accesses.push(a); writes.push(byte); state.flags.cf = false; },
  });
  assert.deepEqual(accesses, [0xffef, 0xffff0, 0xffef, 0xffff0]);
  assert.deepEqual(writes, [0xff, 0x7f]);
  assert.deepEqual(state.flags, { ...aluResult("SUB", 16, 0x8000, 1, flags(511)).flags, cf: false });
  assert.notEqual(state.flags, oldFlags);
});

test("8088 ordinary descriptions expose short-circuit branches, counter writeback, partial status, and carry restoration", () => {
  const branch = describeInstruction(instructions8088[0x76]!);
  assert.ok(branch.indexOf("fetch byte") < branch.indexOf("read CF"));
  assert.match(branch, /read ZF/); assert.match(branch, /read IP/);
  const loop = describeInstruction(instructions8088[0xe0]!);
  assert.ok(loop.indexOf("write CX") < loop.indexOf("read ZF"));
  const status = describeInstruction(instructions8088[0x9e]!);
  assert.match(status, /Flags preserved throughout: TF, IF, DF, OF\./);
  const adjustment = describeInstruction(unary8088.INC_16_memory!);
  assert.ok(adjustment.lastIndexOf("read memory") < adjustment.indexOf("read CF"));
  assert.ok(adjustment.indexOf("preserved carry") < adjustment.indexOf("write memory"));
});
