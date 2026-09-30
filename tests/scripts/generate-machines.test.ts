import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
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

function chapter(source: string): string {
  return `# A machine\n\nIts declarations follow.\n\n\`\`\`machine\n${source}\`\`\`\n`;
}

test("machine chapters combine fences in reading order and preserve the standalone factory", () => {
  const markdown = [
    "# A machine", "", "Its memory:", "~~~machine", "ram 10000", "~~~~", "",
    "Its CPU and images:", "```machine", source.slice(source.indexOf("cpu")), "```", "",
    "Ignored examples:", "````text", "```machine", "invalid nested example", "```", "````", "",
    "```typescript", "invalid host code", "```", "",
    "  ```machine", "invalid indented example", "  ```", "",
    "> ```machine", "> invalid quoted example", "> ```", "",
    "```machine example", "invalid annotated example", "```",
  ].join("\n");
  for (const path of ["lesson", "6502/lesson", "6502/intro/lesson"]) {
    const generated = compileMachine(markdown, `${path}.md`);
    const standalone = compileMachine(source, `${path}.machine`);
    assert.equal(generated.slice(generated.indexOf("\n")), standalone.slice(standalone.indexOf("\n")));
    assert.ok(generated.startsWith(`// Generated from ${"../".repeat(path.split("/").length)}${path}.md;`));
  }
});

test("chapter errors retain Markdown locations, indentation, and line text across line endings", () => {
  const lines = ["# Invalid image", "", "```machine", "ram 10000", "```", "",
    "The image exceeds RAM.", "", "~~~machine", "memory FFFF {", "  AA BB", "}", "~~~"];
  for (const newline of ["\n", "\r\n", "\r"]) {
    assert.throws(() => compileMachine(lines.join(newline), "lesson.md"), {
      name: "SyntaxError",
      message: "lesson.md:11:6: Memory block extends beyond address FFFF\n  AA BB\n     ^",
    });
  }
  assert.throws(() => compileMachine(chapter(source.replace("A=00", "BOGUS=00")), "lesson.md"),
    /lesson\.md:8:3:.*BOGUS/);
});

test("chapters reject absent and unclosed executable fences", () => {
  for (const markdown of ["# No definition", "```text\n```machine\nignored\n```\n"])
    assert.throws(() => compileMachine(markdown, "lesson.md"), /lesson\.md:1:1: Expected at least one machine fence\./);
  for (const closing of ["", "```", "~~~~"]) {
    assert.throws(() => compileMachine(`# Unclosed\n\n\`\`\`\`machine\n${source}${closing}`, "lesson.md"), {
      name: "SyntaxError", message: "lesson.md:3:1: Unclosed machine fence.",
    });
  }
  assert.throws(() => compileMachine("```machine\n```", "lesson.md"), /Missing ram/);
});

test("Z80 generation preserves nested state and uses CpuZ80 with lowercase module paths", () => {
  const source = readFileSync("src/machines/z80/example.machine", "utf8");
  const generated = compileMachine(source, "z80/example.machine");
  assert.ok(generated.includes('import { CpuZ80 } from "../../../components/cpus/generated/z80-cpu.js";'));
  assert.ok(generated.includes("create: createZ80Example, createMemory: createZ80ExampleMemory"));
  assert.ok(generated.includes("defineRamExample(CpuZ80,"));
  assert.ok(generated.includes('"alternate": {'));
  assert.ok(generated.includes('"pv": false'));
  assert.ok(generated.includes('"im": 0'));
  assert.equal(generated.includes('"endAddress"'), false);
});

