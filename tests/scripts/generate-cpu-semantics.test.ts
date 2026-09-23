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
  cpSync("scripts/generate-cpu-chapters.ts", join(directory, "scripts/generate-cpu-chapters.ts"));
  cpSync("src/components", join(directory, "src/components"), { recursive: true });
  const output = join(directory, "src/components/cpus/generated");
  rmSync(output, { recursive: true, force: true });
  const chapters = join(directory, "src/components/cpus/semantics/generated");
  const chapterNames = ["6502.ts", "6800.ts", "68000.ts", "6809.ts", "8008.ts", "8080.ts", "8088.ts", "catalogue.ts", "interfaces.ts", "z80.ts"];
  const chapterFiles = [...chapterNames, "state/6502.ts", "state/6800.ts", "state/68000.ts", "state/6809.ts", "state/8008.ts", "state/8080.ts", "state/8088.ts", "state/z80.ts"];
  rmSync(chapters, { recursive: true, force: true });
  const run = () => {
    const result = spawnSync(process.execPath, [join(directory, "scripts/generate-cpu-semantics.ts")], { cwd: tmpdir(), encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readdirSync(chapters).sort(), [...chapterNames, "state"].sort());
    assert.deepEqual(readdirSync(join(chapters, "state")).sort(), ["6502.ts", "6800.ts", "68000.ts", "6809.ts", "8008.ts", "8080.ts", "8088.ts", "z80.ts"]);
    for (const name of chapterFiles) assert.equal(readFileSync(join(chapters, name), "utf8"),
      readFileSync(`src/components/cpus/semantics/generated/${name}`, "utf8"));
    assert.deepEqual(readdirSync(output).sort(), ["6502-cpu.ts", "6502-execution.ts", "6502-state.ts", "6502.ts", "6800-cpu.ts", "6800-execution.ts", "6800-state.ts", "6800.ts", "68000-cpu.ts", "68000-immediate.ts", "68000-mode-code.ts", "68000-mode-code-displacement.ts", "68000-mode-code-upper-code.ts", "68000-source-mode-source-code-destination-mode-destination-code.ts", "68000-events.ts", "68000-execution.ts", "68000-reset.ts", "68000-state.ts", "68000.ts", "6809-cpu.ts", "6809-execution.ts", "6809-state.ts", "6809.ts", "8008-cpu.ts", "8008-execution.ts", "8008-state.ts", "8008.ts", "8080-cpu.ts", "8080-execution.ts", "8080-state.ts", "8080.ts", "8088-cpu.ts", "8088-execution.ts", "8088-operands.ts", "8088-state.ts", "8088-strings.ts", "8088.ts", "z80-cpu.ts", "z80-execution.ts", "z80-state.ts", "z80.ts"].sort());
    for (const cpu of ["6502-cpu", "6502-execution", "6502-state", "6502", "6800-cpu", "6800-execution", "6800-state", "6800", "68000-cpu", "68000-immediate", "68000-mode-code", "68000-mode-code-displacement", "68000-mode-code-upper-code", "68000-source-mode-source-code-destination-mode-destination-code", "68000-events", "68000-execution", "68000-reset", "68000-state", "68000", "6809-cpu", "6809-execution", "6809-state", "6809", "8008-cpu", "8008-execution", "8008-state", "8008", "8080-cpu", "8080-execution", "8080-state", "8080", "8088-cpu", "8088-execution", "8088-operands", "8088-state", "8088-strings", "8088", "z80-cpu", "z80-execution", "z80-state", "z80"]) {
      assert.equal(readFileSync(join(output, `${cpu}.ts`), "utf8"), readFileSync(`src/components/cpus/generated/${cpu}.ts`, "utf8"));
    }
  };
  run();
  // The schema's runtime import must not load expanded chapter data or executable handlers.
  rmSync(join(chapters, "8008.ts"));
  rmSync(join(chapters, "6502.ts"));
  rmSync(output, { recursive: true, force: true });
  const schema = join(directory, "src/components/cpus/semantics/generated/state/8008.ts");
  const inspect = spawnSync(process.execPath, ["--input-type=module", "-e",
    `const { cpu8008StateDescription: state } = await import(${JSON.stringify(schema)});
     if (state.addressStack.length !== 8 || state.flags.fields.c.kind !== "flag") process.exit(1);
     const { cpu6502StateDescription: mos } = await import(${JSON.stringify(join(directory, "src/components/cpus/semantics/generated/state/6502.ts"))});
     if (mos.sp.bits !== 8 || mos.pc.bits !== 16 || Object.keys(mos.flags.fields).length !== 6) process.exit(1);`], { encoding: "utf8" });
  assert.equal(inspect.status, 0, inspect.stderr);
  mkdirSync(output);
  writeFileSync(join(chapters, "state/8008.ts"), "stale");
  writeFileSync(join(chapters, "state/obsolete.ts"), "obsolete");
  writeFileSync(join(output, "obsolete.ts"), "obsolete");
  writeFileSync(join(output, "6502.ts"), "stale");
  writeFileSync(join(chapters, "obsolete.ts"), "obsolete");
  run();
  for (const [name, before, after] of [
    ["6502", "A <- result", "A <- missing"],
    ["6800", "operand r <- result", "operand r <- missing"],
    ["8008", "result = fetch", "result = source missing"],
    ["8008", "register B: 8", "register B: 8 = a"],
    ["8008", "counter PC write setPC", "counter PC write missing"],
    ["8008", "snapshot pc = PC", "snapshot pc = missing"],
    ["68000", "return concat(high, low)", "return concat(high, missing)"],
    ["68000", "attempt action loadResetVectors", "attempt action missing"],
  ] as const) {
    const source = join(directory, `src/components/cpus/specifications/${name}.md`);
    const original = readFileSync(source, "utf8");
    writeFileSync(source, original.replace(before, after));
    const result = spawnSync(process.execPath, [join(directory, "scripts/generate-cpu-semantics.ts")], { encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(`${name}\\.md:\\d+:\\d+: .*(missing|Duplicate stored field)`));
    assert.equal(readFileSync(join(output, "6502.ts"), "utf8"), readFileSync("src/components/cpus/generated/6502.ts", "utf8"));
    assert.equal(readFileSync(join(output, "68000-reset.ts"), "utf8"), readFileSync("src/components/cpus/generated/68000-reset.ts", "utf8"));
    assert.equal(readFileSync(join(output, "8008.ts"), "utf8"), readFileSync("src/components/cpus/generated/8008.ts", "utf8"));
    for (const chapter of chapterFiles) assert.equal(readFileSync(join(chapters, chapter), "utf8"),
      readFileSync(`src/components/cpus/semantics/generated/${chapter}`, "utf8"));
    writeFileSync(source, original);
  }
});
