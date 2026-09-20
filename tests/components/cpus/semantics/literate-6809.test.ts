import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { boolean, defineState, flag, group, namedChoices, unsigned } from "../../../../src/components/cpus/state.js";
import { cpu6809StateDescription } from "../../../../src/components/cpus/state/6809.js";
import type { Cpu6809State } from "../../../../src/components/cpus/state/6809.js";
import { chapter6809 } from "../../../../src/components/cpus/semantics/definitions/6809.js";
import { instructions } from "../../../../src/components/cpus/generated/6809-base.js";
import { instructions as actions, sourceReaders } from "../../../../src/components/cpus/generated/6809-state.js";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";
import { ChapterError } from "../../../../src/components/cpus/semantics/literate/document.js";

const file = "src/components/cpus/specifications/6809.md", markdown = readFileSync(file, "utf8");
const chapter = compileCpuChapter(markdown, { name: "6809" }, file);
const state = (): Cpu6809State => ({ a: 0x55, b: 0xaa, dp: 0xff, x: 0x8000, y: 0x1234, s: 0xff, u: 0x8001,
  pc: 0x200, waitMode: "none", nmiArmed: true,
  flags: { e: true, f: true, h: true, i: false, n: true, z: true, v: true, c: true } });
interface Context { fetchByte(): number; readByte(address: number): number; writeByte(address: number, byte: number): void }
type Body = (state: Cpu6809State, context: Context) => void;
const unexpected = (): never => { throw new Error("Unexpected access"); };

// Literal base-page inventory, independent of chapter selectors and Motorola builders.
const operandOpcodes = [
  0x80, 0x81, 0x82, 0x83, 0x84, 0x85, 0x86, 0x88, 0x89, 0x8a, 0x8b, 0x8c, 0x8e,
  0x90, 0x91, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0x9b, 0x9c, 0x9e, 0x9f,
  0xb0, 0xb1, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xbb, 0xbc, 0xbe, 0xbf,
  0xc0, 0xc1, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc8, 0xc9, 0xca, 0xcb, 0xcc, 0xce,
  0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xdb, 0xdc, 0xdd, 0xde, 0xdf,
  0xf0, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa, 0xfb, 0xfc, 0xfd, 0xfe, 0xff,
];

const controlOpcodes = [
  0x00, 0x03, 0x04, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0c, 0x0d, 0x0e, 0x0f,
  0x12, 0x16, 0x17, 0x19, 0x1a, 0x1c, 0x1d,
  0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x2b, 0x2c, 0x2d, 0x2e, 0x2f,
  0x39, 0x3a, 0x3d,
  0x40, 0x43, 0x44, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x4c, 0x4d, 0x4f,
  0x50, 0x53, 0x54, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x5c, 0x5d, 0x5f,
  0x70, 0x73, 0x74, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x7c, 0x7d, 0x7e, 0x7f,
  0x8d, 0x9d, 0xbd,
];
const opcodes = [...operandOpcodes, ...controlOpcodes].sort((a, b) => a - b);

async function bodies(text: string): Promise<Readonly<Record<number, Body>>> {
  const compiled = compileCpuChapter(text, { name: "6809" }, file);
  const source = generateInstructions("6809", Object.fromEntries(Object.values(compiled.families).flat()));
  const alu = new URL("../../../../src/components/cpus/alu.js", import.meta.url).href;
  const javascript = stripTypeScriptTypes(source).replace('"../alu.ts"', JSON.stringify(alu));
  return (await import(`data:text/javascript,${encodeURIComponent(javascript)}`)).instructions;
}

test("the 6809 chapter owns its full schema and exactly 163 base-page forms", () => {
  const expected = defineState({ a: unsigned(8), b: unsigned(8), dp: unsigned(8), x: unsigned(16), y: unsigned(16),
    s: unsigned(16), u: unsigned(16), pc: unsigned(16), waitMode: namedChoices("none", "sync", "cwai"), nmiArmed: boolean,
    flags: group({ e: flag, f: flag, h: flag, i: flag, n: flag, z: flag, v: flag, c: flag }) });
  assert.deepEqual(chapter.state, expected); assert.deepEqual(cpu6809StateDescription, expected);
  assert.deepEqual(Object.keys(cpu6809StateDescription), Object.keys(expected));
  assert.equal(operandOpcodes.length, 88); assert.equal(controlOpcodes.length, 75);
  assert.equal(opcodes.length, 163);
  assert.deepEqual(Object.keys(chapter6809).map(Number).sort((a, b) => a - b), opcodes);
  assert.deepEqual(Object.fromEntries(Object.values(chapter.families).flat()), chapter6809);
  assert.equal(chapter.execution, undefined); assert.equal(chapter.interface, undefined);
});

