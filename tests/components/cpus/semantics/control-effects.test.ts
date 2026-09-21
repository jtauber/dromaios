import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { cpu6502StateDescription } from "../../../../src/components/cpus/semantics/generated/state/6502.js";
import { cpu6809StateDescription } from "../../../../src/components/cpus/semantics/generated/state/6809.js";
import { cpu8080StateDescription } from "../../../../src/components/cpus/semantics/generated/state/8080.js";
import { cpu8088StateDescription } from "../../../../src/components/cpus/state/8088.js";
import { cpuZ80StateDescription } from "../../../../src/components/cpus/semantics/generated/state/z80.js";
import type { CpuZ80State } from "../../../../src/components/cpus/semantics/generated/state/z80.js";
import { cpuSymbols, deferInterrupt, flagValue, notifyReti, readLatch, testChoice, when, writeChoice, writeLatch } from "../../../../src/components/cpus/semantics/model.js";
import type { Choice, CpuDeclaration, Statement } from "../../../../src/components/cpus/semantics/model.js";
import { defineInstruction } from "../../../../src/components/cpus/semantics/validate.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";
import { describeInstruction } from "../../../../src/components/cpus/semantics/describe.js";
import { initialState } from "../z80/helpers.js";

const symbols = cpuSymbols("z80", cpuZ80StateDescription);
const z80 = { ...symbols, declaration: { ...symbols.declaration, irqDeferral: true, retiNotification: true } as const }, motorola = cpuSymbols("6809", cpu6809StateDescription);
const define = (cpu: CpuDeclaration, steps: readonly Statement[]) => defineInstruction({ cpu, name: "control", explanation: "Control effect probe.", steps });

test("control choices retain schema ownership, exact alternatives, and Boolean capture scope", () => {
  const choices: readonly [{ declaration: CpuDeclaration }, Choice][] = [[z80, z80.choice("im")], [motorola, motorola.choice("waitMode")]];
  for (const [cpu, choice] of choices) {
    const valid = choice.values[0]!;
    for (const value of choice.values) define(cpu.declaration, [testChoice("matches", choice, value), writeChoice(choice, value)]);
    for (const candidate of [
      { ...choice, cpu: "other" }, { ...choice, field: "pc" }, { ...choice, field: "flags" },
      { ...choice, values: [] }, { ...choice, values: [...choice.values, "extra"] }, { ...choice, values: [...choice.values].reverse() },
    ]) assert.throws(() => define(cpu.declaration, [writeChoice(candidate, valid)]), /do not match the CPU schema/);
    for (const value of ["unknown", 99]) assert.throws(() => define(cpu.declaration, [
      { kind: "write-choice", choice, value },
    ]), /not a declared control choice/);
    const capture = testChoice("matches", choice, valid);
    assert.throws(() => define(cpu.declaration, [capture, capture]), /duplicate capture/);
    assert.throws(() => define(cpu.declaration, [when(flagValue("matches"), []), capture]), /not been captured/);
    assert.throws(() => define(cpu.declaration, [capture, when(flagValue("matches"), [testChoice("local", choice, valid)]),
      when(flagValue("local"), [])]), /not been captured/);
  }
  assert.throws(() => z80.choice("pc" as "im"), /expected declared control choices/);
  assert.throws(() => z80.register("im" as "pc"), /expected a stored register/);
  assert.throws(() => define(z80.declaration, [writeLatch(z80.latch("iff1"), flagValue("missing"))]), /not been captured/);
});

test("interrupt effects accept only the owning CPU's deferral scopes and RETI notification", () => {
  const cpus: readonly { declaration: CpuDeclaration }[] = [z80, symbols, { declaration: { name: "chapter", state: cpu8080StateDescription, irqDeferral: true, retiNotification: true } }, cpuSymbols("8088", cpu8088StateDescription),
    motorola, cpuSymbols("6502", cpu6502StateDescription)];
  for (const cpu of cpus) {
    for (const scope of ["irq", "intr", "all"] as const) {
      const check = () => define(cpu.declaration, [deferInterrupt(scope)]);
      const allowed = cpu.declaration.name === "8088" ? scope !== "irq"
        : cpu.declaration.irqDeferral === true && scope === "irq";
      if (allowed) check(); else assert.throws(check, /deferral/);
    }
    const check = () => define(cpu.declaration, [notifyReti()]);
    if (cpu.declaration.retiNotification) check(); else assert.throws(check, /notification policy/);
  }
});

test("generated control effects capture choices and latches, infer conditional capabilities, and preserve effect order", async () => {
  const definition = define(z80.declaration, [
    testChoice("modeTwo", z80.choice("im"), 2), writeChoice(z80.choice("im"), 0),
    readLatch("saved", z80.latch("iff2")), writeLatch(z80.latch("iff2"), false),
    when(flagValue("modeTwo"), [writeLatch(z80.latch("iff1"), flagValue("saved")), deferInterrupt("irq"), notifyReti()]),
  ]);
  const description = describeInstruction(definition);
  assert.match(description, /test control im equals 2/);
  assert.match(description, /write control im := 0/);
  assert.match(description, /write iff1:boolean := saved/);
  assert.match(description, /IRQ deferral at successful retirement/);
  assert.match(description, /RETI device notification after successful architectural retirement/);
  const source = generateInstructions("z80", { probe: definition });
  assert.match(source, /InterruptDeferralContext<"irq"> & RetiNotificationContext/);
  assert.match(source, /"deferInterrupt" \| "notifyReti"/);
  assert.doesNotMatch(source, /"fetchByte"|"readByte"|"writeByte"/);
  type Body = (state: CpuZ80State, context: { deferInterrupt(scope: "irq"): void; notifyReti(): void }) => void;
  const compiled: { instructions: { probe: Body } } = await import("data:text/javascript," + encodeURIComponent(stripTypeScriptTypes(source)));
  for (const im of [0, 1, 2] as const) for (const saved of [false, true]) {
    const state = initialState({ im, iff1: false, iff2: saved }), events: unknown[] = [];
    compiled.instructions.probe(state, {
      deferInterrupt(scope) { events.push([scope, state.im, state.iff1, state.iff2]); state.iff2 = true; },
      notifyReti() { events.push(["reti", state.iff2]); },
    });
    assert.equal(state.im, 0);
    assert.equal(state.iff1, im === 2 && saved);
    assert.deepEqual(events, im === 2 ? [["irq", 0, saved, false], ["reti", true]] : []);
  }
});
