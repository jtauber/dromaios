import assert from "node:assert/strict";
import { test } from "node:test";
import { bodies6809 as instructions } from "../../../helpers/6809-bodies.js";
import { instructions6809 } from "../../../../src/components/cpus/semantics/definitions.js";
import { chapter6809 } from "../../../../src/components/cpus/semantics/definitions/6809.js";
import { motorola6809TransferForms } from "../../../../src/components/cpus/motorola.js";
import { cpu6809StateDescription } from "../../../../src/components/cpus/state/6809.js";
import type { Cpu6809State, Cpu6809Flags } from "../../../../src/components/cpus/state/6809.js";
import { capture, cpuSymbols, flagLiteral, literal, multiply, value, writeRegister } from "../../../../src/components/cpus/semantics/model.js";
import type { NumberExpression, Width } from "../../../../src/components/cpus/semantics/model.js";
import { defineInstruction } from "../../../../src/components/cpus/semantics/validate.js";
import { describeInstruction } from "../../../../src/components/cpus/semantics/describe.js";

const cpu = cpuSymbols("6809", cpu6809StateDescription);
const groups = [["d", "x", "y", "u", "s", "pc"], ["a", "b", "cc", "dp"]] as const;
type Register = typeof groups[number][number];
const bits = ["e", "f", "h", "i", "n", "z", "v", "c"] as const;
function flags(byte: number): Cpu6809Flags {
  const binary = byte.toString(2).padStart(8, "0");
  return Object.fromEntries(bits.map((name, i) => [name, binary[i] === "1"])) as Cpu6809Flags;
}
function state(): Cpu6809State {
  return { a: 0x81, b: 0x23, dp: 0x45, x: 0x5678, y: 0x9abc, s: 0xdef0, u: 0x1122, pc: 0x3344,
    waitMode: "none", nmiArmed: false, flags: flags(0xaa) };
}
function contents(state: Cpu6809State, register: Register) {
  return register === "d" ? state.a * 256 + state.b : register === "cc"
    ? Number.parseInt(bits.map(name => Number(state.flags[name])).join(""), 2) : state[register];
}
function assign(state: Cpu6809State, register: Register, value: number) {
  if (register === "cc") state.flags = flags(value);
  else if (register === "d") { state.a = Math.floor(value / 256); state.b = value % 256; }
  else state[register] = value;
  if (register === "s") state.nmiArmed = true;
}
function reads(register: Register): string[] {
  return register === "cc" ? bits.map(name => `flag ${name}`) : register === "d" ? ["read a", "read b"] : [`read ${register}`];
}
function writes(register: Register): string[] {
  return register === "cc" ? ["write flags"] : register === "d" ? ["write a", "write b"]
    : [`write ${register}`, ...(register === "s" ? ["write nmiArmed"] : [])];
}

test("6809 generated transfers cover exactly the 52 legal postbytes for each operation", () => {
  const expected = groups.flatMap((registers, group) => registers.flatMap((source, s) => registers.map((target, d) =>
    [(group * 8 + s) * 16 + group * 8 + d, { source, target }] as const)));
  assert.deepEqual(motorola6809TransferForms, expected);
  assert.equal(expected.length, 52);
  for (const operation of ["tfr", "exg"]) {
    assert.deepEqual(Object.keys(instructions6809).filter(key => key.startsWith(`${operation}_`)).sort(),
      expected.map(([, { source, target }]) => `${operation}_${source}_${target}`).sort());
  }
});

test("6809 register transfers capture both originals before writes, including aliases, packed CC, and S arming", () => {
  const generated: Readonly<Record<`${"tfr" | "exg"}_${string}_${string}`, (state: Cpu6809State) => void>> = instructions;
  for (const operation of ["tfr", "exg"] as const) for (const registers of groups) {
    for (const source of registers) for (const target of registers) for (const byte of [0, 0x55, 0xaa, 0xff]) {
      const actual = state(); actual.flags = flags(byte);
      const expected = structuredClone(actual), events: string[] = [], originalFlags = actual.flags;
      const from = contents(expected, source), to = contents(expected, target);
      assign(expected, target, from); if (operation === "exg") assign(expected, source, to);
      actual.flags = new Proxy(originalFlags, {
        get(target, key, receiver) { events.push(`flag ${String(key)}`); return Reflect.get(target, key, receiver); },
        set() { assert.fail("CC writes replace the complete flag object"); },
      });
      const observed = new Proxy(actual, {
        get(target, key, receiver) { if (key !== "flags") events.push(`read ${String(key)}`); return Reflect.get(target, key, receiver); },
        set(target, key, value) { events.push(`write ${String(key)}`); return Reflect.set(target, key, value); },
      });
      generated[`${operation}_${source}_${target}`]!(observed);
      assert.deepEqual(events, [...reads(source), ...reads(target), ...writes(target), ...(operation === "exg" ? writes(source) : [])]);
      assert.deepEqual({ ...actual, flags: target === "cc" || (operation === "exg" && source === "cc") ? actual.flags : originalFlags }, expected);
    }
  }
});

