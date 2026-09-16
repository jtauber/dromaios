import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";

const script = resolve("scripts/test.ts");

test("test command selects CPU and machine tests, defaults to the whole suite, and forwards filters and failures", t => {
  const directory = mkdtempSync(join(tmpdir(), "dromaios-test-cpu-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const fixture = (path: string, name: string, fail = false) => {
    const file = join(directory, "dist/tests", path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `const { test } = require('node:test');\ntest(${JSON.stringify(name)}, () => { ${fail ? "throw new Error('fixture failure');" : ""} });\n`);
  };
  fixture("components/cpus/8008.test.js", "flat CPU");
  fixture("machines/8008/example.test.js", "flat machine");
  fixture("components/cpus/z80/alu.test.js", "grouped CPU");
  fixture("components/cpus/z80/nested/control.test.js", "nested CPU");
  fixture("machines/z80/example.test.js", "grouped machine");
  fixture("components/cpus/z80/helpers.js", "unselected helper", true);
  fixture("components/cpus/z80.test.js", "failure case", true);
  fixture("components/cpus/8080.test.js", "unselected CPU", true);
  // Exercise a standalone command, not another worker of this test runner.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const run = (...args: string[]) => spawnSync(process.execPath, [script, ...args], { cwd: directory, encoding: "utf8", env });
  const flat = run("8008");
  assert.equal(flat.status, 0, flat.stderr);
  assert.match(flat.stdout, /flat CPU/);
  assert.match(flat.stdout, /flat machine/);
  assert.doesNotMatch(flat.stdout, /grouped|unselected/);
  const filtered = run("z80", "--test-name-pattern=grouped|nested");
  assert.equal(filtered.status, 0, filtered.stderr);
  assert.match(filtered.stdout, /grouped CPU/);
  assert.match(filtered.stdout, /nested CPU/);
  assert.match(filtered.stdout, /grouped machine/);
  assert.doesNotMatch(filtered.stdout, /failure case|unselected|flat/);
  const failed = run("z80");
  assert.equal(failed.status, 1);
  assert.match(failed.stdout, /failure case/);
  const all = run("--test-name-pattern=flat|grouped|nested");
  assert.equal(all.status, 0, all.stderr);
  for (const name of ["flat CPU", "flat machine", "grouped CPU", "nested CPU", "grouped machine"]) assert.ok(all.stdout.includes(name));
  assert.equal(run().status, 1, "An unfiltered run includes every CPU, including the failing fixture");
  for (const args of [["unknown"], ["../z80"], ["Z80"]]) {
    const invalid = run(...args);
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /Usage:/);
  }
  const missing = run("68000");
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /No compiled tests found/);
});
