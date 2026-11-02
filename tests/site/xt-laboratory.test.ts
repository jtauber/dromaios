import assert from "node:assert/strict";
import { test } from "node:test";
import { migrateXtWorkspace, xtWorkspaceKey } from "../../site/interactive/xt-workspace.js";
import { decodeWorkspaceState, encodeWorkspaceState } from "../../site/interactive/workspace/state.js";
import { groups } from "../../site/interactive/workspace/layout.js";
import { XtKeyboard } from "../../site/interactive/xt-keyboard.js";
import { createXtSession } from "../../site/interactive/xt-session.js";
import { decodeXtCheckpoint, encodeXtCheckpoint } from "../../site/interactive/xt-checkpoint.js";

function drain(keyboard: XtKeyboard, caps = false) {
  const bytes: number[] = [];
  while (keyboard.queuedBytes || keyboard.pasteRemaining) {
    keyboard.beforeStep(byte => { bytes.push(byte); return true; }, () => caps);
    keyboard.afterStep(500_000, false);
  }
  return bytes;
}

test("XT focus loss releases held keys once and receiver backpressure preserves their order", () => {
  const keys = new XtKeyboard();
  keys.down("ShiftLeft"); keys.down("KeyR"); keys.down("KeyR");
  keys.beforeStep(() => true, () => false);
  keys.beforeStep(byte => { assert.equal(byte, 0x13); return false; }, () => false);
  keys.releaseHeld(); keys.up("KeyR");
  assert.deepEqual(drain(keys), [0x13, 0xaa, 0x93]);
  keys.down("ControlRight"); keys.down("ControlLeft"); keys.up("ControlRight");
  keys.down("NumpadEnter"); keys.releaseHeld();
  assert.deepEqual(drain(keys), [0x1d, 0x1c, 0x9d, 0x9c]);
});

test("XT paste retains emulated delays, Shift and pending bytes across a checkpoint", () => {
  const keys = new XtKeyboard();
  keys.paste("A+\r\nb");
  keys.beforeStep(byte => { assert.equal(byte, 0x2a); return true; }, () => false);
  const state = keys.snapshot(), restored = new XtKeyboard(state);
  assert.deepEqual(state.bytes, [0x1e, 0x9e, 0xaa]); assert.equal(state.paste, "+\nb");
  for (const current of [keys, restored]) {
    for (const expected of state.bytes) current.beforeStep(byte => { assert.equal(byte, expected); return true; }, () => false);
    current.afterStep(state.delay - 1, false);
    current.beforeStep(() => assert.fail("The next character arrived early"), () => false);
    current.afterStep(1, false);
    assert.deepEqual(drain(current), [0x2a, 0x0d, 0x8d, 0xaa, 0x1c, 0x9c, 0x30, 0xb0]);
  }
  keys.paste("aA"); assert.deepEqual(drain(keys, true), [0x2a, 0x1e, 0x9e, 0xaa, 0x1e, 0x9e]);
});

test("a qualifying XT keyboard reset discards outstanding chord releases and paste", () => {
  const keys = new XtKeyboard(); keys.chord(["ControlLeft", "AltLeft", "Delete"]); keys.paste("RUN\n");
  for (const make of [0x1d, 0x38, 0x53]) keys.beforeStep(byte => { assert.equal(byte, make); return true; }, () => false);
  assert.deepEqual(keys.snapshot().bytes, [0xd3, 0xb8, 0x9d]);
  keys.afterStep(1, true);
  assert.deepEqual(keys.snapshot(), new XtKeyboard().snapshot());
});

test("XT session restore validates the keyboard, memory and ROM identities before replacing live hardware", () => {
  const session = createXtSession();
  assert.throws(() => session.step(), /Load the BIOS/);
  session.machine.ram.write(0x98765, 0xdf); session.machine.video.write(0x3fff, 0xe2);
  session.keyboard.paste("PRINT 2+3\n");
  const live = session.machine, saved = session.snapshot(), text = encodeXtCheckpoint(saved);
  assert.ok(text.length < 1_000_000);
  const decoded = decodeXtCheckpoint(text);
  assert.throws(() => session.restore({ ...decoded, keyboard: { ...decoded.keyboard, bytes: [512] } }), /keyboard/);
  assert.throws(() => session.restore({ ...decoded, hardware: { ...decoded.hardware, basic: "unavailable" } }), /identity/);
  assert.throws(() => decodeXtCheckpoint(JSON.stringify({ ...JSON.parse(text), hardware: { ram: "" } })), /memory size/);
  assert.equal(session.machine, live); assert.deepEqual(session.snapshot(), saved);
  session.powerOn(); session.restore(decoded); assert.deepEqual(session.snapshot(), saved);
});

