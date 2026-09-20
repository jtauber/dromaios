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

const file = "src/components/cpus/specifications/6809.md", markdown = readFileSync(file, "utf8");
const chapter = compileCpuChapter(markdown, { name: "6809" }, file);
const state = (): Cpu6809State => ({ a: 0x55, b: 0xaa, dp: 0xff, x: 0x8000, y: 0x1234, s: 0xff, u: 0x8001,
  pc: 0x200, waitMode: "none", nmiArmed: true,
  flags: { e: true, f: true, h: true, i: false, n: true, z: true, v: true, c: true } });
interface Context { fetchByte(): number; readByte(address: number): number; writeByte(address: number, byte: number): void }
type Body = (state: Cpu6809State, context: Context) => void;
const unexpected = (): never => { throw new Error("Unexpected access"); };

// Literal base-page inventory, independent of chapter selectors and Motorola builders.
const opcodes = [
  0x80, 0x81, 0x82, 0x83, 0x84, 0x85, 0x86, 0x88, 0x89, 0x8a, 0x8b, 0x8c, 0x8e,
  0x90, 0x91, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0x9b, 0x9c, 0x9e, 0x9f,
  0xb0, 0xb1, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xbb, 0xbc, 0xbe, 0xbf,
  0xc0, 0xc1, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc8, 0xc9, 0xca, 0xcb, 0xcc, 0xce,
  0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xdb, 0xdc, 0xdd, 0xde, 0xdf,
  0xf0, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa, 0xfb, 0xfc, 0xfd, 0xfe, 0xff,
];

async function bodies(text: string): Promise<Readonly<Record<number, Body>>> {
  const compiled = compileCpuChapter(text, { name: "6809" }, file);
  const source = generateInstructions("6809", Object.fromEntries(Object.values(compiled.families).flat()));
  const alu = new URL("../../../../src/components/cpus/alu.js", import.meta.url).href;
  const javascript = stripTypeScriptTypes(source).replace('"../alu.ts"', JSON.stringify(alu));
  return (await import(`data:text/javascript,${encodeURIComponent(javascript)}`)).instructions;
}

test("the 6809 chapter owns its full schema and exactly 88 immediate/direct/extended forms", () => {
  const expected = defineState({ a: unsigned(8), b: unsigned(8), dp: unsigned(8), x: unsigned(16), y: unsigned(16),
    s: unsigned(16), u: unsigned(16), pc: unsigned(16), waitMode: namedChoices("none", "sync", "cwai"), nmiArmed: boolean,
    flags: group({ e: flag, f: flag, h: flag, i: flag, n: flag, z: flag, v: flag, c: flag }) });
  assert.deepEqual(chapter.state, expected); assert.deepEqual(cpu6809StateDescription, expected);
  assert.deepEqual(Object.keys(cpu6809StateDescription), Object.keys(expected));
  assert.equal(opcodes.length, 88);
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

test("all migrated forms retain old state on a failed operand access, including partial stores", () => {
  for (const opcode of opcodes) {
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
