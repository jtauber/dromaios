import { create6502Apple2 } from "../../src/machines/generated/6502/apple2.js";
import type { RomImage } from "../../src/machines/rom-image.js";
import { checkUnsigned } from "../../src/components/validation.js";
import { terminalInput } from "./serial-terminal.js";
import { Dos33Disk } from "../../src/components/devices/dos33-disk.js";
import { checkMachineSnapshot } from "../../src/machines/snapshot.js";

export interface Apple2SessionState {
  readonly hardware: ReturnType<ReturnType<typeof create6502Apple2>["snapshot"]>;
  readonly input: readonly number[];
}

/** Host keyboard transport for a generated machine; all BASIC behavior still executes in ROM. */
export function createApple2Session(firmware: RomImage | null = null, disk?: { readonly bootstrap: readonly number[]; readonly image: Dos33Disk }) {
  let machine = powerOn(disk), input: number[] = [];
  function powerOn(selected?: typeof disk) {
    const machine = create6502Apple2({ firmware });
    if (selected !== undefined) { machine.disk.install(selected.bootstrap); machine.disk.insert(selected.image); }
    if (firmware !== null) machine.reset();
    return machine;
  }
  function requireFirmware(): void {
    if (!machine.firmware.loaded) throw new Error("Install firmware before running or resetting the browser machine.");
  }
  return {
    get machine() { return machine; },
    get hasFirmware() { return machine.firmware.loaded; },
    get pendingInput() { return input.length; },
    snapshot(): Apple2SessionState { return { hardware: machine.snapshot(), input: [...input] }; },
    restore(value: unknown): void {
      checkMachineSnapshot(value, ["hardware", "input"]);
      const state = value as Apple2SessionState;
      if (!Array.isArray(state.input) || state.input.length > 4096) throw new Error("Invalid saved keyboard queue.");
      for (const byte of state.input) checkUnsigned("Saved keyboard character", byte, 0x7f);
      // Construct and validate everything before replacing any part of the live session.
      const restored = create6502Apple2({ firmware }, state.hardware);
      const { bootstrap, media } = state.hardware.disk;
      if (media !== null && bootstrap === null) throw new Error("Saved disk requires its bootstrap.");
      machine = restored; input = [...state.input];
    },
    installFirmware(image: RomImage): void { machine.firmware.install(image); firmware = image; },
    send(bytes: readonly number[]): void {
      if (input.length + bytes.length > 4096) throw new Error("The keyboard queue is full. Let the machine catch up.");
      for (const byte of bytes) checkUnsigned("Keyboard character", byte, 0x7f);
      input.push(...bytes);
    },
    step() {
      requireFirmware();
      if (input.length && machine.keyboard.offer(input[0]!)) input.shift();
      return machine.step();
    },
    reset(): void { requireFirmware(); machine.reset(); input = []; },
    /** Exchange drive-one media without restarting software or discarding queued input. */
    swapDisk(image: Dos33Disk): void {
      if (!machine.disk.inspect().installed) throw new Error("Boot from a disk before exchanging drive-one media.");
      machine.disk.insert(image);
    },
    powerOn(): void {
      const { bootstrap } = machine.disk.snapshot(), image = machine.disk.medium;
      // The laboratory owns the medium; a fresh machine keeps borrowing that same disk.
      machine = powerOn(image && bootstrap ? { bootstrap, image } : undefined);
      input = [];
    },
    eject(): void { machine.disk.eject(); },
  };
}

/** Reject non-ASCII before uppercasing; a paste is one BASIC line, including an optional Enter. */
export function apple2Input(text: string): number[] {
  return terminalInput(text).map(byte => byte >= 0x61 && byte <= 0x7a ? byte - 32 : byte);
}

export function apple2ControlKey(event: {
  readonly key: string; readonly ctrlKey: boolean; readonly metaKey: boolean;
  readonly altKey: boolean; readonly isComposing: boolean;
}): number | undefined {
  if (event.isComposing || event.metaKey || event.altKey) return undefined;
  if (event.ctrlKey) return event.key.toLowerCase() === "c" ? 3 : undefined;
  if (event.key === "Backspace" || event.key === "ArrowLeft") return 8;
  if (event.key === "ArrowRight") return 21;
  if (event.key === "ArrowUp") return 11;
  if (event.key === "ArrowDown") return 10;
  if (event.key === "Escape") return 27;
  return event.key === "Enter" ? 13 : undefined;
}

/** A focused screen has no text input element; printable keys are delivered explicitly. */
export function apple2ScreenKey(event: Parameters<typeof apple2ControlKey>[0]): number | undefined {
  const control = apple2ControlKey(event);
  if (control !== undefined) return control;
  if (event.isComposing || event.metaKey || event.altKey || event.ctrlKey || !/^[ -~]$/.test(event.key)) return undefined;
  return apple2Input(event.key)[0];
}
