import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createCocoSession } from "../../site/interactive/coco-session.js";
import { cocoSavedState } from "../../site/interactive/coco-saved-state.js";
import { cocoScreenText, readCocoStorage } from "../../site/interactive/coco-inspection.js";
import { cocoDefaultLayout, cocoWorkspaceKey, migrateCocoWorkspace } from "../../site/interactive/coco-workspace.js";
import { groups, closePanel, collapseGroup, panelGroup } from "../../site/interactive/workspace/layout.js";
import { decodeWorkspaceState, encodeWorkspaceState } from "../../site/interactive/workspace/state.js";
import { romFileStorage } from "../../site/interactive/rom-storage.js";
import { readRomFile } from "../../site/interactive/rom-file.js";

function memoryStorage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}

function withoutDisk(state: ReturnType<ReturnType<typeof createCocoSession>["snapshot"]>) {
  const { diskName, hardware, ...input } = state;
  const { dos, disk, ...base } = hardware;
  return { ...input, hardware: base };
}

test("a ROM-free CoCo exposes RAM, while inspection leaves pending PIA edges and keyboard switches untouched", () => {
  const session = createCocoSession(), machine = session.machine;
  machine.ram.write(0x1234, 0x56); machine.pias.write(1, 5); machine.pias.setHorizontalSync(false);
  machine.pias.setKey("A", true); const before = machine.snapshot();
  assert.equal(machine.pias.irq, true);
  machine.memory.read = () => { throw new Error("An inspector must not read the guest bus"); };
  assert.equal(readCocoStorage(machine, 0x1234), 0x56);
  for (const address of [0x8000, 0xa000, 0xff00, 0xff20, 0xffc0, 0xfffc]) assert.equal(readCocoStorage(machine, address), undefined);
  assert.equal(cocoScreenText(machine), ""); assert.deepEqual(machine.snapshot(), before);
  for (const address of [-1, 0x10000, NaN, .5]) assert.throws(() => readCocoStorage(machine, address));
  assert.throws(() => session.step(), /Load Color BASIC/); assert.throws(() => session.send([["A"]]), /Load Color BASIC/);
  session.releaseInput(); const saved = session.snapshot();
  session.powerOn(); assert.equal(session.machine.ram.read(0x1234), 0); session.restore(saved);
  assert.deepEqual(session.snapshot(), saved);
  assert.throws(() => session.restore({ ...saved, hardware: { ...saved.hardware, ram: [] } }));
  assert.throws(() => session.restore({ ...saved, input: [["A"]], pressed: true, remainingClocks: 8 }));
  assert.deepEqual(session.snapshot(), saved, "a rejected snapshot does not replace the running machine");
});

test("one browser checkpoint preserves native state, rejects stale formats, and survives a failed replacement", () => {
  const storage = memoryStorage(), session = createCocoSession(), checkpoint = cocoSavedState(() => storage, session.machine.clock.hertz!);
  assert.equal(checkpoint.read(), undefined); session.machine.ram.write(100, 99); checkpoint.save(session.snapshot());
  session.powerOn(); session.restore(checkpoint.read()!.state); assert.equal(session.machine.ram.read(100), 99);
  const [key, text] = [...storage.values][0]!;
  storage.setItem = () => { throw new Error("Quota"); };
  assert.throws(() => checkpoint.save(createCocoSession().snapshot()), /Quota/); assert.equal(storage.values.get(key), text);
  for (const invalid of ["{", "null", " ".repeat(4_000_001), JSON.stringify({ ...JSON.parse(text), version: 8 }),
    JSON.stringify({ ...JSON.parse(text), machine: "apple2" }), JSON.stringify({ ...JSON.parse(text), savedAt: "never" })]) {
    storage.values.set(key, invalid); assert.throws(() => checkpoint.read());
  }
  checkpoint.forget(); assert.equal(checkpoint.read(), undefined);
});

test("CoCo ROM storage verifies bytes again and uses a key separate from Apple II media", async () => {
  const bytes = Uint8Array.of(1, 2, 3), expected = { size: 3, sha256: createHash("sha256").update(bytes).digest("hex") };
  const storage = memoryStorage(); storage.setItem("dromaios:apple2-rom:v1", "unrelated media");
  const rom = romFileStorage(() => storage, "dromaios:coco-rom:v1", 3, file => readRomFile(file, expected));
  const prepared = await rom.prepare({ name: "coco.rom", size: 3, async arrayBuffer() { return bytes.buffer; } });
  rom.remember(prepared.stored); assert.equal((await rom.restore())?.image.createRom(expected).read(2), 3);
  storage.setItem("dromaios:coco-rom:v1", JSON.stringify({ name: "coco.rom", base64: btoa("bad") }));
  await assert.rejects(rom.restore(), /SHA-256/); rom.forget();
  assert.equal(storage.getItem("dromaios:apple2-rom:v1"), "unrelated media");
});

