import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createCocoSession } from "../../site/interactive/coco-session.js";
import { cocoSavedState } from "../../site/interactive/coco-saved-state.js";
import { cocoScreenText, readCocoStorage } from "../../site/interactive/coco-inspection.js";
import { cocoDefaultLayout, cocoWorkspaceKey } from "../../site/interactive/coco-workspace.js";
import { groups } from "../../site/interactive/workspace/layout.js";
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
  for (const invalid of ["{", "null", " ".repeat(1_000_001), JSON.stringify({ ...JSON.parse(text), version: 2 }),
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

test("the CoCo workspace restores all eight tools independently of Apple II layout preferences", () => {
  const ids = ["screen", "execution", "registers", "memory", "sam", "pias", "rom", "states"];
  const restored = decodeWorkspaceState(encodeWorkspaceState(cocoDefaultLayout), ids);
  assert.deepEqual(groups(restored).flatMap(group => group.panels).sort(), [...ids].sort());
  assert.match(cocoWorkspaceKey, /:coco:/);
});
