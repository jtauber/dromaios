import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { defineState, unsigned } from "../../../../src/components/cpus/state.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";
import { alignmentFault, fetchByte, literal, readPort, readSource, reject, value, writeRegister } from "../../../../src/components/cpus/semantics/model.js";
import type { InstructionDefinition, Statement, ValueSource } from "../../../../src/components/cpus/semantics/model.js";
import type { OperandAlignmentFault, TargetAlignmentFault } from "../../../../src/components/cpus/word-execution.js";

const cpu = { name: "probe", state: defineState({ a: unsigned(8) }), wordBoundary: true } as const;
const definition = (steps: readonly Statement[]): InstructionDefinition => ({ cpu, name: "probe", explanation: "Emission contract.", steps });
const executable = (code: string) => import(`data:text/javascript,${encodeURIComponent(stripTypeScriptTypes(code)
  .replace('"../opcodes.ts"', JSON.stringify(new URL("../../../../src/components/cpus/opcodes.js", import.meta.url).href)))}`);

test("nested shared decoders propagate context requirements and rejection without changing sibling signatures", async () => {
  const matchedSource = (name: string, steps: readonly Statement[]): ValueSource => ({ name, type: 8, steps: [
    fetchByte("selector"), { kind: "match", name: "result", type: 8, selector: value("selector"),
      cases: [{ mask: 255, value: 0, steps, result: value("byte") }] },
  ], result: value("result") });
  const inner = matchedSource("inner", [readPort("byte", literal(16, 0x1234))]);
  const outer = matchedSource("outer", [readSource("byte", inner)]);
  const definitions = { load: definition([readSource("byte", outer),
    writeRegister({ kind: "register", cpu: "probe", field: "a", width: 8 }, value("byte"))]), noop: definition([]) };
  const options = { sources: { cpu, groups: { bytes: { outer, inner } } } };
  const code = generateInstructions("probe", definitions, options);
  assert.match(code, /import type \{ BytePorts \} from "\.\.\/port-access.ts";/);
  const context = 'instruction: Pick<ByteInstructionContext & BytePorts, "fetchByte" | "readPort">';
  for (const name of ["decode0", "decode1", "load"]) {
    assert.ok(code.includes(`"${name}"(state: StoredState, ${context}): ${name === "load" ? "void" : "number"} | "unsupported" {`));
  }
  assert.ok(code.includes('"noop"(state: StoredState): void {'));
  assert.ok(code.includes(`"outer"(${context}): number | "unsupported" {`));
  assert.ok(code.indexOf('"decode0"(') < code.indexOf('"decode1"('));
  assert.equal(code.match(/"decode\d+"\(/g)?.length, 2, "nested and direct uses share the same two decoders");
  interface Context { fetchByte(): number; readPort(port: number): number }
  const { instructions, sourceReaders }: {
    instructions: { load(state: { a: number }, context: Context): void | "unsupported"; noop(state: { a: number }): void };
    sourceReaders(state: { a: number }): { bytes: { outer(context: Context): number | "unsupported"; inner(context: Context): number | "unsupported" } };
  } = await executable(code);
  for (const selectors of [[0, 0], [0, 1], [1]]) {
    const state = { a: 7 }, events: (string | number)[] = [], bytes = [...selectors];
    const context = { fetchByte() { events.push("fetch"); return bytes.shift()!; }, readPort(port: number) { events.push(port); return 0x42; } };
    assert.equal(instructions.load(state, context), selectors.includes(1) ? "unsupported" : undefined);
    assert.deepEqual(events, selectors.includes(1) ? selectors.map(() => "fetch") : ["fetch", "fetch", 0x1234]);
    assert.equal(state.a, selectors.includes(1) ? 7 : 0x42);
    instructions.noop(state);
  }
  const readers = sourceReaders({ a: 9 }).bytes;
  assert.equal(readers.outer({ fetchByte: () => 0, readPort: () => 0x56 }), 0x56);
  assert.equal(readers.inner({ fetchByte: () => 1, readPort() { assert.fail("rejected decoder must not read the port"); } }), "unsupported");
  const standalone = generateInstructions("probe", {}, options);
  assert.match(standalone, /import type \{ BytePorts \}/, "reader-only modules collect decoder requirements too");
  assert.equal(generateInstructions("probe", definitions, options), code, "requirements stay local to each generation");
});

test("module bindings combine named rejections and distinct alignment faults while methods retain their own outcomes", async () => {
  const definitions = { 0: definition([reject("blocked")]), 1: definition([alignmentFault("fetch", literal(32, 3))]),
    2: definition([alignmentFault("read", literal(32, 5), "program")]), 3: definition([]) };
  const code = generateInstructions("probe", definitions, { bindOpcodes: true });
  assert.match(code, /import type \{ OperandAlignmentFault \} from "\.\.\/word-execution.ts";/);
  assert.match(code, /import type \{ TargetAlignmentFault \} from "\.\.\/word-execution.ts";/);
  for (const [key, outcome] of [["00", ' | "blocked"'], ["01", " | TargetAlignmentFault"], ["02", " | OperandAlignmentFault"], ["03", ""]]) {
    assert.ok(code.includes(`0x${key}(state: StoredState): void${outcome} {`));
  }
  assert.ok(code.includes('instruction: ByteInstructionContext) => void | "blocked" | OperandAlignmentFault | TargetAlignmentFault>'));
  const module: { opcodeEntries(state: { a: number }): [number, (context: object) => void | "blocked" | OperandAlignmentFault | TargetAlignmentFault][] } =
    await executable(code);
  assert.deepEqual(module.opcodeEntries({ a: 0 }).map(([opcode, run]) => [opcode, run({})]), [
    [0, "blocked"], [1, { operation: "fetch", address: 3 }], [2, { operation: "read", address: 5, programSpace: true }], [3, undefined],
  ]);
  const plain = generateInstructions("probe", { noop: definitions[3] });
  assert.doesNotMatch(plain, /AlignmentFault|blocked|ByteInstructionContext/);
});
