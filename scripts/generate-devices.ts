import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileDeviceChapter } from "../src/components/devices/semantics/compile.ts";
import { generateDevice } from "../src/components/devices/semantics/generate.ts";
import { ChapterError } from "../src/components/cpus/semantics/literate/document.ts";

/** Validate every chapter before replacing generated device modules and their small catalogue. */
export function generateDevices(directory: string): void {
  const names = new Set<string>();
  const devices = readdirSync(join(directory, "specifications")).filter(file => file.endsWith(".md")).sort().map(file => {
    const stem = file.slice(0, -3), path = join(directory, "specifications", file);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(stem) || stem === "catalogue" || /-(?:state|effects)$/.test(stem)) {
      throw new Error(`Invalid or reserved device filename: ${file}`);
    }
    const chapter = compileDeviceChapter(readFileSync(path, "utf8"), path);
    if (names.has(chapter.model.name)) throw new Error(`Duplicate device ${chapter.model.name}.`);
    names.add(chapter.model.name);
    return { stem, name: chapter.model.name, ...generateDevice(chapter, stem) };
  });
  const output = join(directory, "generated");
  rmSync(output, { recursive: true, force: true }); mkdirSync(output, { recursive: true });
  for (const { stem, state, effects, module } of devices) {
    writeFileSync(join(output, `${stem}-state.ts`), state);
    writeFileSync(join(output, `${stem}-effects.ts`), effects);
    writeFileSync(join(output, `${stem}.ts`), module);
  }
  const catalogue = Object.fromEntries(devices.map(device => [device.name, device.description]));
  writeFileSync(join(output, "catalogue.ts"), `// Generated from device chapters; do not edit.\nexport const deviceModels = ${JSON.stringify(catalogue, null, 2)} as const;\n`);
}

if (import.meta.main) {
  try { generateDevices(fileURLToPath(new URL("../src/components/devices/", import.meta.url))); }
  catch (error) {
    if (!(error instanceof ChapterError)) throw error;
    console.error(error.message); process.exitCode = 1;
  }
}
