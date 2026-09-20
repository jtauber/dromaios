import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

test("6800 chapter state and condition-code edits reach the public core, machine parser, and interrupt frames", t => {
  const directory = mkdtempSync(join(tmpdir(), "dromaios-6800-chapter-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, "scripts"));
  for (const name of ["generate-cpu-chapters", "generate-cpu-semantics"]) cpSync(`scripts/${name}.ts`, join(directory, `scripts/${name}.ts`));
  cpSync("src/components", join(directory, "src/components"), { recursive: true });
  cpSync("src/machines", join(directory, "src/machines"), { recursive: true });
  const chapter = join(directory, "src/components/cpus/specifications/6800.md");
  writeFileSync(chapter, readFileSync(chapter, "utf8").replace("register SP: 16", "register SP: 16\n  register SCRATCH: 8")
    .replace("return or(u8($C0),", "return or(u8($80),").replace("I = not(zero(and(status, u8($10))))", "I = zero(and(status, u8($10)))"));
  const generated = spawnSync(process.execPath, [join(directory, "scripts/generate-cpu-semantics.ts")], { encoding: "utf8" });
  assert.equal(generated.status, 0, generated.stderr);
  const url = (path: string) => JSON.stringify(pathToFileURL(join(directory, path)).href);
  const machine = readFileSync("src/machines/6800/example.machine", "utf8");
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import { Cpu6800, cpu6800StateDescription } from ${url("src/components/cpus/6800.ts")};
    import { parseMachine } from ${url("src/machines/machine-language.ts")};
    const text = ${JSON.stringify(machine)};
    assert.equal(cpu6800StateDescription.scratch.bits, 8);
    assert.throws(() => parseMachine(text), /Missing fields.*SCRATCH/);
    const definition = parseMachine(text.replace("cpu 6800 {", "cpu 6800 { SCRATCH = A5"));
    assert.equal(definition.initialState.scratch, 0xa5);
    for (const operation of ["TPA", "TAP", "WAI", "SWI", "irq", "nmi", "RTI"]) {
      const bytes = new Uint8Array(65536);
      bytes[0x200] = { TPA: 7, TAP: 6, WAI: 0x3e, SWI: 0x3f, RTI: 0x3b }[operation] ?? 1;
      const ram = { size: bytes.length, read: address => bytes[address], write: (address, byte) => { bytes[address] = byte; } };
      const initial = { a: 0, b: 0, x: 0, sp: 0xff, pc: 0x200, waiting: false, scratch: 0xa5,
        flags: { h: false, i: false, n: false, z: false, v: false, c: false } };
      const missing = { ...initial }; delete missing.scratch;
      assert.throws(() => new Cpu6800(ram, missing), /scratch/);
      const cpu = new Cpu6800(ram, initial);
      initial.scratch = 0;
      const snapshot = cpu.snapshot(); snapshot.scratch = 0;
      assert.equal(cpu.snapshot().scratch, 0xa5);
      if (operation === "irq" || operation === "nmi") cpu.interrupt(operation); else cpu.step();
      const after = cpu.snapshot();
      assert.equal(after.scratch, 0xa5);
      if (operation === "TPA") assert.equal(after.a, 0x80);
      else if (operation === "TAP" || operation === "RTI") assert.equal(after.flags.i, true);
      else assert.equal(bytes[0xf9], 0x80, "the stack frame must use the edited packed CC");
    }
  `], { cwd: tmpdir(), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

test("the 6502 chapter's state edits reach construction, snapshots, and machine parsing", t => {
  const directory = mkdtempSync(join(tmpdir(), "dromaios-6502-state-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, "scripts"));
  for (const name of ["generate-cpu-chapters", "generate-cpu-semantics"]) cpSync(`scripts/${name}.ts`, join(directory, `scripts/${name}.ts`));
  cpSync("src/components", join(directory, "src/components"), { recursive: true });
  cpSync("src/machines", join(directory, "src/machines"), { recursive: true });
  const chapter = join(directory, "src/components/cpus/specifications/6502.md");
  writeFileSync(chapter, readFileSync(chapter, "utf8").replace("register SP: 8", "register SP: 8\n  register SCRATCH: 8"));
  const generated = spawnSync(process.execPath, [join(directory, "scripts/generate-cpu-semantics.ts")], { encoding: "utf8" });
  assert.equal(generated.status, 0, generated.stderr);
  const url = (path: string) => JSON.stringify(pathToFileURL(join(directory, path)).href);
  const machine = readFileSync("src/machines/6502/example.machine", "utf8");
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import { Cpu6502, cpu6502StateDescription } from ${url("src/components/cpus/generated/6502-cpu.ts")};
    import { parseMachine } from ${url("src/machines/machine-language.ts")};
    const text = ${JSON.stringify(machine)};
    assert.equal(cpu6502StateDescription.scratch.bits, 8);
    assert.throws(() => parseMachine(text), /Missing fields.*SCRATCH/);
    const definition = parseMachine(text.replace("cpu 6502 {", "cpu 6502 { SCRATCH = A5"));
    assert.equal(definition.initialState.scratch, 0xa5);
    assert.throws(() => parseMachine(text.replace("cpu 6502 {", "cpu 6502 { SCRATCH = 100")), /0.*FF/);
    const ram = { size: 0x10000, read() { throw new Error("Unexpected RAM read"); }, write() { throw new Error("Unexpected RAM write"); } };
    const missing = { ...definition.initialState }; delete missing.scratch;
    assert.throws(() => new Cpu6502(ram, missing), /scratch/);
    const cpu = new Cpu6502(ram, definition.initialState);
    assert.equal(cpu.snapshot().scratch, 0xa5);
    definition.initialState.scratch = 0;
    const snapshot = cpu.snapshot(); snapshot.scratch = 0;
    assert.equal(cpu.snapshot().scratch, 0xa5);
  `], { cwd: tmpdir(), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

test("the 6502 chapter's status view and mask policy drive both software and external entry", t => {
  const directory = mkdtempSync(join(tmpdir(), "dromaios-6502-status-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, "scripts"));
  for (const name of ["generate-cpu-chapters", "generate-cpu-semantics"]) {
    cpSync(`scripts/${name}.ts`, join(directory, `scripts/${name}.ts`));
  }
  cpSync("src/components", join(directory, "src/components"), { recursive: true });
  const chapter = join(directory, "src/components/cpus/specifications/6502.md");
  const original = readFileSync(chapter, "utf8");
  assert.ok(original.includes("return or(u8($20),")); assert.ok(original.includes("I = value"));
  writeFileSync(chapter, original.replace("return or(u8($20),", "return or(u8($00),").replace("I = value", "I = not(value)"));
  const generated = spawnSync(process.execPath, [join(directory, "scripts/generate-cpu-semantics.ts")], { encoding: "utf8" });
  assert.equal(generated.status, 0, generated.stderr);
  const url = JSON.stringify(pathToFileURL(join(directory, "src/components/cpus/generated/6502-cpu.ts")).href);
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import { Cpu6502 } from ${url};
    for (const source of ["PHP", "BRK", "irq", "nmi"]) {
      const image = new Uint8Array(65536); image[0x200] = source === "PHP" ? 0x08 : 0;
      const ram = { size: image.length, read: address => image[address], write: (address, byte) => { image[address] = byte; } };
      const initial = { a: 0, x: 0, y: 0, pc: 0x200, sp: 0xff,
        flags: { n: false, v: false, d: true, i: false, z: false, c: false } };
      const cpu = new Cpu6502(ram, initial);
      if (source === "PHP" || source === "BRK") cpu.step(); else cpu.interrupt(source);
      assert.equal(image[source === "PHP" ? 0x1ff : 0x1fd], source === "PHP" || source === "BRK" ? 0x18 : 0x08);
      assert.equal(cpu.snapshot().flags.i, false);
      assert.equal(cpu.snapshot().flags.d, true);
    }
  `], { cwd: tmpdir(), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

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
