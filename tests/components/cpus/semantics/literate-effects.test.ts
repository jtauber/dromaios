import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import { ChapterError } from "../../../../src/components/cpus/semantics/literate/document.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";
import { describeInstruction } from "../../../../src/components/cpus/semantics/describe.js";
import { checkByteExecution } from "../../../../src/components/cpus/semantics/literate/execution.js";
import { literal, perform, readPort } from "../../../../src/components/cpus/semantics/model.js";
import { validateInstruction } from "../../../../src/components/cpus/semantics/validate.js";
import type { InstructionDefinition, Statement } from "../../../../src/components/cpus/semantics/model.js";

const markdown = `Capture a postbyte once. Write the selected view and then leave the wait state.

\`\`\`cpu
cpu "probe"
state {
  register A: 8
  register B: 8
  latch WRITTEN
  choice WAIT: "none", "sync", "cwai"
}
view ACC "accumulator": 8 {
  result = register A
  return result
}
action writeAcc "write accumulator and mark it" (byte: 8) {
  A <- byte
  WRITTEN <- 1
}
operands selected {
  0 "A" = view ACC write writeAcc
  1 "reserved" = unsupported
}
family direct "0000 000 r" for r in selected {
  operand r <- u8($55)
}
family decode "1111 1111" {
  waiting = choice WAIT = "sync"
  postbyte = fetch
  match postbyte {
    case "0 xxx xxx r" for r in selected {
      original = operand r
      operand r <- add(original, u8(1))
      when waiting {
        B <- original
      }
    }
    otherwise unsupported
  }
  WAIT <- "none"
}
\`\`\``;
const compile = (text = markdown) => compileCpuChapter(text, {}, "effects.md");
interface State { a: number; b: number; written: boolean; wait: "none" | "sync" | "cwai" }
async function executable(text = markdown) {
  const chapter = compile(text), definitions = Object.fromEntries(Object.values(chapter.families).flat());
  const code = generateInstructions("probe", definitions);
  const javascript = stripTypeScriptTypes(code).replace('"../alu.ts"', JSON.stringify(new URL("../../../../src/components/cpus/alu.js", import.meta.url).href));
  const module: { instructions: Record<number, (state: State, context: { fetchByte(): number }) => void | "unsupported"> } =
    await import(`data:text/javascript,${encodeURIComponent(javascript)}`);
  return { ...module, code };
}

test("effect matches preserve selector masks, writable views, reserved slots, choices, and rejection boundaries", async () => {
  const { instructions, code } = await executable();
  assert.deepEqual(Object.keys(instructions).map(Number), [0, 255], "reserved catalogue entries omit opcode forms");
  assert.doesNotMatch(code, /let .*: number;/, "effect matches do not manufacture a numeric result");
  for (const wait of ["none", "sync", "cwai"] as const) for (let postbyte = 0; postbyte < 256; postbyte++) {
    const state: State = { a: 255, b: 7, written: false, wait }, before = { ...state };
    let fetched = 0;
    const result = instructions[255]!(state, { fetchByte() { fetched++; return postbyte; } });
    const supported = postbyte < 128 && postbyte % 2 === 0;
    assert.equal(fetched, 1); assert.equal(result, supported ? undefined : "unsupported");
    assert.deepEqual(state, supported ? { a: 0, b: wait === "sync" ? 255 : 7, written: true, wait: "none" } : before);
  }
  const changed = await executable(markdown.replace('A <- byte', 'A <- xor(byte, u8($FF))').replace('WAIT <- "none"', 'WAIT <- "cwai"'));
  const state: State = { a: 5, b: 0, written: false, wait: "sync" };
  changed.instructions[255]!(state, { fetchByte: () => 0 });
  assert.deepEqual(state, { a: 249, b: 5, written: true, wait: "cwai" });
});

test("effect matches retain completed writes when a view action fails and never run later effects", async () => {
  const { instructions } = await executable(), failure = new Error("write failed");
  const state: State = { a: 4, b: 9, written: false, wait: "sync" }, writes: string[] = [];
  const observed = new Proxy(state, { set(target, key, value) {
    writes.push(String(key)); if (key === "written") throw failure;
    return Reflect.set(target, key, value);
  } });
  assert.throws(() => instructions[255]!(observed, { fetchByte: () => 0 }), error => error === failure);
  assert.deepEqual(writes, ["a", "written"]);
  assert.deepEqual(state, { a: 5, b: 9, written: false, wait: "sync" });
});

test("writable views, choices, and effect matches diagnose invalid definitions at Markdown locations", () => {
  for (const [from, to, diagnostic] of [
    ['view ACC write writeAcc', 'view ACC write absent', /Unknown name/],
    ['(byte: 8)', '(byte: 8, other: 8)', /one input matching/],
    ['(byte: 8)', '(byte: 16)', /expected 8-bit/],
    ['WAIT <- "none"', 'WAIT <- "missing"', /declared control choice/],
    ['choice WAIT = "sync"', 'choice WAIT = "missing"', /declared control choice/],
    ['choice WAIT = "sync"', 'choice ABSENT = "sync"', /Unknown name/],
    ['match postbyte {', 'match extend(postbyte, 16) {', /expected 8-bit/],
    ['  WAIT <- "none"', '  A <- original', /not been captured/],
    ['      original = operand r', '      return u8(0)', /Expected "="/],
    ['    otherwise unsupported', '    case "0000 0000" {\n    }\n    otherwise unsupported', /overlap/],
  ] as const) {
    assert.throws(() => compile(markdown.replace(from, to)), (error: unknown) =>
      error instanceof ChapterError && error.file === "effects.md" && error.line > 0 && diagnostic.test(error.message));
  }
  const noWrite = markdown.replace('view ACC write writeAcc', 'value ACC');
  assert.throws(() => compile(noWrite), /value-only operand cannot be written/);
});

test("effect match IR checks masks, scopes, action composition, execution capabilities, and explanation", () => {
  const chapter = compile(), cpu = { name: "probe", state: chapter.state! };
  const dispatch: Extract<Statement, { kind: "dispatch" }> = { kind: "dispatch", selector: literal(8, 0),
    cases: [{ mask: 255, value: 0, steps: [] }] };
  const definition = (step: Statement): InstructionDefinition => ({ cpu, name: "probe", explanation: "Probe", steps: [step] });
  assert.throws(() => validateInstruction(definition({ ...dispatch, cases: [] })), /at least one/);
  assert.throws(() => validateInstruction(definition({ ...dispatch, cases: [...dispatch.cases, ...dispatch.cases] })), /overlap/);
  assert.throws(() => validateInstruction(definition({ ...dispatch, cases: [{ mask: 0, value: 1, steps: [] }] })), /mask or value/);
  assert.doesNotThrow(() => validateInstruction(definition(perform({ name: "rejecting action", steps: [dispatch] }, {}))));
  assert.throws(() => checkByteExecution([{ ...dispatch, cases: [{ mask: 255, value: 0, steps: [readPort("port", literal(16, 0))] }] }], false, true), /memory-only/);
  const text = describeInstruction(definition(dispatch));
  assert.match(text, /match byte/); assert.doesNotMatch(text, /yield/);
});
