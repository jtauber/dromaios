import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { RomImage } from "../../src/machines/rom-image.js";
import { romImages } from "../../src/machines/generated/6809/coco.js";
import { createCocoSession } from "../../site/interactive/coco-session.js";
import { cocoScreenText, readCocoStorage } from "../../site/interactive/coco-inspection.js";
import { create6809MemoryObservation } from "../../site/interactive/6809-memory.js";
import { createCocoDebugger, observeCocoBoundary } from "../../site/interactive/coco-debugger.js";
import { createCocoWatchHistory } from "../../site/interactive/coco-watch-history.js";
import { accessStopHistoryActions } from "../../site/interactive/mapped-access-stops.js";
import { createCocoChangeLog } from "../../site/interactive/coco-change-log.js";
import { catalogue6809 } from "./6809-inspection-fixture.js";
import { createExecutionTarget } from "../../site/interactive/execution-target.js";

test("Color BASIC walkthrough reaches its real-ROM stops and exposes calls, direct-page stores, and keyboard input", {
  skip: !process.env.COCO_ROM && "Set COCO_ROM to the selected Color BASIC 1.3 image.",
}, async () => {
  const firmware = await RomImage.verify(readFileSync(process.env.COCO_ROM!), romImages.firmware,
    async bytes => createHash("sha256").update(bytes).digest("hex"));
  const session = createCocoSession(firmware), target = createExecutionTarget(), view = create6809MemoryObservation();
  const state = () => session.machine.cpu.snapshot();
  const read = (address: number) => readCocoStorage(session.machine, address);
  let steps = 0;
  function step(): void { assert.equal(session.step().outcome, "executed"); steps++; }
  function stop(address: number): void {
    target.start(address, steps);
    while (!target.beforeStep(state().pc, steps)) step();
    assert.equal(target.stopped, "reached"); assert.equal(state().pc, address);
    view.refresh(read, state());
  }
  assert.equal(state().pc, 0xa027); step(); assert.equal(state().y, 0xa00e);
  stop(0xa051); step(); assert.equal(state().u, 0xffc0);
  view.refresh(read, state()); assert.equal(view.byte(view.pointer("u")).value, undefined);
  stop(0xa05e); step(); assert.equal(state().dp, 0); assert.equal(state().b, 0);
  stop(0xa00e); step(); assert.equal(state().s, 0x3d7);
  stop(0xa07d); step(); view.refresh(read, state());
  assert.equal(state().pc, 0xa928); assert.equal(view.pointer("s"), 0x3d5);
  assert.equal(view.word(0x3d5), 0xa080); assert.equal(view.byte(0x3d5).changed, true);
  step(); step(); step(); view.refresh(read, state());
  assert.equal(state().pc, 0xa92f); assert.equal(view.word(0x88), 0x400);
  stop(0xa936); assert.equal(view.word(0x3d5), 0xa080);
  for (let address = 0x400; address <= 0x5ff; address++) assert.equal(view.byte(address).value, 0x60);
  step(); assert.equal(state().pc, 0xa080); assert.equal(state().s, 0x3d7);
  view.refresh(read, state()); assert.equal(view.word(0x3d5), 0xa080); assert.equal(view.byte(0x3d5).changed, false);
  stop(0xa1d9); assert.equal(state().u, 0xff00);
  step(); assert.equal(session.machine.pias.snapshot().pia0.orb, 0xfe);
  stop(0xa23a); step(); assert.equal(state().a, 0xff); assert.equal(state().pc, 0xa23c);
  for (let i = 0; i < 100_000; i++) step();
  assert.match(cocoScreenText(session.machine), /COLOR BASIC 1\.3\n\(C\) 1982 TANDY\nOK/);
});

test("a stop armed from Color BASIC's screen-clear history survives restoring the caller and lets the banner writer through", {
  skip: !process.env.COCO_ROM && "Set COCO_ROM to the selected Color BASIC 1.3 image.",
}, async () => {
  const firmware = await RomImage.verify(readFileSync(process.env.COCO_ROM!), romImages.firmware,
    async bytes => createHash("sha256").update(bytes).digest("hex"));
  const session = createCocoSession(firmware), debug = createCocoDebugger(() => session.machine, catalogue6809);
  const history = createCocoWatchHistory(), screen = { address: 0x400, enabled: false };
  let log = createCocoChangeLog(session.machine);
  function finish(limit: number) {
    let record: ReturnType<typeof session.step> | undefined;
    while (!debug.beforeStep()) {
      assert.ok(limit-- > 0, "Expected a debugger stop");
      const before = observeCocoBoundary(session.machine, record?.after);
      record = log.capture(() => debug.capture(() => session.step(), before.caller), before);
      const transfers = history.observe(record, before.caller, debug.watchpoints, log.memoryWrites(record));
      debug.observeAccesses(record, before.caller, transfers);
    }
    return record;
  }
  debug.runTo(0xa07d, "rom"); finish(10_000);
  assert.equal(session.machine.cpu.snapshot().pc, 0xa07d);
  const checkpoint = session.snapshot();
  debug.setWatchpoints([screen]); debug.over(); finish(10_000);
  const entries = history.entries(screen);
  assert.equal(entries.length, 1);
  const entry = entries[0]!;
  assert.deepEqual(entry.caller, { address: 0xa92f, space: "rom" });
  assert.equal(entry.value, 0x60); assert.deepEqual(entry.storage, { address: 0x400, before: 0, after: 0x60 });
  debug.accessStops.set([{ ...entry, enabled: true }]); debug.setWatchpoints([]); history.configure([]);
  log.dispose(); session.restore(checkpoint); debug.reset(); history.reset();
  log = createCocoChangeLog(session.machine); log.recording = false;
  debug.run(); finish(10);
  assert.equal(debug.stop?.kind, "event"); assert.equal(debug.stop?.location.address, 0xa931);
  assert.match(debug.stop?.detail ?? "", /\$A92F \(rom\) · WRITE \$0400 = \$60 · STB ,X\+/);
  assert.equal(session.machine.cpu.snapshot().x, 0x401); assert.equal(session.machine.ram.read(0x400), 0x60);
  assert.equal(history.entries(screen).length, 0);
  debug.runTo(0xa344, "rom"); const banner = finish(300_000);
  assert.equal(debug.stop?.kind, "target"); assert.equal(banner?.instruction?.address, 0xa342);
  assert.deepEqual(log.memoryWrites(banner), [{ address: 0x400, before: 0x60, after: 0x43 }]);
  assert.equal(session.machine.ram.read(0x400), 0x43);
  log.dispose(); debug.dispose();
});

