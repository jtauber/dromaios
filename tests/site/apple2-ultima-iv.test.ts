import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { romImages } from "../../src/machines/generated/6502/apple2.js";
import { readApple2Rom, readApple2Disk } from "../../site/interactive/apple2-media.js";
import type { Apple2Media } from "../../site/interactive/apple2-media.js";
import { createApple2Session, apple2ControlKey } from "../../site/interactive/apple2-session.js";
import { apple2HiresFrame } from "../../site/interactive/apple2-screen.js";
import { encodeApple2SavedState, prepareApple2SavedState } from "../../site/interactive/apple2-saved-state.js";

interface Identity { readonly bytes: number; readonly sha256: string }
interface Stop { readonly address: number; readonly bytes: readonly number[] }
interface Scene { readonly name: string; readonly x: number; readonly y: number; readonly terrainSha256: string }
function record(path: string): unknown {
  const fences = [...readFileSync(path, "utf8").matchAll(/^```json\n([\s\S]*?)^```$/gm)];
  assert.equal(fences.length, 1, `${path} must own one acceptance record`);
  return JSON.parse(fences[0]![1]!);
}
const media = record("src/machines/6502/apple2.md") as Apple2Media;
const guide = record("docs/software/ultima-iv.md") as {
  boot: Identity; britannia: Identity; stops: Record<"title" | "menu" | "exchange" | "command", Stop>;
  terrain: { x: number; y: number; width: number; height: number }; scenes: readonly Scene[];
};
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function file(path: string) {
  const bytes = new Uint8Array(readFileSync(path));
  return { name: path, size: bytes.length, async arrayBuffer() { return bytes.buffer; } };
}

