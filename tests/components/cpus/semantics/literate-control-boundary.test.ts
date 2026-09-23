import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import { ChapterError } from "../../../../src/components/cpus/semantics/literate/document.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";
import type { TargetAlignmentFault } from "../../../../src/components/cpus/word-execution.js";

const chapter = (body: string, name = "68000") => `Control boundaries remain ordered instruction effects.
\`\`\`cpu
cpu "${name}"${name === "68000" ? " boundary word" : ""}
state {
  register PC: 32
  register D0: 32
}
family probe "0100 1110 0111 0000" {
${body}
}
\`\`\``;
const body = `  next = next address
  offset = fetch word
  target = add(next, signExtend(offset, 32))
  D0 <- u32(1)
  fault alignment fetch(target) if lowBit(target)
  select target(target)
  cursor = next address
  PC <- cursor
  D0 <- u32(2)
  reset devices
  reset = u32(3)
  select = reset
  D0 <- select`;
const compile = (text: string) => compileCpuChapter(text, {}, "control.md");
interface State { pc: number; d0: number }
interface Context { nextAddress(): number; fetchWord(): number; jump(target: number): void; resetDevices(): void }
async function executable() {
  const definitions = Object.fromEntries(Object.values(compile(chapter(body)).families).flat());
  const source = stripTypeScriptTypes(generateInstructions("68000", definitions))
    .replace('"../alu.ts"', JSON.stringify(new URL("../../../../src/components/cpus/alu.js", import.meta.url).href));
  const module: { instructions: Record<number, (state: State, context: Context) => TargetAlignmentFault | void> } =
    await import(`data:text/javascript,${encodeURIComponent(source)}`);
  return module.instructions[0x4e70]!;
}

test("literate cursor, target, and device reset effects preserve distinct addresses and partial failures", async () => {
  const run = await executable(), failure = Error("callback failed");
  for (const offset of [0, 1, 0xfffe]) for (const failAt of [-1, 0, 1, 2, 3, 4]) {
    const state = { pc: 0x1000, d0: 0 }, events: unknown[][] = [];
    let cursor = 0xfffffffe, target: number | undefined;
    const record = (...event: unknown[]) => { events.push(event); if (events.length - 1 === failAt) throw failure; };
    let outcome: TargetAlignmentFault | void, thrown = false;
    try {
      outcome = run(state, {
        nextAddress() { record("cursor", cursor); return cursor; },
        fetchWord() { record("fetch", cursor); cursor = 0; return offset; },
        jump(address) { record("target", address); target = address; },
        resetDevices() { record("reset"); },
      });
    } catch (error) { assert.equal(error, failure); thrown = true; }
    const expectedTarget = (0xfffffffe + (offset < 0x8000 ? offset : offset - 0x10000)) >>> 0;
    const expected: unknown[][] = [["cursor", 0xfffffffe], ["fetch", 0xfffffffe]];
    if (offset !== 1) expected.push(["target", expectedTarget], ["cursor", 0], ["reset"]);
    const failed = failAt >= 0 && failAt < expected.length;
    assert.deepEqual(events, failed ? expected.slice(0, failAt + 1) : expected);
    assert.equal(thrown, failed);
    assert.deepEqual(outcome!, !failed && offset === 1 ? { operation: "fetch", address: expectedTarget } : undefined);
    assert.equal(target, offset !== 1 && (!failed || failAt > 2) ? expectedTarget : undefined);
    assert.deepEqual(state, failed && failAt < 2 ? { pc: 0x1000, d0: 0 }
      : offset === 1 || failed && failAt < 4 ? { pc: 0x1000, d0: 1 }
      : { pc: 0, d0: failed ? 2 : 3 });
  }
});

test("literate control boundaries reject wrong widths, contexts, and hidden lifecycle effects at document locations", () => {
  const invalid = [
    chapter("  cursor = next address", "probe"),
    chapter("  select target(u32(0))", "probe"),
    chapter("  reset devices", "probe"),
    chapter("  select target(u16(0))"),
    chapter("  fault alignment fetch(u16(1)) if 1"),
    chapter("  fault alignment program write(u32(1)) if 1"),
    chapter("  select target(missing)"),
  ];
  for (const effect of ["cursor = next address", "select target(u32(0))", "reset devices"]) {
    for (const declaration of ['view V "hidden" : 32', 'action hidden "hidden" using memory, boundary']) {
      invalid.push(chapter("").replace('family probe "0100 1110 0111 0000" {', declaration + " {")
        .replace("\n\n}", `\n  when 0 {\n    ${effect}\n  }\n${declaration.startsWith('view') ? '  return u32(0)\n' : ''}}`));
    }
  }
  for (const text of invalid) assert.throws(() => compile(text), error => error instanceof ChapterError
    && error.file === "control.md" && error.line > 0 && error.column > 0, text);
  assert.throws(() => compile(chapter("").replace('family probe "0100 1110 0111 0000" {', 'source hidden "hidden" : 32 {')
    .replace("\n\n}", "\n  fault alignment fetch(u32(1)) if 1\n  return u32(0)\n}")), /cannot reject/);
});
