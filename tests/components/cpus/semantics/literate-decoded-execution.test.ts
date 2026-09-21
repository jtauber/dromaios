import assert from "node:assert/strict";
import { test } from "node:test";
import { Ram } from "../../../../src/components/memory/ram.js";
import type { decodedExecution } from "../../../../src/components/cpus/decoded-execution.js";
import type { BytePorts } from "../../../../src/components/cpus/port-access.js";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import { ChapterError } from "../../../../src/components/cpus/semantics/literate/document.js";
import { generateChapterExecutionModule } from "../../../helpers/literate-model.js";

// Deliberately unlike Z80 storage: an eight-bit bus, big-endian operands, and renamed fields.
const markdown = `A tiny model exercises full-encoding validation and retirement requests.

\`\`\`cpu
cpu "probe"
state {
  register CURSOR: 8
  register TICKS: 8
  register RESULT: 16
  latch PAUSED
  latch DELAY
  latch FINISHED
}
view NEXT "cursor": 8 {
  current = register CURSOR
  return current
}
action advance "write cursor" (value: 16) {
  CURSOR <- lowByte(value)
}
action reset "reset boundary" () {
  CURSOR <- u8($FE)
  PAUSED <- 0
}
action fetched "count fetches" (count: 8) {
  old = register TICKS
  TICKS <- add(old, count)
}
action finish "retirement" () {
  FINISHED <- 1
}
execution {
  memory 8
  counter NEXT write advance
  stopped PAUSED
  word big
  opcode advance on decode with action fetched
  operand advance after read
  failure retain
  reset action reset
  retire irq into DELAY then action finish
  notify reti after retire
  interrupt external
}
page EXTRA = $42
family LOAD "0000 0000" on EXTRA {
  high = fetch
  low = fetch
  value = concat(high, low)
  RESULT <- value
  defer irq
  notify reti
}
family HALT "0000 0001" {
  PAUSED <- 1
}
\`\`\``;
const initial = () => ({ cursor: 0xfe, ticks: 0x7f, result: 0, paused: false, delay: false, finished: false });
type State = ReturnType<typeof initial>;
interface Model {
  checkMemory(ram: Ram): void;
  createExecution(state: State, ram: Ram, snapshot: () => State, ports?: BytePorts, onReti?: () => void): ReturnType<typeof decodedExecution<State>>;
}
const generate = async (text = markdown): Promise<Model> => generateChapterExecutionModule(text, "probe", "probe.md");

test("decoded chapter execution wraps its declared bus, binds renamed state, and retires before notification", async () => {
  const model = await generate(), state = initial(), ram = new Ram(256);
  model.checkMemory(ram); assert.throws(() => model.checkMemory(new Ram(65536)), /256 bytes/);
  [0x42, 0, 0x12, 0x34].forEach((byte, index) => ram.write((0xfe + index) % 256, byte));
  let notified = 0;
  const cpu = model.createExecution(state, ram, () => structuredClone(state), undefined, () => {
    notified++;
    assert.deepEqual(state, { cursor: 2, ticks: 0x81, result: 0x1234, paused: false, delay: true, finished: true });
    assert.throws(() => cpu.step(), /not be reentrant/); assert.throws(() => cpu.reset(), /not be reentrant/);
    assert.throws(() => cpu.atBoundary(() => {}), /not be reentrant/);
  });
  const record = cpu.step(); assert.equal(notified, 1);
  assert.deepEqual(record.instruction, { address: 0xfe, bytes: [0x42, 0, 0x12, 0x34] });
  assert.deepEqual(record.accesses.map(access => "address" in access ? access.address : -1), [0xfe, 0xff, 0, 1]);
  assert.equal(record.before.result, 0);
  const saved = structuredClone(record); cpu.reset(); assert.deepEqual(record, saved);
  assert.equal(state.cursor, 0xfe); assert.equal(state.ticks, 0x81); assert.equal(state.result, 0x1234);
});

