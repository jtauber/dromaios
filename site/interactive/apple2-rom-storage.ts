import type { RomIdentity } from "../../src/machines/rom-image.js";
import { readApple2Rom } from "./apple2-media.js";
import type { Apple2Media, Apple2RomFile } from "./apple2-media.js";

interface RomStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Remember the original file, including a container's Disk II bootstrap, on this origin. */
export function apple2RomStorage(storage: () => RomStorage, expected: RomIdentity, media: Apple2Media) {
  const key = "dromaios:apple2-rom:v1";
  const maxBase64 = Math.ceil(Math.max(expected.size, media.bytes) / 3) * 4;
  return {
    // Prepare first; only the caller accepting this selection may replace the saved ROM.
    async prepare(file: Parameters<typeof readApple2Rom>[0]) {
      let buffer: Promise<ArrayBuffer> | undefined;
      const arrayBuffer = () => buffer ??= file.arrayBuffer();
      const rom = await readApple2Rom({ name: file.name, size: file.size, arrayBuffer }, expected, media);
      const base64 = btoa(String.fromCharCode(...new Uint8Array(await arrayBuffer())));
      return { rom, stored: JSON.stringify({ name: file.name, base64 }) };
    },
    async restore(): Promise<Apple2RomFile | undefined> {
      const stored = storage().getItem(key);
      if (stored === null) return undefined;
      if (stored.length > maxBase64 + 8192) throw new Error("Saved ROM is too large.");
      const value: unknown = JSON.parse(stored);
      if (typeof value !== "object" || value === null || !("name" in value) || !("base64" in value)
        || typeof value.name !== "string" || value.name.length > 1024
        || typeof value.base64 !== "string" || value.base64.length > maxBase64) {
        throw new Error("Invalid saved ROM.");
      }
      const bytes = Uint8Array.from(atob(value.base64), character => character.charCodeAt(0));
      // Storage is untrusted: check the full container, firmware, and bootstrap again.
      return readApple2Rom({ name: value.name, size: bytes.length, async arrayBuffer() { return bytes.buffer; } }, expected, media);
    },
    remember(stored: string): void {
      try { storage().setItem(key, stored); }
      catch (error) {
        // Avoid restoring an older selection after this save failed, where storage permits.
        try { storage().removeItem(key); } catch { /* Storage may be entirely unavailable. */ }
        throw error;
      }
    },
    forget(): void { storage().removeItem(key); },
  };
}
