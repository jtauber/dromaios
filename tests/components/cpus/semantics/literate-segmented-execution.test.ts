import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Ram } from "../../../../src/components/memory/ram.js";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import { ChapterError } from "../../../../src/components/cpus/semantics/literate/document.js";
import { recordCoprocessor } from "../../../../src/components/cpus/coprocessor-access.js";
import { generateChapterExecutionModule } from "../../../helpers/literate-model.js";
import { flags, initialState, snapshot } from "../8088/helpers.js";

const file = "src/components/cpus/specifications/8088.md", text = readFileSync(file, "utf8");
type Model = Pick<typeof import("../../../../src/components/cpus/generated/8088-execution.js"), "checkMemory" | "createExecution">;
const generate = async (chapter = text): Promise<Model> => generateChapterExecutionModule(chapter, "8088", file);
const original = generate();

function fixture(model: Model, code: readonly number[]) {
  const state = initialState({ cs: 0, ds: 0, ss: 0, es: 0, ip: 0, flags: flags(0) }), ram = new Ram(0x100000);
  code.forEach((byte, index) => ram.write(index, byte));
  const boundary = model.createExecution(state, ram, () => snapshot(state), () => undefined, record => recordCoprocessor("8088", { test: () => true }, record));
  return { state, ram, boundary };
}

test("segmented chapter edits control reset, successful fetch advancement, and memory size", async () => {
  const model = await generate(text.replace('CS <- u16($FFFF)', 'CS <- u16($1234)')
    .replace('IP <- add(offset, u16(1))', 'IP <- add(offset, u16(2))').replace('memory 20', 'memory 21'));
  assert.throws(() => model.checkMemory(new Ram(0x100000)), /2 MiB/);
  model.checkMemory(new Ram(0x200000));
  const { state, boundary } = fixture(model, [0xb8, 0, 0x34, 0, 0x12]);
  const step = boundary.step();
  assert.equal(state.ax, 0x1234); assert.equal(state.ip, 6);
  assert.deepEqual(step.accesses.map(access => "address" in access ? access.address : undefined), [0, 2, 4]);
  const reset = boundary.reset();
  assert.equal(reset.after.cs, 0x1234); assert.equal(reset.after.ax, 0x1234);
  assert.deepEqual(reset.accesses, []);
});

test("segmented chapter edits control segment projection, prefix captures, repeat modes, and prefix bounds", async () => {
  const model = await generate(text.replace('segment CS shift 4', 'segment DS shift 3')
    .replace('segment $26 ES', 'segment $26 SS').replace('repeat $F3 1', 'repeat $F3 2').replace('prefixes limit 65536', 'prefixes limit 2'));
  const { state, ram, boundary } = fixture(model, []);
  state.cs = 0x200; state.ds = 0x100; state.ss = 0x300; state.es = 0x400;
  [0x26, 0xa0, 0x10, 0].forEach((byte, i) => ram.write(0x800 + i, byte));
  ram.write(0x3010, 0xab); ram.write(0x4010, 0xcd);
  const step = boundary.step(); assert.equal(step.instruction?.address, 0x2000); assert.equal(state.ax & 255, 0xab);
  assert.equal(step.accesses[0]?.kind, "read"); assert.deepEqual(step.accesses[0], { kind: "read", address: 0x800, value: 0x26 });
  state.ip = 0; ram.write(0x800, 0xf3); ram.write(0x801, 0xa4);
  assert.equal(boundary.step().outcome, "unsupported"); assert.equal(state.ip, 0); // REPNE MOVS is rejected by its body.
  ram.write(0x801, 0x26); ram.write(0x802, 0x90);
  const bounded = boundary.step(); assert.equal(bounded.outcome, "unsupported");
  assert.deepEqual(bounded.instruction?.bytes, [0xf3, 0x26]); assert.equal(state.ip, 0);
});

test("segmented chapter edits control trap and fault vectors, sampled retirement inputs, and WAIT continuation", async () => {
  const model = await generate(text.replace('"trap" vector 1', '"trap" vector 3').replace('"divide-error" vector 0', '"divide-error" vector 4')
    .replace('sampling flag TF, latch TRAPPENDING', 'sampling flag CF, latch TRAPPENDING').replace('waiting WAITING with pollWait(1)', 'waiting WAITING with pollWait(0)'));
  const { state, ram, boundary } = fixture(model, [0xf6, 0xf1]); // DIV CL
  for (const [address, byte] of [[12, 0x34], [14, 0x12], [16, 0x78], [18, 0x56]]) ram.write(address!, byte!);
  state.trapPending = true; state.halted = true;
  const trap = boundary.step(); assert.deepEqual(trap.interrupt, { source: "trap", vector: 3 });
  assert.equal(state.ip, 0x34); assert.equal(state.cs, 0x12); assert.equal(state.halted, false);
  state.cs = state.ip = state.cx = 0;
  const fault = boundary.step(); assert.deepEqual(fault.interrupt, { source: "divide-error", vector: 4 });
  assert.equal(state.ip, 0x78); assert.equal(state.cs, 0x56);
  state.cs = state.ip = 0; ram.write(0, 0x90); state.flags.cf = true;
  boundary.step(); assert.equal(state.trapPending, true); // Sampled CF, not TF.
  state.trapPending = false; state.flags.cf = false; state.waiting = true; state.ip = 0x20;
  const waiting = boundary.step(); assert.equal(waiting.outcome, "waiting"); assert.equal(waiting.instruction, null);
  assert.equal(state.ip, 0x1f); assert.deepEqual(waiting.accesses, [{ kind: "test", high: true }]);
});

