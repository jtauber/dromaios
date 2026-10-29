import type { readRomFile, RomFile } from "./rom-file.js";

type RomFileSource = Parameters<typeof readRomFile>[0];
interface RomStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Remember owned file bytes; every restoration goes through the same verified media reader. */
export function romFileStorage<Rom extends RomFile>(storage: () => RomStorage, key: string,
  maxBytes: number, read: (file: RomFileSource) => Promise<Rom>) {
  const maxBase64 = Math.ceil(maxBytes / 3) * 4;
  return {
    // Prepare first; only the caller accepting this selection may replace the saved ROM.
    async prepare(file: RomFileSource) {
      let buffer: Promise<ArrayBuffer> | undefined;
      const arrayBuffer = () => buffer ??= file.arrayBuffer();
      const rom = await read({ name: file.name, size: file.size, arrayBuffer });
      const base64 = btoa(String.fromCharCode(...new Uint8Array(await arrayBuffer())));
      return { rom, stored: JSON.stringify({ name: file.name, base64 }) };
    },
    async restore(): Promise<Rom | undefined> {
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
      // Storage is untrusted: the caller rechecks the complete media identity.
      return read({ name: value.name, size: bytes.length, async arrayBuffer() { return bytes.buffer; } });
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
