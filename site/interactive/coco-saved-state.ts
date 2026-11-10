import { checkMachineSnapshot } from "../../src/machines/snapshot.js";
import { checkUnsigned } from "../../src/components/validation.js";
import { cocoKeyboardPhaseClocks } from "./coco-keyboard-transport.js";
import type { CocoSessionState } from "./coco-session.js";

interface StoredCocoState {
  readonly version: 4;
  readonly machine: "coco-32k";
  readonly savedAt: string;
  readonly state: CocoSessionState;
}

/** One explicit checkpoint, stored separately from ROM bytes and workspace preferences. */
export function cocoSavedState(storage: () => {
  getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void;
}, hertz: number) {
  const phaseClocks = cocoKeyboardPhaseClocks(hertz);
  const key = "dromaios:coco-snapshot:v1"; // Keep the original key so older checkpoints can be migrated.
  return {
    read(): StoredCocoState | undefined {
      const text = storage().getItem(key);
      if (text === null) return undefined;
      if (text.length > 1_000_000) throw new Error("Saved CoCo snapshot is too large.");
      const value: unknown = JSON.parse(text);
      checkMachineSnapshot(value, ["version", "machine", "savedAt", "state"]);
      const saved = value as Omit<StoredCocoState, "version"> & { readonly version: number };
      if (![1, 2, 3, 4].includes(saved.version) || saved.machine !== "coco-32k" || typeof saved.savedAt !== "string"
        || !Number.isFinite(Date.parse(saved.savedAt))) throw new Error("Invalid CoCo snapshot format.");
      // Versions 1 and 2 had no clock: start their schedule at phase zero while
      // preserving PIA levels and flags until the next scheduled edges.
      // Accept only the exact old shapes, never a damaged current checkpoint.
      if (saved.version < 4) {
        checkMachineSnapshot(saved.state, ["hardware", "input", "pressed", "remaining"]);
        const old = saved.state as unknown as Omit<CocoSessionState, "remainingClocks"> & { remaining: number };
        checkMachineSnapshot(old.hardware, ["cpu", "ram", "firmware", "pias", "sam", "vdg",
          ...(saved.version >= 2 ? ["extended"] : []), ...(saved.version === 3 ? ["clock"] : [])]);
        checkUnsigned("Remaining keyboard steps", old.remaining, 12_000);
        // Preserve the fraction remaining in the former 12,000-boundary phase;
        // its elapsed physical duration cannot be reconstructed from an old save.
        const { remaining, ...state } = old;
        const hardware = { ...old.hardware, extended: saved.version === 1 ? null : old.hardware.extended,
          clock: saved.version < 3 ? { ticks: 0 } : old.hardware.clock };
        return { ...saved, version: 4, state: { ...state, hardware, remainingClocks: Math.ceil(remaining / 12_000 * phaseClocks) } };
      }
      // The session validates every component, input phase, and ROM identity before installing it.
      return { ...saved, version: 4 };
    },
    save(state: CocoSessionState): void {
      storage().setItem(key, JSON.stringify({ version: 4, machine: "coco-32k", savedAt: new Date().toISOString(), state }));
    },
    forget(): void { storage().removeItem(key); },
  };
}
