import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createCocoRomAnnotations, observeCocoRoms, cocoWalkthroughAvailable, cocoCheckpointReached } from "../../site/interactive/coco-rom-guide.js";
import type { CocoCheckpoint, CocoRomGuides } from "../../site/interactive/coco-rom-guide.js";
import { decode6809, address6809Operand } from "../../site/interactive/6809-disassembly.js";
import { code6809Rows } from "../../site/interactive/6809-code.js";
import { catalogue6809 as catalogue, state6809 } from "./6809-inspection-fixture.js";
import { preview6809 } from "../../site/interactive/6809-instruction-preview.js";
import { createCocoSession } from "../../site/interactive/coco-session.js";
import { readCocoStorage, cocoScreenText } from "../../site/interactive/coco-inspection.js";
import { cocoTextInput } from "../../site/interactive/coco-input.js";
import { previewCocoInstruction } from "../../site/interactive/coco-instruction-preview.js";
import { createExecutionTarget } from "../../site/interactive/execution-target.js";
import { createCocoDebugger, cocoDebugLocation } from "../../site/interactive/coco-debugger.js";
import { RomImage } from "../../src/machines/rom-image.js";
import { romImages } from "../../src/machines/generated/6809/coco.js";
import { renderCocoFrame } from "../../src/machines/6809/coco/runtime.js";

const chapter = readFileSync("src/machines/6809/coco.md", "utf8");
const guides: CocoRomGuides & Record<keyof CocoRomGuides, { sha256: string }> = JSON.parse(chapter.match(/```json\n([\s\S]*?)```/)![1]!);
const annotations = createCocoRomAnnotations(guides);
const decode = (address: number, bytes: readonly number[]) => decode6809(at => bytes[(at - address) & 0xffff], address, catalogue);
const mapping = (firmware: boolean, extended: boolean) => ({ firmware, extended, dos: false,
  mapped: (address: number) => extended && address >= 0x8000 && address < 0xa000
    || firmware && (address >= 0xa000 && address < 0xc000 || address >= 0xffe0),
});

test("CoCo notes describe supported 6809 instructions and symbols follow the two ROM sockets independently", () => {
  for (const socket of ["firmware", "extended"] as const) {
    assert.equal(guides[socket].sha256, romImages[socket].sha256);
    for (const note of guides[socket].notes) {
      const row = decode(parseInt(note.address, 16), note.bytes.split(" ").map(byte => parseInt(byte, 16)));
      assert.equal(row.complete, true, note.address); assert.equal(row.bytes.length, note.bytes.split(" ").length, note.address);
      assert.equal(annotations.observe(mapping(true, true))(row).note, note.text);
      assert.equal(annotations.observe(mapping(socket !== "firmware", socket !== "extended"))(row).note, undefined);
      assert.equal(annotations.observe(mapping(true, true))({ ...row, bytes: [0x12] }).note, undefined);
    }
  }
  const call = decode(0x9368, [0xbd, 0xb2, 0x6a]);
  assert.equal(annotations.observe(mapping(true, true))(call).operand?.label?.name, "OPEN_PAREN");
  assert.equal(annotations.observe(mapping(false, true))(call).operand?.label, undefined);
  assert.equal(annotations.observe(mapping(true, false))(decode(0x9361, [0x86, 1])).entry, undefined);
  const direct = decode(0x92c6, [0x96, 0xc0]);
  assert.equal(annotations.observe(mapping(true, true))(direct, 0).operand?.text, "VERBEG+1");
  assert.equal(annotations.observe(mapping(true, true))(direct).operand, undefined);
  assert.equal(annotations.observe(mapping(true, true))(direct, 0x30).operand?.address, 0x30c0);
  assert.equal(annotations.observe(mapping(true, true))(direct, 0x30).operand?.label, undefined);
  assert.equal(address6809Operand(decode(0x200, [0xb7, 0xff, 0x22])), 0xff22);
  assert.equal(annotations.observe(mapping(true, true))(decode(0x200, [0xb7, 0xff, 0x22])).operand?.label?.name, "PIA1_B");
  assert.equal(address6809Operand(decode(0xffff, [0x26, 0xfe])), 0xffff);
  for (const bytes of [[0x8e, 0x92, 0xe5], [0xa6, 0x84], [0xa6, 0x9f, 0xff, 0x00], [0xb6, 0xff]]) {
    assert.equal(address6809Operand(decode(0x200, bytes), 0), undefined, "Do not treat constants, indexed operands, or incomplete code as addresses");
  }
});