test("segmented fetches capture overrides after reads, advance live IP, and preserve the pre-effect trap sample", async () => {
  const model = await original, state = initialState({ cs: 0, ip: 0, ds: 0, es: 0x100, flags: flags(0x20) });
  let reads = 0;
  class CallbackRam extends Ram {
    override read(address: number): number {
      const byte = super.read(address);
      if (++reads === 1) { state.es = 0x200; state.ip = 0x10; state.flags.tf = false; }
      else if (reads === 2) state.es = 0x300;
      return byte;
    }
  }
  const ram = new CallbackRam(0x100000);
  for (const [address, byte] of [[0, 0x26], [0x11, 0xa0], [0x12, 0], [0x13, 1], [0x2100, 0xa5], [0x3100, 0x5a]]) ram.write(address!, byte!);
  const cpu = model.createExecution(state, ram, () => snapshot(state), () => undefined, record => recordCoprocessor("8088", undefined, record));
  const step = cpu.step(); assert.equal(state.ax & 255, 0xa5); assert.equal(state.ip, 0x14); assert.equal(state.trapPending, true);
  assert.deepEqual(step.instruction?.bytes, [0x26, 0xa0, 0, 1]);
});

test("failed fetches and trap entries retain effects without retirement, release the guard, and detach delivery records", async () => {
  const model = await original, state = initialState({ cs: 0, ip: 0, flags: flags(0x20), interruptDeferred: true });
  const error = new Error("read failed"); let count = 0, failure = 2;
  class FailingRam extends Ram { override read(address: number): number { if (++count === failure) throw error; return super.read(address); } }
  const ram = new FailingRam(0x100000); ram.write(0, 0xb8); ram.write(1, 0x34); ram.write(2, 0x12);
  const cpu = model.createExecution(state, ram, () => snapshot(state), () => undefined, record => recordCoprocessor("8088", undefined, record));
  assert.throws(() => cpu.step(), thrown => thrown === error);
  assert.equal(state.ip, 1); assert.equal(state.interruptDeferred, true); assert.equal(state.trapPending, false);
  state.trapPending = true; failure = count + 1;
  assert.throws(() => cpu.step(), thrown => thrown === error); assert.equal(state.trapPending, false); assert.equal(state.flags.tf, true);
  failure = -1; state.trapPending = true;
  const first = cpu.step(); assert.deepEqual(first.interrupt, { source: "trap", vector: 1 });
  Reflect.set(first.interrupt!, "vector", 99);
  state.trapPending = true; assert.deepEqual(cpu.step().interrupt, { source: "trap", vector: 1 });
  cpu.reset(); assert.equal(state.trapPending, false);
});

const invalid: readonly [string, string, RegExp][] = [
  ['  failure retain\n', '', /needs failure/],
  ['memory 20', 'memory 20\n  memory 20', /Duplicate execution field/],
  ['failure retain', 'failure retain\n  timing cycles', /Unknown execution field/],
  ['memory 20', 'memory 15', /16 to 24/],
  ['memory 20', 'memory 25', /integer from/],
  ['segment CS shift 4', 'segment CS shift 5', /integer from/],
  ['counter IP write setIP', 'counter AL write setIP', /Unknown name AL/],
  ['write setIP', 'write resetState', /input widths/],
  ['record address PC', 'record address AL', /32-bit view/],
  ['prefixes limit 65536', 'prefixes limit 0', /positive/],
  ['ignore $F0', 'ignore $F0\n    ignore $F0', /Duplicate prefix/],
  ['ignore $F0', 'ignore $90', /collide with prefixes/],
  ['repeat $F3 1', 'repeat $F3 0', /reserved/],
  ['repeat $F3 1', 'repeat $100 1', /integer from/],
  ['fetch action advanceIP', 'fetch action pollWait', /input widths/],
  ['reset action resetState', 'reset action pollWait', /input widths/],
  ['sampling flag TF, latch TRAPPENDING', 'sampling flag TF', /one byte per sample/],
  ['"divide-error" vector 0', '"other-fault" vector 0', /declared segmented fault/],
  ['"divide-error" vector 0', '"opcode" vector 0', /unreserved/],
  ['waiting WAITING with pollWait(1)', 'waiting WAITING with enterInterrupt(1)', /continuation cannot use read-memory/],
  ['action resetState "reset control state, preserving general registers and RAM" {', 'action resetState "reset control state, preserving general registers and RAM" using boundary {\n  perform pollWait(u8(1))', /boundary/],
  ['action advanceIP "advance the live offset after one successful fetch" {', 'action advanceIP "advance the live offset after one successful fetch" using memory {\n  perform enterInterrupt(u8(1))', /without using memory/],
  ['action beginTrap "consume an owed trap before attempting entry" {', 'action beginTrap "consume an owed trap before attempting entry" using boundary {\n  perform pollWait(u8(1))', /boundary/],
  ['family stringMove (overridden: 8, segmentOverride: 16, repeatMode: 8, startIP: 16)', 'family stringMove (overridden: 8, segmentOverride: 16, repeatMode: 8, startIP: 16, extra: 8)', /families need plain/],
];
test("segmented contracts reject unsupported shapes and transitive lifecycle effects at Markdown locations", () => {
  for (const [before, after, message] of invalid) {
    assert.ok(text.includes(before), before);
    assert.throws(() => compileCpuChapter(text.replace(before, after), { name: "8088" }, file), error => {
      assert.ok(error instanceof ChapterError); assert.equal(error.file, file); assert.ok(error.line > 1);
      assert.match(error.message, message, before); return true;
    });
  }
});