test("a rejected paste or excessive input leaves the XT keyboard usable", () => {
  const keys = new XtKeyboard(); keys.down("ShiftLeft"); const before = keys.snapshot();
  for (const text of ["é", "x".repeat(4097)]) {
    assert.throws(() => keys.paste(text), /Paste up to/); assert.deepEqual(keys.snapshot(), before);
  }
  keys.releaseHeld();
  while (keys.queuedBytes < 510) { keys.down("KeyX"); keys.up("KeyX"); }
  keys.down("KeyA"); assert.throws(() => keys.down("KeyB"), /queue full/);
  keys.releaseHeld(); assert.deepEqual(drain(keys).slice(-2), [0x1e, 0x9e]);
});

test("XT drive A retains its owned disk across CPU reset and fresh power-on until ejected", () => {
  const session = createXtSession(), bytes = new Uint8Array(360 * 1024);
  bytes[0] = 0xeb; session.insertDisk("system.img", bytes); bytes.fill(0);
  session.machine.ports.writePort(0x3f2, 0x1c);
  session.machine.ram.write(0x500, 0xaa); session.keyboard.paste("DIR\n");
  const mounted = session.machine.io.snapshot();
  assert.equal(mounted.disketteImage![0], 0xeb);
  assert.equal(session.machine.io.disketteWritable, false);
  assert.throws(() => session.insertDisk("wrong.img", new Uint8Array(512)), /360 KiB/);
  assert.throws(() => session.insertDisk("", bytes), /filename/);
  session.resetCpu();
  assert.equal(session.diskName, "system.img"); assert.equal(session.machine.io.disketteMotorOn, true);
  assert.deepEqual(session.machine.io.snapshot(), mounted);

  session.powerOn();
  assert.equal(session.diskName, "system.img"); assert.equal(session.machine.io.disketteMotorOn, false);
  assert.equal(session.machine.io.snapshot().disketteImage, mounted.disketteImage);
  assert.equal(session.machine.ram.read(0x500), 0); assert.equal(session.keyboard.pasteRemaining, 0);
  session.ejectDisk(); session.powerOn();
  assert.equal(session.diskName, null); assert.equal(session.machine.io.snapshot().disketteImage, null);
});

test("XT quick boot differs from cold power-on only in the two BIOS warm-start bytes", () => {
  const session = createXtSession();
  session.insertDisk("system.img", new Uint8Array(360 * 1024));
  session.powerOn();
  const cold = session.snapshot();
  session.machine.ram.write(0x500, 0xaa);
  session.keyboard.paste("DIR\n");
  session.powerOn("quick");
  const ram = [...cold.hardware.ram];
  ram[0x472] = 0x34; ram[0x473] = 0x12;
  assert.deepEqual(session.snapshot(), { ...cold, hardware: { ...cold.hardware, ram } });
  session.powerOn();
  assert.deepEqual(session.snapshot(), cold);
});

