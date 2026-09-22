import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { registerUpdates } from "../../../../src/components/cpus/register-updates.js";
import type { RegisterUpdateContext } from "../../../../src/components/cpus/register-updates.js";
import type { Cpu68000State } from "../../../../src/components/cpus/state/68000.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import { initialState } from "../../../helpers/68000-state.js";

const file = "src/components/cpus/specifications/68000.md", markdown = readFileSync(file, "utf8");
type Context = RegisterUpdateContext & { fetchWord(): number; nextAddress(): number };
type Decoder = (size: number, mode: number, code: number, context: Context) => number | "unsupported";
async function edited(replacements: readonly (readonly [string, string])[]) {
  let text = markdown;
  for (const [before, after] of replacements) { assert.ok(text.includes(before), before); text = text.replace(before, after); }
  const chapter = compileCpuChapter(text, {}, file);
  const source = generateInstructions("68000", {}, { sources: {
    cpu: { name: "68000", state: chapter.state! }, groups: { sources: { effectiveAddress: chapter.sources.effectiveAddress! } },
  } });
  const javascript = stripTypeScriptTypes(source).replace('"../alu.ts"', JSON.stringify(new URL("../../../../src/components/cpus/alu.js", import.meta.url).href));
  const module: { sourceReaders(state: Cpu68000State): { sources: { effectiveAddress: Decoder } } } =
    await import(`data:text/javascript,${encodeURIComponent(javascript)}`);
  return (state: Cpu68000State) => module.sourceReaders(state).sources.effectiveAddress;
}

function context(words: readonly number[] = []) {
  let cursor = 0x100, word = 0;
  return { ...registerUpdates(), nextAddress: () => cursor,
    fetchWord: () => { assert.ok(word < words.length, "Unexpected extension fetch"); cursor += 2; return words[word++]!; } };
}

test("chapter edits change A7 bank selection, byte stepping, and signed index interpretation", async () => {
  const readers = await edited([
    ["return add(u8(7), bank)", "return u8(7)"],
    ["u32(2), extend(bytes, 32)", "u32(4), extend(bytes, 32)"],
    ["signExtend(truncate(index, 16), 32)", "extend(truncate(index, 16), 32)"],
  ]);
  const state = initialState(0); state.flags.s = true; state.usp = 0x200; state.ssp = 0x800;
  const resolve = readers(state), pending = context();
  assert.equal(resolve(8, 3, 7, pending), 0x200); // Authored bank selection chooses USP even with S set.
  assert.equal(resolve(8, 2, 7, pending), 0x204); // Authored byte stride is now four.
  assert.equal(state.usp, 0x200); pending.commit();
  assert.equal(state.usp, 0x204); assert.equal(state.ssp, 0x800);
  state.a0 = 0; state.d0 = 0x8000;
  assert.equal(resolve(32, 6, 0, context([0])), 0x8000); // Edited word index is zero-extended.
});

test("chapter edits change absolute-word extension and the PC-relative base's capture order", async () => {
  const readers = await edited([
    ["return signExtend(absolute, 32)", "return extend(absolute, 32)"],
    ["basePc = next address\n          displacement = fetch word", "displacement = fetch word\n          basePc = next address"],
  ]);
  const resolve = readers(initialState(0));
  assert.equal(resolve(32, 7, 0, context([0xffff])), 0xffff);
  assert.equal(resolve(32, 7, 2, context([4])), 0x106);
});

test("changing a chapter stage to a stored write changes visibility before the native commit", async () => {
  const readers = await edited([["stage operand r <- contents", "operand r <- contents"]]);
  const state = initialState(0); state.a0 = 0x100;
  const resolve = readers(state), pending = context();
  assert.equal(resolve(32, 3, 0, pending), 0x100);
  assert.equal(state.a0, 0x104);
  assert.equal(resolve(32, 2, 0, pending), 0x104);
  state.a0 = 0x200; pending.commit();
  assert.equal(state.a0, 0x200); // The edited action left no staged write to replay.
});
