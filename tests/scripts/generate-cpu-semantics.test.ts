import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("native CPU generation bootstraps without generated files and removes obsolete output", t => {
  const directory = mkdtempSync(join(tmpdir(), "dromaios-semantics-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, "scripts"));
  cpSync("scripts/generate-cpu-semantics.ts", join(directory, "scripts/generate-cpu-semantics.ts"));
  cpSync("src/components", join(directory, "src/components"), { recursive: true });
  const output = join(directory, "src/components/cpus/generated");
  rmSync(output, { recursive: true, force: true });
  const run = () => {
    const result = spawnSync(process.execPath, [join(directory, "scripts/generate-cpu-semantics.ts")], { cwd: tmpdir(), encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readdirSync(output).sort(), ["6502.ts", "6800.ts", "6809.ts", "8008.ts", "8080.ts", "8088-alu.ts", "8088-transfers.ts", "8088-unary.ts", "8088.ts", "z80.ts"]);
    for (const cpu of ["6502", "6800", "6809", "8008", "8080", "8088-alu", "8088-transfers", "8088-unary", "8088", "z80"]) {
      assert.equal(readFileSync(join(output, `${cpu}.ts`), "utf8"), readFileSync(`src/components/cpus/generated/${cpu}.ts`, "utf8"));
    }
  };
  run();
  writeFileSync(join(output, "obsolete.ts"), "obsolete");
  writeFileSync(join(output, "6502.ts"), "stale");
  run();
});
