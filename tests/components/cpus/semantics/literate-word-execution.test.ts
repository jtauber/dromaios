import { edited68000 as edited } from "../../../helpers/68000-chapter.js";
import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import { checkWordEffects } from "../../../../src/components/cpus/semantics/literate/word-execution.js";
import { ChapterError } from "../../../../src/components/cpus/semantics/literate/document.js";
import { generateChapterExecution } from "../../../../src/components/cpus/semantics/literate/execution.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";
import { instructionSet } from "../../../../src/components/cpus/semantics/builders.js";
import type { Cpu68000 } from "../../../../src/components/cpus/generated/68000-cpu.js";
import { initialState } from "../../../helpers/68000-state.js";

const base = new URL("../../../../src/components/cpus/generated/", import.meta.url);
function moduleUrl(source: string, bindings: Readonly<Record<string, string>> = {}, relative = base): string {
  const code = stripTypeScriptTypes(source).replace(/from "([^"]+)"/g, (_, path: string) =>
    `from ${JSON.stringify(bindings[path] ?? new URL(path.replace(/\.ts$/, ".js"), relative).href)}`);
  return `data:text/javascript,${encodeURIComponent(code)}`;
}
const toy = `Read an extension word and add the captured low three bits.

\`\`\`cpu
cpu "probe" boundary word
state {
  register COUNTER: 16
  register VALUE: 8
  latch DEAD
  latch WAIT
  latch OWED
  flag WATCH
}
view POSITION "position" : 16 {
  pc = register COUNTER
  return pc
}
source address "address" (size: 8, mode: 3, code: 3) : 32 {
  return u32(0)
}
action fetched "capture opcode" (opcode: 16) {
  VALUE <- lowByte(opcode)
}
action trace "trace sample" (sample: flag) {
  OWED <- sample
}
action retire "next position" (pc: 16, sample: flag) {
  COUNTER <- pc
  perform trace(sample)
}
execution word {
  memory 16
  counter POSITION
  fetch little advance after word
  alignment 1
  terminal DEAD
  stopped WAIT
  trace WATCH pending OWED exception "watch" action trace
  fetched action fetched
  retire action retire
  address source address
  unknown "bad"
  unsupported "bad"
  inputs {
    amount = "xxxx xxxx xxxx xaaa"
  }
  exceptions {
    "bad" vector 6 restart
    "watch" vector 12 restart
    "software" vector 24 plus "xxxx xxxx xxxx xvvv" complete
  }
  interrupt external
}
family add (amount: 3) {
  encoding "1010 0000 0000 xxxx" named "add"
  extension = fetch word
  VALUE <- add(lowByte(extension), extend(amount, 8))
}
\`\`\``;

test("a word contract binds unrelated state and a different fetch order without a native CPU adapter", async () => {
  const chapter = compileCpuChapter(toy), definitions = instructionSet(Object.values(chapter.families).flat(), 16);
  const modules = [{ name: "probe", definitions }];
  const state = moduleUrl(generateInstructions(chapter.cpu, chapter.actions, {
    sources: { cpu: { name: chapter.cpu, state: chapter.state!, wordBoundary: true }, groups: { views: chapter.views, sources: chapter.sources } },
  }));
  const execution = moduleUrl(generateChapterExecution(chapter.cpu, "probe", chapter.execution!, modules), {
    "./probe-state.ts": state, "./probe.ts": moduleUrl(generateInstructions(chapter.cpu, definitions)),
  });
  const { createExecution } = await import(execution);
  const stored = { counter: 3, value: 0, dead: false, wait: false, owed: false, flags: { watch: true } }, requests: unknown[] = [];
  const step = createExecution(stored, {
    exception(request: unknown) { requests.push(request); return { exception: request, delivered: true }; },
    initialFetch() { assert.fail(); }, memoryError() { assert.fail(); }, faultFromError() { return undefined; },
  });
  const bytes = [5, 0xa0, 0x22, 0x11], reads: number[] = [];
  const memory = { fetchByte(address: number) { reads.push(address); return bytes[address - 3]; } };
  assert.deepEqual(step(memory, () => assert.fail()), { instruction: { address: 3, bytes }, outcome: "executed" });
  assert.equal(stored.counter, 7); assert.equal(stored.value, 0x27); assert.equal(stored.owed, true);
  assert.deepEqual(reads, [3, 4, 5, 6]);
  step(memory, () => assert.fail());
  assert.deepEqual(requests, [{ source: "watch", vector: 12, returnPc: 7 }]);
});

