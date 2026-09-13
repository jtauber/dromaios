import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { parseMachine } from "../src/machines/machine-language.ts";

/** Turn a machine definition into a factory checked against its concrete CPU. */
export function compileMachine(text: string, relativePath: string): string {
  const stem = relativePath.replace(/\.machine$/, "");
  if (relativePath !== `${stem}.machine` || !stem.split("/").every(part => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(part))) {
    throw new Error(`Invalid machine path: ${relativePath}`);
  }
  // The parser validates the explicit RAM size against the helper's 64 KiB model.
  const { cpu, ramSize, ...definition } = parseMachine(text, relativePath);
  const data = JSON.stringify(definition, null, 2);
  const name = `create${stem.split(/[/-]/).map(part => part.charAt(0).toUpperCase() + part.slice(1)).join("")}`;
  const from = posix.dirname(posix.join("generated", relativePath));
  return `// Generated from ${posix.relative(from, relativePath)}; edit the .machine definition instead.
import { Cpu${cpu} } from "${posix.relative(from, `../components/cpus/${cpu}.js`)}";
import { defineRamExample } from "${posix.relative(from, "ram-example.js")}";

export const { create: ${name}, createMemory: ${name}Memory } = defineRamExample(Cpu${cpu}, ${data});
`;
}

function machinePaths(directory: string, prefix = ""): string[] {
  return readdirSync(join(directory, prefix), { withFileTypes: true }).flatMap(entry => {
    const path = posix.join(prefix, entry.name);
    if (path === "generated") return [];
    if (entry.isDirectory()) return machinePaths(directory, path);
    return entry.isFile() && entry.name.endsWith(".machine") ? [path] : [];
  });
}

/** Rebuild the generated directory, removing outputs for deleted definitions. */
export function generateMachines(directory: string): void {
  const modules = machinePaths(directory).sort().map(path => ({
    filename: path.replace(/\.machine$/, ".ts"),
    source: compileMachine(readFileSync(join(directory, path), "utf8"), path),
  }));
  const output = join(directory, "generated");
  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });
  for (const { filename, source } of modules) {
    const path = join(output, filename);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, source);
  }
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
