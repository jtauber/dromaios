import { stepCoco } from "../../src/machines/6809/coco/runtime.js";
import type { Coco } from "../../src/machines/6809/coco/runtime.js";
import type { Catalogue6809 } from "./6809-catalogue.js";
import { preview6809 } from "./6809-instruction-preview.js";
import { readCocoStorage } from "./coco-inspection.js";

/** Reuse native interrupt arbitration with a copied CPU; PIA/SAM state is only observed. */
export function previewCocoInstruction(machine: Coco, catalogue: Catalogue6809) {
  const state = machine.cpu.snapshot();
  const preview = preview6809(state, address => readCocoStorage(machine, address), catalogue,
    address => address < 0x8000 ? "ram" : address >= 0xff00 && address < 0xffe0 ? "device" : "ignored",
    cpu => stepCoco({ ...machine, cpu }));
  // Entry can stop at an unavailable vector or stack address before a record exists.
  const source = machine.pias.firq && !state.flags.f ? "FIRQ" : machine.pias.irq && !state.flags.i ? "IRQ" : undefined;
  return preview.blocked && source ? { ...preview, assembly: `${source} · entry preview stopped`, addressing: [],
    explanation: "External interrupt entry precedes the instruction at PC." } : preview;
}