test("the CoCo workspace restores all twenty tools and migrates older layouts only once", () => {
  const ids = ["screen", "execution", "registers", "memory", "sam", "pias", "rom", "states", "code", "instruction", "direct-page", "stack-s", "stack-u", "walkthrough", "debugger", "calls", "log", "joysticks", "cassette", "disk"];
  const restored = decodeWorkspaceState(encodeWorkspaceState(cocoDefaultLayout), ids);
  assert.deepEqual(groups(restored).flatMap(group => group.panels).sort(), [...ids].sort());
  assert.match(cocoWorkspaceKey, /:coco:/);
  const storage = memoryStorage();
  let previous = ["disk", "code", "instruction", "pias", "direct-page", "stack-s", "stack-u", "debugger", "calls", "log"].reduce(closePanel, cocoDefaultLayout);
  previous = collapseGroup(previous, panelGroup(previous, "sam")!.id, true);
  storage.setItem("dromaios:workspace:coco:1", encodeWorkspaceState(previous));
  migrateCocoWorkspace(storage, ids);
  const migrated = decodeWorkspaceState(storage.getItem(cocoWorkspaceKey)!, ids);
  assert.ok(panelGroup(migrated, "code")); assert.ok(panelGroup(migrated, "instruction"));
  for (const id of ["direct-page", "stack-s", "stack-u", "debugger"]) assert.ok(panelGroup(migrated, id));
  assert.equal(panelGroup(migrated, "pias"), undefined); assert.equal(panelGroup(migrated, "sam")?.collapsed, true);
  const hidden = encodeWorkspaceState(closePanel(migrated, "code")); storage.setItem(cocoWorkspaceKey, hidden);
  migrateCocoWorkspace(storage, ids); assert.equal(storage.getItem(cocoWorkspaceKey), hidden);

  const version2 = memoryStorage();
  version2.setItem("dromaios:workspace:coco:2", encodeWorkspaceState(previous));
  migrateCocoWorkspace(version2, ids);
  const updated = decodeWorkspaceState(version2.getItem(cocoWorkspaceKey)!, ids);
  for (const id of ["code", "instruction", "pias"]) assert.equal(panelGroup(updated, id), undefined, `Keep ${id} hidden`);
  for (const id of ["direct-page", "stack-s", "stack-u"]) assert.ok(panelGroup(updated, id));
  assert.deepEqual(panelGroup(updated, "memory")?.panels, ["memory", "direct-page", "stack-s", "stack-u", "calls"]);
  assert.equal(panelGroup(updated, "memory")?.active, "memory");
  const hiddenStack = encodeWorkspaceState(closePanel(updated, "stack-u")); version2.setItem(cocoWorkspaceKey, hiddenStack);
  migrateCocoWorkspace(version2, ids); assert.equal(version2.getItem(cocoWorkspaceKey), hiddenStack);
});

test("legacy checkpoints preserve queued chords and convert phase progress explicitly", () => {
  const storage = memoryStorage(), session = createCocoSession(), checkpoint = cocoSavedState(() => storage, session.machine.clock.hertz!);
  session.machine.ram.write(0x3456, 0x78); session.machine.clock.advance(1234);
  session.machine.pias.setKey("A", true);
  const current = { ...session.snapshot(), input: [["A"]] as const, pressed: true, remainingClocks: 22_373 };
  checkpoint.save(current);
  const [key, text] = [...storage.values][0]!, envelope = JSON.parse(text);
  assert.equal(envelope.version, 7);
  session.restore(checkpoint.read()!.state); assert.deepEqual(session.snapshot(), current);
  for (const version of [1, 2, 3]) {
    const { remainingClocks, ...state } = withoutDisk(current);
    const { extended, clock, pias, ...base } = state.hardware;
    const { joysticks, cassette, ...oldPias } = pias;
    const hardware = { ...base, pias: oldPias, ...(version >= 2 ? { extended } : {}), ...(version === 3 ? { clock } : {}) };
    const old = { ...envelope, version, state: { ...state, hardware, remaining: 6000 } };
    storage.setItem(key, JSON.stringify(old));
    const migrated = checkpoint.read()!;
    assert.equal(migrated.version, 7); assert.equal(migrated.state.remainingClocks, 22_373);
    assert.deepEqual(migrated.state.input, [["A"]]); assert.equal(migrated.state.pressed, true);
    session.restore(migrated.state); assert.equal(session.machine.ram.read(0x3456), 0x78);
    assert.equal(session.machine.clock.ticks, version === 3 ? 1234 : 0);
    assert.equal(storage.getItem(key), JSON.stringify(old), "reading leaves the original checkpoint recoverable");
    for (const remaining of [-1, 12_001, 0.5]) {
      storage.setItem(key, JSON.stringify({ ...old, state: { ...old.state, remaining } }));
      assert.throws(() => checkpoint.read(), /Remaining keyboard steps/);
    }
  }
  for (const version of [1, 2, 3, 4]) {
    const { remainingClocks, ...state } = withoutDisk(current);
    const { clock, ...withoutClock } = state.hardware;
    const malformed = { ...envelope, version, state: { ...state, hardware: version === 3 ? withoutClock : state.hardware, remaining: 0 } };
    storage.setItem(key, JSON.stringify(malformed));
    assert.throws(() => session.restore(checkpoint.read()!.state), /Machine snapshot requires/);
  }
});

