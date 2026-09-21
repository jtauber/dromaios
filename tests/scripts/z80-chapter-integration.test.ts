import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

// Deliberately wrong hardware edits prove production reads chapter policy, including native indexed callers.
test("Z80 chapter edits reach construction, both snapshots, byte dispatch, indexed arithmetic, and stack status", t => {
  const directory = mkdtempSync(join(tmpdir(), "dromaios-z80-chapter-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, "scripts"));
  for (const name of ["generate-cpu-chapters", "generate-cpu-semantics"]) cpSync(`scripts/${name}.ts`, join(directory, `scripts/${name}.ts`));
  cpSync("src/components", join(directory, "src/components"), { recursive: true });
  cpSync("src/machines", join(directory, "src/machines"), { recursive: true });
  const file = join(directory, "src/components/cpus/specifications/z80.md");
  writeFileSync(file, readFileSync(file, "utf8").replace("register PC: 16", "register SCRATCH: 8\n  register PC: 16")
    .replaceAll("return concat(high, low)", "return concat(low, high)")
    .replace("  Z = zero(result)", "  Z = not(zero(result))")
    .replace("select(carry, u8($01)", "select(carry, u8($20)")
    .replace("C = not(zero(and(status, u8($01))))", "C = zero(and(status, u8($01)))"));
  const generated = spawnSync(process.execPath, [join(directory, "scripts/generate-cpu-semantics.ts")], { encoding: "utf8" });
  assert.equal(generated.status, 0, generated.stderr);
  const url = (path: string) => JSON.stringify(pathToFileURL(join(directory, path)).href);
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import { CpuZ80, cpuZ80StateDescription } from ${url("src/components/cpus/z80.ts")};
    import { parseMachine } from ${url("src/machines/machine-language.ts")};
    const machine = ${JSON.stringify(readFileSync("src/machines/z80/example.machine", "utf8"))};
    assert.equal(cpuZ80StateDescription.scratch.bits, 8);
    assert.throws(() => parseMachine(machine), /Missing fields.*SCRATCH/);
    assert.equal(parseMachine(machine.replace("cpu z80 {", "cpu z80 { SCRATCH = A5")).initialState.scratch, 0xa5);
    const flags = { s: false, z: false, h: false, pv: false, n: false, c: true };
    const bank = { a: 1, b: 0x12, c: 0x34, d: 0x56, e: 0x78, h: 0x9a, l: 0xbc, flags };
    for (const code of [[0x80], [0xc6, 1], [0xdd, 0x86, 0], [0xfd, 0x86, 0], [0xf5], [0xf1], [0x7e]]) {
      const bytes = new Uint8Array(65536); bytes.set(code, 0x200); bytes[0x400] = 1; bytes[0xbc9a] = 0x7f;
      const ram = { size: bytes.length, read: address => bytes[address], write: (address, value) => { bytes[address] = value; } };
      const initial = { ...bank, alternate: { ...bank, b: 0x56, c: 0x78 }, ix: 0x400, iy: 0x400, pc: 0x200, sp: 0x600,
        i: 0, r: 0, iff1: false, iff2: false, im: 0, interruptDeferred: false, nmiDeferred: false, halted: false, scratch: 0xa5 };
      const missing = { ...initial }; delete missing.scratch;
      assert.throws(() => new CpuZ80(ram, missing), /scratch/);
      const cpu = new CpuZ80(ram, initial); initial.scratch = 0;
      const snapshot = cpu.snapshot(); snapshot.scratch = 0;
      assert.equal(cpu.snapshot().scratch, 0xa5); assert.equal(snapshot.bc, 0x3412); assert.equal(snapshot.alternate.bc, 0x7856);
      cpu.step(); const after = cpu.snapshot();
      if ([0x80, 0xc6, 0xdd, 0xfd].includes(code[0])) { assert.equal(after.flags.z, true); assert.ok(after.a > 1); }
      else if (code[0] === 0xf5) assert.equal(bytes[0x5fe], 0x20);
      else if (code[0] === 0xf1) assert.equal(after.flags.c, true);
      else assert.equal(after.a, 0x7f);
      assert.equal(after.scratch, 0xa5);
    }
  `], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});
