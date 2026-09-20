import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import { ChapterError } from "../../../../src/components/cpus/semantics/literate/document.js";
import { describeInstruction } from "../../../../src/components/cpus/semantics/describe.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";
import { literal, perform, reject, value, writeRegister } from "../../../../src/components/cpus/semantics/model.js";
import type { Action, Statement } from "../../../../src/components/cpus/semantics/model.js";
import { defineInstruction } from "../../../../src/components/cpus/semantics/validate.js";

const compile = (body: string) => compileCpuChapter(`Actions expand in order with isolated captures.

\`\`\`cpu
cpu "probe"
state {
  register A: 8
  register B: 8
  register SP: 16
}
${body}
\`\`\``, {}, "actions.md");
const javascript = (source: string) => stripTypeScriptTypes(source).replace('"../alu.ts"',
  JSON.stringify(new URL("../../../../src/components/cpus/alu.js", import.meta.url).href));
const actions = `action push "push a byte" (byte: 8) using memory {
  address = register SP
  memory(address) <- byte
  pointer = register SP
  SP <- subtract(pointer, u16(1))
}
action pair "push two captured bytes" (first: 8, second: 8) using memory {
  perform push(first)
  perform push(second)
}`;

test("composed actions capture arguments in caller scope and isolate each expansion's locals", async () => {
  const chapter = compile(`${actions}
family probe "00000000" {
  first = register A
  second = register B
  perform pair(second, first)
  perform push(first)
  B <- second
}`);
  const definition = chapter.families.probe![0]![1];
  const source = generateInstructions("probe", { probe: definition });
  assert.match(source, /Pick<ByteInstructionContext, "writeByte">/);
  const module: { instructions: { probe(state: { a: number; b: number; sp: number }, context: { writeByte(address: number, byte: number): void }): void } } =
    await import(`data:text/javascript,${encodeURIComponent(javascript(source))}`);
  const failure = new Error("push failed");
  for (let failAt = -1; failAt < 3; failAt++) {
    const state = { a: 0x12, b: 0x34, sp: 0 }, writes: number[][] = [];
    const run = () => module.instructions.probe(state, { writeByte(address, byte) {
      const index = writes.length; writes.push([address, byte]);
      if (index === failAt) throw failure;
      state.a = 0xaa; state.b = 0xbb;
      state.sp = index === 0 ? 0x200 : 0; // Each post-write decrement uses the live pointer.
    } });
    if (failAt < 0) run(); else assert.throws(run, error => error === failure);
    assert.deepEqual(writes, [[0, 0x34], [0x1ff, 0x12], [0xffff, 0x12]].slice(0, failAt < 0 ? 3 : failAt + 1));
    assert.deepEqual(state, failAt === 0 ? { a: 0x12, b: 0x34, sp: 0 }
      : { a: 0xaa, b: failAt < 0 ? 0x34 : 0xbb, sp: failAt === 1 ? 0x1ff : 0xffff });
  }
  const description = describeInstruction(definition);
  assert.match(description, /first:u8 := second\n\s+second:u8 := first/);
  assert.match(description, /perform "push two captured bytes"/);
  assert.equal(description.match(/perform "push a byte"/g)?.length, 3);
});

test("value sources can perform ordered effects and return their own captures", async () => {
  const chapter = compile(`action advance "advance stack pointer" {
  pointer = register SP
  SP <- add(pointer, u16(1))
}
source pop "pop a byte" : 8 {
  perform advance()
  pointer = register SP
  byte = memory(pointer)
  return byte
}
family pull "00000000" {
  byte = source pop
  A <- byte
}`);
  const source = generateInstructions("probe", { pull: chapter.families.pull![0]![1] });
  assert.match(source, /Pick<ByteInstructionContext, "readByte">/);
  const module: { instructions: { pull(state: { a: number; b: number; sp: number }, context: { readByte(address: number): number }): void } } =
    await import(`data:text/javascript,${encodeURIComponent(javascript(source))}`);
  const state = { a: 0, b: 0, sp: 0xffff };
  module.instructions.pull(state, { readByte(address) { assert.equal(address, 0); assert.equal(state.sp, 0); return 0x80; } });
  assert.deepEqual(state, { a: 0x80, b: 0, sp: 0 });
});

