import { create8088PcXt } from "../../src/machines/generated/8088/pc-xt.js";
import { create8088PcXtEga } from "../../src/machines/generated/8088/pc-xt-ega.js";
import { stepTimedXtCpu, type XtCpuBoard } from "../../src/machines/8088/pc-xt/interrupts.js";
import type { RomImage } from "../../src/machines/rom-image.js";
import { checkMachineSnapshot } from "../../src/machines/snapshot.js";
import { XtKeyboard } from "./xt-keyboard.js";
import type { XtKeyboardState } from "./xt-keyboard.js";

export type XtMachine = ReturnType<typeof create8088PcXt | typeof create8088PcXtEga>;
type Bindings = Parameters<typeof create8088PcXt>[0];
type EgaBindings = Parameters<typeof create8088PcXtEga>[0];
export type XtRomSlot = keyof Bindings | keyof EgaBindings;
export interface XtSessionState {
  readonly hardware: ReturnType<XtMachine["snapshot"]>;
  readonly keyboard: XtKeyboardState;
  readonly diskName: string | null;
}

/** Keyboard delivery and timed arbitration are identical for live execution and a private preview. */
export function stepXtSessionCpu(machine: XtCpuBoard & Pick<XtMachine, "ram">, keyboard: XtKeyboard) {
  keyboard.beforeStep(byte => machine.io.offerScanCode(byte), () => Boolean(machine.ram.read(0x417) & 0x40));
  const result = stepTimedXtCpu(machine);
  keyboard.afterStep(result.oscillatorTicks, machine.io.keyboardSelfTesting);
  return result.record;
}

function checkDiskName(name: unknown): asserts name is string {
  if (typeof name !== "string" || !name.trim() || name.length > 255) throw new Error("Invalid XT disk filename.");
}

/** The lab's execution and input boundary. Pausing, drawing and docking do not advance the machine. */
export function createXtSession(initial: Bindings = { bios: null, basic: null, font: null }) {
  const bindings = { ...initial };
  return xtSession((state?: Parameters<typeof create8088PcXt>[1]) => create8088PcXt(bindings, state),
    (machine, slot, image) => {
      if (slot === "option") throw new Error("The CGA has no option ROM.");
      machine[slot].install(image); bindings[slot] = image;
    });
}

export function createXtEgaSession(initial: EgaBindings = { bios: null, basic: null, option: null }) {
  const bindings = { ...initial };
  return xtSession((state?: Parameters<typeof create8088PcXtEga>[1]) => create8088PcXtEga(bindings, state),
    (machine, slot, image) => {
      if (slot === "font") throw new Error("The EGA loads its font from the option ROM.");
      machine[slot].install(image); bindings[slot] = image;
    });
}

function xtSession<M extends XtMachine, S>(create: (state?: S) => M,
  install: (machine: M, slot: XtRomSlot, image: RomImage) => void) {
  function freshMachine() {
    const board = create();
    board.reset();
    return board;
  }
  let machine = freshMachine();
  let keyboard = new XtKeyboard();
  let diskName: string | null = null;
  const ready = () => machine.bios.loaded && machine.basic.loaded && ("option" in machine ? machine.option.loaded : machine.font.loaded);
  return {
    get machine() { return machine; },
    get keyboard() { return keyboard; },
    get ready() { return ready(); },
    get diskName() { return diskName; },
    insertDisk(name: string, bytes: Uint8Array, { writable = false } = {}) {
      checkDiskName(name);
      machine.io.setDiskette(bytes, { writable });
      diskName = name;
    },
    ejectDisk() { machine.io.setDiskette(null); diskName = null; },
    install(slot: XtRomSlot, image: RomImage) { install(machine, slot, image); },
    step() {
      if (!ready()) throw new Error("Load the BIOS, BASIC, and display firmware to run the XT.");
      const record = stepXtSessionCpu(machine, keyboard);
      if (record.outcome === "unsupported") throw new Error(`Unsupported instruction at ${record.before.pc.toString(16)}.`);
      return record;
    },
    resetCpu() { machine.cpu.reset(); },
    powerOn(start: "cold" | "quick" = "cold") {
      const { disketteImage, diskette } = machine.io.snapshot();
      const next = freshMachine();
      if (disketteImage) next.io.setDiskette(disketteImage, { writable: diskette.writable });
      if (start === "quick") {
        // The 11/08/82 BIOS checks the Ctrl-Alt-Del signature at 0040:0072 during POST.
        next.ram.write(0x472, 0x34);
        next.ram.write(0x473, 0x12);
      }
      machine = next;
      keyboard = new XtKeyboard();
    },
    snapshot(): XtSessionState { return { hardware: machine.snapshot(), keyboard: keyboard.snapshot(), diskName }; },
    restore(value: unknown) {
      checkMachineSnapshot(value, ["hardware", "keyboard", "diskName"]);
      const state = value as XtSessionState;
      const next = create(state.hardware as S);
      const input = new XtKeyboard(state.keyboard);
      if (next.io.snapshot().disketteImage) checkDiskName(state.diskName);
      else if (state.diskName !== null) throw new Error("Empty XT drive cannot have a disk filename.");
      machine = next;
      keyboard = input;
      diskName = state.diskName;
    },
  };
}
