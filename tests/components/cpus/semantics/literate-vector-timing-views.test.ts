import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { Cpu6809, Cpu6809State } from "../../../../src/components/cpus/generated/6809-cpu.js";
import { Ram } from "../../../../src/components/memory/ram.js";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import { ChapterError } from "../../../../src/components/cpus/semantics/literate/document.js";
import { generateChapterModule } from "../../../helpers/literate-model.js";

const file = "src/components/cpus/specifications/6809.md", markdown = readFileSync(file, "utf8");
const state: Cpu6809State = { a: 0, b: 0, dp: 0, x: 0x3000, y: 0, s: 0x8000, u: 0, pc: 0x200,
  waitMode: "none", nmiArmed: true,
  flags: { e: false, f: false, h: false, i: false, n: false, z: false, v: false, c: false } };

test("a renamed chapter owns instruction additions and state-dependent interrupt clocks", async () => {
  const text = markdown.replace('cpu "6809"', 'cpu "probe"').replace('interface Cpu6809', 'interface CpuProbe')
    .replace('"irq" view INTERRUPTCLOCKS', '"level" view INTERRUPTCLOCKS').replace('source irq unless', 'source level unless')
    .replace('source indexed "indexed postbyte": 16 {\n  clocks + u16(2)',
      'source indexed "indexed postbyte": 16 {\n  clocks + u16(8)')
    .replace('return select(stacked, u16(4), u16(19))', 'return select(stacked, u16(9), u16(23))');
  const exports = await generateChapterModule(text, "probe", file);
  const Model = exports.CpuProbe as new (ram: Ram, state: Cpu6809State) => Cpu6809;
  const ram = new Ram(0x10000); ram.write(0x200, 0xa6); ram.write(0x201, 0x84);
  const cpu = new Model(ram, state);
  assert.equal(cpu.stepTimed().clocks, 10);
  assert.equal(Reflect.apply(cpu.interruptTimed, cpu, ["level"]).clocks, 23);
  assert.equal(Reflect.apply(cpu.interruptTimed, cpu, ["level"]).clocks, 0);
  const waiting = new Model(ram, { ...state, waitMode: "cwai" });
  const record = Reflect.apply(waiting.interruptTimed, waiting, ["level"]);
  assert.equal(record.clocks, 9); assert.equal(record.after.waitMode, "none");
});

for (const [name, replacement, expected] of [
  ["missing view", 'view MISSING', /Unknown timing view/],
  ["byte view", 'view CC', /16-bit clock/],
  ["ordinary source", 'view indexed', /Unknown timing view/],
] as const) test(`vector timing rejects a ${name} with a chapter location`, () => {
  assert.throws(() => compileCpuChapter(markdown.replace('"irq" view INTERRUPTCLOCKS', `"irq" ${replacement}`), {}, file), (error: unknown) => {
    assert.ok(error instanceof ChapterError); assert.ok(error.line > 0); assert.match(error.message, expected); return true;
  });
});

test("a zero clock view fails before accepted-entry effects; ordinary and declined offers do not consume timing", async () => {
  const text = markdown.replace('return select(stacked, u16(4), u16(19))', 'return u16(0)');
  const exports = await generateChapterModule(text, "6809", file);
  const Model = exports.Cpu6809 as new (ram: Ram, state: Cpu6809State) => Cpu6809;
  const ram = new Ram(0x10000), cpu = new Model(ram, state), writes: number[] = [];
  ram.observeWrites(write => writes.push(write.address));
  const before = cpu.snapshot();
  assert.throws(() => cpu.interruptTimed("irq"), /positive 16-bit/);
  assert.deepEqual(cpu.snapshot(), before); assert.deepEqual(writes, []);
  assert.equal(cpu.interrupt("irq").outcome, "accepted");
  assert.equal(cpu.interruptTimed("irq").clocks, 0);
  assert.equal(cpu.interruptTimed("firq").clocks, 10); // A failed IRQ timing read cannot poison another source.
});
