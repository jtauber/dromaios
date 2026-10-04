import type { createApple2Session } from "./apple2-session.js";
import type { InstructionCatalogue } from "./apple2-explorer.js";
import { hex } from "./apple2-explorer.js";
import { apple2StorageReader } from "./apple2-inspection.js";
import { preview6502 } from "./apple2-instruction-preview.js";

/** Explain the upcoming instruction independently of recorded execution history. */
export function createApple2InstructionView(root: HTMLElement, instructions: InstructionCatalogue) {
  const output = root.querySelector<HTMLElement>("[data-instruction-preview]");
  if (!output) return undefined;
  const location = root.querySelector<HTMLElement>("[data-instruction-location]")!;
  const accesses = root.querySelector<HTMLElement>("[data-instruction-accesses]")!;
  return (machine: ReturnType<typeof createApple2Session>["machine"]): void => {
    const state = machine.cpu.snapshot(), preview = preview6502(state, apple2StorageReader(machine), instructions);
    location.textContent = `Next · $${hex(state.pc)}`;
    const heading = document.createElement("strong"); heading.className = "lab-instruction-assembly"; heading.textContent = preview.assembly;
    output.replaceChildren(heading, `\n\n${preview.effects.join("\n")}`);
    accesses.textContent = preview.accesses.map(access => `${access.kind === "read" ? "Read " : "Write"} $${hex(access.address)}  $${hex(access.value, 2)}`).join("\n") || "No storage reads available.";
  };
}
