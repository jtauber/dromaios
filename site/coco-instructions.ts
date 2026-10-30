import { readFileSync } from "node:fs";
import { compileCpuChapter } from "../src/components/cpus/semantics/literate/compile.ts";
import { instructionCatalogue6809 } from "./6809-instruction-catalogue.ts";

import { parseMachine } from "../src/machines/machine-language.ts";
import { machineChapterSource } from "../src/machines/machine-chapter.ts";

const chapter = compileCpuChapter(readFileSync("src/components/cpus/specifications/6809.md", "utf8"));
const file = "src/machines/6809/coco.md";
const machine = parseMachine(machineChapterSource(readFileSync(file, "utf8"), file), file);
if (!("components" in machine) || !machine.externalImages) throw new Error("CoCo must declare its ROM sockets.");
const romImages = Object.fromEntries(machine.externalImages.map(image => [image.component, { sha256: image.sha256 }]));
process.stdout.write(JSON.stringify({ ...instructionCatalogue6809(chapter), romImages }));
