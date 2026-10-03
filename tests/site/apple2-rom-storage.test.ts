import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { apple2RomStorage } from "../../site/interactive/apple2-rom-storage.js";

const firmware = Uint8Array.of(0x4c, 0x00, 0xd0);
const bootstrap = Uint8Array.from({ length: 256 }, (_, byte) => byte);
const container = Uint8Array.from([...bootstrap, ...firmware]);
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const expected = { size: firmware.length, sha256: hash(firmware) };
const media = {
  bytes: container.length, offset: bootstrap.length, sha256: hash(container),
  bootstrap: { bytes: bootstrap.length, offset: 0, sha256: hash(bootstrap) },
  disk: { bytes: 143360, sha256: "0".repeat(64) },
};
function file(bytes: Uint8Array) {
  return { name: "Apple II Plus.rom", size: bytes.length, async arrayBuffer() { return new Uint8Array(bytes).buffer; } };
}
function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

test("ROM storage shares verified firmware and the complete Disk II container across page instances", async () => {
  const storage = memoryStorage();
  const classroom = apple2RomStorage(() => storage, expected, media);
  const laboratory = apple2RomStorage(() => storage, expected, media);
  assert.equal(await laboratory.restore(), undefined);
  for (const bytes of [firmware, container]) {
    let reads = 0;
    const selected = await classroom.prepare({ ...file(bytes), async arrayBuffer() { reads++; return new Uint8Array(bytes).buffer; } });
    assert.equal(reads, 1);
    classroom.remember(selected.stored);
    const restored = await laboratory.restore();
    assert.ok(restored);
    assert.equal(restored.name, "Apple II Plus.rom");
    const rom = restored.image.createRom(expected);
    assert.deepEqual([0, 1, 2].map(address => rom.read(address)), [...firmware]);
    assert.deepEqual(restored.bootstrap, bytes === container ? [...bootstrap] : undefined);
  }
  laboratory.forget();
  assert.equal(await classroom.restore(), undefined);
});

test("rejected and unaccepted selections leave the remembered file intact", async () => {
  const storage = memoryStorage(), shared = apple2RomStorage(() => storage, expected, media);
  const original = await shared.prepare(file(container));
  shared.remember(original.stored);
  await shared.prepare(file(firmware)); // A cancelled selection is never committed to storage.
  const corrupt = container.slice(); corrupt[0] = 0xff;
  await assert.rejects(shared.prepare(file(corrupt)), /SHA-256/);
  let read = false;
  await assert.rejects(shared.prepare({ name: "wrong size", size: 100000, async arrayBuffer() {
    read = true; return new ArrayBuffer(0);
  } }), /Choose/);
  assert.equal(read, false);
  assert.deepEqual((await shared.restore())!.bootstrap, [...bootstrap]);
});

test("restoration treats saved metadata and bytes as untrusted and rechecks all identities", async () => {
  let saved = "";
  const store = apple2RomStorage(() => ({ getItem: () => saved, setItem() {}, removeItem() {} }), expected, media);
  for (const invalid of ["{", "null", "[]", "{}", JSON.stringify({ name: 4, base64: "" }),
    JSON.stringify({ name: "rom", base64: [] }), JSON.stringify({ name: "rom", base64: "!!!!" }),
    JSON.stringify({ name: "rom", base64: btoa("bad") }), " ".repeat(10000)]) {
    saved = invalid;
    await assert.rejects(store.restore());
  }
  const selected = await store.prepare(file(container));
  saved = selected.stored;
  for (const offset of [0, 258]) {
    const corrupt = container.slice(); corrupt[offset] = 0xff;
    saved = JSON.stringify({ name: "changed.rom", base64: btoa(String.fromCharCode(...corrupt)) });
    await assert.rejects(store.restore(), /SHA-256/);
  }
  saved = selected.stored;
  const wrongFirmware = apple2RomStorage(() => ({ getItem: () => saved, setItem() {}, removeItem() {} }),
    { ...expected, sha256: "0".repeat(64) }, media);
  const wrongBootstrap = apple2RomStorage(() => ({ getItem: () => saved, setItem() {}, removeItem() {} }),
    expected, { ...media, bootstrap: { ...media.bootstrap, sha256: "0".repeat(64) } });
  await assert.rejects(wrongFirmware.restore(), /SHA-256/);
  await assert.rejects(wrongBootstrap.restore(), /bootstrap/);
});

test("storage failures preserve usable verified media and discard an older saved copy when possible", async () => {
  const storage = memoryStorage(), store = apple2RomStorage(() => storage, expected, media);
  const selected = await store.prepare(file(container));
  store.remember(selected.stored);
  storage.setItem = () => { throw new Error("Quota exceeded"); };
  const replacement = await store.prepare(file(firmware));
  assert.throws(() => store.remember(replacement.stored), /Quota/);
  assert.equal(await store.restore(), undefined);
  assert.equal(replacement.rom.image.createRom(expected).read(0), 0x4c);

  const denied = apple2RomStorage(() => { throw new Error("Storage denied"); }, expected, media);
  const usable = await denied.prepare(file(firmware));
  assert.equal(usable.rom.image.createRom(expected).read(0), 0x4c);
  await assert.rejects(denied.restore(), /denied/);
  assert.throws(() => denied.remember(usable.stored), /denied/);
  assert.throws(() => denied.forget(), /denied/);
});
