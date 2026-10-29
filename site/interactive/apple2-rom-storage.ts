import type { RomIdentity } from "../../src/machines/rom-image.js";
import { readApple2Rom } from "./apple2-media.js";
import type { Apple2Media } from "./apple2-media.js";
import { romFileStorage } from "./rom-storage.js";

/** Retain the original file, including a container's Disk II bootstrap, on this origin. */
export function apple2RomStorage(storage: Parameters<typeof romFileStorage>[0], expected: RomIdentity, media: Apple2Media) {
  return romFileStorage(storage, "dromaios:apple2-rom:v1", Math.max(expected.size, media.bytes),
    file => readApple2Rom(file, expected, media));
}
