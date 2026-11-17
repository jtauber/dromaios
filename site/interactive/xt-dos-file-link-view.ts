import type { DosFileLink } from "./xt-dos-file-links.js";
import type { Fat12Region } from "./fat12.js";
import { dosOffsetText } from "./xt-dos-explanation.js";
import { xtHex as hex } from "./8088-disassembly.js";
import { memoryLink } from "./memory-link.js";

export function showDosFileLink(output: HTMLElement, link: DosFileLink, sameHistory: boolean,
  browseMemory: (address: number) => void,
  browseActivity: (regions: readonly Fat12Region[], label: string, operations: number | readonly number[]) => void): void {
  const { call, range, entry } = link, label = `DOS call #${call.id} · ${call.service.name}`;
  function paragraph(text: string, className = "lab-hint") {
    const p = document.createElement("p"); p.className = className; p.textContent = text; output.append(p); return p;
  }
  function activityButton(text: string, regions: readonly Fat12Region[], operations: number | readonly number[]) {
    const b = document.createElement("button"); b.type = "button"; b.className = "lab-memory-link"; b.textContent = text;
    b.disabled = !sameHistory; b.onclick = () => browseActivity(regions, label, operations); return b;
  }
  paragraph(`${label} · ${call.filename ?? entry?.name ?? "filename unknown"}`, "basic-readout");
  paragraph(`File bytes ${dosOffsetText(range.offset)} through ${dosOffsetText(range.offset + range.length - 1)} · ${range.length} bytes.`);
  paragraph("Captured at the DOS return. Allocation and DMA links describe that observation; Memory opens current RAM.");
  paragraph("Program buffer", "basic-readout");
  for (const span of link.memory) {
    paragraph(`File +${span.fileOffset} · ${span.length} bytes · RAM `).append(memoryLink(span.address, browseMemory, `$${hex(span.address, 5)}`), "–",
      memoryLink(span.address + span.length - 1, browseMemory, `$${hex(span.address + span.length - 1, 5)}`));
  }
  paragraph("FAT12 allocation", "basic-readout");
  if (link.note) paragraph(link.note, "basic-message");
  if (link.regions.length) {
    paragraph(`Root entry ${entry!.name} · ${entry!.size} bytes · chain ${entry!.clusters.join(" → ")}`);
    for (const region of link.regions) {
      const sector = region.offset / 512 | 0;
      paragraph(`File +${region.fileOffset} · ${region.length} bytes · cluster ${region.cluster} · image +$${hex(region.offset, 5)} · `)
        .append(activityButton(`Sector ${sector} (C${Math.floor(sector / 18)} H${Math.floor(sector / 9) % 2} R${sector % 9 + 1})`, [region],
          link.transfers.map(t => t.operation)));
    }
  }
  paragraph("Disk activity during this call", "basic-readout");
  if (!link.complete) paragraph("Recording did not cover the whole call. Missing transfers cannot establish a cached read.", "basic-message");
  else if (!link.dmaBytes) paragraph(call.service.buffer!.direction === "output"
    ? "No disk DMA occurred during this read: DOS supplied the bytes without a new disk transfer."
    : "No disk DMA occurred during this write: completion does not establish that DOS flushed the bytes to disk.");
  else paragraph(`${link.dmaBytes} disk DMA bytes observed during the call. Links below cover only matching file bytes in the call's direction; other bytes can be metadata, read-ahead, or buffered writes.`);
  for (const transfer of link.transfers) {
    paragraph(`File +${transfer.fileOffset} · ${transfer.bytes} bytes · `).append(
      activityButton(`Command #${transfer.operation}`, [{ kind: "data", label, offset: transfer.offset, length: transfer.bytes }], transfer.operation),
      ` · DMA ${transfer.direction === "disk-to-memory" ? "→" : "←"} RAM `,
      memoryLink(transfer.address, browseMemory, `$${hex(transfer.address, 5)}`), "–",
      memoryLink(transfer.address + transfer.bytes - 1, browseMemory, `$${hex(transfer.address + transfer.bytes - 1, 5)}`));
  }
  if (link.dmaBytes && !link.transfers.length) paragraph("No recorded DMA span maps to this captured file range.");
  if (!sameHistory) paragraph("Activity history was cleared or the media changed; historical sector navigation is disabled.");
  paragraph("A DMA buffer may belong to DOS, while the program buffer is DS:DX. Matching file offsets do not prove the CPU copy between them.");
}
