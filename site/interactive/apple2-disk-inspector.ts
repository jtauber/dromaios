import type { Apple2DiskII } from "../../src/components/devices/apple2-disk-ii.js";
import type { Dos33SectorWrite } from "../../src/components/devices/dos33-disk.js";
import { dos33Catalogue, dos33FileSectors, sectorLabel, vtoc } from "./dos33-catalogue.js";
import { hex } from "./apple2-explorer.js";

function sectorDump(bytes: readonly number[], index: number): string {
  const lines = [];
  for (let i = 0; i < 256; i += 16) {
    const row = bytes.slice(i, i + 16);
    const text = row.map(byte => { const c = byte & 0x7f; return c >= 32 && c < 127 ? String.fromCharCode(c) : "."; }).join("");
    lines.push(`${hex(index * 256 + i, 5)}  ${row.map(byte => hex(byte, 2)).join(" ")}  ${text}`);
  }
  return lines.join("\n");
}

/** The file view uses committed images. Trace rows retain the bytes of each accepted write. */
export function createApple2DiskInspector(root: HTMLElement) {
  const panel = root.querySelector<HTMLElement>("[data-dos-inspector]");
  if (!panel) return undefined;
  const source = panel.querySelector<HTMLSelectElement>("[data-dos-source]")!;
  const sector = panel.querySelector<HTMLSelectElement>("[data-dos-sector]")!;
  const detail = panel.querySelector<HTMLElement>("[data-dos-detail]")!, dump = panel.querySelector<HTMLElement>("[data-dos-dump]")!;
  let medium: ReturnType<Apple2DiskII["inspectMedium"]> = null, detach: (() => void) | undefined;
  let image: readonly number[] | null = null, catalogue: ReturnType<typeof dos33Catalogue> | undefined, notice = "";
  let sequence = 0, followWrites = true;
  const writes: { number: number; write: Dos33SectorWrite }[] = [];
  const clear = panel.querySelector<HTMLButtonElement>("[data-dos-clear]")!;
  type Row = { key: string; index: number; label: string; detail: string; bytes?: readonly number[] };
  let rows: Row[] = [];
  function showBytes(): void {
    const row = rows[sector.selectedIndex];
    dump.textContent = row && image ? sectorDump(row.bytes ?? image.slice(row.index * 256, (row.index + 1) * 256), row.index) : "";
    if (row) detail.textContent = `${sectorLabel(row.index)} · image offset $${hex(row.index * 256, 5)}. ${row.detail}`;
  }
  function showSource(preferred = ""): void {
    rows = []; detail.textContent = notice;
    if (image && source.value === "writes") {
      detail.textContent = "No completed writes in this trace.";
      rows = writes.map(({ number, write }) => ({ key: String(number), index: write.track * 16 + write.sector,
        label: `Write #${number}`, detail: "Captured when this data field was committed.", bytes: write.bytes }));
    } else if (image && source.value === "volume") {
      rows = [{ key: "vtoc", index: vtoc, label: "Volume table", detail: notice || `Volume ${catalogue?.number}. The first catalogue pointer is at +$01.` },
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
    if (!(source.value === "writes" && followWrites) && rows.some(row => row.key === preferred)) sector.value = preferred;
    else sector.selectedIndex = source.value === "writes" ? rows.length - 1 : 0;
    clear.disabled = writes.length === 0;
    clear.hidden = source.value !== "writes";
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
      ...(catalogue?.files ?? []).map(file => new Option(`${file.locked ? "*" : ""}${file.type} ${String(file.count).padStart(3, "0")} ${file.name}`, String(file.entry))));
    source.disabled = !image;
    if (Array.from(source.options).some(option => option.value === selection)) source.value = selection;
    showSource(selectedSector);
  }
  source.onchange = () => { followWrites = true; showSource(); };
  sector.onchange = () => { followWrites = sector.selectedIndex === rows.length - 1; showBytes(); };
  clear.onclick = () => { writes.length = 0; sequence = 0; followWrites = true; showSource(); };
  showImage();
  return {
    refresh(controller: Apple2DiskII, update: boolean): void {
      const current = controller.inspectMedium();
      if (current !== medium) {
        detach?.(); medium = current; writes.length = 0; sequence = 0; followWrites = true; image = null;
        source.value = "volume"; sector.selectedIndex = -1;
        detach = medium?.observeWrites(write => {
          writes.push({ number: ++sequence, write });
          if (writes.length > 64) writes.shift();
        });
        if (!medium) showImage();
      }
      if (!update || !medium || !panel.getClientRects().length) return;
      const committed = medium.snapshot();
      if (image !== committed) { image = committed; showImage(); }
    },
  };
}
