import { checkMachineSnapshot } from "../../src/machines/snapshot.js";
import type { CocoSessionState } from "./coco-session.js";

interface StoredCocoState {
  readonly version: 1;
  readonly machine: "coco-32k";
  readonly savedAt: string;
  readonly state: CocoSessionState;
}

/** One explicit checkpoint, stored separately from ROM bytes and workspace preferences. */
export function cocoSavedState(storage: () => {
  getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void;
}) {
  const key = "dromaios:coco-snapshot:v1";
  return {
    read(): StoredCocoState | undefined {
      const text = storage().getItem(key);
      if (text === null) return undefined;
      if (text.length > 1_000_000) throw new Error("Saved CoCo snapshot is too large.");
      const value: unknown = JSON.parse(text);
      checkMachineSnapshot(value, ["version", "machine", "savedAt", "state"]);
      const saved = value as StoredCocoState;
      if (saved.version !== 1 || saved.machine !== "coco-32k" || typeof saved.savedAt !== "string"
        || !Number.isFinite(Date.parse(saved.savedAt))) throw new Error("Invalid CoCo snapshot format.");
      // The session validates every component, input phase, and ROM identity before installing it.
      return saved;
    },
    save(state: CocoSessionState): void {
      storage().setItem(key, JSON.stringify({ version: 1, machine: "coco-32k", savedAt: new Date().toISOString(), state }));
    },
    forget(): void { storage().removeItem(key); },
  };
}
