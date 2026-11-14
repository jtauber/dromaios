import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { RomImage } from "../../src/machines/rom-image.js";
import { romImages } from "../../src/machines/generated/6809/coco-disk.js";
import { createCocoSession } from "../../site/interactive/coco-session.js";
import { cocoSavedState } from "../../site/interactive/coco-saved-state.js";
import { cocoScreenText } from "../../site/interactive/coco-inspection.js";
import { cocoTextInput } from "../../site/interactive/coco-input.js";
import type { CocoChord } from "../../site/interactive/coco-input.js";

export const cocoSoftwareRoms = Boolean(process.env.COCO_ROM && process.env.COCO_EXTENDED_ROM && process.env.COCO_DISK_ROM);
export const cocoHash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Real firmware and physical input, with bounded, passive observation of third-party software. */
export async function cocoSoftware(memory: 32 | 64 = 32) {
  const image = (path: string, identity: { readonly size: number; readonly sha256: string }) => RomImage.verify(readFileSync(path), identity, async bytes => cocoHash(bytes));
  const session = createCocoSession(await image(process.env.COCO_ROM!, romImages.firmware),
    await image(process.env.COCO_EXTENDED_ROM!, romImages.extended), await image(process.env.COCO_DISK_ROM!, romImages.dos), memory);
  const storage = new Map<string, string>();
  const checkpoint = cocoSavedState(() => ({ getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => { storage.set(key, value); }, removeItem: key => { storage.delete(key); } }), session.machine.clock.hertz!);
  const screen = () => cocoScreenText(session.machine);
  const run = (count: number) => { for (let i = 0; i < count; i++) session.step(); };
  function until(done: () => boolean, limit = 3_000_000, sample = 256): number {
    for (let i = 0; i < limit; i++) { if (i % sample === 0 && done()) return i; session.step(); }
    assert.fail(`Software did not reach its stop at $${session.machine.cpu.snapshot().pc.toString(16)}:\n${screen()}`);
  }
  function keys(chords: readonly CocoChord[]): void { session.send(chords); until(() => session.inputSettled, 3_000_000, 1); }
  const key = (text: string) => keys(cocoTextInput(text));
  const bytes = (address: number, length: number) => Uint8Array.from({ length }, (_, i) => session.machine.ram.read(address + i));
  return { session, checkpoint, run, until, key, keys, screen, bytes };
}
