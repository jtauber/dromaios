import { create8088PcXt } from "../../src/machines/generated/8088/pc-xt.js";
import { stepTimedXtCpu } from "../../src/machines/8088/pc-xt/interrupts.js";
import type { RomImage } from "../../src/machines/rom-image.js";
import { checkMachineSnapshot } from "../../src/machines/snapshot.js";
import { XtKeyboard } from "./xt-keyboard.js";
import type { XtKeyboardState } from "./xt-keyboard.js";

export type XtMachine = ReturnType<typeof create8088PcXt>;
type Bindings = Parameters<typeof create8088PcXt>[0];
export type XtRomSlot = keyof Bindings;
export interface XtSessionState {
  readonly hardware: ReturnType<XtMachine["snapshot"]>;
  readonly keyboard: XtKeyboardState;
}

/** The lab's execution and input boundary. Pausing, drawing and docking do not advance the machine. */
export function createXtSession(initial: Bindings = { bios: null, basic: null, font: null }) {
  const bindings = { ...initial };
  function freshMachine() {
    const board = create8088PcXt(bindings);
    board.reset();
    return board;
  }
  let machine = freshMachine();
  let keyboard = new XtKeyboard();
  const ready = () => machine.bios.loaded && machine.basic.loaded && machine.font.loaded;
  const offer = (byte: number) => machine.io.offerScanCode(byte);
  // Pasted text is for the selected IBM firmware; its lock state is readable without guest bus activity.
  const capsLock = () => Boolean(machine.ram.read(0x417) & 0x40);
  return {
    get machine() { return machine; },
    get keyboard() { return keyboard; },
    get ready() { return ready(); },
    install(slot: XtRomSlot, image: RomImage) { machine[slot].install(image); bindings[slot] = image; },
    step() {
      if (!ready()) throw new Error("Load the BIOS, BASIC, and character ROMs to run the XT.");
      keyboard.beforeStep(offer, capsLock);
      const result = stepTimedXtCpu(machine);
      keyboard.afterStep(result.oscillatorTicks, machine.io.keyboardSelfTesting);
      if (result.record.outcome === "unsupported") throw new Error(`Unsupported instruction at ${result.record.before.pc.toString(16)}.`);
      return result.record;
    },
    resetCpu() { machine.cpu.reset(); },
    powerOn() { machine = freshMachine(); keyboard = new XtKeyboard(); },
    snapshot(): XtSessionState { return { hardware: machine.snapshot(), keyboard: keyboard.snapshot() }; },
    restore(value: unknown) {
      checkMachineSnapshot(value, ["hardware", "keyboard"]);
      const state = value as XtSessionState;
      const next = create8088PcXt(bindings, state.hardware);
      const input = new XtKeyboard(state.keyboard);
      machine = next;
      keyboard = input;
    },
  };
}
