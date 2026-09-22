import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { registerUpdates } from "../../../../src/components/cpus/register-updates.js";
import type { RegisterUpdateContext } from "../../../../src/components/cpus/register-updates.js";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import { ChapterError } from "../../../../src/components/cpus/semantics/literate/document.js";
import { describeInstruction } from "../../../../src/components/cpus/semantics/describe.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";

const chapter = (declarations: string) => `A different processor uses the same pending-register mechanism.
\`\`\`cpu
cpu "staging"
state {
  register A: 8
  register B: 8
  group AUX {
    register A: 8
  }
}
${declarations}
\`\`\``;
const compile = (declarations: string) => compileCpuChapter(chapter(declarations), {}, "staging.md");

test("staging works for a different CPU, selected registers, nested fields, and contextual local names", async () => {
  const result = compile(`operands bytes {
  0 "A" = register A
  1 "B" = register B
}
action update "stage register A" (contents: 8) using staging {
  stage A <- contents
  stage AUX.A <- u8(9)
}
family nextByte "0000000r" for r in bytes {
  original = pending operand r
  stage = u8(1)
  pending = add(original, stage)
  stage operand r <- pending
  staged = pending operand r
  perform update(staged)
}`);
  const definitions = Object.fromEntries(result.families.nextByte!);
  const source = generateInstructions("staging", definitions);
  assert.match(source, /Pick<.*RegisterUpdateContext, "readPendingRegister" \| "stageRegister">/);
  const javascript = stripTypeScriptTypes(source).replace('"../alu.ts"', JSON.stringify(new URL("../../../../src/components/cpus/alu.js", import.meta.url).href));
  const module: { instructions: Record<number, (state: { a: number; b: number; aux: { a: number } }, context: RegisterUpdateContext) => void> } =
    await import(`data:text/javascript,${encodeURIComponent(javascript)}`);
  const state = { a: 3, b: 7, aux: { a: 2 } }, updates = registerUpdates();
  module.instructions[1]!(state, updates);
  module.instructions[1]!(state, updates);
  assert.deepEqual(state, { a: 3, b: 7, aux: { a: 2 } });
  updates.commit();
  assert.deepEqual(state, { a: 9, b: 9, aux: { a: 9 } });
  const explanation = describeInstruction(definitions[1]!);
  assert.match(explanation, /pending B, or read stored register if unstaged/);
  assert.match(explanation, /stage B:u8 := pending; preserve stored state until commit/);
});

test("staging rejects wrong widths and non-register operands, and cannot hide inside views or undeclared action effects", () => {
  const failures = [
    'family bad "00000000" {\n  stage A <- u16(1)\n}',
    'family bad "00000000" {\n  value = pending register MISSING\n}',
    'view BAD "bad" : 8 {\n  value = pending register A\n  return value\n}',
    'action bad "bad" {\n  stage A <- u8(1)\n}',
    'action bad "bad" using boundary, memory {\n  value = pending register A\n}',
    'source hidden "hidden" : 8 {\n  stage A <- u8(1)\n  return u8(1)\n}\nview BAD "bad" : 8 {\n  value = source hidden\n  return value\n}',
    'action hidden "hidden" using staging {\n  stage A <- u8(1)\n}\naction bad "bad" {\n  perform hidden()\n}',
    'action bad "bad" using staging {\n  byte = fetch\n}',
  ];
  for (const effect of ['stage operand r <- u8(1)', 'value = pending operand r']) failures.push(`codes values {
  0 "zero"
  1 "one"
}
family bad "0000000r" for r in values {
  ${effect}
}`);
  for (const text of failures) assert.throws(() => compile(text), error => error instanceof ChapterError
    && error.file === "staging.md" && error.line > 0 && error.column > 0, text);
});
