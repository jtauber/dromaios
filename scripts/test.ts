import { spawnSync } from "node:child_process";
import { globSync } from "node:fs";

// npm runs this entry point from the repository root; no CPU selects the whole suite.
const options = process.argv.slice(2);
const cpu = options[0] && !options[0].startsWith("-") ? options.shift() : undefined;
if (cpu !== undefined && !/^(6502|6800|68000|6809|8008|8080|8088|z80)$/.test(cpu)) {
  console.error("Usage: npm test -- [6502|6800|68000|6809|8008|8080|8088|z80] [Node test options]");
  process.exitCode = 1;
} else {
  // Support both a single CPU test file and topic files in a CPU directory.
  // Include that CPU's machine programs; all shared-helper tests remain in npm test.
  const files = [...globSync(cpu ? [
    `dist/tests/components/cpus/${cpu}.test.js`,
    `dist/tests/components/cpus/${cpu}/**/*.test.js`,
    `dist/tests/machines/${cpu}/**/*.test.js`,
  ] : ["dist/tests/**/*.test.js"])].sort();
  if (files.length === 0) {
    console.error(`No compiled tests found${cpu ? ` for ${cpu}` : ""}. Run npm run build first.`);
    process.exitCode = 1;
  } else {
    const result = spawnSync(process.execPath, ["--test", ...options, ...files], { stdio: "inherit" });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  }
}
