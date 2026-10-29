import { checkMachineSnapshot } from "../../src/machines/snapshot.js";
import type { CocoSessionState } from "./coco-session.js";

interface StoredCocoState {
  readonly version: 2;
  readonly machine: "coco-32k";
  readonly savedAt: string;
  readonly state: CocoSessionState;
}

/** One explicit checkpoint, stored separately from ROM bytes and workspace preferences. */
export function cocoSavedState(storage: () => {
  getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void;
}) {
  const key = "dromaios:coco-snapshot:v1"; // Keep the original key so older checkpoints can be migrated.
  return {
    read(): StoredCocoState | undefined {
      const text = storage().getItem(key);
      if (text === null) return undefined;
      if (text.length > 1_000_000) throw new Error("Saved CoCo snapshot is too large.");
      const value: unknown = JSON.parse(text);
      checkMachineSnapshot(value, ["version", "machine", "savedAt", "state"]);
      const saved = value as Omit<StoredCocoState, "version"> & { readonly version: number };
      if (![1, 2].includes(saved.version) || saved.machine !== "coco-32k" || typeof saved.savedAt !== "string"
        || !Number.isFinite(Date.parse(saved.savedAt))) throw new Error("Invalid CoCo snapshot format.");
      // Version 1 predates the extension socket. Migrate only its exact former shape;
      // a missing field in version 2 must still be rejected, not guessed to mean empty.
      if (saved.version === 1) {
        checkMachineSnapshot(saved.state, ["hardware", "input", "pressed", "remaining"]);
        checkMachineSnapshot(saved.state.hardware, ["cpu", "ram", "firmware", "pias", "sam", "vdg"]);
        return { ...saved, version: 2, state: { ...saved.state, hardware: { ...saved.state.hardware, extended: null } } };
      }
      // The session validates every component, input phase, and ROM identity before installing it.
      return { ...saved, version: 2 };
    },
    save(state: CocoSessionState): void {
      storage().setItem(key, JSON.stringify({ version: 2, machine: "coco-32k", savedAt: new Date().toISOString(), state }));
    },
    forget(): void { storage().removeItem(key); },
  };
}
