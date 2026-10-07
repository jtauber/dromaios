import { createApple2Session } from "./apple2-session.js";
import type { Apple2SessionState } from "./apple2-session.js";
import type { Apple2Media, Apple2DiskFile } from "./apple2-media.js";
import { readApple2Disk } from "./apple2-media.js";
import type { RomImage } from "../../src/machines/rom-image.js";
import { checkMachineSnapshot } from "../../src/machines/snapshot.js";
import { sha256 } from "./rom-file.js";

/** Bump this version when the machine or host continuation contract changes incompatibly. */
export interface Apple2SavedState {
  readonly version: 1;
  readonly machine: "apple2-plus";
  readonly name: string;
  readonly savedAt: string;
  readonly diskName: string | null;
  readonly flash: boolean;
  readonly state: Apple2SessionState;
}

function checkName(name: string): void {
  if (typeof name !== "string" || !name.trim() || name !== name.trim() || name.length > 80) {
    throw new Error("Give the state a name of 1–80 characters.");
  }
}

/** Metadata is checked on read; component validation and media verification happen before use. */
function decodeSavedState(text: string): Apple2SavedState {
  if (text.length > 1_000_000) throw new Error("Saved state is too large.");
  const value: unknown = JSON.parse(text);
  checkMachineSnapshot(value, ["version", "machine", "name", "savedAt", "diskName", "flash", "state"]);
  const saved = value as Apple2SavedState;
  if (saved.version !== 1 || saved.machine !== "apple2-plus") throw new Error("This saved state uses a different machine version.");
  checkName(saved.name);
  if (typeof saved.savedAt !== "string" || !Number.isFinite(Date.parse(saved.savedAt)) || typeof saved.flash !== "boolean"
    || saved.diskName !== null && (typeof saved.diskName !== "string" || !saved.diskName || saved.diskName.length > 1024)) {
    throw new Error("Invalid saved state details.");
  }
  return saved;
}

interface StateStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Each name has its own atomic storage entry; other tabs cannot overwrite an unrelated state. */
export function apple2SavedStates(storage: () => StateStorage) {
  const prefix = "dromaios:apple2-saved-state:";
  const key = (name: string) => { checkName(name); return prefix + encodeURIComponent(name); };
  return {
    names(): string[] {
      const store = storage(), names: string[] = [];
      for (let index = 0; index < store.length; index++) {
        const entry = store.key(index);
        if (entry?.startsWith(prefix)) {
          try { const name = decodeURIComponent(entry.slice(prefix.length)); checkName(name); names.push(name); }
          catch { /* Ignore keys that could not have been written by this instrument. */ }
        }
      }
      return names.sort((a, b) => a.localeCompare(b));
    },
    read(name: string): Apple2SavedState {
      const text = storage().getItem(key(name));
      if (text === null) throw new Error("This state is no longer saved.");
      const saved = decodeSavedState(text);
      if (saved.name !== name) throw new Error("Saved state name does not match its entry.");
      return saved;
    },
    save(saved: Apple2SavedState): void {
      const text = JSON.stringify(saved);
      decodeSavedState(text);
      const store = storage(), entry = key(saved.name);
      if (store.getItem(entry) !== null) throw new Error("That name is already saved. Choose another name or delete the old state first.");
      try { store.setItem(entry, text); }
      catch { throw new Error("The browser could not save this state. Storage may be full or unavailable; existing states are unchanged."); }
    },
    remove(name: string): void { storage().removeItem(key(name)); },
  };
}

/** Verify stored media and construct independent hardware; the caller decides whether to install it. */
export async function prepareApple2SavedState(saved: Apple2SavedState, firmware: RomImage | null, media: Apple2Media) {
  // Recheck the envelope even for callers that did not obtain it through browser storage.
  decodeSavedState(JSON.stringify(saved));
  const session = createApple2Session();
  if (firmware !== null) session.installFirmware(firmware);
  session.restore(saved.state);
  const snapshot = session.machine.disk.snapshot();
  if (snapshot.bootstrap !== null && await sha256(Uint8Array.from(snapshot.bootstrap)) !== media.bootstrap.sha256) {
    throw new Error("Saved Disk II bootstrap does not match this machine.");
  }
  let disk: Apple2DiskFile | undefined;
  if (snapshot.media !== null) {
    if (saved.diskName === null) throw new Error("Saved disk has no name.");
    const bytes = Uint8Array.from(snapshot.media);
    disk = await readApple2Disk({ name: saved.diskName, size: bytes.length, async arrayBuffer() { return bytes.buffer; } }, media.disk);
  } else if (saved.diskName !== null) throw new Error("Saved disk is missing its media.");
  return { session, disk, flash: saved.flash };
}