test("mapping observations and guide selection never read devices or relabel a held observation", () => {
  const session = createCocoSession(), machine = session.machine;
  machine.memory.read = () => { throw new Error("No bus reads during annotation"); };
  const before = machine.snapshot();
  const empty = observeCocoRoms(machine), held = annotations.observe(empty);
  assert.equal(held(decode(0xa027, [0x31, 0x8c, 0xe4])).entry, undefined);
  assert.deepEqual(machine.snapshot(), before);
  for (const [fw, ext] of [[false, false], [true, false], [false, true], [true, true]] as const) {
    const observed = mapping(fw, ext);
    assert.equal(cocoWalkthroughAvailable(guides.firmware.walkthroughs[0]!, guides, observed), fw && !ext);
    assert.equal(cocoWalkthroughAvailable(guides.extended.walkthroughs[0]!, guides, observed), fw && ext);
  }
  // Observe receives a value snapshot; callers retain the snapshot alongside their captured bytes.
  const snapshot = observeCocoRoms(machine);
  machine.sam.write(0x1f, 0);
  assert.equal(snapshot.firmware, false); assert.equal(observeCocoRoms(machine).mapped(0xa027), false);
});

test("the keyboard row stop distinguishes the captured data read from a fetch or a debounce read", () => {
  const step: CocoCheckpoint = guides.firmware.walkthroughs.find(tour => tour.id === "keyboard-echo")!.steps[0]!;
  const bytes = new Uint8Array(65536);
  bytes.set([0xa6, 0xc4], 0xa23a); bytes[0xff00] = 0xfd;
  const sample = (x: number) => preview6809(state6809({ pc: 0xa23a, u: 0xff00, x }), address => bytes[address], catalogue, () => "ram").record;
  const caller = { address: 0xa23a, space: "rom" }, read = sample(0x152);
  assert.ok(cocoCheckpointReached(step, caller, read));
  assert.ok(!cocoCheckpointReached(step, caller, sample(0)));
  assert.ok(!cocoCheckpointReached(step, { ...caller, space: "upper RAM" }, read));
  assert.ok(!cocoCheckpointReached({ ...step, after: { ...step.after!, access: { kind: "read", address: "A23A", value: "A6" } } }, caller, read));
  bytes[0xff00] = 0xff;
  assert.ok(!cocoCheckpointReached(step, caller, sample(0x152)));
});