test("replaying Color BASIC's keyboard read samples the PIA once and catches both idle and pressed rows", {
  skip: !process.env.COCO_ROM && "Set COCO_ROM to the selected Color BASIC 1.3 image.",
}, async () => {
  const firmware = await RomImage.verify(readFileSync(process.env.COCO_ROM!), romImages.firmware,
    async bytes => createHash("sha256").update(bytes).digest("hex"));
  const session = createCocoSession(firmware), debug = createCocoDebugger(() => session.machine, catalogue6809);
  for (let limit = 500_000; session.machine.cpu.snapshot().pc !== 0xa23a; limit--) {
    assert.ok(limit > 0, "Boot must reach the keyboard scan"); session.step();
  }
  const checkpoint = session.snapshot(), history = createCocoWatchHistory(), watch = { address: 0xff00, enabled: true };
  assert.equal(checkpoint.hardware.pias.pia0.orb, 0xfe);
  function sample() {
    const { machine } = session, before = observeCocoBoundary(machine);
    let samples = 0;
    const read = machine.pias.read.bind(machine.pias);
    machine.pias.read = offset => { if (offset === 0) samples++; return read(offset); };
    const record = debug.capture(() => session.step(), before.caller);
    history.observe(record, before.caller, [], [], debug.readWatchpoints);
    assert.equal(samples, 1);
    assert.equal(record.after.pc, 0xa23c);
    return record.after.a;
  }
  debug.setReadWatchpoints([watch]); assert.equal(sample(), 0xff);
  assert.equal(debug.stop?.kind, "watchpoint");
  const [entry] = history.reads.entries(watch);
  assert.ok(entry); assert.deepEqual(entry.caller, { space: "rom", address: 0xa23a });
  assert.deepEqual([entry.kind, entry.address, entry.value], ["read", 0xff00, 0xff]);
  debug.accessStops.set([{ ...entry, enabled: true }]); debug.setReadWatchpoints([]);
  for (const key of [undefined, "H"] as const) {
    session.restore(checkpoint); history.reset(); debug.reset();
    if (key) session.send([[key]]);
    debug.run();
    const value = sample();
    assert.equal(value, key ? 0xfd : 0xff); assert.equal(debug.stop?.kind, "event");
    assert.match(debug.stop?.detail ?? "", key ? /READ \$FF00 = \$FD · LDA ,U/ : /READ \$FF00 = \$FF · LDA ,U/);
    assert.equal(debug.hit?.kind, "read"); assert.equal(debug.hit?.address, 0xff00);
    assert.deepEqual(history.reads.entries(watch), []);
  }
  // Capture the pressed sample, then arm its value and remove the address watch.
  session.restore(checkpoint); history.reset(); debug.reset(); debug.accessStops.set([]);
  debug.setReadWatchpoints([watch]); session.send([["H"]]); assert.equal(sample(), 0xfd);
  const [pressed] = history.reads.entries(watch); assert.ok(pressed);
  accessStopHistoryActions(point => debug.accessStops.set([{ ...point, enabled: true }])).stopOnValue(pressed);
  debug.setReadWatchpoints([]); history.reset(); session.restore(checkpoint); debug.reset();
  let idleReads = 0;
  debug.runTo(0xa220, "rom");
  for (let i = 0; !debug.beforeStep(); i++) {
    assert.ok(i < 100_000);
    const record = debug.capture(() => session.step());
    if (record.instruction?.address === 0xa23a) {
      assert.equal(record.after.a, 0xff); idleReads++;
    }
  }
  assert.ok(idleReads >= 3); assert.equal(debug.stop?.kind, "target");
  session.send([["H"]]); debug.run();
  for (let i = 0; !debug.beforeStep(); i++) { assert.ok(i < 50_000); debug.capture(() => session.step()); }
  assert.equal(debug.stop?.kind, "event"); assert.equal(debug.stop?.location.address, 0xa23c);
  assert.match(debug.stop?.detail ?? "", /\$A23A \(rom\) · READ \$FF00 = \$FD · LDA ,U/);
  assert.equal(session.machine.cpu.snapshot().a, 0xfd);
  debug.dispose();
});
