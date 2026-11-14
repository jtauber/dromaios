import { create6809Coco64 } from "../../src/machines/generated/6809/coco64.js";
import { create6809CocoDisk } from "../../src/machines/generated/6809/coco-disk.js";
import { stepCoco } from "../../src/machines/6809/coco/runtime.js";
import type { RomImage } from "../../src/machines/rom-image.js";
import { checkMachineSnapshot } from "../../src/machines/snapshot.js";
import { createCocoKeyboardTransport } from "./coco-keyboard-transport.js";
import type { CocoKeyboardTransportState } from "./coco-keyboard-transport.js";
import { CocoCartridge } from "../../src/machines/6809/coco/cartridge.js";
import type { CocoCartridgeSnapshot } from "../../src/machines/6809/coco/cartridge.js";
import type { CocoChord } from "./coco-input.js";

export interface CocoSessionState extends CocoKeyboardTransportState {
  readonly hardware: ReturnType<ReturnType<typeof create6809CocoDisk>["snapshot"]>;
  readonly diskName: string | null;
}

/** Native machine and host continuation, independent of DOM, docking, and drawing. */
export function createCocoSession(firmware: RomImage | null = null, extended: RomImage | null = null, dos: RomImage | null = null, memory: 32 | 64 = 32) {
  let machine = fresh({ firmware, extended, dos }), input = createCocoKeyboardTransport(machine.pias, machine.clock.hertz!);
  let diskName: string | null = null;
  function fresh(bindings: { firmware: RomImage | null; extended: RomImage | null; dos: RomImage | null }) {
    const result = factory(memory)(bindings);
    if (bindings.firmware !== null) result.reset();
    return result;
  }
  function factory(size: 32 | 64) {
    if (size !== 32 && size !== 64) throw new RangeError("Choose 32 or 64 KiB of CoCo RAM.");
    return size === 64 ? create6809Coco64 : create6809CocoDisk;
  }
  function replace(bindings: { firmware: RomImage | null; extended: RomImage | null; dos: RomImage | null }, size = memory, cartridge: CocoCartridgeSnapshot = machine.cartridge.snapshot()): void {
    const tape = machine.pias.cassette.snapshot(), disk = machine.disk.snapshot();
    const state = factory(size)(bindings).snapshot();
    const next = factory(size)(bindings, { ...state, cartridge, pias: { ...state.pias, cassette: { ...tape, mode: "stop" } } });
    next.disk.mount(disk.image, { writable: disk.circuit.writable });
    if (bindings.firmware !== null) next.reset();
    machine = next; memory = size; ({ firmware, extended, dos } = bindings);
    input = createCocoKeyboardTransport(machine.pias, machine.clock.hertz!);
  }
  function checkDiskName(value: unknown): asserts value is string | null {
    if (value !== null && (typeof value !== "string" || !value.trim() || value.length > 255)) throw new Error("Invalid mounted disk name.");
  }
  function requireFirmware(): void {
    if (!machine.firmware.loaded) throw new Error("Load Color BASIC before running the browser machine.");
    if (machine.cartridge.empty() && machine.dos.loaded && !machine.extended.loaded) throw new Error("Disk BASIC also requires Extended Color BASIC 1.1.");
  }
  return {
    get machine() { return machine; },
    get diskName() { return diskName; },
    get cartridgeName() { return machine.cartridge.snapshot().name; },
    mountCartridge(name: string, bytes: Uint8Array): void {
      const cartridge = new CocoCartridge({ name, image: Array.from(bytes) });
      replace({ firmware, extended, dos }, memory, cartridge.snapshot());
    },
    ejectCartridge(): void { replace({ firmware, extended, dos }, memory, new CocoCartridge().snapshot()); },
    get memorySize() { return memory; },
    configureMemory(size: 32 | 64): void { replace({ firmware, extended, dos }, size); },
    get hasFirmware() { return machine.firmware.loaded; },
    get ready() { return machine.firmware.loaded && (machine.cartridge.inserted() || !machine.dos.loaded || machine.extended.loaded); },
    get pendingInput() { return input.pending; },
    get inputSettled() { return input.settled; },
    installFirmware(image: RomImage): void { machine.firmware.install(image); firmware = image; },
    configureRoms(bindings: { firmware: RomImage | null; extended: RomImage | null; dos: RomImage | null }): void { replace(bindings); },
    mountDisk(name: string, bytes: Uint8Array): void {
      checkDiskName(name); if (name === null) throw new Error("A mounted disk needs a name.");
      machine.disk.mount(bytes); diskName = name;
    },
    ejectDisk(): void { machine.disk.mount(null); diskName = null; },
    send(keys: readonly CocoChord[]): void { requireFirmware(); input.send(keys); },
    step() {
      requireFirmware(); input.beforeStep();
      const start = machine.clock.ticks;
      const record = stepCoco(machine); input.afterStep(machine.clock.ticks - start);
      return record;
    },
    releaseInput(): void { input.release(); },
    reset(): void { requireFirmware(); machine.reset(); input.release(); },
    powerOn(): void { replace({ firmware, extended, dos }); },
    snapshot(): CocoSessionState { return { hardware: machine.snapshot(), diskName, ...input.snapshot() }; },
    restore(value: unknown): void {
      checkMachineSnapshot(value, ["hardware", "diskName", "input", "pressed", "remainingClocks"]);
      const state = value as CocoSessionState;
      const size = state.hardware?.ram?.length === 0x10000 ? 64 : 32;
      const restored = factory(size)({ firmware, extended, dos }, state.hardware);
      checkDiskName(state.diskName);
      if ((state.diskName === null) !== (restored.disk.snapshot().image === null)) throw new Error("Saved disk name does not match its mounted image.");
      const transport = createCocoKeyboardTransport(restored.pias, restored.clock.hertz!, {
        input: state.input, pressed: state.pressed, remainingClocks: state.remainingClocks,
      });
      machine = restored; memory = size; input = transport; diskName = state.diskName;
    },
  };
}
