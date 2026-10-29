import type { InstructionPreview6809 } from "./6809-instruction-preview.js";
import { hex6809 as hex } from "./6809-disassembly.js";
import { memoryAddressText } from "./memory-link.js";

export function create6809InstructionView(panel: HTMLElement, browse: (address: number) => void) {
  const at = (name: string) => panel.querySelector<HTMLElement>(`[data-instruction-${name}]`)!;
  return (preview: InstructionPreview6809 | string): void => {
    if (typeof preview === "string") {
      at("location").textContent = "Preview unavailable";
      at("preview").textContent = preview;
      at("explanation").textContent = ""; at("accesses").textContent = ""; return;
    }
    at("location").textContent = `Next boundary · $${hex(preview.address)}`;
    const assembly = document.createElement("strong"); assembly.className = "lab-instruction-assembly"; assembly.textContent = preview.assembly;
    const purpose = document.createElement("span"); purpose.className = "lab-instruction-purpose";
    purpose.textContent = preview.explanation?.split(/(?<=\.)\s/)[0] ?? "No specification for this opcode.";
    at("preview").replaceChildren(assembly, "\n", purpose, "\n\n",
      memoryAddressText([...preview.addressing, ...preview.effects].join("\n"), browse));
    at("explanation").textContent = preview.explanation ?? "No specification for this opcode.";
    at("accesses").replaceChildren(memoryAddressText(preview.accesses.map(access =>
      `${access.kind === "read" ? "Read " : "Write"} $${hex(access.address)}  $${hex(access.value, 2)}`).join("\n") || "No storage accesses.", browse));
  };
}