test("flat decoders, halted attempts, and state-action-only retirement obey the same contract", async () => {
  const model = await generate(markdown.replace("page EXTRA = $42\n", "").replace(' on EXTRA', '')
    .replace("retire irq into DELAY then action finish", "retire action finish").replace("  defer irq\n", ""));
  const state = initial(), ram = new Ram(256), cpu = model.createExecution(state, ram, () => structuredClone(state));
  ram.write(0xfe, 0); ram.write(0xff, 0x12); ram.write(0, 0x34);
  assert.equal(cpu.step().outcome, "executed"); assert.equal(state.cursor, 1); assert.equal(state.ticks, 0x80);
  assert.equal(state.result, 0x1234); assert.equal(state.finished, true); assert.equal(state.delay, false);
  ram.write(1, 1); state.finished = false;
  assert.equal(cpu.step().outcome, "halted"); assert.equal(state.finished, true);
  state.finished = false;
  const saved = structuredClone(state), halted = cpu.step();
  assert.equal(halted.instruction, null); assert.deepEqual(halted.accesses, []); assert.deepEqual(state, saved);
});

test("unknown encodings and failed prefix or operand reads retain the correct boundary state", async () => {
  const model = await generate(), failure = Error("read failed");
  for (const failedAt of [0, 1, 2, 3, -1]) {
    const state = initial(), observations: State[] = [];
    class Memory extends Ram {
      override read(address: number) {
        const index = observations.length; observations.push(structuredClone(state));
        assert.throws(() => cpu.reset(), /not be reentrant/);
        if (index === failedAt) throw failure;
        return super.read(address);
      }
    }
    const ram = new Memory(256), code = [0x42, failedAt < 0 ? 0xff : 0, 0x12, 0x34];
    code.forEach((byte, index) => ram.write((0xfe + index) % 256, byte));
    const cpu = model.createExecution(state, ram, () => structuredClone(state));
    if (failedAt < 0) {
      const record = cpu.step(); assert.equal(record.outcome, "unsupported");
      assert.deepEqual(record.instruction, { address: 0xfe, bytes: [0x42, 0xff] });
    } else assert.throws(() => cpu.step(), error => error === failure);
    assert.equal(state.cursor, failedAt >= 2 ? failedAt - 2 : 0xfe);
    assert.equal(state.ticks, failedAt >= 2 ? 0x81 : 0x7f);
    assert.equal(state.finished, false); assert.equal(state.delay, false); assert.equal(state.result, 0);
    for (const observed of observations.slice(0, 2)) assert.deepEqual(observed, initial());
    cpu.reset(); // The guard releases even after a thrown access.
  }
});

test("RETI failure follows retirement while failed bodies discard both retirement requests", async () => {
  const model = await generate(), state = initial(), ram = new Ram(256), failure = Error("device failed");
  const cpu = model.createExecution(state, ram, () => structuredClone(state), undefined, () => { throw failure; });
  const context = { fetchByte: () => 0, fetchWord: () => 0, readByte: () => 0, writeByte: () => {}, readPort: () => 0, writePort: () => {} };
  for (const delayed of [false, true]) {
    state.delay = delayed;
    assert.throws(() => cpu.atBoundary(() => cpu.execute(({ deferInterrupt, notifyReti }) => {
      deferInterrupt("irq"); notifyReti(); throw failure;
    }, context)), error => error === failure);
    assert.equal(state.delay, delayed); assert.equal(state.finished, false);
  }
  assert.throws(() => cpu.atBoundary(() => cpu.execute(({ notifyReti }) => { notifyReti(); }, context)), error => error === failure);
  assert.equal(state.delay, false); assert.equal(state.finished, true);
  cpu.reset();
});

test("decode policy diagnostics reject unsupported combinations with chapter locations", () => {
  for (const [before, after, diagnostic] of [
    ["with action fetched", "with action advance", /one 8-bit input/],
    ["opcode advance on decode with action fetched", "opcode advance on dispatch", /decode-before-execution/],
    ["stopped PAUSED", "stopped none", /stopped latch/],
    ["stopped PAUSED", "stopped PAUSED as waiting", /stopped latch/],
    ["  notify reti after retire\n", "", /notification policy/],
    ["retire irq into DELAY then action finish", "retire none", /retirement destination/],
    ["interrupt external", "interrupt external extra", /Unexpected/],
    ["  value = concat(high, low)", "  selector = fetch\n  value = match selector: 16 {\n    case \"0000 0000\" {\n      return u16(0)\n    }\n    otherwise unsupported\n  }", /operand rejection/],
    ["page EXTRA", 'interface CpuProbe "partial model" {\n}\npage EXTRA', /chapter-owned interrupt entry/],
  ] as const) {
    assert.ok(markdown.includes(before));
    assert.throws(() => compileCpuChapter(markdown.replace(before, after), {}, "probe.md"), error =>
      error instanceof ChapterError && error.line > 1 && diagnostic.test(error.message), `${before} -> ${after}`);
  }
});
