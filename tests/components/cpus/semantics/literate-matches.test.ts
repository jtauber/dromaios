import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import { ChapterError } from "../../../../src/components/cpus/semantics/literate/document.js";
import { checkByteExecution } from "../../../../src/components/cpus/semantics/literate/execution.js";
import { describeInstruction } from "../../../../src/components/cpus/semantics/describe.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";
import { literal, perform, readPort, readSource, value } from "../../../../src/components/cpus/semantics/model.js";
import type { InstructionDefinition, Statement } from "../../../../src/components/cpus/semantics/model.js";
import { validateInstruction } from "../../../../src/components/cpus/semantics/validate.js";

const markdown = `Match the captured selector, read the selected register, then read memory.

\`\`\`cpu
cpu "probe"
state {
  register A: 8
  register B: 8
  register RESULT: 16
}
operands registers {
  0 "A" = register A
  1 "B" = register B
}
source selected "selected byte": 16 {
  selector = fetch
  result = match selector: 16 {
    case "0 rxx xxxx" for r in registers {
      original = operand r
      operand r <- add(original, u8(1))
      address = extend(original, 16)
      byte = memory(address)
      return concat(original, byte)
    }
    case "1000 xxxx" {
      original = u16($ABCD)
      return original
    }
    otherwise unsupported
  }
  return result
}
family load "0000 0000" {
  result = source selected
  RESULT <- result
}
family repeated "0000 0001" {
  first = source selected
  second = source selected
  RESULT <- second
}
\`\`\``;
const compile = (text = markdown) => compileCpuChapter(text, {}, "match.md");
interface State { a: number; b: number; result: number }
interface Context { fetchByte(): number; readByte(address: number): number }
async function executable(text = markdown) {
  const chapter = compile(text);
  const code = generateInstructions("probe", Object.fromEntries(Object.values(chapter.families).flat()), {
    sources: { cpu: { name: "probe", state: chapter.state! }, groups: { sources: chapter.sources } },
  });
  const javascript = stripTypeScriptTypes(code).replace('"../alu.ts"',
    JSON.stringify(new URL("../../../../src/components/cpus/alu.js", import.meta.url).href));
  const module: { instructions: Record<number, (state: State, context: Context) => void | "unsupported">;
    sourceReaders(state: State): { sources: { selected(context: Context): number | "unsupported" } } } =
    await import(`data:text/javascript,${encodeURIComponent(javascript)}`);
  return { ...module, code };
}

test("byte matches cover every selector with disjoint masks and stop later effects on unsupported input", async () => {
  const { instructions } = await executable();
  for (let selector = 0; selector < 256; selector++) {
    const state = { a: 0xff, b: 0x34, result: 0x1234 }, accesses: string[] = [];
    const outcome = instructions[0]!(state, {
      fetchByte() { accesses.push("fetch"); return selector; },
      readByte(address) { accesses.push(`read ${address}`); return address ^ 0xff; },
    });
    const selected = selector < 64 ? 0xff : 0x34;
    assert.deepEqual(accesses, selector < 128 ? ["fetch", `read ${selected}`] : ["fetch"]);
    assert.deepEqual(state, { a: selector < 64 ? 0 : 0xff, b: selector >= 64 && selector < 128 ? 0x35 : 0x34,
      result: selector < 128 ? selected * 256 + (selected ^ 0xff) : selector < 144 ? 0xabcd : 0x1234 });
    assert.equal(outcome, selector < 144 ? undefined : "unsupported");
  }
});

