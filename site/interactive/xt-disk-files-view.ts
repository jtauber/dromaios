import { fat12FileSectors, fat12FileRegions, inspectFat12, type Fat12Region, type Fat12Volume } from "./fat12.js";
import { xtFileTransfers } from "./xt-disk-file-transfers.js";
import type { createXtDiskActivity } from "./xt-disk-activity.js";
import type { XtIo } from "../../src/machines/8088/pc-xt/io.js";
import { xtHex as hex } from "./8088-disassembly.js";
import { memoryLink } from "./memory-link.js";
import type { DosFileLink } from "./xt-dos-file-links.js";
import { showDosFileLink } from "./xt-dos-file-link-view.js";

export function createXtDiskFilesView(root: HTMLElement, activity: ReturnType<typeof createXtDiskActivity>,
  browseMemory: (address: number) => void, browseActivity: (regions: readonly Fat12Region[], label: string, operations?: number | readonly number[]) => void,
  changed: () => void) {
  const at = <T extends HTMLElement>(name: string) => root.querySelector<T>(`[data-${name}]`)!;
  const panel = at("disk-files"), status = at("disk-files-status"), choice = at<HTMLSelectElement>("disk-file-choice");
  const output = at("disk-file-detail"), transfers = at("disk-file-transfers");
  let image: readonly number[] | null | undefined, volume: Fat12Volume | undefined, revision = -1;
  let selected = "", error = "", ticks = 0;
  let focus: { readonly name: string; readonly offset: number; readonly length: number } | undefined;
  let captured: DosFileLink | undefined;
  const key = (offset: number, name: string) => `${offset}:${name}`;
  function button(label: string, regions: readonly Fat12Region[], operation?: number) {
    const link = document.createElement("button"); link.type = "button"; link.className = "lab-memory-link";
    link.textContent = label; link.title = "Show matching sector activity";
    link.onclick = () => browseActivity(regions, label, operation); return link;
  }
  function details(): void {
    output.replaceChildren(); transfers.replaceChildren();
    at("disk-file-transfers-title").hidden = !!captured;
    if (captured) {
      showDosFileLink(output, captured, captured.epoch === activity.epoch, browseMemory, browseActivity);
      return;
    }
    const entry = volume?.entries.find(e => key(e.offset, e.name) === selected);
    if (focus && entry?.name !== focus.name) {
      output.textContent = `${focus.name} is not on the mounted disk.`; return;
    }
    if (!volume || !entry) return;
    const regions = fat12FileRegions(volume, entry), info = document.createElement("p");
    info.className = "lab-hint";
    const attributes = [[1, "read-only"], [2, "hidden"], [4, "system"], [32, "archive"]] as const;
    info.textContent = `${entry.kind} · ${entry.size.toLocaleString()} bytes · attributes $${hex(entry.attributes, 2)}`
      + attributes.filter(([bit]) => entry.attributes & bit).map(([, name]) => ` · ${name}`).join("");
    output.append(info, button(`Activity for ${entry.name}`, regions));
    const chain = document.createElement("p"); chain.className = "basic-readout";
    chain.textContent = `Chain: ${[...entry.clusters, entry.ending].join(" → ")}`; output.append(chain);
    for (const issue of entry.issues) { const p = document.createElement("p"); p.className = "basic-message"; p.textContent = issue; output.append(p); }
    const allocation = document.createElement("details"), summary = document.createElement("summary");
    summary.textContent = "Directory, FAT and data ranges"; allocation.open = true; allocation.append(summary);
    for (const region of regions) {
      const row = document.createElement("p"); row.className = "lab-hint";
      const first = Math.floor(region.offset / 512), last = Math.floor((region.offset + region.length - 1) / 512);
      row.append(button(region.label, [region]), ` · sector ${first}${last === first ? "" : "–" + last} · image +$${hex(region.offset, 5)} · ${region.length} allocated bytes`);
      if (region.fileOffset !== undefined) row.append(` · ${region.fileBytes} file bytes at +${region.fileOffset} · ${region.length - region.fileBytes!} slack bytes`);
      if (region.kind === "fat") {
        row.append(` · entry $${hex(volume.fat[region.cluster!]!, 3)}`);
      }
      allocation.append(row);
    }
    output.append(allocation);
    let activityRegions = regions;
    if (focus && image) {
      activityRegions = fat12FileSectors(regions, focus.offset, focus.length);
      if (entry.issues.length || volume.warnings.length || activityRegions.reduce((n, r) => n + r.length, 0) !== focus.length) {
        transfers.textContent = "Cannot locate these file bytes in the mounted disk’s allocation."; return;
      }
      const fields = document.createElement("div");
      for (const span of activityRegions) {
        const row = document.createElement("p"), sector = Math.floor(span.offset / 512);
        row.className = "basic-readout";
        const bytes = image.slice(span.offset, span.offset + span.length).map(b => hex(b, 2)).join(" ");
        row.append(`File +$${hex(span.fileOffset!, 4)} · ${bytes} · cluster ${span.cluster} · `,
          button(`Sector ${sector}`, [span]), ` +$${hex(span.offset % 512, 3)} · image +$${hex(span.offset, 5)}`);
        fields.append(row);
      }
      output.prepend(fields);
    }
    const matches = xtFileTransfers(activityRegions, activity.entries());
    if (!matches.length) transfers.textContent = "No retained DMA spans overlap the selected disk ranges. Record disk activity and run a DOS read or write.";
    for (const match of [...matches].reverse()) {
      const row = document.createElement("p"); row.className = "lab-hint";
      row.append(button(`#${match.operation} ${match.label}`, [{ kind: match.kind, label: match.label, offset: match.offset, length: match.bytes }], match.operation),
        ` · image +$${hex(match.offset, 5)}${match.fileOffset === undefined ? "" : ` · file +${match.fileOffset}`} · ${match.bytes} bytes ${match.direction === "disk-to-memory" ? "→" : "←"} RAM `,
        memoryLink(match.address, browseMemory, `$${hex(match.address, 5)}`), "–",
        memoryLink(match.address + match.bytes - 1, browseMemory, `$${hex(match.address + match.bytes - 1, 5)}`));
      transfers.append(row);
    }
  }
  choice.onchange = () => { focus = undefined; captured = undefined; selected = choice.value; changed(); details(); };
  at("disk-files-refresh").onclick = () => { captured = undefined; image = undefined; changed(); };
  return {
    select(name: string, range?: { readonly offset: number; readonly length: number }): void {
      focus = range && { name, ...range };
      captured = undefined;
      const entry = volume?.entries.find(entry => entry.name === name);
      if (entry || focus) { selected = entry ? key(entry.offset, entry.name) : ""; choice.value = selected; details(); }
    },
    selectRange(link: DosFileLink): void {
      focus = undefined; captured = link; choice.value = link.entry ? key(link.entry.offset, link.entry.name) : "";
      revision = -1; details();
    },
    reset(): void { focus = undefined; captured = undefined; image = undefined; volume = undefined; selected = ""; revision = -1; output.replaceChildren(); transfers.replaceChildren(); choice.replaceChildren(); at("disk-files-warnings").textContent = ""; },
    refresh(io: XtIo, running: boolean): void {
      if (panel.hidden) return;
      at<HTMLButtonElement>("disk-files-refresh").disabled = running;
      choice.disabled = running;
      if (running) { status.textContent = "Pause to inspect current files. Any displayed allocation and transfer links remain from the previous pause."; return; }
      const next = io.inspectDiskette();
      if (next !== image) {
        image = next; volume = undefined; error = ""; ticks = io.clock.ticks;
        try { if (image) volume = inspectFat12(image); }
        catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
        choice.replaceChildren(...(volume?.entries ?? []).map(entry => new Option(`${entry.name} · ${entry.kind === "file" ? `${entry.size} bytes` : entry.kind}`, key(entry.offset, entry.name))));
        if (focus || !volume?.entries.some(e => key(e.offset, e.name) === selected)) {
          const entry = focus ? volume?.entries.find(e => e.name === focus!.name)
            : volume?.entries.find(e => e.kind === "file") ?? volume?.entries[0];
          selected = entry ? key(entry.offset, entry.name) : "";
        }
        choice.value = captured ? captured.entry ? key(captured.entry.offset, captured.entry.name) : "" : selected;
        revision = -1;
      }
      status.textContent = captured ? "Captured DOS range. Choose a root entry or Refresh files to inspect the current disk." : error || (!image ? "Drive A is empty." : volume
        ? `FAT12 · ${volume.entries.length} root entries · ${volume.sectorsPerCluster} sectors per cluster · ${volume.clusterCount} data clusters · root at +$${hex(volume.rootOffset, 5)} · snapshot at ${ticks.toLocaleString()} ticks`
        : "No readable root directory.");
      at("disk-files-warnings").textContent = volume?.warnings.join(" ") ?? "";
      if (revision !== activity.revision) { revision = activity.revision; details(); }
    },
  };
}
