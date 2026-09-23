import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { edited68000 } from "../../../helpers/68000-chapter.js";
import { initialState } from "../../../helpers/68000-state.js";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import { ChapterError } from "../../../../src/components/cpus/semantics/literate/document.js";
import { wordInstructionGroups } from "../../../../src/components/cpus/semantics/literate/word-execution.js";
import { cpuModels } from "../../../../src/components/cpus/models.js";

const markdown = readFileSync("src/components/cpus/specifications/68000.md", "utf8");

test("word public names, memory projection, and snapshot views follow chapter declarations", async () => {
  const Cpu = await edited68000([
    ['cpu "68000" boundary word', 'cpu "other" boundary word'], ["interface Cpu68000", "interface CpuProbe"], ["memory 24", "memory 12"],
    ["snapshot physicalPc = PHYSICALPC", "snapshot physicalPc = A7"],
  ]);
  assert.equal(Cpu.name, "CpuProbe");
  const state = initialState(64); state.pc = 0xabcdef00; state.ssp = 0x12345678;
  const seen: number[] = [], memory = { size: 4096, read(address: number) { seen.push(address); return address === 0xf00 ? 0x4e : 0x71; }, write() { assert.fail(); } };
  assert.throws(() => new Cpu({ ...memory, size: 0x1000000 }, state), RangeError);
  const cpu = new Cpu(memory, state), record = cpu.step();
  assert.deepEqual(seen, [0xf00, 0xf01]);
  assert.equal(record.instruction?.address, 0xabcdef00); assert.equal(record.after.pc, 0xabcdef02);
  assert.equal(record.after.physicalPc, state.ssp);
  assert.notEqual(record.before.flags, record.after.flags);
  assert.deepEqual(cpuModels["68000"], {
    name: "Cpu68000", module: "generated/68000-cpu", state: cpuModels["68000"].state,
    ramSize: 0x1000000, maximumPc: 0xffffffff,
  });
});

test("word interfaces require reset and owned events, and memory widths fit the logical counter", () => {
  for (const changed of [
    markdown.replace("memory 24", "memory 0"), markdown.replace("memory 24", "memory 33"),
    markdown.replace("memory 24", "memory -1"),
    markdown.replace(/reset \{[^}]*\}/, ""),
    markdown.replace("interrupt events", "interrupt external"),
  ]) assert.throws(() => compileCpuChapter(changed, {}, "word.md"), error => error instanceof ChapterError && error.file === "word.md");
});

test("word catalogues partition by declared inputs and reject overlapping encodings across signatures", () => {
  const chapter = compileCpuChapter(markdown), entries = Object.values(chapter.families).flat();
  const groups = wordInstructionGroups("other", entries);
  assert.deepEqual(groups.map(group => group.name).sort(), ["other", "other-immediate", "other-mode-code",
    "other-mode-code-displacement", "other-mode-code-upper-code", "other-source-mode-source-code-destination-mode-destination-code"]);
  const register = entries.find(([, body]) => !body.inputs)!, operand = entries.find(([, body]) => body.inputs)!;
  assert.throws(() => wordInstructionGroups("other", [register, [register[0], operand[1]]]), /Duplicate/);
});
