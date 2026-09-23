import { readFileSync, readdirSync } from "node:fs";
import { compileCpuChapter } from "../src/components/cpus/semantics/literate/compile.ts";

// Use the compiler's validated state schema; the site does not parse CPU syntax.
const directory = new URL("../src/components/cpus/specifications/", import.meta.url);
const chapters = readdirSync(directory).filter(name => name.endsWith(".md")).sort().map(file => {
  const chapter = compileCpuChapter(readFileSync(new URL(file, directory), "utf8"), {}, file);
  if (!chapter.state || !chapter.execution) throw new Error(`${file}: Expected a complete CPU chapter.`);
  return { slug: file.slice(0, -3), state: chapter.state, memoryBits: chapter.execution.memoryBits };
});
process.stdout.write(JSON.stringify(chapters));
