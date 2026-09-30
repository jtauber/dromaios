import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { compileComposition } from "./compile-composition.ts";
import { parseMachine } from "../src/machines/machine-language.ts";
import { machineChapterSource } from "../src/machines/machine-chapter.ts";
import { cpuModels } from "../src/components/cpus/models.ts";

/** Turn a machine definition into a factory checked against its concrete components. */
export function compileMachine(text: string, relativePath: string): string {
  const stem = relativePath.replace(/\.(?:machine|md)$/, "");
  if (stem === relativePath || !stem.split("/").every(part => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(part))) {
    throw new Error(`Invalid machine path: ${relativePath}`);
  }
  // The parser validates state and wiring against the selected CPU model.
  const source = relativePath.endsWith(".md") ? machineChapterSource(text, relativePath) : text;
  const machine = parseMachine(source, relativePath);
  const name = `create${stem.split(/[/-]/).map(part => part.charAt(0).toUpperCase() + part.slice(1)).join("")}`;
  const from = posix.dirname(posix.join("generated", relativePath));
  if ("components" in machine) {
    return `// Generated from ${posix.relative(from, relativePath)}; edit the source definition instead.\n`
      + compileComposition(machine, name, from);
  }
  const { cpu, ...definition } = machine;
  const data = JSON.stringify(definition, null, 2);
  const { name: cpuClass, module: cpuModule } = cpuModels[cpu];
  return `// Generated from ${posix.relative(from, relativePath)}; edit the source definition instead.
import { ${cpuClass} } from "${posix.relative(from, `../components/cpus/${cpuModule}.js`)}";
import { defineRamExample } from "${posix.relative(from, "ram-example.js")}";

export const { create: ${name}, createMemory: ${name}Memory } = defineRamExample(${cpuClass}, ${data});
`;
}

function machinePaths(directory: string, prefix = ""): string[] {
  return readdirSync(join(directory, prefix), { withFileTypes: true }).flatMap(entry => {
    const path = posix.join(prefix, entry.name);
    if (path === "generated") return [];
    if (entry.isDirectory()) return machinePaths(directory, path);
    return entry.isFile() && /\.(?:machine|md)$/.test(entry.name) ? [path] : [];
  });
}

/** Rebuild the generated directory, removing outputs for deleted definitions. */
export function generateMachines(directory: string): void {
  const sources = new Map<string, string>();
  const modules = machinePaths(directory).sort().map(path => {
    const filename = path.replace(/\.(?:machine|md)$/, ".ts");
    const previous = sources.get(filename);
    if (previous) throw new SyntaxError(`Machine definitions ${previous} and ${path} both generate ${filename}.`);
    sources.set(filename, path);
    return { filename, source: compileMachine(readFileSync(join(directory, path), "utf8"), path) };
  });
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
