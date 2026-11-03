import { readFileSync } from "node:fs";
import { compileCpuChapter } from "../src/components/cpus/semantics/literate/compile.ts";
import { parseMachine } from "../src/machines/machine-language.ts";
import { machineChapterSource } from "../src/machines/machine-chapter.ts";
import { instructionCatalogue8088 } from "./8088-instruction-catalogue.ts";
import { xtStorageRegions } from "./xt-storage-regions.ts";

const chapter = compileCpuChapter(readFileSync("src/components/cpus/specifications/8088.md", "utf8"));
const file = process.argv[2] === "ega" ? "src/machines/8088/pc-xt-ega.md" : "src/machines/8088/pc-xt.md";
const machine = parseMachine(machineChapterSource(readFileSync(file, "utf8"), file), file);
if (!("connection" in machine)) throw new Error("Expected the composed XT board.");
const romImages = Object.fromEntries(machine.externalImages!.map(image => [image.component, { sha256: image.sha256 }]));
process.stdout.write(JSON.stringify({ cpu: instructionCatalogue8088(chapter), storage: xtStorageRegions(machine), romImages }));
