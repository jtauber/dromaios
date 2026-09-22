import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Ram } from "../../../../src/components/memory/ram.js";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import { ChapterError } from "../../../../src/components/cpus/semantics/literate/document.js";
import { generateChapterModule } from "../../../helpers/literate-model.js";
import { initialState } from "../8088/helpers.js";

const file = "src/components/cpus/specifications/8088.md", text = readFileSync(file, "utf8");
type Cpu = typeof import("../../../../src/components/cpus/generated/8088-cpu.js").Cpu8088;
const generate = async (source: string): Promise<Cpu> => (await generateChapterModule(source, "8088", file)).Cpu8088;

test("vector offer declarations control gate order, mask flags, fixed vectors, and acceptance effects", async () => {
  const Model = await generate(text.replace('when flag IF otherwise "masked"', 'when flag CF otherwise "masked"')
    .replace('source nmi vector 2', 'source nmi vector 7')
    .replace('  WAITING <- 0\n  STOPPED <- 0\n}\n\nexecution segmented', '  WAITING <- 0\n  STOPPED <- 0\n  AX <- u16($CAFE)\n}\n\nexecution segmented'));
  const ram = new Ram(0x100000); ram.write(28, 0x34); ram.write(29, 0x12); ram.write(30, 0x78); ram.write(31, 0x56);
  const state = initialState({ halted: true, waiting: true, trapPending: true }); state.flags.cf = false; state.flags.if = true;
  const masked = new Model(ram, state);
  assert.equal(masked.interrupt("intr", () => assert.fail("masked callback")).outcome, "ignored");
  assert.equal(masked.snapshot().halted, true); assert.equal(masked.snapshot().waiting, true);
  const nmi = masked.interrupt("nmi"); assert.equal(nmi.outcome, "accepted");
  if (nmi.outcome === "accepted") assert.equal(nmi.vector, 7);
  assert.equal(nmi.after.ip, 0x1234); assert.equal(nmi.after.cs, 0x5678); assert.equal(nmi.after.ax, 0xcafe);
  assert.equal(nmi.after.trapPending, true);
  for (const recognitionDeferred of [false, true]) {
    const deferred = new Model(ram, { ...state, interruptDeferred: true, recognitionDeferred });
    const offer = deferred.interrupt("intr", () => assert.fail("deferred callback"));
    assert.equal(offer.outcome, "ignored"); if (offer.outcome === "ignored") assert.equal(offer.reason, "deferred");
    assert.deepEqual(offer.before, offer.after); assert.deepEqual(offer.accesses, []);
  }
  state.flags.cf = true; state.flags.if = false;
  const accepted = new Model(ram, state), calls: string[] = [];
  const offer = accepted.interrupt("intr", () => {
    const snapshot = accepted.snapshot(); calls.push("acknowledge");
    assert.equal(snapshot.ax, 0xcafe); assert.equal(snapshot.halted, false); assert.equal(snapshot.waiting, false);
    assert.throws(() => accepted.reset(), /reentrant/); return 7;
  });
  assert.deepEqual(calls, ["acknowledge"]); assert.deepEqual(offer.accesses[0], { kind: "acknowledge", value: 7 });
  assert.equal(offer.after.ip, 0x1234);
});

test("segmented public generation depends on declarations rather than the CPU name", async () => {
  const source = text.replace('cpu "8088"', 'cpu "renamed"').replace('interface Cpu8088 ', 'interface CpuRenamed ')
    .replace('source intr acknowledge', 'source request acknowledge').replace('source nmi vector 2', 'source edge vector 9')
    .replace('snapshot al = AL', 'snapshot low = AH');
  const exports = await generateChapterModule(source, "renamed", "renamed.md");
  const Model = exports.CpuRenamed, ram = new Ram(0x100000), state = initialState({ cs: 0, ip: 0, ax: 0x1234 });
  const cpu = new Model(ram, state);
  assert.equal(cpu.snapshot().low, 0x12); assert.equal(cpu.snapshot().al, undefined);
  assert.equal(exports.cpuRenamedStateDescription.ax.bits, 16);
  assert.throws(() => cpu.interrupt("nmi"), /renamed interrupt source must be request or edge/);
  const before = cpu.snapshot();
  for (const source of [null, 9, ["edge"], new String("edge"), { toString() { assert.fail("Source must not be coerced"); } }]) {
    assert.throws(() => cpu.interrupt(source), /renamed interrupt source must be request or edge/);
    assert.deepEqual(cpu.snapshot(), before);
  }
  assert.equal(cpu.interrupt("edge").vector, 9);
  ram.write(0, 0x9b);
  const waiting = new Model(ram, state, { test: () => false });
  assert.equal(waiting.step().outcome, "executed");
  assert.throws(() => new Model(ram, state).step(), /renamed WAIT requires/);
});

const invalid: readonly [string, string, RegExp][] = [
  [' boundary segmented', '', /matching CPU boundary|segmented|declared retirement/],
  ['source nmi vector 2', 'source intr vector 2', /Duplicate interrupt source/],
  ['source nmi vector 2', 'source nmi vector 256', /vector must be a byte/],
  ['source nmi vector 2', 'source nmi vector -1', /Unexpected character/],
  ['when flag IF otherwise "masked"', 'when register AX otherwise "masked"', /flag or latch/],
  ['when flag IF otherwise "masked"', 'when flag IF otherwise ""', /nonempty reason/],
  ['when flag IF otherwise "masked"', 'when flag MISSING otherwise "masked"', /Unknown name/],
  ['accept action acceptInterrupt', 'accept action setIP', /no inputs/],
  ['accept action acceptInterrupt', 'accept action beginTrap\n      accept action acceptInterrupt', /Acceptance must appear once/],
  ['enter action enterInterrupt', 'enter action resetState', /one byte input/],
  ['enter action enterInterrupt', 'enter action pollWait', /CPU boundaries/],
  ['accept action acceptInterrupt\n      enter action enterInterrupt', 'enter action enterInterrupt\n      accept action acceptInterrupt', /after acceptance/],
  ['accept action acceptInterrupt', 'accept action acceptInterrupt\n      unless latch WAITING otherwise "waiting"', /gates must precede/],
  ['enter action enterInterrupt', 'enter action enterInterrupt\n      enter action enterInterrupt', /once, after acceptance/],
  ['      enter action enterInterrupt\n', '', /needs acceptance and delivery/],
  ['action acceptInterrupt "release WAIT and HLT before acknowledgement or entry" {', 'action acceptInterrupt "release WAIT and HLT before acknowledgement or entry" using memory {\n  perform enterInterrupt(u8(2))', /without using memory/],
  ['snapshot al = AL', 'snapshot al = missing', /Unknown state view/],
  ['snapshot al = AL', 'snapshot ax = AL', /reserved snapshot field/],
];
test("vector offer contracts reject unavailable effects, invalid ordering, and malformed declarations at their source locations", () => {
  for (const [before, after, message] of invalid) {
    assert.ok(text.includes(before), before);
    assert.throws(() => compileCpuChapter(text.replace(before, after), {}, file), error => {
      assert.ok(error instanceof ChapterError); assert.equal(error.file, file); assert.ok(error.line > 1);
      assert.match(error.message, message, before); return true;
    });
  }
});
