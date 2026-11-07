import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { Cpu6502, Cpu6502State } from "../../../../src/components/cpus/generated/6502-cpu.js";
import { Ram } from "../../../../src/components/memory/ram.js";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import { ChapterError } from "../../../../src/components/cpus/semantics/literate/document.js";
import { generateChapterModule } from "../../../helpers/literate-model.js";

const file = "src/components/cpus/specifications/6502.md", markdown = readFileSync(file, "utf8");
const state: Cpu6502State = { a: 0, x: 0, y: 1, sp: 0xff, pc: 0x200,
  flags: { n: false, v: false, d: false, i: false, z: false, c: false } };

test("chapter timing edits govern public instructions, shared addressing, branches, and renamed offers", async () => {
  const text = markdown.replace('cpu "6502"', 'cpu "probe"').replace('interface Cpu6502', 'interface CpuProbe')
    .replace('timing offers "irq" 7, "nmi" 7', 'timing offers "pulse" 11, "edge" 13')
    .replace('source irq unless', 'source pulse unless').replace('source nmi always', 'source edge always')
    .replace('clocks + u16(3)\n  pointer = fetch', 'clocks + u16(8)\n  pointer = fetch')
    .replace('u16(1), u16(2))\n    PC <- target', 'u16(5), u16(6))\n    PC <- target');
  const exports = await generateChapterModule(text, "probe", file);
  const Model = exports.CpuProbe as new (ram: Ram, state: Cpu6502State) => Cpu6502;
  const ram = new Ram(0x10000);
  [0xb1, 0x80, 0xd0, 0xfe].forEach((byte, offset) => ram.write(0x200 + offset, byte));
  ram.write(0x80, 0xff); ram.write(0x81, 0x30); ram.write(0x3100, 0x42);
  const cpu = new Model(ram, state);
  assert.equal(cpu.stepTimed().clocks, 11); // 2 + edited pointer cost 8 + crossing 1.
  assert.equal(cpu.snapshot().a, 0x42);
  assert.equal(cpu.stepTimed().clocks, 7); // 2 + edited taken cost 5.
  assert.equal(Reflect.apply(cpu.interruptTimed, cpu, ["pulse"]).clocks, 11);
  assert.equal(Reflect.apply(cpu.interruptTimed, cpu, ["pulse"]).clocks, 0);
  assert.equal(Reflect.apply(cpu.interruptTimed, cpu, ["edge"]).clocks, 13);
});

for (const [name, from, to, expected] of [
  ["missing contract", '  timing offers "irq" 7, "nmi" 7\n', '', /timing contract/],
  ["missing offer", '"irq" 7, "nmi" 7', '"irq" 7', /every interrupt offer/],
  ["duplicate offer", '"irq" 7, "nmi" 7', '"irq" 7, "irq" 7', /distinct declared/],
  ["unknown offer", '"irq" 7, "nmi" 7', '"irq" 7, "other" 7', /distinct declared/],
  ["zero offer", '"irq" 7, "nmi" 7', '"irq" 0, "nmi" 7', /positive 16-bit/],
  ["oversize offer", '"irq" 7, "nmi" 7', '"irq" 65536, "nmi" 7', /positive 16-bit/],
  ["missing base", '  clocks u16(2)\n', '', /start with unconditional/],
  ["late base", '  clocks u16(2)\n', '  A <- u8(0)\n  clocks u16(2)\n', /start with unconditional/],
  ["partial base", '  clocks u16(2)\n', '  clocks u16(2) when 1\n', /start with unconditional/],
  ["two bases", '  clocks u16(2)\n', '  clocks u16(2)\n  clocks u16(2)\n', /exactly once/],
  ["nested base", '  clocks + u16(1)\n', '  clocks u16(1)\n', /exactly once/],
  ["addition before base", '  clocks u16(2)\n', '  clocks + u16(2)\n  clocks u16(2)\n', /start with unconditional/],
  ["wrong clock width", '  clocks u16(2)\n', '  clocks u8(2)\n', /expected 16-bit/],
  ["clocked lifecycle", '  low = memory(u16($FFFC))', '  clocks + u16(7)\n  low = memory(u16($FFFC))', /actions.*CPU boundaries/],
] as const) test(`vector timing rejects ${name} with chapter locations`, () => {
  assert.ok(markdown.includes(from));
  assert.throws(() => compileCpuChapter(markdown.replace(from, to), {}, file), (error: unknown) => {
    assert.ok(error instanceof ChapterError); assert.match(error.message, expected);
    assert.ok(error.line > 0); return true;
  });
});

test("removing all timing declarations removes the generated optional API", async () => {
  const text = markdown.replace(/^  timing offers .*\n/m, '').replace(/^\s*clocks .+\n/gm, '');
  const exports = await generateChapterModule(text, "6502", file);
  const Model = exports.Cpu6502 as new (ram: Ram, state: Cpu6502State) => Cpu6502;
  const ram = new Ram(0x10000); ram.write(0x200, 0xea);
  const cpu = new Model(ram, state);
  assert.equal(Reflect.has(cpu, "stepTimed"), false);
  assert.equal(Reflect.has(cpu, "interruptTimed"), false);
  assert.equal(cpu.step().outcome, "executed");
});
