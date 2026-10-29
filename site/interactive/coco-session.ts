import { create6809Coco } from "../../src/machines/generated/6809/coco.js";
import { stepCoco } from "../../src/machines/6809/coco/runtime.js";
import type { CocoSnapshot } from "../../src/machines/6809/coco/runtime.js";
import type { RomImage } from "../../src/machines/rom-image.js";
import { checkMachineSnapshot } from "../../src/machines/snapshot.js";
import { createCocoKeyboardTransport } from "./coco-keyboard-transport.js";
import type { CocoKeyboardTransportState } from "./coco-keyboard-transport.js";
import type { CocoChord } from "./coco-input.js";

export interface CocoSessionState extends CocoKeyboardTransportState {
  readonly hardware: CocoSnapshot;
}

/** Native machine and host continuation, independent of DOM, docking, and drawing. */
export function createCocoSession(firmware: RomImage | null = null) {
  let machine = powerOn(), input = createCocoKeyboardTransport(machine.pias);
  function powerOn() {
    const result = create6809Coco({ firmware });
    if (firmware !== null) result.reset();
    return result;
  }
  function requireFirmware(): void {
    if (!machine.firmware.loaded) throw new Error("Load Color BASIC before running the browser machine.");
  }
  return {
    get machine() { return machine; },
    get hasFirmware() { return machine.firmware.loaded; },
    get pendingInput() { return input.pending; },
    get inputSettled() { return input.settled; },
    installFirmware(image: RomImage): void { machine.firmware.install(image); firmware = image; },
    send(keys: readonly CocoChord[]): void { requireFirmware(); input.send(keys); },
    step() {
      requireFirmware(); input.beforeStep();
      const record = stepCoco(machine); input.afterStep();
      return record;
    },
    releaseInput(): void { input.release(); },
    reset(): void { requireFirmware(); machine.reset(); input.release(); },
    powerOn(): void { machine = powerOn(); input = createCocoKeyboardTransport(machine.pias); },
    snapshot(): CocoSessionState { return { hardware: machine.snapshot(), ...input.snapshot() }; },
    restore(value: unknown): void {
      checkMachineSnapshot(value, ["hardware", "input", "pressed", "remaining"]);
      const state = value as CocoSessionState;
      const restored = create6809Coco({ firmware }, state.hardware);
      const transport = createCocoKeyboardTransport(restored.pias, { input: state.input, pressed: state.pressed, remaining: state.remaining });
      machine = restored; input = transport;
    },
  };
}
