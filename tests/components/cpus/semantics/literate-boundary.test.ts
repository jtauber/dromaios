import assert from "node:assert/strict";
import { test } from "node:test";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import { checkStateEffects } from "../../../../src/components/cpus/semantics/literate/statements.js";
import { checkByteExecution } from "../../../../src/components/cpus/semantics/literate/execution.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";
import { compileResolved } from "../../../helpers/8088-resolved.js";
import type { CoprocessorEscape as Cpu8088Escape } from "../../../../src/components/cpus/coprocessor-access.js";

const compile = (body: string, cpu = "8088") => compileCpuChapter(`Ordered boundary effects remain explicit.

\`\`\`cpu
cpu "${cpu}"${cpu === "8088" ? " boundary segmented" : ""}
state {
  register A: 8
  latch WAIT
}
${body}
\`\`\``, {}, "boundary.md");
const effects = `action device "sample, deliver, report, defer" (vector: 8) using memory, boundary {
  byte = memory(u16($FFFF))
  high = sample test
  WAIT <- high
  send escape(vector, byte)
  send escape(vector, byte) with memory(u16($FFFF), u16($0010), projectAddress(u16($FFFF), u16($0010), 4, 20), u16($ABCD))
  report interrupt(vector)
  defer all
}
family probe "00000000" {
  A <- u8(1)
  perform device(u8(3))
  A <- u8(2)
}`;

interface State { a: number; wait: boolean }
interface Context {
  readByte(address: number): number;
  readTest(): boolean;
  sendEscape(request: Cpu8088Escape): void;
  reportInterrupt(vector: number): void;
  deferInterrupt(scope: "intr" | "all"): void;
}
test("chapter boundary effects preserve captured data, context capabilities, and every failed callback", async () => {
  const definition = compile(effects).families.probe![0]![1];
  const generated = generateInstructions("8088", { probe: definition });
  assert.match(generated, /"readByte" \| "readTest" \| "sendEscape" \| "reportInterrupt" \| "deferInterrupt"/);
  assert.doesNotMatch(generated, /fetchByte|writeByte|readPort/);
  const bodies = await compileResolved<{ probe(state: State, context: Context): void }>({ probe: definition });
  const expected = [
    ["read", 0xffff], ["test"],
    ["escape", { opcode: 3, modRM: 0x42, memory: null }],
    ["escape", { opcode: 3, modRM: 0x42, memory: { segment: 0xffff, offset: 0x10, address: 0, value: 0xabcd } }],
    ["report", 3], ["defer", "all"],
  ];
  for (let failAt = -1; failAt < expected.length; failAt++) {
    const state = { a: 0, wait: false }, events: unknown[][] = [], failure = Error("callback failed");
    const effect = (...event: unknown[]) => {
      events.push(event); assert.equal(state.a, 1);
      if (events.length - 1 === failAt) throw failure;
    };
    const run = () => bodies.probe(state, {
      readByte(address) { effect("read", address); return 0x42; },
      readTest() { effect("test"); return true; },
      sendEscape(request) { effect("escape", request); },
      reportInterrupt(vector) { effect("report", vector); },
      deferInterrupt(scope) { effect("defer", scope); },
    });
    if (failAt < 0) run(); else assert.throws(run, error => error === failure);
    assert.deepEqual(events, expected.slice(0, failAt < 0 ? expected.length : failAt + 1));
    assert.deepEqual(state, { a: failAt < 0 ? 2 : 1, wait: failAt < 0 || failAt > 1 });
  }
});

test("action capabilities compose transitively without granting wider lifecycle permissions", () => {
  const chapter = compile(effects);
  for (const body of [
    'action wrapper "no capabilities" {\n  perform device(u8(3))\n}',
    'action wrapper "memory only" using memory {\n  when 0 {\n    perform device(u8(3))\n  }\n}',
    'action wrapper "boundary only" using boundary {\n  perform device(u8(3))\n}',
    'view BYTE "pure" : 8 {\n  perform device(u8(3))\n  return u8(0)\n}',
  ]) assert.throws(() => compile(effects + "\n" + body), /using memory|CPU boundaries/);
  assert.doesNotThrow(() => compile(effects + '\naction wrapper "composed" using boundary, memory {\n  perform device(u8(3))\n}'));
  // Execution declarations recheck actions, so an annotation cannot smuggle
  // event effects into a reset/vector/retirement hook with a narrower context.
  assert.throws(() => checkStateEffects(chapter.actions.device!.steps, "memory"), /CPU boundaries/);
  assert.throws(() => checkByteExecution(chapter.families.probe![0]![1].steps), /Byte execution does not support read-test/);
});

test("boundary syntax rejects invalid capabilities, CPU contexts, and operand widths", () => {
  for (const [from, to, message] of [
    ["memory, boundary", "memory, memory", /Duplicate action capability/],
    ["memory, boundary", "devices", /Expected memory, boundary, or staging/],
    ["byte = memory(u16($FFFF))", "byte = fetch", /cannot fetch/],
    ["byte = memory(u16($FFFF))", "byte = port(u16(0))", /cannot fetch/],
    ["report interrupt(vector)", "report interrupt(u16(3))", /expected 8-bit/],
    ["send escape(vector, byte)", "send escape(u16(3), byte)", /expected 8-bit/],
    ["u16($ABCD)", "u8($AB)", /expected 16-bit/],
  ] as const) assert.throws(() => compile(effects.replace(from, to)), message);
  for (const body of ["high = sample test", "send escape(u8(0), u8(0))", "report interrupt(u8(0))"]) {
    assert.throws(() => compile(`family probe "00000000" {\n  ${body}\n}`, "probe"), /segmented/);
  }
});

test("boundary keywords remain usable as ordinary capture names without implicit device reads", async () => {
  const definition = compile(`family probe "00000000" {
  test = u8(7)
  sample = test
  send = sample
  report = send
  A <- report
}`).families.probe![0]![1];
  const bodies = await compileResolved<{ probe(state: State): void }>({ probe: definition });
  const state = { a: 0, wait: false }; bodies.probe(state);
  assert.deepEqual(state, { a: 7, wait: false });
  assert.doesNotMatch(generateInstructions("8088", { probe: definition }), /readTest|sendEscape|reportInterrupt/);
});
