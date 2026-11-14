import { cocoRamAddress } from "../../src/machines/6809/coco/memory.js";
import { stepCocoCpu } from "../../src/machines/6809/coco/runtime.js";
import type { Coco } from "../../src/machines/6809/coco/runtime.js";
import type { Catalogue6809 } from "./6809-catalogue.js";
import { preview6809 } from "./6809-instruction-preview.js";
import { readCocoStorage } from "./coco-inspection.js";

/** Reuse native interrupt arbitration with a copied CPU; PIA/SAM state is only observed. */
export function previewCocoInstruction(machine: Coco, catalogue: Catalogue6809) {
  const state = machine.cpu.snapshot();
  const disk = machine.cartridge?.inserted() ? undefined : machine.disk;
  const halted = disk?.halted;
  const nmi = disk?.inspect().nmi_pending && state.nmiArmed;
  const preview = preview6809(state, address => readCocoStorage(machine, address), catalogue,
    address => cocoRamAddress(machine, address) !== undefined ? "ram" : address >= 0xff00 && address < 0xffe0 ? "device" : "ignored",
    cpu => halted ? { outcome: "waiting", before: state, after: cpu.snapshot(), instruction: null, accesses: [] }
      : nmi ? cpu.interrupt("nmi") : stepCocoCpu({ cpu, pias: machine.pias, sam: machine.sam, ram: machine.ram }));
  if (halted) return { ...preview, assembly: "HALT · waiting for disk", addressing: [],
    effects: ["Step advances board time; no instruction is fetched."],
    explanation: "The disk controller holds HALT until data or command completion releases the CPU." };
  // Entry can stop at an unavailable vector or stack address before a record exists.
  const source = nmi ? "NMI" : machine.pias.firq && !state.flags.f ? "FIRQ" : machine.pias.irq && !state.flags.i ? "IRQ" : undefined;
  return preview.blocked && source ? { ...preview, assembly: `${source} · entry preview stopped`, addressing: [],
    explanation: "External interrupt entry precedes the instruction at PC." } : preview;
}
