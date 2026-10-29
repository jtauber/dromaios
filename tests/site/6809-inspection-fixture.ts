import { readFileSync } from "node:fs";
import type { Cpu6809Snapshot } from "../../src/components/cpus/generated/6809-cpu.js";
import { compileCpuChapter } from "../../src/components/cpus/semantics/literate/compile.js";
import { instructionCatalogue6809 } from "../../site/6809-instruction-catalogue.js";

export const chapter6809 = compileCpuChapter(readFileSync("src/components/cpus/specifications/6809.md", "utf8"));
export const catalogue6809 = instructionCatalogue6809(chapter6809);
export const state6809 = (overrides: Partial<Cpu6809Snapshot> = {}): Cpu6809Snapshot => ({
  a: 0x19, b: 3, d: 0x1903, x: 0x4000, y: 0x4100, s: 0x7000, u: 0x6000, pc: 0x2000, dp: 0x30,
  flags: { e: false, f: true, h: false, i: true, n: false, z: false, v: false, c: false },
  waitMode: "none", nmiArmed: false, ...overrides,
});
