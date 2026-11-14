import assert from "node:assert/strict";
import { test } from "node:test";
import { CocoCartridge } from "../../src/machines/6809/coco/cartridge.js";
import { createCocoSession } from "../../site/interactive/coco-session.js";
import { cocoSavedState } from "../../site/interactive/coco-saved-state.js";
import { readCocoStorage } from "../../site/interactive/coco-inspection.js";
import { cocoDebugLocation } from "../../site/interactive/coco-debugger.js";
import { stepCoco } from "../../src/machines/6809/coco/runtime.js";

test("plain ROM Paks mirror undecoded address lines and own immutable, validated images", () => {
  assert.equal(new CocoCartridge().read(0), "bus-error");
  for (const size of [0x800, 0x1000, 0x2000, 0x4000]) {
    const image = Array.from({ length: size }, (_, i) => (i >> 8) ^ (i & 255));
    const cartridge = new CocoCartridge({ name: "test.ccc", image }); image[0] = 255;
    for (let address = 0; address < 0x4000; address++) {
      const offset = address % size;
      assert.equal(cartridge.read(address), (offset >> 8) ^ (offset & 255));
    }
    const state = cartridge.snapshot(); cartridge.write(0, 55); assert.deepEqual(cartridge.snapshot(), state);
    assert.throws(() => (state.image as number[])[0] = 1, TypeError);
    assert.deepEqual(new CocoCartridge(state).snapshot(), state);
  }
  for (const state of [{ name: null, image: [] }, { name: "wrong", image: null }, { name: "empty", image: Array(0x800) },
    { name: "bad", image: Array(0x800).fill(256) }, { name: "large", image: Array(0x8000).fill(0) }]) {
    assert.throws(() => new CocoCartridge(state));
  }
});

test("cartridge insertion disconnects disk registers and supplies CART edges without changing the CPU entry", () => {
  const session = createCocoSession(); session.mountCartridge("test.ccc", new Uint8Array(4096).fill(0x12));
  const machine = session.machine;
  assert.equal(machine.cpu.snapshot().pc, 0, "insertion without firmware does not invent an entry point");
  assert.equal(machine.memory.read(0xc000), 0x12); assert.equal(machine.memory.read(0xefff), 0x12);
  assert.equal(readCocoStorage(machine, 0xc000), 0x12);
  assert.deepEqual(cocoDebugLocation(machine, 0xc000), { address: 0xc000, space: "cartridge" });
  const disk = machine.disk.snapshot(); machine.memory.write(0xff40, 0xa9); machine.memory.write(0xff48, 0x80);
  assert.equal(machine.memory.read(0xff48), 255); assert.deepEqual(machine.disk.snapshot(), disk);
  machine.ram.write(0, 0x12); machine.pias.write(0x23, 5);
  assert.equal(machine.pias.firq, false); stepCoco(machine); assert.equal(machine.pias.firq, true);
  machine.pias.read(0x22); assert.equal(machine.pias.firq, false);
  const saved = session.snapshot(); session.powerOn(); assert.equal(session.cartridgeName, "test.ccc");
  session.ejectCartridge(); assert.equal(session.cartridgeName, null);
  session.restore(saved); assert.deepEqual(session.snapshot(), saved);
  session.ejectCartridge(); session.machine.memory.write(0xff40, 0xa9); assert.equal(session.machine.disk.inspect().control, 0xa9);
});

test("packed checkpoints restore RAM capacity and cartridge bytes; malformed replacements leave the machine intact", () => {
  const values = new Map<string, string>(), session = createCocoSession(null, null, null, 64);
  const saved = cocoSavedState(() => ({ getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } }), session.machine.clock.hertz!);
  session.mountCartridge("test.ccc", new Uint8Array(8192).fill(0x12)); session.machine.ram.write(0x9234, 42);
  session.machine.sam.write(0x1d, 0); session.machine.sam.write(0x15, 0);
  const state = session.snapshot(); saved.save(state);
  const [key, text] = [...values][0]!, envelope = JSON.parse(text);
  assert.equal(envelope.version, 9); assert.equal(envelope.machine, "coco-64k");
  assert.equal(typeof envelope.state.hardware.cartridge.image, "string");
  session.configureMemory(32); assert.equal(session.memorySize, 32); assert.equal(session.cartridgeName, "test.ccc");
  session.ejectCartridge(); session.restore(saved.read()!.state);
  assert.equal(session.memorySize, 64); assert.equal(readCocoStorage(session.machine, 0x1234), 42);
  assert.deepEqual(session.snapshot(), state);
  for (const invalid of ["", "AA==", [], "!bad"]) {
    const copy = structuredClone(envelope); copy.state.hardware.cartridge.image = invalid; values.set(key, JSON.stringify(copy));
    assert.throws(() => session.restore(saved.read()!.state)); assert.deepEqual(session.snapshot(), state);
  }
  values.set(key, JSON.stringify({ ...envelope, machine: "coco-32k" })); assert.throws(() => saved.read(), /capacity/);
  assert.throws(() => session.mountCartridge("bad", new Uint8Array(9))); assert.deepEqual(session.snapshot(), state);
  assert.throws(() => session.configureMemory(128 as never)); assert.deepEqual(session.snapshot(), state);
});

test("version-8 disk checkpoints acquire an empty Pak slot without losing RAM or writable media", () => {
  const values = new Map<string, string>(), session = createCocoSession();
  const saved = cocoSavedState(() => ({ getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } }), session.machine.clock.hertz!);
  session.machine.ram.write(0x4321, 42);
  session.mountDisk("old.dsk", new Uint8Array(35 * 18 * 256).fill(0x55)); session.machine.disk.writableCopy();
  const expected = session.snapshot(); saved.save(expected);
  const [key, text] = [...values][0]!, legacy = JSON.parse(text);
  legacy.version = 8; delete legacy.state.hardware.cartridge;
  const original = JSON.stringify(legacy); values.set(key, original);
  session.configureMemory(64); session.mountCartridge("new.ccc", new Uint8Array(4096));
  session.restore(saved.read()!.state);
  assert.equal(session.memorySize, 32); assert.equal(session.cartridgeName, null);
  assert.deepEqual(session.snapshot(), expected); assert.equal(values.get(key), original, "reading does not rewrite an older checkpoint");
});