test("one H reaches the row read, ASCII decode and echo, together and separately from the idle checkpoint", {
  skip: !process.env.COCO_ROM && "Set COCO_ROM to Color BASIC 1.3.",
}, async () => {
  const firmware = await RomImage.verify(readFileSync(process.env.COCO_ROM!), romImages.firmware,
    async bytes => createHash("sha256").update(bytes).digest("hex"));
  const session = createCocoSession(firmware);
  for (let i = 0; session.machine.cpu.snapshot().pc !== 0xa220; i++) { assert.ok(i < 300_000); session.step(); }
  const idle = session.snapshot();
  assert.equal(session.machine.ram.read(0x152), 0xff);
  assert.match(cocoScreenText(session.machine), /OK$/);
  const tour = guides.firmware.walkthroughs.find(tour => tour.id === "keyboard-echo")!;
  const stops: readonly CocoCheckpoint[] = tour.steps;
  assert.deepEqual(stops.map(step => step.title), ["Read keyboard row", "Decode H", "Echo H"]);
  const debug = createCocoDebugger(() => session.machine, catalogue);
  let last: ReturnType<typeof session.step> | undefined, caller: ReturnType<typeof cocoDebugLocation> | undefined;
  function replay(key: string): void {
    session.restore(idle); debug.reset(); last = caller = undefined;
    session.send(cocoTextInput(key));
  }
  function advance() {
    caller = cocoDebugLocation(session.machine);
    last = debug.capture(() => session.step(), caller);
    return last;
  }
  function runTo(step: CocoCheckpoint) {
    debug.runTo(parseInt(step.after!.pc, 16), "rom", () => cocoCheckpointReached(step, caller, last));
    for (let i = 0; !debug.beforeStep(); i++) { assert.ok(i < 8_000, step.title); advance(); }
    assert.equal(debug.stop?.kind, "target");
    assert.equal(cocoCheckpointReached(step, { address: last!.before.pc, space: "ram" }, last), false);
    return last!;
  }
  replay("H");
  const read = runTo(stops[0]!);
  assert.deepEqual([read.before.pc, read.after.pc, read.after.x, read.after.a], [0xa23a, 0xa23c, 0x0152, 0xfd]);
  assert.deepEqual(read.accesses.slice(2), [{ kind: "read", address: 0xff00, value: 0xfd }]);
  const decode = runTo(stops[1]!);
  assert.deepEqual([decode.before.pc, decode.instruction?.bytes, decode.before.b, decode.after.b], [0xa201, [0xca, 0x40], 8, 0x48]);
  const echo = runTo(stops[2]!);
  assert.deepEqual([echo.before.pc, echo.before.x, echo.after.x], [0xa342, 0x460, 0x461]);
  assert.deepEqual(echo.accesses.slice(2), [{ kind: "write", address: 0x460, value: 0x48 }]);
  assert.match(cocoScreenText(session.machine), /OK\nH$/);
  for (const [index, expected] of [read, decode, echo].entries()) {
    replay("H"); assert.deepEqual(runTo(stops[index]!), expected);
  }
  // I pulls down the same row in the next column and uses the same decode and echo instructions.
  replay("I");
  for (let i = 0; i < 8_000; i++) {
    const record = advance();
    assert.ok(stops.every(step => !cocoCheckpointReached(step, caller, record)));
    if (record.before.pc === 0xa342) break;
  }
  assert.match(cocoScreenText(session.machine), /OK\nI$/);
  debug.dispose();
});