test("D captures A then B, writes A then B, and CC packs and restores every bit", () => {
  const current = state(), effects: string[] = [];
  let a = 0x12, b = 0x34;
  Object.defineProperties(current, {
    a: { get() { effects.push("read A"); return a; }, set(value: number) { effects.push("write A"); a = value; } },
    b: { get() { effects.push("read B"); return b; }, set(value: number) { effects.push("write B"); b = value; } },
  });
  assert.equal(sourceReaders(current).views.D(), 0x1234);
  actions.writeD(current, 0x5678);
  assert.deepEqual(effects, ["read A", "read B", "write A", "write B"]);
  assert.equal(a, 0x56); assert.equal(b, 0x78);
  const flags = ["c", "v", "z", "n", "i", "h", "f", "e"] as const;
  for (let status = 0; status < 256; status++) {
    for (const [bit, name] of flags.entries()) current.flags[name] = !!(status & (1 << bit));
    const before = { ...current.flags }, original = current.flags;
    assert.equal(sourceReaders(current).views.CC(), status);
    actions.maskCC(current, 0);
    assert.deepEqual(current.flags, before); assert.notEqual(current.flags, original);
    actions.maskCC(current, 0x50);
    assert.equal(sourceReaders(current).views.CC(), status | 0x50);
  }
});

test("direct words fetch before reading DP and retain their address across both data reads", () => {
  for (const page of [0x12, 0xff]) {
    const current = state(), reads: number[] = [];
    instructions[0xdc](current, {
      fetchByte() { current.dp = page; return 0xff; },
      readByte(address) { reads.push(address); current.dp = 0x56; current.a = 0; return reads.length === 1 ? 0x80 : 0; },
    });
    assert.deepEqual(reads, [(page << 8) | 0xff, ((page + 1) << 8) & 0xffff]);
    assert.equal(current.a, 0x80); assert.equal(current.b, 0); assert.equal(current.dp, 0x56);
    assert.deepEqual(current.flags, { ...state().flags, n: true, z: false, v: false });
  }
});

test("word stores capture address and D once, then update flags after both high-first writes", () => {
  const current = state(), writes: [number, number][] = [], before = { ...current.flags };
  instructions[0xfd](current, { fetchByte: () => 0xff,
    writeByte(address, value) {
      assert.deepEqual(current.flags, before);
      writes.push([address, value]); current.a = 0; current.b = 0; current.dp = 0;
    } });
  assert.deepEqual(writes, [[0xffff, 0x55], [0, 0xaa]]);
  assert.equal(current.a, 0); assert.equal(current.b, 0);
  assert.deepEqual(current.flags, { ...before, n: false, z: false, v: false });
});

test("CMPX uses whole-word subtraction flags, unlike the earlier 6800", () => {
  const current = state(), fetched = [0, 1];
  instructions[0x8c](current, { fetchByte: () => fetched.shift()! });
  assert.equal(current.x, 0x8000);
  assert.deepEqual(current.flags, { ...state().flags, n: false, z: false, v: true, c: false });
});

test("chapter edits change direct addressing and the D view consumed by instruction bodies", async () => {
  const changed = await bodies(markdown.replace("page = register DP", "page = u8($56)")
    .replace("return concat(high, low)", "return concat(low, high)"));
  const current = state(), writes: [number, number][] = [];
  changed[0xdd]!(current, { fetchByte: () => 0xff, readByte: unexpected, writeByte: (address, value) => { writes.push([address, value]); } });
  assert.deepEqual(writes, [[0x56ff, 0xaa], [0x5700, 0x55]]);
});

