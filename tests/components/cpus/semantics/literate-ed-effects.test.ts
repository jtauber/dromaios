import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import { checkByteExecution } from "../../../../src/components/cpus/semantics/literate/execution.js";
import { ChapterError } from "../../../../src/components/cpus/semantics/literate/document.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";

const markdown = `A minimal Z80 state exercises fixed shifts, constant predicates, and retirement requests.

\`\`\`cpu
cpu "z80"
state {
  register A: 8
  register B: 8
}
source enabled "selected constant": 8 {
  return u8(1)
}
\`\`\`

Capture the byte, shift it, and only then request notification.

\`\`\`cpu
family shift "0000 0000" {
  original = register A
  result = shiftBits(original, left, 4)
  A <- result
  selected = source enabled
  when not(zero(selected)) {
    B <- u8(1)
  }
  notify reti
}
\`\`\``;
const compile = (text = markdown) => compileCpuChapter(text, {}, "effects.md");

async function executable(text: string) {
  const definitions = Object.fromEntries(Object.values(compile(text).families).flat());
  const code = generateInstructions("z80", definitions);
  const module: { instructions: Record<number, (state: { a: number; b: number }, context: { notifyReti(): void }) => void> } =
    await import(`data:text/javascript,${encodeURIComponent(stripTypeScriptTypes(code))}`);
  return { execute: module.instructions[0]!, code };
}

test("fixed shifts include zero/full width, and notification follows completed effects", async () => {
  for (const direction of ["left", "right"]) for (const count of [0, 4, 8]) {
    const { execute, code } = await executable(markdown.replace("left, 4", `${direction}, ${count}`));
    assert.match(code, /const \w+_selected: number = 0x1;/);
    for (let byte = 0; byte < 256; byte++) {
      const state = { a: byte, b: 0 }, expected = direction === "left" ? byte * 2 ** count % 256 : Math.floor(byte / 2 ** count);
      let notified = 0;
      execute(state, { notifyReti() { notified++; assert.deepEqual(state, { a: expected, b: 1 }); } });
      assert.equal(notified, 1);
    }
    const state = { a: 0x81, b: 0 }, failure = new Error("notification failure");
    assert.throws(() => execute(state, { notifyReti() { throw failure; } }), error => error === failure);
    assert.equal(state.b, 1);
  }
  const { execute } = await executable(markdown.replace("return u8(1)", "return u8(0)"));
  const state = { a: 1, b: 0 }; execute(state, { notifyReti() {} }); assert.equal(state.b, 0);
});

test("shift and notification diagnostics preserve chapter locations and capability boundaries", () => {
  for (const [before, after, diagnostic] of [
    ["left, 4", "around, 4", /direction/], ["left, 4", "left, 9", /constant count/],
    ["left, 4", "left, original", /number/], ["notify reti", "notify irq", /reti/],
    ['family shift "0000 0000"', 'action shift "state action" ()', /state|effect/],
    ['family shift "0000 0000"', 'action shift "memory action" () using memory', /state|effect/],
  ] as const) assert.throws(() => compile(markdown.replace(before, after)), error =>
    error instanceof ChapterError && error.file === "effects.md" && error.line > 1 && diagnostic.test(error.message));
  assert.throws(() => compile(markdown.replace('cpu "z80"', 'cpu "other"')), /requires the Z80 boundary/);
  assert.throws(() => checkByteExecution(compile().families.shift![0]![1].steps), /does not support notify-reti/);
});
