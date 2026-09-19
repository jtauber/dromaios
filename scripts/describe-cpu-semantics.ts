import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { generateCpuChapters } from "./generate-cpu-chapters.ts";
import { describeInstructions } from "../src/components/cpus/semantics/describe.ts";

generateCpuChapters();
const { instructionDefinitions } = await import("../src/components/cpus/semantics/definitions.ts");

const target = fileURLToPath(new URL("../docs/cpus/semantic-examples.md", import.meta.url));
const document = describeInstructions(instructionDefinitions);
if (process.argv.includes("--check")) {
  if (readFileSync(target, "utf8") !== document) {
    console.error("Instruction examples are stale. Run node scripts/describe-cpu-semantics.ts.");
    process.exitCode = 1;
  }
} else writeFileSync(target, document);
