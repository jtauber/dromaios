import { create6502Apple2 } from "../../src/machines/generated/6502/apple2.js";
import type { RomImage } from "../../src/machines/rom-image.js";
import { checkUnsigned } from "../../src/components/validation.js";
import { terminalInput } from "./serial-terminal.js";
import type { Dos33Disk } from "../../src/components/devices/dos33-disk.js";

/** Host keyboard transport for a generated machine; all BASIC behavior still executes in ROM. */
export function createApple2Session(firmware: RomImage | null = null, disk?: { readonly bootstrap: readonly number[]; readonly image: Dos33Disk }) {
  // Fresh power-on retains selected media; eject changes that selection as well as the live drive.
  let selected = disk === undefined ? undefined : { bootstrap: [...disk.bootstrap], image: disk.image };
  let machine = powerOn(), input: number[] = [];
  function powerOn() {
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
    installFirmware(image: RomImage): void { machine.firmware.install(image); firmware = image; },
    send(bytes: readonly number[]): void {
      if (input.length + bytes.length > 4096) throw new Error("The keyboard queue is full. Let the machine catch up.");
      for (const byte of bytes) checkUnsigned("Keyboard character", byte, 0x7f);
      input.push(...bytes);
    },
    step() {
      requireFirmware();
      if (input.length && machine.keyboard.offer(input[0]!)) input.shift();
      return machine.cpu.step();
    },
    reset(): void { requireFirmware(); machine.reset(); input = []; },
    powerOn(): void { machine = powerOn(); input = []; },
    eject(): void { machine.disk.eject(); selected = undefined; },
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
