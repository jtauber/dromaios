import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { compileMachine, generateMachines } from "../../scripts/generate-machines.js";

const source = `ram 10000
cpu 6502 {
  A=00 X=00 Y=00 SP=FF PC=0200
  flags { N=0 V=0 D=0 I=1 Z=0 C=0 }
}
memory 0200 { A9 02 }
memory FFFC { 00 02 }
end 0202
`;

test("regeneration discovers definitions and removes obsolete output without modifying source files", t => {
  const directory = mkdtempSync(join(tmpdir(), "dromaios-machines-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const original = `${source}// Keep this comment.\n`;
  writeFileSync(join(directory, "first-example.machine"), original);
  generateMachines(directory);
  assert.deepEqual(readdirSync(join(directory, "generated")), ["first-example.ts"]);
  assert.equal(readFileSync(join(directory, "first-example.machine"), "utf8"), original);
  const first = readFileSync(join(directory, "generated/first-example.ts"), "utf8");
  assert.match(first, /createFirstExampleMemory/);
  assert.match(first, /defineRamExample\(Cpu6502,/);
  assert.match(first, /"endAddress": 514/);

  rmSync(join(directory, "first-example.machine"));
  writeFileSync(join(directory, "second-example.machine"), original);
  generateMachines(directory);
  assert.deepEqual(readdirSync(join(directory, "generated")), ["second-example.ts"]);
  const generated = readFileSync(join(directory, "generated/second-example.ts"), "utf8");
  generateMachines(directory);
  assert.equal(readFileSync(join(directory, "generated/second-example.ts"), "utf8"), generated);

  writeFileSync(join(directory, "third-example.machine"), "ram 10000 memory 0000 { GG }");
  assert.throws(() => generateMachines(directory), /third-example\.machine:/);
  assert.deepEqual(readdirSync(join(directory, "generated")), ["second-example.ts"]);
  assert.equal(readFileSync(join(directory, "generated/second-example.ts"), "utf8"), generated);
  for (const filename of ["../escape.machine", "Uppercase.machine", "with_underscore.machine", "example.jsonc"]) {
    assert.throws(() => compileMachine(source, filename), /Invalid machine filename/);
  }
});

test("the native TypeScript build entry point works outside the repo and prints source errors without a stack trace", t => {
  const directory = mkdtempSync(join(tmpdir(), "dromaios-machine-build-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, "scripts"));
  mkdirSync(join(directory, "src/machines"), { recursive: true });
  cpSync("scripts/generate-machines.ts", join(directory, "scripts/generate-machines.ts"));
  cpSync("src/machines/machine-language.ts", join(directory, "src/machines/machine-language.ts"));
  writeFileSync(join(directory, "package.json"), JSON.stringify({ type: "module" }));
  writeFileSync(join(directory, "src/machines/lesson.machine"), source);
  const run = () => spawnSync(process.execPath, [join(directory, "scripts/generate-machines.ts")], {
    cwd: tmpdir(), encoding: "utf8",
  });
  const success = run();
  assert.equal(success.error, undefined);
  assert.equal(success.status, 0, success.stderr);
  assert.equal(success.stderr, "");
  const generated = readFileSync(join(directory, "src/machines/generated/lesson.ts"), "utf8");
  assert.match(generated, /createLesson/);

  writeFileSync(join(directory, "src/machines/lesson.machine"), "ram 10000\nmemory 0000 { GG }");
  const failure = run();
  assert.equal(failure.error, undefined);
  assert.equal(failure.status, 1);
  assert.equal(failure.stderr, 'lesson.machine:2:15: Expected a two-digit hexadecimal byte, found "GG"\nmemory 0000 { GG }\n              ^\n');
  assert.equal(readFileSync(join(directory, "src/machines/generated/lesson.ts"), "utf8"), generated);
});
