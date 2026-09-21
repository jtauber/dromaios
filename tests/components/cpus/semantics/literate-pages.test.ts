import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import { ChapterError } from "../../../../src/components/cpus/semantics/literate/document.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";

const markdown = `A small CPU with two independent opcode pages.

\`\`\`cpu
cpu "probe"
state {
  register A: 8
}
page first = $20
page second = $30
\`\`\`

Capture the operand and write A.

\`\`\`cpu
family load {
  encoding "0000 0001"
  encoding "0000 0001" on first
  encoding "0000 001x" on second except "0000 0011"
  byte = fetch
  A <- byte
}
\`\`\``;
const compile = (text = markdown) => compileCpuChapter(text, {}, "pages.md");
type Handler = (context: { fetchByte(): number }) => void | "unsupported";
type State = { a: number };
async function executable(text = markdown, selected?: readonly number[]) {
  const chapter = compile(text), definitions = Object.fromEntries(Object.values(chapter.families).flat());
  const code = generateInstructions("probe", definitions, { bindOpcodes: selected ?? true, pages: chapter.pages });
  const javascript = stripTypeScriptTypes(code).replace('"../opcodes.ts"',
    JSON.stringify(new URL("../../../../src/components/cpus/opcodes.js", import.meta.url).href));
  const module: { opcodeEntries(state: State, additional?: Partial<Record<"first" | "second", readonly (readonly [number, Handler])[]>>): readonly (readonly [number, Handler])[] } =
    await import(`data:text/javascript,${encodeURIComponent(javascript)}`);
  return module.opcodeEntries;
}

test("named pages isolate opcode spaces and fetch the following opcode exactly once", async () => {
  const entries = await executable(), state = { a: 0x42 };
  assert.deepEqual(compile().pages, { first: 0x20, second: 0x30 });
  assert.deepEqual(Object.values(compile().families).flat().map(([opcode]) => opcode), [1, 0x2001, 0x3002]);
  const handlers = Object.fromEntries(entries(state));
  assert.deepEqual(Object.keys(handlers).map(Number), [1, 0x20, 0x30]);
  for (const prefix of [0x20, 0x30]) for (let opcode = 0; opcode < 256; opcode++) {
    state.a = 0x42; const bytes = [opcode, 0x77], reads: number[] = [];
    const outcome = handlers[prefix]!({ fetchByte() { const byte = bytes.shift()!; reads.push(byte); return byte; } });
    const valid = opcode === (prefix === 0x20 ? 1 : 2);
    assert.equal(outcome, valid ? undefined : "unsupported");
    assert.equal(state.a, valid ? 0x77 : 0x42);
    assert.deepEqual(reads, valid ? [opcode, 0x77] : [opcode]);
  }
  handlers[1]!({ fetchByte: () => 0x55 }); assert.equal(state.a, 0x55);
});

test("prefix and operand failures retain completed effects, and extra page bodies cannot override generated ones", async () => {
  const entries = await executable(), state = { a: 1 }, failure = new Error("fetch failed");
  let reads = 0;
  const handlers = Object.fromEntries(entries(state, { first: [[3, () => { state.a = 0x99; }]] }));
  handlers[0x20]!({ fetchByte: () => 3 }); assert.equal(state.a, 0x99);
  for (const failAt of [0, 1]) {
    reads = 0;
    assert.throws(() => handlers[0x20]!({ fetchByte() { if (reads++ === failAt) throw failure; return 1; } }), error => error === failure);
    assert.equal(reads, failAt + 1); assert.equal(state.a, 0x99);
  }
  assert.throws(() => entries(state, { first: [[1, () => {}]] }), /Duplicate opcode/);
  assert.throws(() => entries(state, { first: [[256, () => {}]] }), /opcode/);
  const edited = await executable(markdown.replace("page first = $20", "page first = $40"));
  const changed = Object.fromEntries(edited(state));
  assert.equal(changed[0x20], undefined); assert.equal(typeof changed[0x40], "function");
  const selected = Object.fromEntries((await executable(markdown, [0x2001]))(state));
  assert.equal(selected[1], undefined);
  assert.equal(selected[0x30]!({ fetchByte: () => 2 }), "unsupported");
});

test("page declarations and encodings diagnose unknown names, duplicate slots, invalid widths, and prefix collisions", () => {
  for (const [from, to, diagnostic] of [
    ["page first = $20", "page first = $00", /from \$01 through \$FF/],
    ["page first = $20", "page first = $100", /from \$01 through \$FF/],
    ["page second = $30", "page second = $20", /Duplicate opcode page prefix/],
    ["page second = $30", "page first = $30", /Duplicate declaration/],
    ["on first", "on missing", /Unknown name/],
    ['encoding "0000 0001" on first', 'encoding "0000 0001"', /Duplicate opcode/],
    ["page first = $20", "page first = $01", /collides with a base opcode/],
    ['encoding "0000 0001" on first', 'encoding "00000000 00000001" on first', /eight-bit/],
    ['except "0000 0011"', 'except "0000 001x"', /at least one instruction/],
  ] as const) assert.throws(() => compile(markdown.replace(from, to)), (error: unknown) =>
    error instanceof ChapterError && error.file === "pages.md" && error.line > 1 && diagnostic.test(error.message));
  const word = markdown.replace('page first = $20\npage second = $30\n', '')
    .replace('encoding "0000 0001"\n  encoding "0000 0001" on first\n  encoding "0000 001x" on second except "0000 0011"', 'encoding "00100000 00000001"');
  compile(word);
  assert.throws(() => compile(word + '\n```cpu\npage first = $20\n```'), /Word opcode patterns/);
});

test("generation validates page bindings independently of the chapter parser", () => {
  const chapter = compile(), definitions = Object.fromEntries(Object.values(chapter.families).flat());
  const invalid: readonly Readonly<Record<string, number>>[] = [{ first: 0 }, { first: 256 }, { first: 1.5 }, { first: 1 }, { first: 32, second: 32 }, { "bad-name": 32 }];
  for (const pages of invalid) {
    assert.throws(() => generateInstructions("probe", definitions, { bindOpcodes: true, pages }), /Opcode pages|opcode page prefix/);
  }
  assert.throws(() => generateInstructions("probe", definitions, { pages: chapter.pages }), /require execution bindings/);
  assert.throws(() => generateInstructions("probe", definitions, { bindOpcodes: true, pages: { first: 32 } }), /no declared page/);
});