test("operand families retain old state on a failed operand access, including partial stores", () => {
  for (const opcode of operandOpcodes) {
    const execute: Body = instructions[opcode as keyof typeof instructions];
    const baselineAccesses: [string, number?][] = [];
    execute(state(), { fetchByte() { baselineAccesses.push(["fetch"]); return 0xff; },
      readByte(address) { baselineAccesses.push(["read", address]); return 0x80; },
      writeByte(address) { baselineAccesses.push(["write", address]); } });
    for (let failAt = 0; failAt < baselineAccesses.length; failAt++) {
      const current = state(), attempts: [string, number?][] = [], writes: [number, number][] = [];
      const fail = new Error("injected");
      const access = (kind: string, address?: number) => {
        attempts.push(address === undefined ? [kind] : [kind, address]);
        if (attempts.length - 1 === failAt) throw fail;
      };
      assert.throws(() => execute(current, {
        fetchByte() { access("fetch"); return 0xff; },
        readByte(address) { access("read", address); return 0x80; },
        writeByte(address, value) { access("write", address); writes.push([address, value]); },
      }), error => error === fail);
      assert.deepEqual(current, state(), `opcode ${opcode}, access ${failAt}`);
      assert.deepEqual(attempts, baselineAccesses.slice(0, failAt + 1));
      assert.equal(writes.length, baselineAccesses.slice(0, failAt).filter(([kind]) => kind === "write").length);
    }
  }
});

test("chapter unary policies expose preserved V/C and CLR's read before flags and writeback", async () => {
  const changed = await bodies(markdown
    .replace('policy RIGHTFLAGS "6809 right shift" (result: 8, outgoing: flag) {',
      'policy RIGHTFLAGS "6809 right shift" (result: 8, outgoing: flag) {\n  V = 0')
    .replace('policy TESTFLAGS "6809 TST" (result: 8) {', 'policy TESTFLAGS "6809 TST" (result: 8) {\n  C = 0'));
  const normal = state(), edited = state();
  instructions[0x44](normal); changed[0x44]!(edited, { fetchByte: unexpected, readByte: unexpected, writeByte: unexpected });
  assert.equal(normal.flags.v, true); assert.equal(edited.flags.v, false);
  instructions[0x4d](normal); changed[0x4d]!(edited, { fetchByte: unexpected, readByte: unexpected, writeByte: unexpected });
  assert.equal(normal.flags.c, true); assert.equal(edited.flags.c, false);
  for (const failAt of ["read", "write"]) {
    const current = state(), failure = new Error(failAt), accesses: string[] = [];
    assert.throws(() => instructions[0x0f](current, {
      fetchByte: () => 0xff,
      readByte(address) {
        assert.equal(address, 0xffff); accesses.push("read");
        if (failAt === "read") throw failure;
        current.dp = 0; return 0x81;
      },
      writeByte(address, value) {
        assert.equal(address, 0xffff); assert.equal(value, 0); accesses.push("write");
        assert.deepEqual(current.flags, { ...state().flags, n: false, z: true, c: false, v: false });
        throw failure;
      },
    }), error => error === failure);
    assert.deepEqual(accesses, failAt === "read" ? ["read"] : ["read", "write"]);
    if (failAt === "read") assert.deepEqual(current, state());
  }
});

test("formal edits determine decimal correction and signed branch displacement", async () => {
  const changed = await bodies(markdown.replace(', u8($06), u8($00))', ', u8($05), u8($00))')
    .replace('PC <- add(pc, signExtend(offset, 16))', 'PC <- add(pc, extend(offset, 16))'));
  const normal = state(), edited = state();
  for (const current of [normal, edited]) { current.a = 0x9a; current.flags.h = false; current.flags.c = false; }
  instructions[0x19](normal); changed[0x19]!(edited, { fetchByte: unexpected, readByte: unexpected, writeByte: unexpected });
  assert.equal(normal.a, 0); assert.equal(normal.flags.c, true);
  assert.equal(edited.a, 0xff); assert.equal(edited.flags.c, false);
  normal.pc = 1; edited.pc = 1;
  instructions[0x20](normal, { fetchByte: () => 0xff });
  changed[0x20]!(edited, { fetchByte: () => 0xff, readByte: unexpected, writeByte: unexpected });
  assert.equal(normal.pc, 0); assert.equal(edited.pc, 0x100);
});

