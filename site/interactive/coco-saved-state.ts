import { checkMachineSnapshot } from "../../src/machines/snapshot.js";
import { checkUnsigned } from "../../src/components/validation.js";
import { cocoKeyboardPhaseClocks } from "./coco-keyboard-transport.js";
import type { CocoSessionState } from "./coco-session.js";
import { CocoJoystick } from "../../src/components/devices/generated/coco-joystick.js";
import { CocoCassette, cocoTapeSampleLimit } from "../../src/components/devices/coco-cassette.js";
import { CocoDiskController, cocoDiskSize } from "../../src/machines/6809/coco/disk-controller.js";

interface StoredCocoState {
  readonly version: 7;
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
      // Base64 tape and disk plus room for RAM, devices, names, and the keyboard queue.
      if (text.length > Math.ceil((cocoTapeSampleLimit + cocoDiskSize) / 3) * 4 + 256 * 1024) throw new Error("Saved CoCo snapshot is too large.");
      const value: unknown = JSON.parse(text);
      checkMachineSnapshot(value, ["version", "machine", "savedAt", "state"]);
      const saved = value as Omit<StoredCocoState, "version"> & { readonly version: number };
      if (![1, 2, 3, 4, 5, 6, 7].includes(saved.version) || saved.machine !== "coco-32k" || typeof saved.savedAt !== "string"
        || !Number.isFinite(Date.parse(saved.savedAt))) throw new Error("Invalid CoCo snapshot format.");
      // Versions 1 and 2 had no clock: start their schedule at phase zero while
      // preserving PIA levels and flags until the next scheduled edges.
      // Accept only the exact old shapes, never a damaged current checkpoint.
      let state = saved.state;
      if (saved.version < 4) {
        checkMachineSnapshot(saved.state, ["hardware", "input", "pressed", "remaining"]);
        const old = saved.state as unknown as Omit<CocoSessionState, "remainingClocks"> & { remaining: number };
        checkMachineSnapshot(old.hardware, ["cpu", "ram", "firmware", "pias", "sam", "vdg",
          ...(saved.version >= 2 ? ["extended"] : []), ...(saved.version === 3 ? ["clock"] : [])]);
        checkUnsigned("Remaining keyboard steps", old.remaining, 12_000);
        // Preserve the fraction remaining in the former 12,000-boundary phase;
        // its elapsed physical duration cannot be reconstructed from an old save.
        const { remaining, ...previous } = old;
        const hardware = { ...old.hardware, extended: saved.version === 1 ? null : old.hardware.extended,
          clock: saved.version < 3 ? { ticks: 0 } : old.hardware.clock };
        state = { ...previous, hardware, remainingClocks: Math.ceil(remaining / 12_000 * phaseClocks) };
      }
      if (saved.version < 5) {
        checkMachineSnapshot(state, ["hardware", "input", "pressed", "remainingClocks"]);
        checkMachineSnapshot(state.hardware?.pias, ["pia0", "pia1", "keyboard"]);
        // Earlier hardware held the comparator high and both fire inputs released.
        const empty = new CocoJoystick();
        state = { ...state, hardware: { ...state.hardware, pias: { ...state.hardware.pias,
          joysticks: { right: empty.snapshot(), left: empty.snapshot() } } } };
      }
      if (saved.version < 6) {
        checkMachineSnapshot(state.hardware?.pias, ["pia0", "pia1", "keyboard", "joysticks"]);
        state = { ...state, hardware: { ...state.hardware, pias: { ...state.hardware.pias, cassette: new CocoCassette().snapshot() } } };
      } else {
        const tape = state.hardware?.pias?.cassette;
        checkMachineSnapshot(tape, ["name", "samples", "writable", "mode", "position", "phase"]);
        state = { ...state, hardware: { ...state.hardware, pias: { ...state.hardware.pias,
          cassette: { ...tape, samples: unpack(tape.samples, cocoTapeSampleLimit, "cassette") } } } };
      }
      if (saved.version < 7) {
        checkMachineSnapshot(state, ["hardware", "input", "pressed", "remainingClocks"]);
        checkMachineSnapshot(state.hardware, ["cpu", "ram", "firmware", "extended", "pias", "sam", "vdg", "clock"]);
        state = { ...state, diskName: null, hardware: { ...state.hardware, dos: null, disk: new CocoDiskController().snapshot() } };
      } else {
        const disk = state.hardware?.disk;
        checkMachineSnapshot(disk, ["circuit", "image", "microsecondPhase", "haltDeferred"]);
        const image = unpack(disk.image, cocoDiskSize, "disk");
        if (image !== null && image.length !== cocoDiskSize) throw new Error("Invalid saved disk size.");
        state = { ...state, hardware: { ...state.hardware, disk: { ...disk, image } } };
      }
      // The session validates every component, input phase, and ROM identity before installing it.
      return { ...saved, version: 7, state };
    },
    save(state: CocoSessionState): void {
      const tape = state.hardware.pias.cassette;
      const packed = { ...state, hardware: { ...state.hardware, disk: { ...state.hardware.disk, image: pack(state.hardware.disk.image) }, pias: { ...state.hardware.pias,
        cassette: { ...tape, samples: pack(tape.samples) } } } };
      storage().setItem(key, JSON.stringify({ version: 7, machine: "coco-32k", savedAt: new Date().toISOString(), state: packed }));
    },
    forget(): void { storage().removeItem(key); },
  };
}

// Media has one compact copy in storage; native snapshots retain ordinary byte arrays.
function pack(samples: readonly number[] | null): string | null {
  if (samples === null) return null;
  let binary = "";
  for (let i = 0; i < samples.length; i += 8192) binary += String.fromCharCode(...samples.slice(i, i + 8192));
  return btoa(binary);
}
function unpack(value: unknown, limit: number, label: string): number[] | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > Math.ceil(limit / 3) * 4) throw new Error(`Invalid saved ${label} bytes.`);
  const binary = atob(value);
  if (binary.length > limit || btoa(binary) !== value) throw new Error(`Invalid saved ${label} encoding.`);
  return Array.from(binary, character => character.charCodeAt(0));
}