test("version-4 checkpoints gain disconnected joysticks; current snapshots retain connected positions and fire", () => {
  const storage = memoryStorage(), session = createCocoSession(), checkpoint = cocoSavedState(() => storage, session.machine.clock.hertz!);
  const original = session.snapshot(); checkpoint.save(original);
  const [key, text] = [...storage.values][0]!;
  const { joysticks, cassette, ...oldPias } = original.hardware.pias;
  const old = { ...JSON.parse(text), version: 4, state: { ...withoutDisk(original), hardware: { ...withoutDisk(original).hardware, pias: oldPias } } };
  storage.setItem(key, JSON.stringify(old));
  const migrated = checkpoint.read()!;
  assert.equal(migrated.version, 7); session.restore(migrated.state); assert.deepEqual(session.snapshot(), original);
  assert.equal(storage.getItem(key), JSON.stringify(old));
  session.machine.pias.connectJoystick("right", true); session.machine.pias.setJoystickPosition("right", 7, 58);
  session.machine.pias.setJoystickButton("right", true);
  const held = session.snapshot(); checkpoint.save(held); session.powerOn(); session.restore(checkpoint.read()!.state);
  assert.deepEqual(session.snapshot(), held);
  storage.setItem(key, JSON.stringify({ ...old, version: 6 }));
  assert.throws(() => session.restore(checkpoint.read()!.state), /Machine snapshot requires/);
  assert.deepEqual(session.snapshot(), held);
});

test("Joysticks joins the version-7 PIA group once while preserving layout choices", () => {
  const ids = groups(cocoDefaultLayout).flatMap(group => group.panels), storage = memoryStorage();
  const previous = ["disk", "cassette", "joysticks", "log"].reduce(closePanel, cocoDefaultLayout), pia = panelGroup(previous, "pias")!;
  storage.setItem("dromaios:workspace:coco:7", encodeWorkspaceState(collapseGroup(previous, pia.id, true)));
  migrateCocoWorkspace(storage, ids);
  const migrated = decodeWorkspaceState(storage.getItem(cocoWorkspaceKey)!, ids);
  assert.deepEqual(panelGroup(migrated, "pias")?.panels, ["pias", "joysticks", "cassette", "disk"]);
  assert.equal(panelGroup(migrated, "pias")?.active, "pias"); assert.equal(panelGroup(migrated, "pias")?.collapsed, true);
  assert.equal(panelGroup(migrated, "log"), undefined);
  const hidden = encodeWorkspaceState(closePanel(migrated, "joysticks")); storage.setItem(cocoWorkspaceKey, hidden);
  migrateCocoWorkspace(storage, ids); assert.equal(storage.getItem(cocoWorkspaceKey), hidden);
});

test("Cassette joins version-8 controls without reopening a hidden joystick panel", () => {
  const ids = groups(cocoDefaultLayout).flatMap(group => group.panels), storage = memoryStorage();
  const previous = ["disk", "cassette", "joysticks"].reduce(closePanel, cocoDefaultLayout);
  storage.setItem("dromaios:workspace:coco:8", encodeWorkspaceState(previous));
  migrateCocoWorkspace(storage, ids);
  const migrated = decodeWorkspaceState(storage.getItem(cocoWorkspaceKey)!, ids);
  assert.ok(panelGroup(migrated, "cassette")); assert.equal(panelGroup(migrated, "joysticks"), undefined);
  const hidden = encodeWorkspaceState(closePanel(migrated, "cassette")); storage.setItem(cocoWorkspaceKey, hidden);
  migrateCocoWorkspace(storage, ids); assert.equal(storage.getItem(cocoWorkspaceKey), hidden);
});

