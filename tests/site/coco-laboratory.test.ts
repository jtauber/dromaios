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
  assert.throws(() => session.restore({ ...saved, input: [["A"]], pressed: true, remaining: 8 }));
  assert.deepEqual(session.snapshot(), saved, "a rejected snapshot does not replace the running machine");
});

test("one browser checkpoint preserves native state, rejects stale formats, and survives a failed replacement", () => {
  const storage = memoryStorage(), checkpoint = cocoSavedState(() => storage), session = createCocoSession();
  assert.equal(checkpoint.read(), undefined); session.machine.ram.write(100, 99); checkpoint.save(session.snapshot());
  session.powerOn(); session.restore(checkpoint.read()!.state); assert.equal(session.machine.ram.read(100), 99);
  const [key, text] = [...storage.values][0]!;
  storage.setItem = () => { throw new Error("Quota"); };
  assert.throws(() => checkpoint.save(createCocoSession().snapshot()), /Quota/); assert.equal(storage.values.get(key), text);
  for (const invalid of ["{", "null", " ".repeat(1_000_001), JSON.stringify({ ...JSON.parse(text), version: 3 }),
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

test("the CoCo workspace restores all sixteen tools and migrates older layouts only once", () => {
  const ids = ["screen", "execution", "registers", "memory", "sam", "pias", "rom", "states", "code", "instruction", "direct-page", "stack-s", "stack-u", "walkthrough", "debugger", "calls"];
  const restored = decodeWorkspaceState(encodeWorkspaceState(cocoDefaultLayout), ids);
  assert.deepEqual(groups(restored).flatMap(group => group.panels).sort(), [...ids].sort());
  assert.match(cocoWorkspaceKey, /:coco:/);
  const storage = memoryStorage();
  let previous = ["code", "instruction", "pias", "direct-page", "stack-s", "stack-u", "debugger", "calls"].reduce(closePanel, cocoDefaultLayout);
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

test("old BASIC-only checkpoints migrate to an empty extension socket, while new snapshots must specify it", () => {
  const storage = memoryStorage(), checkpoint = cocoSavedState(() => storage), session = createCocoSession();
  session.machine.ram.write(0x3456, 0x78); checkpoint.save(session.snapshot());
  const [key, current] = [...storage.values][0]!, envelope = JSON.parse(current);
  assert.equal(envelope.version, 2);
  const { extended, ...oldHardware } = envelope.state.hardware;
  const old = { ...envelope, version: 1, state: { ...envelope.state, hardware: oldHardware } };
  storage.setItem(key, JSON.stringify(old));
  const migrated = checkpoint.read()!; assert.equal(migrated.version, 2); assert.equal(migrated.state.hardware.extended, null);
  session.powerOn(); session.restore(migrated.state); assert.equal(session.machine.ram.read(0x3456), 0x78);
  assert.equal(storage.getItem(key), JSON.stringify(old), "reading does not overwrite a recoverable old checkpoint");
  storage.setItem(key, JSON.stringify({ ...old, version: 2 }));
  assert.throws(() => session.restore(checkpoint.read()!.state), /Machine snapshot requires/);
  storage.setItem(key, JSON.stringify({ ...envelope, version: 1 }));
  assert.throws(() => checkpoint.read(), /Machine snapshot requires/, "a v1 record cannot claim an extension");
});

test("the CoCo walkthrough joins a version-3 ROM tab set once and preserves its selection and hidden tools", () => {
  const ids = groups(cocoDefaultLayout).flatMap(group => group.panels);
  const previous = ["walkthrough", "pias", "debugger", "calls"].reduce(closePanel, cocoDefaultLayout);
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
  const previous = ["debugger", "walkthrough", "pias", "calls"].reduce(closePanel, cocoDefaultLayout);
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
  const previous = ["calls", "debugger", "walkthrough"].reduce(closePanel, cocoDefaultLayout);
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