test("6809 accepted transfer bodies stop on failed reads/writes and never read a source again after writeback", () => {
  const actual = state(), events: string[] = [], failure = new Error("register write failure");
  const before = structuredClone(actual);
  const observed = new Proxy(actual, {
    get(target, key, receiver) { events.push(`read ${String(key)}`); return Reflect.get(target, key, receiver); },
    set(target, key, value) {
      events.push(`write ${String(key)}`);
      if (key === "a") throw failure;
      return Reflect.set(target, key, value);
    },
  });
  assert.throws(() => instructions.exg_d_x(observed), error => error === failure);
  assert.deepEqual(events, ["read a", "read b", "read x", "write x", "write a"]);
  assert.deepEqual(actual, { ...before, x: 0x8123 });
  const badTarget = new Proxy(state(), { get(target, key, receiver) { if (key === "x") throw failure; return Reflect.get(target, key, receiver); } });
  assert.throws(() => instructions.tfr_a_cc(new Proxy(state(), { get(target, key, receiver) {
    if (key === "flags") throw failure; return Reflect.get(target, key, receiver);
  } })), error => error === failure);
  assert.throws(() => instructions.exg_d_x(badTarget), error => error === failure);
  assert.equal(badTarget.a, 0x81);
});

test("unsigned multiplication is a pure byte-by-byte operation with a full word result", () => {
  const define = (expression: NumberExpression) => defineInstruction({ cpu: cpu.declaration, name: "product", explanation: "Product validation.",
    steps: [capture("product", expression), writeRegister(cpu.register("x"), value("product"))] });
  define(multiply(literal(8, 255), literal(8, 255)));
  for (const width of [3, 14, 32] as const) assert.throws(() => define(multiply(literal(width, 1), literal(width, 2))), /requires two bytes or two words/);
  for (const bad of [multiply(literal(8, 1), literal(16, 2)), multiply(value("missing"), literal(8, 1)),
    multiply(flagLiteral(true) as unknown as NumberExpression, literal(8, 1)), multiply(literal(8, 256), literal(8, 1)),
    multiply(literal(32 as Width, 1), literal(32 as Width, 1))]) assert.throws(() => define(bad));
  assert.throws(() => defineInstruction({ cpu: cpu.declaration, name: "narrow product", explanation: "No implicit truncation.",
    steps: [writeRegister(cpu.register("a"), multiply(literal(8, 1), literal(8, 2)))] }), /expected 8-bit/);
  const actual = state();
  for (let a = 0; a < 256; a++) for (let b = 0; b < 256; b++) {
    actual.a = a; actual.b = b; actual.flags = flags(0xab);
    const product = a * b; instructions.mul(actual);
    assert.equal(actual.a, Math.floor(product / 256)); assert.equal(actual.b, product % 256);
    assert.deepEqual(actual.flags, { ...flags(0xab), z: product === 0, c: Math.floor(product / 128) % 2 === 1 });
  }
  assert.match(describeInstruction(chapter6809[0x3d]!), /product := multiplyUnsigned\(left, right\)/);
});

test("6809 inherent and indexed LEA bodies expose their read, write, and flag stages", () => {
  const cases = [
    { execute: instructions.nop, events: [] },
    { execute: instructions.sex, events: ["read b", "write a", "flag n", "flag z"] },
    { execute: instructions.abx, events: ["read x", "read b", "write x"] },
    { execute: instructions.mul, events: ["read a", "read b", "write a", "write b", "flag z", "flag c"] },
    { execute: (state: Cpu6809State) => instructions.leax(state, 0), events: ["read x", "write x", "flag z"] },
    { execute: (state: Cpu6809State) => instructions.leay(state, 0x8000), events: ["read x", "write y", "flag z"] },
    { execute: (state: Cpu6809State) => instructions.leas(state, 0xffff), events: ["read x", "write s", "write nmiArmed"] },
    { execute: (state: Cpu6809State) => instructions.leau(state, 0), events: ["read x", "write u"] },
  ];
  for (const probe of cases) {
    const actual = state(), events: string[] = [];
    actual.flags = new Proxy(actual.flags, {
      get() { assert.fail("These bodies do not read flags"); },
      set(target, key, value) { events.push(`flag ${String(key)}`); return Reflect.set(target, key, value); },
    });
    probe.execute(new Proxy(actual, {
      get(target, key, receiver) { if (key !== "flags") events.push(`read ${String(key)}`); return Reflect.get(target, key, receiver); },
      set(target, key, value) { events.push(`write ${String(key)}`); return Reflect.set(target, key, value); },
    }));
    assert.deepEqual(events, probe.events);
  }
});