const romPath = process.env.APPLE2_ROM, bootPath = process.env.APPLE2_ULTIMA_IV_BOOT;
const britanniaPath = process.env.APPLE2_ULTIMA_IV_BRITANNIA;
test("Ultima IV cold-boots, exchanges disks, and replays a move in Britannia", {
  skip: !romPath || !bootPath || !britanniaPath
    ? "Set APPLE2_ROM, APPLE2_ULTIMA_IV_BOOT and APPLE2_ULTIMA_IV_BRITANNIA to the guide's local media" : false,
}, async t => {
  assert.ok(romPath); assert.ok(bootPath); assert.ok(britanniaPath);
  async function disk(path: string, identity: Identity) {
    const selected = file(path);
    assert.equal(selected.size, identity.bytes);
    assert.equal(hash(new Uint8Array(await selected.arrayBuffer())), identity.sha256);
    return (await readApple2Disk(selected, media.disk, "read-only")).disk;
  }
  const rom = await readApple2Rom(file(romPath), romImages.firmware, media);
  assert.ok(rom.bootstrap, "Boot needs the 20 KiB container's slot-6 firmware");
  const boot = await disk(bootPath, guide.boot), britannia = await disk(britanniaPath, guide.britannia);
  let session = createApple2Session(rom.image, { bootstrap: rom.bootstrap, image: boot });
  let diskName = "ultima_iv_boot.dsk";
  function runTo(stop: Stop, limit: number): void {
    // Execute at least once: a move starts and finishes at the same command boundary.
    for (let i = 0; i < limit; i++) {
      const step = session.step();
      assert.equal(step.outcome, "executed");
      if (step.after.pc !== stop.address) continue;
      assert.deepEqual(stop.bytes.map((_, offset) => session.machine.ram.read(stop.address + offset)), stop.bytes);
      t.diagnostic(`Reached $${stop.address.toString(16).toUpperCase()} after ${(i + 1).toLocaleString()} instructions`);
      return;
    }
    assert.fail(`Did not reach $${stop.address.toString(16)} after ${limit} instructions; PC=$${session.machine.cpu.snapshot().pc.toString(16)}`);
  }
  async function savedState(name: string) {
    return encodeApple2SavedState({ machine: "apple2-plus", name, savedAt: "2026-11-08T00:00:00Z",
      diskName, flash: false, state: session.snapshot() });
  }
  async function checkpoint(name: string): Promise<void> {
    const directory = process.env.APPLE2_ULTIMA_IV_CHECKPOINTS;
    if (!directory) return;
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, `${name}.json`), JSON.stringify(await savedState(name)));
  }
  function checkScene(scene: Scene): void {
    assert.deepEqual([session.machine.ram.read(0), session.machine.ram.read(1)], [scene.x, scene.y], scene.name);
    assert.deepEqual(session.machine.video.snapshot(), { text: false, mixed: false, page2: false, hires: true });
    const { x: left, y: top, width, height } = guide.terrain;
    // Independent hardware address equations, not the renderer's addressing helpers.
    const dots = Uint8Array.from({ length: width * height }, (_, i) => {
      const x = left + i % width, y = top + Math.floor(i / width);
      const address = 0x2000 + y % 8 * 0x400 + Math.floor(y / 8) % 8 * 0x80 + Math.floor(y / 64) * 40 + Math.floor(x / 7);
      return (session.machine.ram.read(address) >> (x % 7)) & 1;
    });
    assert.equal(hash(dots), scene.terrainSha256, "Terrain matches the independently executed game");
    const displayed = apple2HiresFrame(session.machine.ram, session.machine.video, true);
    assert.deepEqual(displayed.slice(top, top + height).flatMap(row => row!.slice(left, left + width)), [...dots]);
    assert.equal(session.pendingInput, 0);
    assert.equal(session.machine.disk.inspect().motor, false);
  }
  function moveEast(): void {
    const key = apple2ControlKey({ key: "ArrowRight", ctrlKey: false, metaKey: false, altKey: false, isComposing: false });
    assert.equal(key, 21);
    session.send([key!]); runTo(guide.stops.command, 2_000_000); checkScene(guide.scenes[1]!);
  }

  await t.test("cold boot reaches the title, menu, and Britannia disk request", () => {
    runTo(guide.stops.title, 200_000_000);
    session.send([32]); runTo(guide.stops.menu, 10_000_000);
    session.send([74]); runTo(guide.stops.exchange, 80_000_000);
    assert.equal(session.machine.disk.inspect().motor, false);
  });
  await checkpoint("ultima-iv-exchange");
  await t.test("disk exchange preserves the machine before Escape loads the world", () => {
    const { disk: beforeDisk, ...beforeHardware } = session.snapshot().hardware;
    const beforeInput = session.snapshot().input, machine = session.machine;
    session.swapDisk(britannia); diskName = "ultima_iv_br.dsk";
    const { disk: afterDisk, ...afterHardware } = session.snapshot().hardware;
    assert.equal(session.machine, machine);
    assert.deepEqual(afterHardware, beforeHardware);
    assert.deepEqual(session.snapshot().input, beforeInput);
    assert.deepEqual(afterDisk, { ...beforeDisk, media: britannia.snapshot(), position: 0, byteClocks: 0, latch: 0 });
    session.send([27]); runTo(guide.stops.command, 80_000_000); checkScene(guide.scenes[0]!);
  });
  await checkpoint("ultima-iv-britannia");
  await t.test("Right Arrow moves east and serialized checkpoint replay reproduces every hardware byte", async () => {
    const saved = await savedState("Ultima IV — Britannia");
    moveEast(); const east = session.snapshot();
    const restored = await prepareApple2SavedState(JSON.parse(JSON.stringify(saved)), rom.image, media);
    session = restored.session;
    assert.equal(restored.diskName, "ultima_iv_br.dsk");
    assert.equal(session.machine.disk.inspect().writable, false);
    checkScene(guide.scenes[0]!); moveEast();
    assert.deepEqual(session.snapshot(), east);
    assert.equal(hash(boot.exportImage()), guide.boot.sha256);
    assert.equal(hash(session.machine.disk.exportImage()), guide.britannia.sha256);
  });
  await checkpoint("ultima-iv-east");
});