test("XT browser checkpoint restores the saved disk and pending DMA byte over different media", () => {
  const session = createXtSession(), disk = new Uint8Array(360 * 1024);
  disk.set([0x41, 0x42]); session.insertDisk("data.img", disk);
  const { io, ports, memory } = session.machine;
  ports.writePort(0x3f2, 0x1c); io.advanceOscillatorTicks(29324);
  ports.writePort(0x3f5, 8); ports.readPort(0x3f5); ports.readPort(0x3f5);
  // DMA channel 2: two disk bytes to physical 03000. Save after the first grant.
  for (const [port, byte] of [[4, 0], [4, 0x30], [5, 1], [5, 0], [11, 0x46], [10, 2]] as const) ports.writePort(port, byte);
  for (const byte of [0xe6, 0, 0, 0, 1, 2, 9, 0x2a, 0xff]) ports.writePort(0x3f5, byte);
  io.advanceOscillatorTicks(470); assert.equal(io.serviceDma(memory)?.channel, 2);
  io.advanceOscillatorTicks(470);

  const saved = session.snapshot(), text = encodeXtCheckpoint(saved);
  assert.ok(text.length < 1_500_000);
  const decoded = decodeXtCheckpoint(text);
  assert.deepEqual(decoded, saved);
  const broken = JSON.parse(text); broken.hardware.io.disketteImage = "AA==";
  assert.throws(() => decodeXtCheckpoint(JSON.stringify(broken)), /disk size/);
  assert.throws(() => decodeXtCheckpoint(" ".repeat(1_600_000)), /too large/);

  session.insertDisk("other.img", new Uint8Array(disk.length));
  const live = session.machine;
  assert.throws(() => session.restore({ ...decoded, diskName: null }), /filename/);
  assert.equal(session.machine, live); assert.equal(session.diskName, "other.img");
  // Mounted-disk checkpoints saved before writes were supported have no permission field.
  const old = JSON.parse(text); delete old.hardware.io.diskette.writable;
  session.restore(decodeXtCheckpoint(JSON.stringify(old)));
  assert.equal(session.machine.io.disketteWritable, false);
  assert.equal(session.diskName, "data.img"); assert.equal(session.machine.io.disketteMotorOn, true);
  assert.deepEqual(session.machine.io.serviceDma(session.machine.memory), { channel: 2, address: 0x3001, value: 0x42, oscillatorTicks: 15 });
  assert.equal(session.machine.ram.read(0x3000), 0x41); assert.equal(session.machine.ram.read(0x3001), 0x42);
  session.powerOn(); assert.deepEqual(session.machine.io.snapshot().disketteImage, saved.hardware.io.disketteImage);
});

test("XT fresh power-on retains the write permission restored from a checkpoint", () => {
  const session = createXtSession(), disk = new Uint8Array(360 * 1024);
  session.insertDisk("scratch.img", disk, { writable: true });
  const checkpoint = encodeXtCheckpoint(session.snapshot());
  session.ejectDisk(); session.restore(decodeXtCheckpoint(checkpoint));
  assert.equal(session.machine.io.disketteWritable, true);
  session.powerOn(); assert.equal(session.machine.io.disketteWritable, true);
  assert.equal(session.diskName, "scratch.img");
  session.insertDisk("system.img", disk);
  assert.equal(session.machine.io.disketteWritable, false);
});

test("restoring a version-1 empty-drive XT checkpoint ejects the current disk", () => {
  const session = createXtSession();
  const saved = session.snapshot(), current = JSON.parse(encodeXtCheckpoint(saved));
  const legacy = { version: 1, machine: current.machine, hardware: current.hardware, keyboard: current.keyboard };
  session.insertDisk("later.img", new Uint8Array(360 * 1024));
  session.restore(decodeXtCheckpoint(JSON.stringify(legacy)));
  assert.deepEqual(session.snapshot(), saved);

  const { disketteImage, diskettePage, diskette, ...board } = legacy.hardware.io;
  const { results, result_index, byte_us, byte_offset, media, writable, ...controller } = diskette;
  legacy.hardware.io = { ...board, diskette: { ...controller, result: 0, result_pcn: 0 } };
  session.insertDisk("later.img", new Uint8Array(360 * 1024));
  session.restore(decodeXtCheckpoint(JSON.stringify(legacy)));
  assert.deepEqual(session.snapshot(), saved);
});

test("version-6 XT workspaces gain Drive A below Firmware once and keep their existing tabs", () => {
  const firmware = { kind: "tabs", id: "custom", active: "snapshot", panels: ["rom", "snapshot"], collapsed: true } as const;
  const items = new Map([["dromaios:workspace:xt:6", encodeWorkspaceState({ root: firmware })]]);
  const storage = { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, text: string) => items.set(key, text) };
  migrateXtWorkspace(storage);
  const saved = items.get(xtWorkspaceKey)!;
  const [old, drive] = groups(decodeWorkspaceState(saved, ["rom", "snapshot", "drive"]));
  assert.deepEqual(old, firmware); assert.deepEqual(drive?.panels, ["drive"]);
  migrateXtWorkspace(storage); assert.equal(items.get(xtWorkspaceKey), saved);
});
