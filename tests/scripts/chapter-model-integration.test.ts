import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

test("chapter edits drive machine schemas, RAM bounds, entry points, and automatic model registration", t => {
  const directory = mkdtempSync(join(tmpdir(), "dromaios-chapter-model-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, "scripts"));
  for (const script of ["generate-cpu-chapters", "generate-cpu-semantics", "generate-machines", "compile-composition"]) {
    cpSync(`scripts/${script}.ts`, join(directory, `scripts/${script}.ts`));
  }
  cpSync("src/components", join(directory, "src/components"), { recursive: true });
  cpSync("src/machines", join(directory, "src/machines"), { recursive: true });
  const url = (path: string) => JSON.stringify(pathToFileURL(join(directory, path)).href);
  const run = (source: string) => {
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", source], { cwd: tmpdir(), encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  };
  const generate = () => spawnSync(process.execPath, [join(directory, "scripts/generate-cpu-semantics.ts")], { cwd: tmpdir(), encoding: "utf8" });
  const chapter = join(directory, "src/components/cpus/specifications/8008.md");
  const original = readFileSync(chapter, "utf8");
  const changed = original.replace("memory 14", "memory 15")
    .replace("interface Cpu8008", "interface CpuSmall")
    .replace("latch STOPPED = halted", "latch STOPPED = halted\n  latch READY = ready");
  writeFileSync(chapter, changed);
  const result = generate(); assert.equal(result.status, 0, result.stderr);
  const machine = readFileSync("src/machines/8008/example.machine", "utf8").replace("ram 4000", "ram 8000")
    .replace("halted = false", "halted = false\n  ready = true");
  const imports = `import assert from "node:assert/strict";
    import { parseMachine } from ${url("src/machines/machine-language.ts")};
    import { compileMachine } from ${url("scripts/generate-machines.ts")};
    import { cpuModels } from ${url("src/components/cpus/models.ts")};`;
  run(`${imports}
    const source = ${JSON.stringify(machine)};
    const parsed = parseMachine(source + "\\nmemory 7FFF { AA } end 3FFF");
    assert.equal(parsed.ramSize, 0x8000); assert.equal(parsed.initialState.ready, true);
    assert.equal(cpuModels["8008"].name, "CpuSmall");
    assert.equal(cpuModels["8080"].module, "generated/8080-cpu");
    assert.equal(cpuModels["8080"].maximumPc, 0xffff, "stored PC also supplies public completion bounds");
    assert.equal(cpuModels["8008"].ramSize, 0x8000);
    assert.equal(cpuModels["8008"].maximumPc, 0x3fff);
    assert.throws(() => parseMachine(source.replace("ready = true", "")), /Missing fields.*ready/);
    assert.throws(() => parseMachine(source.replace("ram 8000", "ram 4000")), /RAM size/);
    assert.throws(() => parseMachine(source + "\\nmemory 8000 {}"), /7FFF/);
    assert.throws(() => parseMachine(source + "\\nend 4000"), /3FFF/);
    const flat = compileMachine(source, "changed.machine");
    assert.ok(flat.includes('import { CpuSmall }'));
    assert.ok(flat.includes('cpus/generated/8008-cpu.js'));
    const composed = source.slice(source.indexOf("cpu 8008"), source.indexOf("memory "))
      + "components { ram = ram 8000 } memory = ram end 3FFF";
    const parsedComposition = parseMachine(composed);
    assert.equal("ramSize" in parsedComposition, false);
    assert.equal(parsedComposition.connection.kind, "direct");
    assert.ok(compileMachine(composed, "composed.machine").includes('import { CpuSmall }'));
    assert.ok(compileMachine(composed, "composed.machine").includes('cpus/generated/8008-cpu.js'));
    assert.throws(() => parseMachine(composed.replace("ram 8000", "ram 4000")), /requires RAM of size 8000/);
  `);

  // A copied chapter declares a new model without editing any handwritten registration list.
  const added = join(directory, "src/components/cpus/specifications/probe.md");
  writeFileSync(added, changed.replace('cpu "8008"', 'cpu "probe"').replace("interface CpuSmall", "interface CpuProbe"));
  const discovered = generate(); assert.equal(discovered.status, 0, discovered.stderr);
  run(`${imports}
    assert.equal(cpuModels.probe.ramSize, 0x8000);
    const source = ${JSON.stringify(machine.replace("cpu 8008", "cpu probe"))};
    assert.equal(parseMachine(source).cpu, "probe");
    const factory = compileMachine(source, "probe.machine");
    assert.ok(factory.includes('import { CpuProbe }'));
    assert.ok(factory.includes('cpus/generated/probe-cpu.js'));
  `);

  // A model without a public pc view still supports execution, but not PC-based completion.
  writeFileSync(chapter, changed.replace("snapshot pc = PC", "snapshot location = PC"));
  const noPc = generate(); assert.equal(noPc.status, 0, noPc.stderr);
  run(`${imports}
    const source = ${JSON.stringify(machine)};
    assert.equal(parseMachine(source).cpu, "8008");
    assert.throws(() => parseMachine(source + "\\nend 0"), /no public PC view/);
  `);

  const metadata = join(directory, "src/components/cpus/semantics/generated/interfaces.ts");
  const beforeFailure = readFileSync(metadata, "utf8");
  writeFileSync(added, changed);
  const duplicate = generate();
  assert.notEqual(duplicate.status, 0); assert.match(duplicate.stderr, /Duplicate complete CPU chapter/);
  assert.equal(readFileSync(metadata, "utf8"), beforeFailure);
  rmSync(added);
  writeFileSync(chapter, original);
  const restored = generate(); assert.equal(restored.status, 0, restored.stderr);
  run(`${imports}
    assert.equal(Object.hasOwn(cpuModels, "probe"), false);
    assert.equal(cpuModels["8008"].ramSize, 0x4000);
    assert.equal(cpuModels["8008"].name, "Cpu8008");
  `);
});
