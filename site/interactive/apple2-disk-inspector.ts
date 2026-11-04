import type { Apple2DiskII } from "../../src/components/devices/apple2-disk-ii.js";
import type { Dos33SectorWrite } from "../../src/components/devices/dos33-disk.js";
import { dos33Catalogue, dos33FileSectors, sectorLabel, vtoc } from "./dos33-catalogue.js";
import { createDos33ReadTrace } from "./dos33-reads.js";
import { hex } from "./apple2-explorer.js";

function sectorDump(bytes: readonly number[], base: number, digits: number): string {
  const lines = [];
  for (let i = 0; i < 256; i += 16) {
    const row = bytes.slice(i, i + 16);
    const text = row.map(byte => { const c = byte & 0x7f; return c >= 32 && c < 127 ? String.fromCharCode(c) : "."; }).join("");
    lines.push(`${hex(base + i, digits)}  ${row.map(byte => hex(byte, 2)).join(" ")}  ${text}`);
  }
  return lines.join("\n");
}

/** File rows browse the committed image. Trace rows keep the bytes at the time of transfer. */
export function createApple2DiskInspector(root: HTMLElement, browseMemory: (address: number) => void) {
  const panel = root.querySelector<HTMLElement>("[data-dos-inspector]");
  if (!panel) return undefined;
  const source = panel.querySelector<HTMLSelectElement>("[data-dos-source]")!;
  const sector = panel.querySelector<HTMLSelectElement>("[data-dos-sector]")!;
  const detail = panel.querySelector<HTMLElement>("[data-dos-detail]")!, dump = panel.querySelector<HTMLElement>("[data-dos-dump]")!;
  let medium: ReturnType<Apple2DiskII["inspectMedium"]> = null, detach: (() => void) | undefined;
  let image: readonly number[] | null = null, catalogue: ReturnType<typeof dos33Catalogue> | undefined, notice = "";
  const trace = createDos33ReadTrace();
  let readNumber = 0, sequence = 0, followLatest = true;
  const writes: { number: number; write: Dos33SectorWrite }[] = [];
  const clear = panel.querySelector<HTMLButtonElement>("[data-dos-clear]")!;
  const memory = panel.querySelector<HTMLButtonElement>("[data-dos-memory]")!;
  type Row = { buffer?: number; key: string; index: number; label: string; detail: string; bytes?: readonly number[] };
  let rows: Row[] = [];
  function showBytes(): void {
    const row = rows[sector.selectedIndex];
    dump.textContent = row && image ? sectorDump(row.bytes ?? image.slice(row.index * 256, (row.index + 1) * 256),
      row.buffer ?? row.index * 256, row.buffer === undefined ? 5 : 4) : "";
    memory.hidden = row?.buffer === undefined;
    if (row) detail.textContent = `${sectorLabel(row.index)} · image offset $${hex(row.index * 256, 5)}. ${row.detail}`;
    if (row?.buffer !== undefined && row.bytes && image) {
      const mounted = image, offset = row.index * 256;
      detail.textContent += row.bytes.every((byte, i) => byte === mounted[offset + i])
        ? " All 256 captured bytes match the mounted sector." : " The captured bytes differ from the mounted sector.";
    }
  }
  function showSource(preferred = ""): void {
    rows = []; detail.textContent = notice;
    if (image && source.value === "writes") {
      detail.textContent = "No completed writes in this trace.";
      rows = writes.map(({ number, write }) => ({ key: String(number), index: write.track * 16 + write.sector,
        label: `Write #${number}`, detail: "Captured when this data field was committed.", bytes: write.bytes }));
    } else if (image && source.value === "reads") {
      detail.textContent = "No completed DOS reads in this trace.";
      rows = trace.reads.map(({ number, track, sector, buffer, bytes }) => ({
        key: String(number), index: track * 16 + sector, label: `Read #${number} → $${hex(buffer)}`, buffer, bytes,
        detail: `RWTS returned these 256 bytes in RAM $${hex(buffer)}–$${hex(buffer + 255)}.`,
      }));
    } else if (image && source.value === "volume") {
      rows = [{ key: "vtoc", index: vtoc, label: "Volume table", detail: notice || `Volume ${catalogue?.number}. The first catalogue pointer is at +$01.` },
        { key: "boot", index: 0, label: "Boot sector", detail: "Compare these first 256 disk bytes with RAM at $0800 after the slot ROM loads the sector." },
        ...(catalogue?.sectors ?? []).map(index => ({ key: String(index), index, label: "Catalogue", detail: "The next catalogue pointer is at +$01." }))];
    } else if (image && catalogue) {
      const file = catalogue.files.find(file => String(file.entry) === source.value);
      if (file) {
        try { rows = dos33FileSectors(image, file).map(row => ({ ...row, key: `${row.label} ${row.index}` })); }
        catch (error) { detail.textContent = `${file.name}: ${(error as Error).message}`; }
      }
    }
    sector.replaceChildren(...rows.map(row => new Option(`${row.label} · ${sectorLabel(row.index)}`, row.key)));
    sector.size = Math.min(7, Math.max(2, rows.length));
    sector.disabled = !rows.length;
    const isTrace = source.value === "writes" || source.value === "reads";
    if (!(isTrace && followLatest) && rows.some(row => row.key === preferred)) sector.value = preferred;
    else sector.selectedIndex = isTrace ? rows.length - 1 : 0;
    clear.disabled = !rows.length; clear.hidden = !isTrace;
    clear.textContent = source.value === "reads" ? "Clear read trace" : "Clear write trace";
    showBytes();
  }
  function showImage(): void {
    const selection = source.value, selectedSector = sector.value;
    catalogue = undefined; notice = "No disk mounted.";
    if (image) {
      try { catalogue = dos33Catalogue(image); notice = ""; }
      catch (error) { notice = (error as Error).message; }
    }
    source.replaceChildren(new Option("Volume and catalogue", "volume"), new Option("Sector write trace", "writes"),
      new Option("DOS sector read trace", "reads"),
      ...(catalogue?.files ?? []).map(file => new Option(`${file.locked ? "*" : ""}${file.type} ${String(file.count).padStart(3, "0")} ${file.name}`, String(file.entry))));
    source.disabled = !image;
    if (Array.from(source.options).some(option => option.value === selection)) source.value = selection;
    showSource(selectedSector);
  }
  source.onchange = () => { followLatest = true; showSource(); };
  sector.onchange = () => { followLatest = sector.selectedIndex === rows.length - 1; showBytes(); };
  clear.onclick = () => {
    if (source.value === "reads") { trace.clear(); readNumber = 0; }
    else { writes.length = 0; sequence = 0; }
    followLatest = true; showSource();
  };
  memory.onclick = () => {
    const address = rows[sector.selectedIndex]?.buffer;
    if (address !== undefined) browseMemory(address);
  };
  showImage();
  return {
    trace,
    refresh(controller: Apple2DiskII, update: boolean): void {
      const current = controller.inspectMedium();
      if (current !== medium) {
        detach?.(); medium = current; trace.interrupt(); trace.clear(); readNumber = 0; writes.length = 0; sequence = 0; followLatest = true; image = null;
        source.value = "volume"; sector.selectedIndex = -1;
        detach = medium?.observeWrites(write => {
          writes.push({ number: ++sequence, write });
          if (writes.length > 64) writes.shift();
        });
        if (!medium) showImage();
      }
      if (!update || !medium || !panel.getClientRects().length) return;
      const committed = medium.snapshot();
      const number = trace.reads.at(-1)?.number ?? 0;
      if (image !== committed) { image = committed; showImage(); }
      else if (source.value === "reads" && number !== readNumber) showSource(sector.value);
      readNumber = number;
    },
  };
}