const needsRoms = !(process.env.COCO_ROM && process.env.COCO_EXTENDED_ROM) && "Set COCO_ROM and COCO_EXTENDED_ROM for the guided real-ROM checks.";
async function sessionWithRoms() {
  const digest = async (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  const firmware = await RomImage.verify(readFileSync(process.env.COCO_ROM!), romImages.firmware, digest);
  const extended = await RomImage.verify(readFileSync(process.env.COCO_EXTENDED_ROM!), romImages.extended, digest);
  return { firmware, extended };
}

test("the chapter's PSET checkpoints reach the declared states and write exactly the independently calculated pixel", { skip: needsRoms }, async () => {
  const { firmware, extended } = await sessionWithRoms(), session = createCocoSession(firmware, extended), target = createExecutionTarget();
  const state = () => session.machine.cpu.snapshot(), read = (address: number) => readCocoStorage(session.machine, address);
  let steps = 0;
  function advance() { steps++; return session.step(); }
  function run(count: number): void { for (let i = 0; i < count; i++) advance(); }
  function settle(): void { for (let i = 0; i < 3_000_000 && !session.inputSettled; i++) advance(); assert.ok(session.inputSettled); run(20_000); }
  const observed = observeCocoRoms(session.machine), describe = annotations.observe(observed);
  const initial = session.snapshot();
  for (const guide of Object.values(guides)) for (const note of guide.notes) {
    const row = decode6809(read, parseInt(note.address, 16), catalogue);
    assert.equal(row.bytes.map(byte => byte!.toString(16).toUpperCase().padStart(2, "0")).join(" "), note.bytes, note.address);
    assert.equal(describe(row, 0).note, note.text);
  }
  assert.deepEqual(session.snapshot(), initial, "Annotations only observe storage");
  run(720_000);
  const section = chapter.split("## Follow PSET into graphics RAM\n")[1]!;
  const program = section.match(/```text\n([^`]+)\n```/)![1]!.split("\n");
  assert.equal(program.length, 6);
  for (const line of program) { session.send(cocoTextInput(line + "\n")); settle(); }
  session.send(cocoTextInput("RUN\n"));
  const tour = guides.extended.walkthroughs[0]!;
  const checkpoints = tour.steps.map(step => parseInt(step.address, 16));
  assert.deepEqual(checkpoints, [0x9361, 0x9374, 0x92c2, 0x92d9, 0x9377, 0x9386, 0x9388]);
  let saved: ReturnType<typeof session.snapshot> | undefined, psetStart: typeof saved;
  for (const address of checkpoints) {
    target.start(address, steps); while (!target.beforeStep(state().pc, steps)) advance();
    assert.equal(target.stopped, "reached"); assert.equal(state().pc, address); assert.equal(state().dp, 0);
    if (address === 0x9361) psetStart = session.snapshot();
    const row = decode6809(read, address, catalogue); assert.ok(describe(row, state().dp).note);
    if (address === 0x9374) {
      assert.deepEqual([0xb5, 0xb6, 0xb9, 0xba, 0xbb, 0xbd, 0xbe, 0xbf, 0xc0].map(read), [0xaa, 3, 32, 6, 0, 0, 65, 0, 96]);
    }
    if (address === 0x92c2) assert.equal(state().u, 0x92c2);
    if (address === 0x92d9) {
      assert.equal(state().x, 0x1210); assert.equal(state().u, 0x92e5); assert.equal(state().a, 1);
      advance(); assert.equal(state().a, 0x30);
    }
    if (address === 0x9377) { assert.equal(state().x, 0x1210); assert.equal(state().a, 0x30); }
    if (address !== 0x9388) assert.equal(read(0x1210), 0);
    if (address === 0x9386) {
      assert.equal(state().a, 0x20); saved = session.snapshot();
      const preview = previewCocoInstruction(session.machine, catalogue);
      assert.ok(preview.effects.includes("Write $1210 ← $20")); assert.deepEqual(session.snapshot(), saved);
      const record = advance();
      assert.deepEqual(record.accesses.filter(access => access.kind === "write"), [{ kind: "write", address: 0x1210, value: 0x20 }]);
      assert.equal(read(0x1210), 0x20);
      const rows = code6809Rows(read, state().pc, catalogue, [record]);
      assert.equal(rows[0]!.dp, 0); assert.equal(rows[1]!.dp, undefined);
      const resumed = createCocoSession(firmware, extended); resumed.restore(saved);
      assert.deepEqual(resumed.step(), record); assert.deepEqual(resumed.snapshot(), session.snapshot());
      // Discover the writer from the command entry, with the same debugger used by the lab.
      resumed.restore(psetStart!);
      const debug = createCocoDebugger(() => resumed.machine, catalogue);
      debug.setBreakpoints([{ address: 0x9361, enabled: true }]);
      debug.setWatchpoints([{ address: 0x1210, enabled: true }]);
      debug.run(); assert.equal(debug.beforeStep(), true); assert.equal(debug.stop?.kind, "breakpoint");
      assert.deepEqual(resumed.snapshot(), psetStart, "a breakpoint cannot consume a queued keyboard phase");
      debug.run();
      let count = 0;
      while (!debug.beforeStep()) { assert.ok(count++ < 100_000); debug.capture(() => resumed.step()); }
      assert.equal(debug.stop?.kind, "watchpoint");
      assert.equal(debug.hit?.kind, "write");
      assert.deepEqual([debug.hit?.record.instruction?.address, debug.hit?.address, debug.hit?.before, debug.hit?.after], [0x9386, 0x1210, 0, 0x20]);
      assert.deepEqual(resumed.snapshot(), session.snapshot());
      resumed.restore(saved); debug.reset(); debug.step();
      assert.deepEqual(debug.capture(() => resumed.step()), record);
      assert.equal(debug.stop?.kind, "watchpoint"); assert.equal(debug.watchpoints.length, 1); assert.equal(debug.breakpoints.length, 1);
      debug.dispose();
    }
  }
  settle(); const frame = renderCocoFrame(session.machine);
  for (let i = 0; i < frame.length; i++) assert.equal(frame[i], i === 96 * 256 + 130 || i === 96 * 256 + 131 ? 6 : 4);
  session.send(cocoTextInput(" ")); settle(); assert.match(cocoScreenText(session.machine), /OK\n█$/);
  // A loaded ROM's annotations remain held when the live machine switches to an unsupported map.
  session.machine.sam.write(0x1f, 0);
  assert.equal(observeCocoRoms(session.machine).mapped(0x9361), false);
  assert.equal(describe(decode(0x9361, [0x86, 1])).entry?.name, "PSET");
});

test("the authored base-ROM walkthrough reaches its call, cursor store and return checkpoints", { skip: needsRoms }, async () => {
  const { firmware } = await sessionWithRoms(), session = createCocoSession(firmware), target = createExecutionTarget();
  let steps = 0;
  const advance = () => { steps++; return session.step(); };
  const state = () => session.machine.cpu.snapshot();
  let beforeCall: ReturnType<typeof session.snapshot> | undefined;
  const stops = guides.firmware.walkthroughs[0]!.steps.map(step => parseInt(step.address, 16));
  assert.deepEqual(stops, [0xa027, 0xa07d, 0xa92d, 0xa936]);
  for (const address of stops) {
    target.start(address, steps); while (!target.beforeStep(state().pc, steps)) advance();
    assert.equal(target.stopped, "reached");
    if (address === 0xa027) { advance(); assert.equal(state().y, 0xa00e); }
    if (address === 0xa07d) {
      beforeCall = session.snapshot();
      advance(); assert.equal(state().pc, 0xa928); assert.equal(state().s, 0x3d5);
      assert.equal(session.machine.ram.read(0x3d5) * 256 + session.machine.ram.read(0x3d6), 0xa080);
    }
    if (address === 0xa92d) {
      assert.equal(state().x, 0x400); advance();
      assert.deepEqual([session.machine.ram.read(0x88), session.machine.ram.read(0x89)], [4, 0]);
    }
    if (address === 0xa936) {
      for (let at = 0x400; at < 0x600; at++) assert.equal(session.machine.ram.read(at), 0x60);
      advance(); assert.equal(state().pc, 0xa080); assert.equal(state().s, 0x3d7);
    }
  }
  const returned = session.snapshot(), debug = createCocoDebugger(() => session.machine, catalogue);
  function finish(): void {
    let count = 0;
    while (!debug.beforeStep()) { assert.ok(count++ < 10_000); debug.capture(() => session.step()); }
  }
  session.restore(beforeCall!); debug.reset(); debug.over(); finish();
  assert.equal(debug.stop?.kind, "over"); assert.deepEqual(session.snapshot(), returned);
  session.restore(beforeCall!); debug.reset(); debug.step(); debug.capture(() => session.step());
  assert.equal(debug.frames[0]?.entry.address, 0xa928); assert.equal(debug.frames[0]?.returnAddress, 0xa080);
  debug.out(); finish(); assert.equal(debug.stop?.kind, "out"); assert.deepEqual(session.snapshot(), returned);
  debug.dispose();

});