test("regeneration mirrors nested definitions, ignores its output, and removes obsolete files and directories", t => {
  const directory = mkdtempSync(join(tmpdir(), "dromaios-machines-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const original = `${source}// Keep this comment.\n`;
  const write = (path: string, text = original): void => {
    const filename = join(directory, path);
    mkdirSync(dirname(filename), { recursive: true });
    writeFileSync(filename, text);
  };
  write("intro/first-example.machine");
  write("advanced/memory/first-example.machine"); // Matching basenames remain distinct.
  write("root-example.machine");
  write("intro/chapter.md", chapter(source));
  generateMachines(directory);
  assert.deepEqual(readdirSync(join(directory, "generated")).sort(), ["advanced", "intro", "root-example.ts"]);
  for (const path of ["intro/first-example.machine", "advanced/memory/first-example.machine", "root-example.machine"]) {
    assert.equal(readFileSync(join(directory, path), "utf8"), original);
  }
  const first = readFileSync(join(directory, "generated/intro/first-example.ts"), "utf8");
  assert.match(first, /createIntroFirstExampleMemory/);
  assert.match(first, /defineRamExample\(Cpu6502,/);
  assert.match(first, /"endAddress": 514/);
  assert.match(readFileSync(join(directory, "generated/intro/chapter.ts"), "utf8"), /createIntroChapter/);
  assert.match(readFileSync(join(directory, "generated/advanced/memory/first-example.ts"), "utf8"),
    /createAdvancedMemoryFirstExample/);
  assert.match(readFileSync(join(directory, "generated/root-example.ts"), "utf8"), /createRootExample/);

  // The generated subtree must never become an input, even if it contains a .machine file.
  write("generated/ignored/bad.machine", "invalid source");
  write("generated/ignored/bad.md", "invalid source");
  rmSync(join(directory, "intro"), { recursive: true });
  rmSync(join(directory, "advanced"), { recursive: true });
  write("6502/stack-example.machine");
  generateMachines(directory);
  assert.deepEqual(readdirSync(join(directory, "generated")).sort(), ["6502", "root-example.ts"]);
  assert.deepEqual(readdirSync(join(directory, "generated/6502")), ["stack-example.ts"]);
  const generated = readFileSync(join(directory, "generated/6502/stack-example.ts"), "utf8");
  assert.match(generated, /create6502StackExample/);
  generateMachines(directory);
  assert.equal(readFileSync(join(directory, "generated/6502/stack-example.ts"), "utf8"), generated);

  write("6502/bad.machine", "ram 10000 memory 0000 { GG }");
  assert.throws(() => generateMachines(directory), /6502\/bad\.machine:/);
  assert.deepEqual(readdirSync(join(directory, "generated")).sort(), ["6502", "root-example.ts"]);
  assert.equal(readFileSync(join(directory, "generated/6502/stack-example.ts"), "utf8"), generated);
  rmSync(join(directory, "6502"), { recursive: true });
  rmSync(join(directory, "root-example.machine"));
  generateMachines(directory);
  assert.deepEqual(readdirSync(join(directory, "generated")), []);
});

test("a chapter and standalone definition cannot overwrite the same generated module", t => {
  const directory = mkdtempSync(join(tmpdir(), "dromaios-machine-collision-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(join(directory, "lesson.machine"), source);
  generateMachines(directory);
  const generated = readFileSync(join(directory, "generated/lesson.ts"), "utf8");
  writeFileSync(join(directory, "lesson.md"), chapter(source));
  assert.throws(() => generateMachines(directory),
    /lesson\.machine and lesson\.md both generate lesson\.ts/);
  assert.equal(readFileSync(join(directory, "generated/lesson.ts"), "utf8"), generated);
  rmSync(join(directory, "lesson.machine"));
  generateMachines(directory);
  assert.match(readFileSync(join(directory, "generated/lesson.ts"), "utf8"), /Generated from \.\.\/lesson\.md/);
});

test("machine paths determine factory names, source comments, and imports at each directory depth", () => {
  for (const [path, name, sourcePath, cpuPath, helperPath] of [
    ["lesson.machine", "createLesson", "../lesson.machine", "../../components/cpus/generated/6502-cpu.js", "../ram-example.js"],
    ["6502/example.machine", "create6502Example", "../../6502/example.machine", "../../../components/cpus/generated/6502-cpu.js", "../../ram-example.js"],
    ["6502/stack/example.machine", "create6502StackExample", "../../../6502/stack/example.machine", "../../../../components/cpus/generated/6502-cpu.js", "../../../ram-example.js"],
  ] as const) {
    const generated = compileMachine(source, path);
    assert.ok(generated.includes(`// Generated from ${sourcePath};`));
    assert.ok(generated.includes(`import { Cpu6502 } from "${cpuPath}";`));
    assert.ok(generated.includes(`import { defineRamExample } from "${helperPath}";`));
    assert.ok(generated.includes(`create: ${name}, createMemory: ${name}Memory`));
  }
  for (const path of [
    "../escape.machine", "/absolute.machine", "6502/../escape.machine", "6502//example.machine",
    "6502/./example.machine", "6502\\example.machine", "Uppercase/example.machine",
    "with_underscore.machine", "6502/example.jsonc", ".machine", ".md", "../escape.md", "Uppercase.md",
  ]) {
    assert.throws(() => compileMachine(source, path), /Invalid machine path/);
  }
});

test("the native TypeScript build entry point works outside the repo and prints nested source errors without a stack trace", t => {
  const directory = mkdtempSync(join(tmpdir(), "dromaios-machine-build-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, "scripts"));
  mkdirSync(join(directory, "src/machines/6502"), { recursive: true });
  cpSync("scripts/generate-machines.ts", join(directory, "scripts/generate-machines.ts"));
  cpSync("scripts/compile-composition.ts", join(directory, "scripts/compile-composition.ts"));
  cpSync("src/machines/language", join(directory, "src/machines/language"), { recursive: true });
  cpSync("src/machines/machine-language.ts", join(directory, "src/machines/machine-language.ts"));
  cpSync("src/machines/machine-chapter.ts", join(directory, "src/machines/machine-chapter.ts"));
  cpSync("src/components", join(directory, "src/components"), { recursive: true });
  cpSync("src/literate.ts", join(directory, "src/literate.ts"));
  rmSync(join(directory, "src/components/cpus/generated"), { recursive: true, force: true });
  writeFileSync(join(directory, "package.json"), JSON.stringify({ type: "module" }));
  writeFileSync(join(directory, "src/machines/6502/lesson.machine"), source);
  const run = () => spawnSync(process.execPath, [join(directory, "scripts/generate-machines.ts")], {
    cwd: tmpdir(), encoding: "utf8",
  });
  const success = run();
  assert.equal(success.error, undefined);
  assert.equal(success.status, 0, success.stderr);
  assert.equal(success.stderr, "");
  const generated = readFileSync(join(directory, "src/machines/generated/6502/lesson.ts"), "utf8");
  assert.match(generated, /create6502Lesson/);

  writeFileSync(join(directory, "src/machines/6502/lesson.machine"), "ram 10000\nmemory 0000 { GG }");
  const failure = run();
  assert.equal(failure.error, undefined);
  assert.equal(failure.status, 1);
  assert.equal(failure.stderr, '6502/lesson.machine:2:15: Expected a two-digit hexadecimal byte, found "GG"\nmemory 0000 { GG }\n              ^\n');
  assert.equal(readFileSync(join(directory, "src/machines/generated/6502/lesson.ts"), "utf8"), generated);

  rmSync(join(directory, "src/machines/6502/lesson.machine"));
  writeFileSync(join(directory, "src/machines/6502/lesson.md"), chapter("ram 10000\nmemory 0000 { GG }\n"));
  const chapterFailure = run();
  assert.equal(chapterFailure.status, 1);
  assert.equal(chapterFailure.stderr, '6502/lesson.md:7:15: Expected a two-digit hexadecimal byte, found "GG"\nmemory 0000 { GG }\n              ^\n');
  assert.equal(readFileSync(join(directory, "src/machines/generated/6502/lesson.ts"), "utf8"), generated);
});

test("6800 generation uses Cpu6800, preserves its state and high-byte-first vector, and exports a completion address", () => {
  const source = readFileSync("src/machines/6800/example.machine", "utf8");
  const generated = compileMachine(source, "6800/example.machine");
  assert.ok(generated.includes('import { Cpu6800 } from "../../../components/cpus/generated/6800-cpu.js";'));
  assert.ok(generated.includes("create: create6800Example, createMemory: create6800ExampleMemory"));
  assert.ok(generated.includes("defineRamExample(Cpu6800,"));
  assert.ok(generated.includes('"sp": 32767'));
  assert.ok(generated.includes('"waiting": false'));
  assert.ok(compileMachine(source.replace("waiting = false", "waiting = true"), "6800/example.machine").includes('"waiting": true'));
  assert.ok(generated.includes('"h": true'));
  assert.ok(generated.includes('"i": false'));
  assert.ok(generated.includes('"address": 65534'));
  assert.ok(generated.includes('"endAddress": 519'));
  assert.equal(generated.includes('"dp"'), false);
  assert.equal(generated.includes('"halted"'), false);
});

test("8008 generation preserves the 16 KiB size and eight address registers for Cpu8008", () => {
  const source = readFileSync("src/machines/8008/example.machine", "utf8");
  const generated = compileMachine(source, "8008/example.machine");
  assert.ok(generated.includes('import { Cpu8008 } from "../../../components/cpus/generated/8008-cpu.js";'));
  assert.ok(generated.includes("create: create8008Example, createMemory: create8008ExampleMemory"));
  assert.ok(generated.includes("defineRamExample(Cpu8008,"));
  assert.ok(generated.includes('"ramSize": 16384'));
  assert.ok(generated.includes('"addressStack": ['));
  assert.ok(generated.includes('"stackIndex": 0'));
  assert.equal(generated.includes('"pc"'), false);
  assert.equal(generated.includes('"endAddress"'), false);
  const existing = compileMachine(readFileSync("src/machines/8080/example.machine", "utf8"), "8080/example.machine");
  assert.ok(existing.includes('"ramSize": 65536'));
});

test("8088 generation retains word registers, one MiB RAM, and physical addresses beyond sixteen bits", () => {
  const source = readFileSync("src/machines/8088/example.machine", "utf8");
  const generated = compileMachine(source, "8088/example.machine");
  assert.ok(generated.includes('import { Cpu8088 } from "../../../components/cpus/generated/8088-cpu.js";'));
  assert.ok(generated.includes("create: create8088Example, createMemory: create8088ExampleMemory"));
  assert.ok(generated.includes('"ramSize": 1048576'));
  assert.ok(generated.includes('"cs": 4660'));
  assert.ok(generated.includes('"ip": 256'));
  assert.ok(generated.includes('"address": 74816'));
  assert.ok(generated.includes('"endAddress": 74825'));
  assert.equal(generated.includes('"pc"'), false);
  assert.equal(generated.includes('"al"'), false);
});

test("68000 generation preserves unsigned long values and logical completion with 16 MiB RAM", () => {
  const source = readFileSync("src/machines/68000/example.machine", "utf8");
  const generated = compileMachine(source, "68000/example.machine");
  assert.ok(generated.includes('import { Cpu68000 } from "../../../components/cpus/generated/68000-cpu.js";'));
  assert.ok(generated.includes("create: create68000Example, createMemory: create68000ExampleMemory"));
  assert.ok(generated.includes('"ramSize": 16777216'));
  assert.ok(generated.includes(`"pc": ${0xab001000}`));
  assert.ok(generated.includes(`"endAddress": ${0xab001012}`));
  assert.ok(generated.includes('"interruptMask": 2'));
  assert.equal(generated.includes('"a7"'), false);
  assert.equal(generated.includes('"physicalPc"'), false);
});
