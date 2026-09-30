import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test } from "node:test";

test("listing checks are read-only and regeneration writes only the listing, without generated CPU files", t => {
  const directory = mkdtempSync(join(tmpdir(), "dromaios-listing-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, "scripts"));
  for (const name of ["compile-cpu-chapters", "describe-cpu-semantics"]) {
    cpSync(`scripts/${name}.ts`, join(directory, `scripts/${name}.ts`));
  }
  cpSync("src/components", join(directory, "src/components"), { recursive: true, filter: source => basename(source) !== "generated" });
  cpSync("src/literate.ts", join(directory, "src/literate.ts"));
  const target = join(directory, "docs/cpus/semantic-examples.md"), expected = readFileSync("docs/cpus/semantic-examples.md", "utf8");
  mkdirSync(join(directory, "docs/cpus"), { recursive: true });
  writeFileSync(target, expected);
  // A successful check must not rewrite an already-current listing with identical bytes.
  utimesSync(target, 1, 1);
  const outputs = ["generated", "semantics/generated"].map(path => join(directory, "src/components/cpus", path));
  const snapshot = () => outputs.map(directory => existsSync(directory) ? readdirSync(directory, { recursive: true, encoding: "utf8" }).sort()
    .filter(name => statSync(join(directory, name)).isFile())
    .map(name => ({ name, text: readFileSync(join(directory, name), "utf8"), modified: statSync(join(directory, name)).mtimeMs })) : null);
  const run = (check: boolean) => spawnSync(process.execPath,
    [join(directory, "scripts/describe-cpu-semantics.ts"), ...(check ? ["--check"] : [])], { cwd: tmpdir(), encoding: "utf8" });

  const fresh = run(true);
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.equal(readFileSync(target, "utf8"), expected);
  assert.equal(statSync(target).mtimeMs, 1000);
  assert.deepEqual(snapshot(), [null, null]);

  writeFileSync(target, "stale"); utimesSync(target, 1, 1);
  const stale = run(true);
  assert.equal(stale.status, 1, stale.stderr);
  assert.match(stale.stderr, /Instruction examples are stale/);
  assert.equal(readFileSync(target, "utf8"), "stale");
  assert.equal(statSync(target).mtimeMs, 1000);
  assert.deepEqual(snapshot(), [null, null]);

  const generated = run(false);
  assert.equal(generated.status, 0, generated.stderr);
  assert.equal(readFileSync(target, "utf8"), expected);
  assert.deepEqual(snapshot(), [null, null]);

  // Existing build artifacts, including obsolete files, belong to the build command.
  for (const directory of outputs) {
    mkdirSync(join(directory, "state"), { recursive: true });
    for (const name of ["8008.ts", "obsolete.ts", "state/8008.ts"]) {
      const file = join(directory, name);
      writeFileSync(file, `Leave ${name} untouched.`); utimesSync(file, 1, 1);
    }
  }
  const before = snapshot();
  for (const check of [true, false]) {
    const result = run(check);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(snapshot(), before);
    assert.equal(readFileSync(target, "utf8"), expected);
  }

  const chapter = join(directory, "src/components/cpus/specifications/8008.md");
  const original = readFileSync(chapter, "utf8");
  for (const [text, diagnostic] of [
    [original.replace("result = fetch", "result = source missing"), /8008\.md:\d+:\d+: .*missing/],
    [original.replace("interface Cpu8008", 'view BADPC "invalid counter": flag {\n  return 0\n}\ninterface Cpu8008')
      .replace("snapshot pc = PC", "snapshot pc = BADPC"), /8008\.md:\d+:\d+: The public PC must be numeric/],
  ] as const) {
    writeFileSync(chapter, text); utimesSync(target, 1, 1);
    for (const check of [true, false]) {
      const invalid = run(check);
      assert.equal(invalid.status, 1, invalid.stderr);
      assert.match(invalid.stderr, diagnostic);
      assert.deepEqual(snapshot(), before);
      assert.equal(readFileSync(target, "utf8"), expected);
      assert.equal(statSync(target).mtimeMs, 1000);
    }
  }
});
