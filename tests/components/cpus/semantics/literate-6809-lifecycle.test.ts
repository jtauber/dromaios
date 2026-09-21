import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Ram } from "../../../../src/components/memory/ram.js";
import type { Cpu6809, Cpu6809State } from "../../../../src/components/cpus/generated/6809-cpu.js";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import { ChapterError } from "../../../../src/components/cpus/semantics/literate/document.js";
import { generateChapterModule } from "../../../helpers/literate-model.js";

const file = "src/components/cpus/specifications/6809.md", markdown = readFileSync(file, "utf8");
const initial = (): Cpu6809State => ({ a: 0x12, b: 0x34, dp: 0x56, x: 0x789a, y: 0xbcde,
  s: 0x100, u: 0x4321, pc: 0x200, waitMode: "none", nmiArmed: true,
  flags: { e: false, f: false, h: true, i: false, n: true, z: false, v: true, c: false } });

async function generated(text = markdown, name = "6809", publicName = "Cpu6809") {
  const exports = await generateChapterModule(text, name, file);
  return exports[publicName] as new (ram: Ram, state: Cpu6809State) => Cpu6809;
}
function memory() {
  const ram = new Ram(0x10000);
  for (const [address, byte] of [[0xfff6, 0x45], [0xfff7, 0x67], [0xfff8, 0x56], [0xfff9, 0x78],
    [0xfffc, 0x12], [0xfffd, 0x34], [0xfffe, 0x9a], [0xffff, 0xbc]]) ram.write(address!, byte!);
  return ram;
}

test("6809 chapter edits control reset vectors, flags, arming, and the derived public snapshot", async () => {
  for (const changed of [false, true]) {
    const text = changed ? markdown.replace("high = memory(u16($FFFE))", "high = memory(u16($FFFC))")
      .replace("low = memory(u16($FFFF))", "low = memory(u16($FFFD))")
      .replace("  DP <- u8($00)", "  DP <- u8($AB)").replace("  F = 1\n  I = 1", "  F = 0\n  I = 0")
      .replace("  NMIARMED <- 0", "  NMIARMED <- 1").replace("snapshot d = D", "snapshot d = NEXT") : markdown;
    const Model = await generated(text), before = { ...initial(), waitMode: "cwai" as const }, cpu = new Model(memory(), before);
    const record = cpu.reset();
    assert.deepEqual(record.before, { ...before, d: changed ? 0x200 : 0x1234 });
    assert.deepEqual(record.after, { ...initial(), pc: changed ? 0x1234 : 0x9abc, dp: changed ? 0xab : 0,
      nmiArmed: changed, flags: { ...initial().flags, f: !changed, i: !changed }, d: 0x1234 });
    assert.deepEqual(record.accesses, changed ? [{ kind: "read", address: 0xfffc, value: 0x12 }, { kind: "read", address: 0xfffd, value: 0x34 }]
      : [{ kind: "read", address: 0xfffe, value: 0x9a }, { kind: "read", address: 0xffff, value: 0xbc }]);
  }
});

test("6809 declared gates distinguish ignored, resumed, and accepted offers without hidden wake effects", async () => {
  const Model = await generated();
  for (const waitMode of ["none", "sync", "cwai"] as const) for (const source of ["irq", "firq", "nmi"] as const) {
    const cpu = new Model(memory(), { ...initial(), waitMode, nmiArmed: false,
      flags: { ...initial().flags, i: true, f: true } }), before = cpu.snapshot(), entry = cpu.interrupt(source);
    const resumed = source !== "nmi" && waitMode === "sync";
    assert.deepEqual(entry, { before, after: { ...before, waitMode: resumed ? "none" : waitMode },
      instruction: null, accesses: [], source, outcome: resumed ? "resumed" : "ignored", reason: source === "nmi" ? "unarmed" : "masked" });
  }
  const changed = await generated(markdown.replace('resume when choice WAIT = "sync"', 'resume when choice WAIT = "cwai"')
    .replace('action resumeSync "leave SYNC without taking an interrupt" {\n  WAIT <- "none"',
      'action resumeSync "leave SYNC without taking an interrupt" {\n  WAIT <- "sync"')
    .replace('otherwise "unarmed"', 'otherwise "uninitialized"'));
  const cpu = new changed(memory(), { ...initial(), waitMode: "cwai", nmiArmed: false, flags: { ...initial().flags, i: true } });
  assert.equal(cpu.interrupt("irq").outcome, "resumed"); assert.equal(cpu.snapshot().waitMode, "sync");
  assert.equal(Reflect.get(cpu.interrupt("nmi"), "reason"), "uninitialized");
  assert.equal(cpu.step().instruction, null);
  const noWait = await generated(markdown.replace('stopped choice WAIT unless "none" as waiting', 'stopped none'));
  const ram = memory(); ram.write(0x200, 0x12);
  assert.equal(new noWait(ram, { ...initial(), waitMode: "sync" }).step().outcome, "executed");
});