const invalid: readonly [string, string, RegExp][] = [
  ["forward calls", 'action first "first" {\n perform later()\n}\naction later "later" {\n A <- u8(0)\n}', /Unknown.*later/],
  ["recursive calls", 'action again "again" {\n perform again()\n}', /Unknown.*again/],
  ["missing argument", `${actions}\nfamily probe "00000000" {\n perform push()\n}`, /Expected/],
  ["extra argument", `${actions}\nfamily probe "00000000" {\n perform push(u8(1), u8(2))\n}`, /Expected/],
  ["wrong argument width", `${actions}\nfamily probe "00000000" {\n perform push(u16(1))\n}`, /expected 8-bit/],
  ["caller-local leak into action", 'action write "write" {\n A <- outer\n}\nfamily probe "00000000" {\n outer = u8(1)\n perform write()\n}', /outer has not been captured/],
  ["action-local leak into caller", `${actions}\nfamily probe "00000000" {\n perform push(u8(1))\n SP <- pointer\n}`, /pointer has not been captured/],
  ["hidden memory in state action", `${actions}\naction reset "reset" {\n perform pair(u8(1), u8(2))\n}`, /without using memory/],
  ["hidden effects in view", 'action write "write" {\n A <- u8(0)\n}\nview BYTE "pure" : 8 {\n perform write()\n return u8(0)\n}', /Views may only read/],
  ["hidden untaken memory", `${actions}\naction reset "reset" {\n when 0 {\n perform push(u8(1))\n }\n}`, /without using memory/],
  ["fetch in action", 'action bad "bad" using memory {\n byte = fetch\n}', /cannot fetch/],
];
for (const [name, text, message] of invalid) test(`action composition rejects ${name} with a chapter diagnostic`, () => {
  assert.throws(() => compile(text), (error: unknown) => {
    assert.ok(error instanceof ChapterError); assert.equal(error.file, "actions.md");
    assert.match(error.message, message); return true;
  });
});

test("IR action validation checks argument names, widths, field ownership, and escaping outcomes", () => {
  const definition = compile('family probe "00000000" {\n A <- u8(0)\n}').families.probe![0]![1];
  const check = (statement: Statement) => defineInstruction({ ...definition, steps: [statement] });
  const action: Action = { name: "write byte", inputs: { byte: 8 }, steps: [
    writeRegister({ kind: "register", cpu: "probe", field: "a", width: 8 }, value("byte")),
  ] };
  assert.doesNotThrow(() => check(perform(action, { byte: literal(8, 1) })));
  assert.throws(() => check(perform(action, {})), /arguments must match/);
  assert.throws(() => check(perform(action, { other: literal(8, 1) })), /arguments must match/);
  assert.throws(() => check(perform(action, { byte: literal(16, 1) })), /expected 8-bit/);
  assert.throws(() => check(perform({ ...action, steps: [writeRegister({ kind: "register", cpu: "other", field: "a", width: 8 }, value("byte"))] }, { byte: literal(8, 1) })), /CPU/);
  assert.throws(() => check(perform({ name: "reject", steps: [reject("bad")] }, {})), /cannot reject/);
});


test("constant action arguments retain their declared numeric type in generated TypeScript", t => {
  const chapter = compile(`action choose "test an input byte" (byte: 8) {
  when zero(byte) {
    A <- u8(0)
  }
  when not(zero(byte)) {
    A <- u8(1)
  }
}
family probe "00000000" {
  perform choose(u8(1))
}`);
  // Supply this arbitrary CPU's state locally; the generated body is unchanged.
  const source = generateInstructions("probe", { probe: chapter.families.probe![0]![1] })
    .replace(/^import type .*;\n/gm, "") + "\ninterface CpuprobeState { a: number; b: number; sp: number }\n";
  const directory = mkdtempSync(join(tmpdir(), "dromaios-action-types-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, "probe.ts"); writeFileSync(file, source);
  const checked = spawnSync(process.execPath, [resolve("node_modules/typescript/bin/tsc"),
    "--ignoreConfig", "--strict", "--noEmit", "--skipLibCheck", "--target", "es2022", file], { encoding: "utf8" });
  assert.equal(checked.status, 0, checked.stdout + checked.stderr);
});