test("decoder sharing retains fresh captures, live state, source results, and failure propagation", async () => {
  const { instructions, sourceReaders, code } = await executable();
  assert.equal(code.match(/"decode\d+"\(/g)?.length, 1, "one generated decoder serves both bodies and the source reader");
  assert.match(code, /number \| "unsupported"/);
  const state = { a: 1, b: 2, result: 0x1234 }, selectors = [0, 0];
  instructions[1]!(state, { fetchByte: () => selectors.shift()!, readByte: address => address });
  assert.deepEqual(state, { a: 3, b: 2, result: 0x202 });
  const failure = new Error("memory failed");
  assert.throws(() => instructions[0]!(state, { fetchByte: () => 0, readByte() { throw failure; } }), e => e === failure);
  assert.deepEqual(state, { a: 4, b: 2, result: 0x202 });
  assert.equal(sourceReaders(state).sources.selected({ fetchByte: () => 255, readByte() { assert.fail(); } }), "unsupported");
  assert.throws(() => instructions[0]!(state, { fetchByte() { throw failure; }, readByte() { assert.fail(); } }), e => e === failure);
  assert.deepEqual(state, { a: 4, b: 2, result: 0x202 });
  const picks = [0, 255];
  assert.equal(instructions[1]!(state, { fetchByte: () => picks.shift()!, readByte: () => 0 }), "unsupported");
  assert.deepEqual(state, { a: 5, b: 2, result: 0x202 }, "completed first source effects survive rejection of the second");
});

test("nested matches keep outer captures and reject overlap, wrong widths, escaping locals, and incomplete cases at Markdown lines", () => {
  compile(markdown.replace('original = u16($ABCD)', 'original = match selector: 16 {\n        case "1000 xxxx" {\n          return u16($ABCD)\n        }\n        otherwise unsupported\n      }'));
  for (const [from, to, diagnostic] of [
    ['case "1000 xxxx"', 'case "00xx xxxx"', /overlap/],
    ['case "1000 xxxx"', 'case "1000"', /eight bits/],
    ['case "1000 xxxx"', 'case "1 qxx xxxx"', /requires 2 values/],
    ['case "0 rxx xxxx" for r in registers', 'case "0 rxx xxxx" for r in missing', /Unknown name/],
    ['result = match selector: 16', 'result = match extend(selector, 16): 16', /expected 8-bit/],
    ['return concat(original, byte)', 'return byte', /result width/],
    ['  return result', '  return original', /not been captured/],
    ['    otherwise unsupported', '    otherwise ignored', /unsupported/],
    ['      return original', '      A <- u8(1)', /must end with return/],
  ] as const) {
    assert.throws(() => compile(markdown.replace(from, to)), (error: unknown) =>
      error instanceof ChapterError && error.file === "match.md" && error.line > 15 && error.column >= 1 && diagnostic.test(error.message));
  }
  assert.throws(() => compile(markdown.replace('source selected', 'view SELECTED').replace('source selected', 'source SELECTED')), /Views and actions|Views and state actions/);
});

test("match IR validates masks, branch scopes and results, and byte execution checks every branch capability", () => {
  const chapter = compile(), cpu = { name: "probe", state: chapter.state! };
  const match: Extract<Statement, { kind: "match" }> = { kind: "match", name: "result", selector: literal(8, 0), width: 16,
    cases: [{ mask: 0xff, value: 0, steps: [], result: literal(16, 1) }] };
  const definition = (step: Statement): InstructionDefinition => ({ cpu, name: "probe", explanation: "probe", steps: [step] });
  for (const [mask, byte] of [[256, 0], [0, 1], [-1, 0], [255, 1.5]]) {
    assert.throws(() => validateInstruction(definition({ ...match, cases: [{ ...match.cases[0]!, mask: mask!, value: byte! }] })), /mask or value/);
  }
  assert.throws(() => validateInstruction(definition({ ...match, cases: [] })), /at least one/);
  assert.throws(() => validateInstruction(definition({ ...match, cases: [...match.cases, ...match.cases] })), /overlap/);
  assert.throws(() => validateInstruction(definition({ ...match, cases: [{ ...match.cases[0]!, result: value("absent") }] })), /not been captured/);
  assert.throws(() => validateInstruction(definition(perform({ name: "action", steps: [match] }, {}))), /composed actions cannot reject/);
  const source = { name: "decoder", width: 16 as const, steps: [match], result: value("result") };
  assert.throws(() => validateInstruction(definition(perform({ name: "action", steps: [readSource("decoded", source)] }, {}))), /composed actions cannot reject/);
  const portCase = { ...match.cases[0]!, steps: [readPort("byte", literal(16, 0))] };
  assert.throws(() => checkByteExecution([{ ...match, cases: [portCase] }], false, true), /memory-only/);
  const description = describeInstruction(definition(match));
  assert.match(description, /match byte/); assert.match(description, /otherwise return outcome "unsupported"/);
});
