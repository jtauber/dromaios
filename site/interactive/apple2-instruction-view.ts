import { hex } from "./apple2-explorer.js";
import type { Apple2InstructionPreview } from "./apple2-instruction-preview.js";
import { memoryAddressText } from "./memory-link.js";

/** Explain the upcoming instruction independently of recorded execution history. */
export function createApple2InstructionView(root: HTMLElement, browse: (address: number) => void) {
  const output = root.querySelector<HTMLElement>("[data-instruction-preview]");
  if (!output) return undefined;
  const location = root.querySelector<HTMLElement>("[data-instruction-location]")!;
  const accesses = root.querySelector<HTMLElement>("[data-instruction-accesses]")!;
  const explanation = root.querySelector<HTMLElement>("[data-instruction-explanation]")!;
  const calculations = root.querySelector<HTMLElement>("[data-instruction-calculations]")!;
  return (preview: Apple2InstructionPreview): void => {
    location.textContent = `Next · $${hex(preview.address)}`;
    const heading = document.createElement("strong"); heading.className = "lab-instruction-assembly"; heading.textContent = preview.assembly;
    const addresses = preview.addressing.length ? preview.addressing.join("\n") + "\n\n" : "";
    const effects = preview.effects.filter(line => !line.startsWith("Write ") || !preview.addressing.includes(line));
    const purpose = preview.explanation?.split(/(?<=\.)\s/)[0] ?? "";
    const description = document.createElement("span"); description.className = "lab-instruction-purpose"; description.textContent = purpose;
    output.replaceChildren(heading, "\n", description, "\n\n", memoryAddressText(addresses + effects.join("\n"), browse));
    accesses.replaceChildren(memoryAddressText(preview.accesses.map(access => `${access.kind === "read" ? "Read " : "Write"} $${hex(access.address)}  $${hex(access.value, 2)}`).join("\n") || "No storage reads available.", browse));
    explanation.textContent = preview.explanation ?? "No specification for this opcode.";
    calculations.textContent = preview.calculations.join("\n");
  };
}
