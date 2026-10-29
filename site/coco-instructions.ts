import { readFileSync } from "node:fs";
import { compileCpuChapter } from "../src/components/cpus/semantics/literate/compile.ts";
import { instructionCatalogue6809 } from "./6809-instruction-catalogue.ts";

const chapter = compileCpuChapter(readFileSync("src/components/cpus/specifications/6809.md", "utf8"));
process.stdout.write(JSON.stringify(instructionCatalogue6809(chapter)));
