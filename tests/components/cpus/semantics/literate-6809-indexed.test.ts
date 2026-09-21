import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { instructions } from "../../../../src/components/cpus/generated/6809.js";
import type { Cpu6809State } from "../../../../src/components/cpus/state/6809.js";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";

const state = (): Cpu6809State => ({ a: 0x80, b: 0xff, x: 0xffff, y: 0x1234, s: 0xffff, u: 0x4567, dp: 0,
  pc: 0x200, waitMode: "none", nmiArmed: false,
  flags: { e: true, f: false, h: true, i: false, n: true, z: false, v: true, c: false } });
interface Context { fetchByte(): number; readByte(address: number): number }
const file = "src/components/cpus/specifications/6809.md", markdown = readFileSync(file, "utf8");
async function reader(text: string) {
  const chapter = compileCpuChapter(text, {}, file);
  const source = generateInstructions("6809", {}, { sources: { cpu: { name: "6809", state: chapter.state! },
    groups: { addresses: { indexed: chapter.sources.indexed! } } } });
  const javascript = stripTypeScriptTypes(source).replace('"../alu.ts"',
    JSON.stringify(new URL("../../../../src/components/cpus/alu.js", import.meta.url).href));
  const module: { sourceReaders(state: Cpu6809State): { addresses: { indexed(context: Context): number | "unsupported" } } } =
    await import(`data:text/javascript,${encodeURIComponent(javascript)}`);
  return module.sourceReaders;
}

const sourceReaders = await reader(markdown);

test("the chapter decoder accepts exactly 217 indexed postbytes and invalid modes stop after one fetch", () => {
  // Independent hardware mode inventory, not derived from the chapter's pattern expansion.
  const modes = new Set([0, 1, 2, 3, 4, 5, 6, 8, 9, 11, 12, 13]);
  let accepted = 0;
  for (let postbyte = 0; postbyte < 256; postbyte++) {
    const current = state(), before = structuredClone(current), accesses: string[] = [];
    const valid = postbyte < 128 || postbyte === 0x9f || (modes.has(postbyte % 16)
      && !(postbyte & 0x10 && (postbyte % 16 === 0 || postbyte % 16 === 2)));
    const result = sourceReaders(current).addresses.indexed({
      fetchByte() { accesses.push("fetch"); return accesses.length === 1 ? postbyte : 0; },
      readByte(address) { accesses.push(`read ${address}`); return 0; },
    });
    assert.equal(typeof result === "number", valid, `postbyte ${postbyte.toString(16)}`);
    if (valid) accepted++;
    else { assert.deepEqual(accesses, ["fetch"]); assert.deepEqual(current, before); }
    assert.deepEqual(current.flags, before.flags);
  }
  assert.equal(accepted, 217);
});

test("indexed auto-update and NMI arming precede indirect reads, retaining effects at every failure", () => {
  const failure = new Error("access failed");
  for (const failAt of [0, 1, 2, -1]) {
    const current = state(), attempts: string[] = [];
    const access = (label: string) => { attempts.push(label); if (attempts.length - 1 === failAt) throw failure; };
    const run = () => sourceReaders(current).addresses.indexed({
      fetchByte() { access("fetch"); return 0xf1; }, // [,S++]
      readByte(address) {
        assert.equal(current.s, 1); assert.equal(current.nmiArmed, true);
        access(`read ${address}`); return address === 0xffff ? 0x12 : 0x34;
      },
    });
    if (failAt < 0) assert.equal(run(), 0x1234); else assert.throws(run, error => error === failure);
    assert.deepEqual(attempts, ["fetch", "read 65535", "read 0"].slice(0, failAt < 0 ? 3 : failAt + 1));
    assert.deepEqual(current, { ...state(), s: failAt === 0 ? 0xffff : 1, nmiArmed: failAt !== 0 });
  }
});

test("indexed offsets retain the captured base while PC-relative modes read PC after displacement fetching", () => {
  const current = state(); current.x = 0x1000;
  let fetches = 0;
  assert.equal(sourceReaders(current).addresses.indexed({ fetchByte() {
    if (++fetches === 1) return 0x88; // signed byte,X
    current.x = 0x8000; return 0xfe;
  }, readByte() { assert.fail(); } }), 0x0ffe);
  fetches = 0;
  assert.equal(sourceReaders(current).addresses.indexed({ fetchByte() {
    if (++fetches === 1) return 0xcc; // byte,PC; rr ignored
    current.pc = 0; return 0xff;
  }, readByte() { assert.fail(); } }), 0xffff);
  for (let offset = 0; offset < 32; offset++) {
    const actual = sourceReaders(current).addresses.indexed({ fetchByte: () => offset, readByte() { assert.fail(); } });
    assert.equal(actual, (0x8000 + (offset < 16 ? offset : offset - 32)) % 65536);
  }
});

test("formal postbyte and auto-update edits determine decoding without a CPU-name-specific resolver", async () => {
  const edited = await reader(markdown.replace('case "1 xx 0 0000"', 'case "1 xx 0 0111"')
    .replace('operand r <- add(base, u16($0002))', 'operand r <- add(base, u16($0003))'));
  const current = state();
  const context = (postbyte: number) => ({ fetchByte: () => postbyte, readByte() { assert.fail(); } });
  assert.equal(edited(current).addresses.indexed(context(0x80)), "unsupported");
  assert.equal(current.x, 0xffff);
  assert.equal(edited(current).addresses.indexed(context(0x87)), 0xffff); assert.equal(current.x, 0);
  assert.equal(edited(current).addresses.indexed(context(0xe1)), 0xffff);
  assert.equal(current.s, 2); assert.equal(current.nmiArmed, true);
});

test("LEA preserves decoder updates before destination replacement and does not write on rejected postbytes", () => {
  const current = state(); current.s = 0x100;
  instructions[0x30](current, { fetchByte: () => 0xe1, readByte() { assert.fail(); } });
  assert.deepEqual(current, { ...state(), x: 0x100, s: 0x102, nmiArmed: true });
  const before = structuredClone(current);
  assert.equal(instructions[0x32](current, { fetchByte: () => 0xff, readByte() { assert.fail(); } }), "unsupported");
  assert.deepEqual(current, before);
});
