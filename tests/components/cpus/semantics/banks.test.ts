import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { cpuZ80StateDescription } from "../../../../src/components/cpus/semantics/generated/state/z80.js";
import { group, unsigned } from "../../../../src/components/cpus/state.js";
import { capture, cpuSymbols, exchangeFlags, flagLiteral, flagValue, literal, readLatch, readRegister, shiftBits, value, when, writeRegister } from "../../../../src/components/cpus/semantics/model.js";
import type { CpuDeclaration, FlagGroup, InstructionDefinition, NumberExpression, Statement } from "../../../../src/components/cpus/semantics/model.js";
import { defineInstruction } from "../../../../src/components/cpus/semantics/validate.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";
import { describeInstruction } from "../../../../src/components/cpus/semantics/describe.js";
import { initialState } from "../z80/helpers.js";

const cpu = cpuSymbols("z80", cpuZ80StateDescription), alternate = cpu.bank("alternate");
const define = (steps: readonly Statement[], declaration: CpuDeclaration = cpu.declaration) => defineInstruction({ cpu: declaration, name: "bank probe", explanation: "Checked stored state.", steps });
async function compile(definitions: Readonly<Record<string, InstructionDefinition>>) {
  const source = generateInstructions("z80", definitions);
  assert.doesNotMatch(source, /ByteInstructionContext/);
  const compiled: { instructions: Record<string, (state: object) => void> } = await import(`data:text/javascript,${encodeURIComponent(stripTypeScriptTypes(source))}`);
  return compiled.instructions;
}

test("bank references validate against the owning schema, including complete matching flag groups", () => {
  const a = alternate.register("a");
  define([readRegister("byte", a), writeRegister(cpu.register("a"), value("byte")), exchangeFlags(cpu.flags, alternate.flags)]);
  for (const ref of [{ ...a, bank: "missing" }, { ...a, bank: "flags" }, { ...a, field: "ix" }, { ...a, width: 16 as const }, { ...a, cpu: "8080" }]) {
    assert.throws(() => define([readRegister("byte", ref)]));
    assert.throws(() => define([writeRegister(ref, literal(8, 0))]));
  }
  for (const ref of [{ ...alternate.flags, bank: "missing" }, { ...alternate.flags, bank: "a" }, { ...alternate.flags, cpu: "8080" }, a as unknown as FlagGroup]) {
    assert.throws(() => define([exchangeFlags(cpu.flags, ref)]));
  }
  const incompatible = { ...cpu.declaration, state: { ...cpuZ80StateDescription,
    alternate: group({ ...cpuZ80StateDescription.alternate.fields, flags: group({ c: cpuZ80StateDescription.flags.fields.c }) }) } };
  assert.throws(() => define([exchangeFlags(cpu.flags, alternate.flags)], incompatible), /same fields/);
  const numericFlag = { ...cpu.declaration, state: { ...cpuZ80StateDescription,
    alternate: group({ ...cpuZ80StateDescription.alternate.fields, flags: group({ c: unsigned(8) }) }) } };
  assert.throws(() => define([exchangeFlags(cpu.flags, alternate.flags)], numericFlag), /stored flags/);
  assert.throws(() => cpu.bank("flags" as "alternate"), /register bank/);
  assert.throws(() => alternate.register("ix" as "a"), /stored register/);
  const text = describeInstruction(define([readRegister("byte", a), writeRegister(a, value("byte")), exchangeFlags(cpu.flags, alternate.flags)]));
  assert.match(text, /read ALTERNATE.A/); assert.match(text, /exchange FLAGS with ALTERNATE.FLAGS/);
  assert.match(text, /Flags preserved throughout: none/);
});