test("6809 chapter frame arguments and CWAI reuse determine exact accesses and RTI restoration", async () => {
  const Model = await generated();
  for (const waiting of [false, true]) for (const source of ["irq", "firq", "nmi"] as const) {
    const ram = memory(), cpu = new Model(ram, initial());
    if (waiting) { ram.write(0x200, 0x3c); ram.write(0x201, 0xff); assert.equal(cpu.step().outcome, "waiting"); }
    const before = cpu.snapshot(), record = cpu.interrupt(source);
    const vector = source === "irq" ? 0xfff8 : source === "firq" ? 0xfff6 : 0xfffc;
    const full = source !== "firq", values = full ? [0, 2, 0x21, 0x43, 0xde, 0xbc, 0x9a, 0x78, 0x56, 0x34, 0x12, 0xaa] : [0, 2, 0x2a];
    assert.deepEqual(record.accesses, [
      ...(waiting ? [] : values.map((value, index) => ({ kind: "write", address: 0xff - index, value }))),
      { kind: "read", address: vector, value: ram.read(vector) }, { kind: "read", address: vector + 1, value: ram.read(vector + 1) },
    ]);
    assert.equal(record.after.flags.e, waiting || full); assert.equal(record.after.s, waiting ? before.s : 0x100 - values.length);
    ram.write(record.after.pc, 0x3b); // RTI selects the actual saved E bit.
    assert.deepEqual(cpu.step().after, { ...initial(), pc: waiting ? 0x202 : 0x200, d: 0x1234,
      flags: { ...initial().flags, e: waiting || full } });
  }
  const Changed = await generated(markdown.replace('enterInterrupt($FFF6, $50, $00)', 'enterInterrupt($FFFC, $10, $01)'));
  const entry = new Changed(memory(), initial()).interrupt("firq");
  assert.equal(entry.after.s, 0xf4); assert.equal(entry.after.pc, 0x1234);
  assert.equal(entry.after.flags.e, true); assert.equal(entry.after.flags.f, false); assert.equal(entry.after.flags.i, true);
});

test("named wait choices and gated entry work with renamed CPU, state, and interrupt sources", async () => {
  const text = markdown.replace('cpu "6809"', 'cpu "probe"').replace("interface Cpu6809", "interface CpuProbe")
    .replaceAll("WAIT", "PAUSE").replaceAll("waitMode", "phase").replaceAll("NMIARMED", "READY").replaceAll("nmiArmed", "armed")
    .replace('source irq unless', 'source pulse unless').replace('source firq unless', 'source fast unless').replace('source nmi when', 'source edge when');
  const Model = await generated(text, "probe", "CpuProbe"), state = { ...initial(), phase: "sync", armed: false };
  Reflect.deleteProperty(state, "waitMode"); Reflect.deleteProperty(state, "nmiArmed");
  const cpu = new Model(memory(), state), interrupt = (source: string) => Reflect.apply(cpu.interrupt, cpu, [source]);
  assert.equal(cpu.step().instruction, null); assert.equal(interrupt("edge").outcome, "ignored");
  assert.equal(interrupt("fast").outcome, "accepted"); assert.equal(Reflect.get(cpu.snapshot(), "phase"), "none");
  assert.throws(() => interrupt("nmi"), /probe interrupt source must be pulse or fast or edge/);
});

test("invalid wait and entry clauses report their original Markdown location", () => {
  for (const [before, after, message] of [
    ['unless "none" as waiting', 'unless "missing" as waiting', /Unknown choice value/],
    ['unless "none" as waiting', 'unless "none"', /declared as waiting/],
    ['when latch NMIARMED', 'when latch UNKNOWN', /Unknown name/],
    ['otherwise "unarmed"', 'otherwise ""', /nonempty reason/],
    ['resume when choice WAIT = "sync"', 'resume when choice WAIT = "missing"', /Unknown choice value/],
    ['source irq unless flag I', 'source irq always', /Resume requires a masked source/],
    ['with resumeSync()', 'with resetState()', /cannot fetch instructions or access memory/],
    ['with resumeSync()', 'with setPC()', /Resume actions must have no inputs/],
    ['enterInterrupt($FFF6, $50, $00)', 'enterInterrupt($FFF6, $100, $00)', /must fit 8 bits/],
  ] as const) {
    assert.throws(() => compileCpuChapter(markdown.replace(before, after), { name: "6809" }, file), error => {
      assert.ok(error instanceof ChapterError); assert.equal(error.file, file); assert.ok(error.line > 1);
      assert.match(error.message, message); return true;
    });
  }
});