test("chapter calls retain completed S decrements and returns increment live S only after successful reads", () => {
  const failure = new Error("stack failed");
  for (const failAt of [0, 1, -1]) {
    const current = state(), writes: [number, number][] = [];
    current.s = 0; current.pc = 0x1234; current.nmiArmed = false;
    const call = () => actions.call(current, 0x5678, { writeByte(address, value) {
      const index = writes.length;
      assert.equal(address, index === 0 ? 0xffff : 0xff);
      if (index === failAt) throw failure;
      writes.push([address, value]); current.s = 0x100; current.pc = 0x9999;
    } });
    if (failAt < 0) call(); else assert.throws(call, error => error === failure);
    assert.deepEqual(writes, [[0xffff, 0x34], [0xff, 0x12]].slice(0, failAt < 0 ? 2 : failAt));
    assert.equal(current.s, failAt === 0 ? 0xffff : failAt === 1 ? 0xff : 0x100);
    assert.equal(current.pc, failAt === 0 ? 0x1234 : failAt === 1 ? 0x9999 : 0x5678);
    assert.equal(current.nmiArmed, false); assert.deepEqual(current.flags, state().flags);

    current.s = 0xffff; current.pc = 0x200;
    let reads = 0;
    const pop = () => instructions[0x39](current, { readByte(address) {
      const index = reads++;
      assert.equal(address, index === 0 ? 0xffff : 0x101);
      if (index === failAt) throw failure;
      current.s = 0x100; return index === 0 ? 0x56 : 0x78;
    } });
    if (failAt < 0) pop(); else assert.throws(pop, error => error === failure);
    assert.equal(current.pc, failAt < 0 ? 0x5678 : 0x200);
    assert.equal(current.s, failAt === 0 ? 0xffff : 0x101);
    assert.equal(current.nmiArmed, false); assert.deepEqual(current.flags, state().flags);
  }
});

test("MUL's literate expression yields an unsigned full-width result and retains Markdown diagnostics", async () => {
  const changed = await bodies(markdown.replace('multiply(left, right)', 'multiply(right, right)'));
  const current = state(); current.a = 3; current.b = 5;
  changed[0x3d]!(current, { fetchByte: unexpected, readByte: unexpected, writeByte: unexpected });
  assert.equal(current.a, 0); assert.equal(current.b, 25);
  for (const expression of ['multiply(left, extend(right, 16))', 'multiply(extend(left, 32), extend(right, 32))']) {
    const edited = markdown.replace('multiply(left, right)', expression);
    const line = edited.split("\n").findIndex(line => line.includes(`product = ${expression}`)) + 1;
    assert.throws(() => compileCpuChapter(edited, { name: "6809" }, file), (error: unknown) =>
      error instanceof ChapterError && error.file === file && error.line === line && /equal widths|multiplication requires/.test(error.message));
  }
  const edited = markdown.replace('product = multiply(left, right)', 'product = multiply(extend(left, 16), extend(right, 16))');
  assert.throws(() => compileCpuChapter(edited, { name: "6809" }, file), /expected 16-bit/);

  // The same expression supports a different CPU's word-by-word multiplication.
  const probe = compileCpuChapter('Multiply two unsigned words into a double-width destination.\n\n```cpu\ncpu "probe"\nstate {\n register X: 16\n register Y: 16\n register D: 32\n}\n' +
    'family product "0000 0000" {\n left = register X\n right = register Y\n D <- multiply(left, right)\n}\n```');
  const source = generateInstructions("probe", Object.fromEntries(Object.values(probe.families).flat()));
  const alu = new URL("../../../../src/components/cpus/alu.js", import.meta.url).href;
  const javascript = stripTypeScriptTypes(source).replace('"../alu.ts"', JSON.stringify(alu));
  const compiled: { instructions: Record<number, (state: { x: number; y: number; d: number }) => void> } =
    await import(`data:text/javascript,${encodeURIComponent(javascript)}`);
  const words = { x: 0xffff, y: 0xffff, d: 0 };
  compiled.instructions[0]!(words); assert.equal(words.d, 0xfffe0001);
});