test("the CoCo walkthrough joins a version-3 ROM tab set once and preserves its selection and hidden tools", () => {
  const ids = groups(cocoDefaultLayout).flatMap(group => group.panels);
  const previous = ["disk", "walkthrough", "pias", "debugger", "calls"].reduce(closePanel, cocoDefaultLayout);
  const rom = panelGroup(previous, "rom")!, collapsed = collapseGroup(previous, rom.id, true), storage = memoryStorage();
  storage.setItem("dromaios:workspace:coco:3", encodeWorkspaceState(collapsed));
  migrateCocoWorkspace(storage, ids);
  const migrated = decodeWorkspaceState(storage.getItem(cocoWorkspaceKey)!, ids);
  assert.deepEqual(panelGroup(migrated, "rom")?.panels, ["rom", "states", "walkthrough"]);
  assert.equal(panelGroup(migrated, "rom")?.active, rom.active); assert.equal(panelGroup(migrated, "rom")?.collapsed, true);
  assert.equal(panelGroup(migrated, "pias"), undefined);
  const hidden = encodeWorkspaceState(closePanel(migrated, "walkthrough")); storage.setItem(cocoWorkspaceKey, hidden);
  migrateCocoWorkspace(storage, ids); assert.equal(storage.getItem(cocoWorkspaceKey), hidden);
});

test("the debugger joins version-4 Execution once without reopening hidden tools or changing its selection", () => {
  const ids = groups(cocoDefaultLayout).flatMap(group => group.panels);
  const previous = ["disk", "debugger", "walkthrough", "pias", "calls"].reduce(closePanel, cocoDefaultLayout);
  const execution = panelGroup(previous, "execution")!, storage = memoryStorage();
  storage.setItem("dromaios:workspace:coco:4", encodeWorkspaceState(collapseGroup(previous, execution.id, true)));
  migrateCocoWorkspace(storage, ids);
  const migrated = decodeWorkspaceState(storage.getItem(cocoWorkspaceKey)!, ids);
  assert.deepEqual(panelGroup(migrated, "debugger")?.panels, ["execution", "debugger"]);
  assert.equal(panelGroup(migrated, "execution")?.active, "execution"); assert.equal(panelGroup(migrated, "execution")?.collapsed, true);
  for (const id of ["walkthrough", "pias"]) assert.equal(panelGroup(migrated, id), undefined);
  const hidden = encodeWorkspaceState(closePanel(migrated, "debugger")); storage.setItem(cocoWorkspaceKey, hidden);
  migrateCocoWorkspace(storage, ids); assert.equal(storage.getItem(cocoWorkspaceKey), hidden);
});

test("Call stack joins version-5 System Stack once, retaining collapsed groups and deliberately hidden tools", () => {
  const ids = groups(cocoDefaultLayout).flatMap(group => group.panels), storage = memoryStorage();
  const previous = ["disk", "calls", "debugger", "walkthrough"].reduce(closePanel, cocoDefaultLayout);
  const stack = panelGroup(previous, "stack-s")!;
  storage.setItem("dromaios:workspace:coco:5", encodeWorkspaceState(collapseGroup(previous, stack.id, true)));
  migrateCocoWorkspace(storage, ids);
  const migrated = decodeWorkspaceState(storage.getItem(cocoWorkspaceKey)!, ids);
  assert.deepEqual(panelGroup(migrated, "calls")?.panels, ["stack-s", "calls"]);
  assert.equal(panelGroup(migrated, "calls")?.active, "stack-s"); assert.equal(panelGroup(migrated, "calls")?.collapsed, true);
  assert.equal(panelGroup(migrated, "debugger"), undefined); assert.equal(panelGroup(migrated, "walkthrough"), undefined);
  const hidden = encodeWorkspaceState(closePanel(migrated, "calls")); storage.setItem(cocoWorkspaceKey, hidden);
  migrateCocoWorkspace(storage, ids); assert.equal(storage.getItem(cocoWorkspaceKey), hidden);
});


test("Changes joins version-6 Disassembly once without changing selected, collapsed, or hidden tools", () => {
  const ids = groups(cocoDefaultLayout).flatMap(group => group.panels), storage = memoryStorage();
  const previous = ["disk", "log", "calls", "debugger"].reduce(closePanel, cocoDefaultLayout);
  const code = panelGroup(previous, "code")!;
  storage.setItem("dromaios:workspace:coco:6", encodeWorkspaceState(collapseGroup(previous, code.id, true)));
  migrateCocoWorkspace(storage, ids);
  const migrated = decodeWorkspaceState(storage.getItem(cocoWorkspaceKey)!, ids);
  assert.deepEqual(panelGroup(migrated, "log")?.panels, ["code", "log"]);
  assert.equal(panelGroup(migrated, "log")?.active, "code"); assert.equal(panelGroup(migrated, "log")?.collapsed, true);
  assert.equal(panelGroup(migrated, "calls"), undefined); assert.equal(panelGroup(migrated, "debugger"), undefined);
  const hidden = encodeWorkspaceState(closePanel(migrated, "log")); storage.setItem(cocoWorkspaceKey, hidden);
  migrateCocoWorkspace(storage, ids); assert.equal(storage.getItem(cocoWorkspaceKey), hidden);
});
