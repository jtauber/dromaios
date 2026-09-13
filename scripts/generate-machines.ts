import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseMachine } from "../src/machines/machine-language.ts";

/** Turn a machine definition into a factory checked against its concrete CPU. */
export function compileMachine(text: string, filename: string): string {
  const stem = filename.replace(/\.machine$/, "");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(stem) || filename !== `${stem}.machine`) {
    throw new Error(`Invalid machine filename: ${filename}`);
  }
  // The parser validates the explicit RAM size against the helper's 64 KiB model.
  const { cpu, ramSize, ...definition } = parseMachine(text, filename);
  const data = JSON.stringify(definition, null, 2);
  const name = `create${stem.split("-").map(part => part.charAt(0).toUpperCase() + part.slice(1)).join("")}`;
  return `// Generated from ../${filename}; edit the .machine definition instead.
import { Cpu${cpu} } from "../../components/cpus/${cpu}.js";
import { defineRamExample } from "../ram-example.js";

export const { create: ${name}, createMemory: ${name}Memory } = defineRamExample(Cpu${cpu}, ${data});
`;
}

/** Rebuild the generated directory, removing outputs for deleted definitions. */
export function generateMachines(directory: string): void {
  const modules = readdirSync(directory).filter(name => name.endsWith(".machine")).sort().map(filename => ({
    filename: filename.replace(/\.machine$/, ".ts"),
    source: compileMachine(readFileSync(join(directory, filename), "utf8"), filename),
  }));
  const output = join(directory, "generated");
  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });
  for (const { filename, source } of modules) writeFileSync(join(output, filename), source);
}

if (import.meta.main) {
  try {
    generateMachines(fileURLToPath(new URL("../src/machines/", import.meta.url)));
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    console.error(error.message);
    process.exitCode = 1;
  }
}
