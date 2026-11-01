import { readFileSync } from "node:fs";
import { instructionCatalogue8088 } from "../../site/8088-instruction-catalogue.js";
import { xtStorageRegions } from "../../site/xt-storage-regions.js";
import { compileCpuChapter } from "../../src/components/cpus/semantics/literate/compile.js";
import { parseMachine } from "../../src/machines/machine-language.js";
import { machineChapterSource } from "../../src/machines/machine-chapter.js";
import type { RomGuide } from "../../site/interactive/rom-guide.js";

const file = "src/machines/8088/pc-xt.md", source = readFileSync(file, "utf8");
const board = parseMachine(machineChapterSource(source, file), file);
if (!("connection" in board)) throw new Error("Expected an XT board");
export const xtCatalogue = {
  cpu: instructionCatalogue8088(compileCpuChapter(readFileSync("src/components/cpus/specifications/8088.md", "utf8"))),
  storage: xtStorageRegions(board),
};
export const xtRomGuide: RomGuide & { readonly sha256: string } = JSON.parse(source.match(/```json\n([\s\S]*?)```/)![1]!);
