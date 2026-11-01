import type { previewXtInstruction } from "./xt-instruction-preview.js";
import { logical8088, physical8088, xtHex as hex } from "./8088-disassembly.js";
import { memoryAddressText } from "./memory-link.js";

export function createXtInstructionView(panel: HTMLElement, browse: (address: number) => void) {
  const at = (name: string) => panel.querySelector<HTMLElement>(`[data-instruction-${name}]`)!;
  return (preview: ReturnType<typeof previewXtInstruction>): void => {
    const { row } = preview;
    at("location").textContent = `Next boundary · CS:IP ${logical8088(row.cs, row.ip)} · physical ${hex(physical8088(row.cs, row.ip), 5)}`;
    const assembly = document.createElement("strong"); assembly.className = "lab-instruction-assembly"; assembly.textContent = preview.assembly;
    const purpose = document.createElement("span"); purpose.className = "lab-instruction-purpose";
    purpose.textContent = preview.explanation?.split(/(?<=\.)\s/)[0] ?? "Instruction description unavailable.";
    at("preview").replaceChildren(assembly, "\n", purpose, "\n\n",
      memoryAddressText([...preview.addressing, ...preview.effects].join("\n"), browse, 5));
    at("explanation").textContent = preview.explanation ?? "Instruction description unavailable.";
    at("accesses").replaceChildren(memoryAddressText(preview.accesses.map(access =>
      `${access.kind === "read" ? "Read " : "Write"} $${hex(access.address, 5)}  ${hex(access.value, 2)}`).join("\n") || "No storage accesses.", browse, 5));
  };
}
