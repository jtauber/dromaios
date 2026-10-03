import { readFileSync } from "node:fs";
import { compileCpuChapter } from "../src/components/cpus/semantics/literate/compile.ts";
import { parseMachine } from "../src/machines/machine-language.ts";
import { machineChapterSource } from "../src/machines/machine-chapter.ts";
import { instructionCatalogue6502 } from "./6502-instruction-catalogue.ts";

// Export only presentation data, keeping the compiler and expanded semantics out of the browser.
const chapter = compileCpuChapter(readFileSync("src/components/cpus/specifications/6502.md", "utf8"));
const instructions = instructionCatalogue6502(Object.values(chapter.families).flat());
const file = "src/machines/6502/apple2.md";
const machine = parseMachine(machineChapterSource(readFileSync(file, "utf8"), file), file);
const firmware = "components" in machine ? machine.externalImages?.find(image => image.component === "firmware") : undefined;
if (firmware === undefined) throw new Error("The Apple II machine must declare its firmware identity.");
process.stdout.write(JSON.stringify({ instructions, firmware }));