test("bank names are emitted as property names, and flag exchange moves whole objects without inspecting them", async () => {
  const key = 'bank["odd"]';
  const scoped = cpuSymbols("z80", { ...cpuZ80StateDescription, [key]: cpuZ80StateDescription.alternate });
  const bank = scoped.bank(key);
  const execute = (await compile({ run: define([readRegister("byte", bank.register("a")), writeRegister(scoped.register("b"), value("byte")),
    exchangeFlags(scoped.flags, bank.flags)], scoped.declaration) })).run!;
  const mainFlags = new Proxy({}, { get() { assert.fail("do not inspect flags"); } }), otherFlags = new Proxy({}, { get() { assert.fail("do not inspect flags"); } });
  const state = { b: 0, flags: mainFlags, [key]: { a: 0x91, flags: otherFlags } };
  execute(state);
  assert.equal(state.b, 0x91); assert.equal(state.flags, otherFlags); assert.equal(state[key].flags, mainFlags);
});

test("control-latch reads are Boolean captures with lexical scope and no implicit numeric conversion", async () => {
  const steps = [readLatch("enabled", cpu.latch("iff2")), when(flagValue("enabled"), [writeRegister(cpu.register("a"), literal(8, 0x91))])];
  const definition = define(steps), execute = (await compile({ run: definition })).run!;
  for (const enabled of [false, true]) {
    const state = initialState({ iff2: enabled }), events: string[] = [];
    execute(new Proxy(state, {
      get(target, key, receiver) { events.push(`read ${String(key)}`); return Reflect.get(target, key, receiver); },
      set(target, key, value) { events.push(`write ${String(key)}`); return Reflect.set(target, key, value); },
    }));
    assert.deepEqual(events, ["read iff2", ...(enabled ? ["write a"] : [])]);
    assert.equal(state.a, enabled ? 0x91 : 0x11);
  }
  for (const latch of [{ ...cpu.latch("iff2"), field: "a" }, { ...cpu.latch("iff2"), field: "im" }, { ...cpu.latch("iff2"), cpu: "8080" }]) {
    assert.throws(() => define([readLatch("enabled", latch)]), /unknown control latch/);
  }
  assert.throws(() => define([readLatch("enabled", cpu.latch("iff2")), writeRegister(cpu.register("a"), value("enabled"))]), /flag, not a number/);
  assert.throws(() => define([when(flagLiteral(true), [readLatch("enabled", cpu.latch("iff2"))]), when(flagValue("enabled"), [])]), /not been captured/);
  assert.throws(() => define([readLatch("enabled", cpu.latch("iff2")), readLatch("enabled", cpu.latch("iff1"))]), /duplicate capture/);
  assert.match(describeInstruction(definition), /enabled:flag := read control latch iff2/);
});

test("constant logical shifts retain width and reject invalid directions, counts, and operands", async () => {
  const definitions: Record<string, InstructionDefinition> = {};
  for (const width of [8, 16] as const) for (const direction of ["left", "right"] as const) for (const count of [0, 1, 4, width - 1, width]) {
    const register = cpu.register(width === 8 ? "a" : "ix");
    definitions[`${width}_${direction}_${count}`] = define([readRegister("original", register), writeRegister(register, shiftBits(value("original"), direction, count))]);
  }
  const compiled = await compile(definitions), state = initialState();
  for (const [key, execute] of Object.entries(compiled)) {
    const [widthText, direction, countText] = key.split("_"), width = Number(widthText), count = Number(countText), field = width === 8 ? "a" : "ix";
    for (let original = 0; original < 2 ** width; original++) {
      state[field] = original; execute(state);
      assert.equal(state[field], direction === "left" ? original * 2 ** count % 2 ** width : Math.floor(original / 2 ** count));
    }
  }
  for (const count of [-1, 9, 1.5, NaN, Infinity]) assert.throws(() => define([capture("result", shiftBits(literal(8, 1), "left", count))]), /constant count/);
  assert.throws(() => define([capture("result", shiftBits(literal(8, 1), "rotate" as "left", 1))]), /direction/);
  for (const width of [3, 14] as const) assert.throws(() => define([capture("result", shiftBits(literal(width, 1), "left", 1))]), /8-, 16-, or 32-bit/);
  assert.throws(() => define([capture("result", shiftBits(flagLiteral(true) as unknown as NumberExpression, "left", 1))]));
  assert.throws(() => define([writeRegister(cpu.register("a"), shiftBits(literal(16, 1), "left", 1))]), /expected 8-bit/);
});