test("word declarations reject malformed fields, input widths, lifecycle effects, and hidden byte/port operations with chapter locations", () => {
  const invalid = [
    ["  terminal DEAD\n", ""], ["terminal DEAD", "terminal UNKNOWN"], ["stopped WAIT", "stopped WAIT\n  stopped WAIT"],
    ["alignment 1", "alignment 4"], ["fetch little", "fetch middle"], ["counter POSITION", "counter VALUE"],
    ["fetched action fetched", "fetched action trace"], ["retire action retire", "retire action fetched"],
    ["address source address", "address source missing"], ["(size: 8, mode: 3, code: 3)", "(size: 16, mode: 3, code: 3)"],
    ["unknown \"bad\"", "unknown \"missing\""], ['"bad" vector 6 restart', '"bad" vector 256 restart'],
    ['"bad" vector 6 restart', '"bad" vector 6 restart\n    "bad" vector 8 restart'],
    ["xxxx xxxx xxxx xaaa", "xxxx xxxx xxxx xaba"], ["xxxx xxxx xxxx xaaa", "xxxx xxxx xxxx xxxx"],
    ["xxxx xxxx xxxx xaaa", "xxxx xxxx xxxx aaaa"], ["amount =", "other ="],
    ["extension = fetch word", "prior = pending register VALUE\n  extension = fetch word"],
    ["extension = fetch word", "stage VALUE <- u8(1)\n  extension = fetch word"],
    ["extension = fetch word", "extension = fetch"], ["extension = fetch word", "extension = port(u8(0))"],
    ["extension = fetch word", 'reject "missing"\n  extension = fetch word'],
    ["VALUE <- lowByte(opcode)", 'perform hidden()'],
  ];
  for (const [before, after] of invalid) {
    const changed = toy.replace(before!, after!);
    assert.throws(() => compileCpuChapter(changed, {}, "word.md"), error => error instanceof ChapterError && error.file === "word.md" && error.line > 0, before);
  }
  const numericTrace = toy.replace('"trace sample" (sample: flag)', '"trace sample" (sample: 8)')
    .replace("OWED <- sample", "OWED <- not(zero(sample))")
    .replace("perform trace(sample)", "perform trace(select(sample, u8(1), u8(0)))");
  assert.throws(() => compileCpuChapter(numericTrace), /Execution action needs inputs \[flag\]/);
  const numericRetire = toy.replace("(pc: 16, sample: flag)", "(pc: 16, sample: 8)")
    .replace("perform trace(sample)", "perform trace(not(zero(sample)))");
  assert.throws(() => compileCpuChapter(numericRetire), /Execution action needs inputs \[16, flag\]/);
  for (const reason of ["bad", "unsupported", "missing"]) {
    const division = toy.replace("extension = fetch word", `quotient, remainder = divide(u16(1), u8(0), unsigned) otherwise "${reason}"\n  extension = fetch word`);
    if (reason === "missing") assert.throws(() => compileCpuChapter(division), /Unknown word exception/);
    else assert.doesNotThrow(() => compileCpuChapter(division));
  }
  assert.throws(() => checkWordEffects([{ kind: "commit-address-updates" }], {}, "address"), /cannot resolve or commit/);
  const hidden = toy.replace('action fetched "capture opcode"', 'action hidden "hidden memory" using memory {\n  value = memory(u32(0))\n}\naction fetched "capture opcode"')
    .replace("VALUE <- lowByte(opcode)", "perform hidden()");
  assert.throws(() => compileCpuChapter(hidden), /cannot fetch instructions or access memory/);
});

function cpuWith(Cpu: typeof Cpu68000, words: readonly number[], bits = 64) {
  const state = initialState(bits); state.pc = 0x1000; state.ssp = 0x8000;
  const bytes = words.flatMap(word => [word >>> 8, word & 255]);
  return new Cpu({ size: 0x1000000, read(address) { return bytes[address - 0x1000] ?? 0; }, write() {} }, state);
}

test("chapter edits change 68000 input extraction, opcode commits, retirement, and trace sampling through the public CPU", async () => {
  const Cpu = await edited([
    ['immediate = "xxxx xxxx iiii iiii"', 'immediate = "iiii iiii xxxx xxxx"'],
    ["IR <- opcode", "IR <- xor(opcode, u16($FFFF))"],
    ["PC <- next\n  perform scheduleTrace(sampled)", "PC <- add(next, u32(2))\n  perform scheduleTrace(sampled)"],
    ['trace T pending TRACEPENDING', 'trace C pending TRACEPENDING'],
  ]);
  const result = cpuWith(Cpu, [0x7042], 80).step();
  assert.equal(result.after.d0, 0x70); assert.equal(result.after.ir, 0x8fbd);
  assert.equal(result.after.pc, 0x1004); assert.equal(result.after.tracePending, true);
});

test("chapter edits control exception vector literals, instruction completion, unknown words, and word-fetch order", async () => {
  const Cpu = await edited([
    ['"trap" vector 32 plus "xxxx xxxx xxxx vvvv" complete', '"trap" vector 48 plus "xxxx xxxx vvvv xxxx" restart'],
    ['unknown "illegal-instruction"', 'unknown "line-a"'],
  ]);
  const trap = cpuWith(Cpu, [0x4e4f], 96).step();
  assert.deepEqual(trap.exception, { source: "trap", vector: 52, returnPc: 0x1000 });
  assert.equal(trap.after.tracePending, false); assert.equal(trap.after.entry.kind, "exception");
  assert.deepEqual(cpuWith(Cpu, [0x7100]).step().exception, { source: "line-a", vector: 10, returnPc: 0x1000 });
  const Little = await edited([["fetch big advance after word", "fetch little advance after word"]]);
  assert.equal(cpuWith(Little, [0x7170]).step().after.d0, 0x71);
});
