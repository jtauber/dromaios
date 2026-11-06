import type { Dos33Disk } from "../../src/components/devices/dos33-disk.js";
import { hex } from "./apple2-explorer.js";
import { inspectDos33Track } from "./dos33-track.js";

export function diskByteDump(bytes: readonly number[], base: number, digits: number): string {
  const lines = [];
  for (let i = 0; i < bytes.length; i += 16) {
    const row = bytes.slice(i, i + 16);
    const text = row.map(byte => { const c = byte & 0x7f; return c >= 32 && c < 127 ? String.fromCharCode(c) : "."; }).join("");
    lines.push(`${hex(base + i, digits)}  ${row.map(byte => hex(byte, 2)).join(" ").padEnd(47)}  ${text}`);
  }
  return lines.join("\n");
}

type Medium = Pick<Dos33Disk, "snapshot" | "inspectTrack">;
type Selection = { index: number; bytes?: readonly number[] };

/** Keep encoded snapshots with the displayed image, including when Live is held. */
export function createApple2DiskTrackInspector(panel: HTMLElement) {
  const view = panel.querySelector<HTMLDetailsElement>("[data-dos-encoded]")!;
  const detail = panel.querySelector<HTMLElement>("[data-dos-encoded-detail]")!;
  const address = panel.querySelector<HTMLElement>("[data-dos-address-field]")!;
  const data = panel.querySelector<HTMLElement>("[data-dos-data-field]")!;
  const dump = panel.querySelector<HTMLElement>("[data-dos-encoded-dump]")!;
  const whole = panel.querySelector<HTMLElement>("[data-dos-track-dump]")!;
  let medium: Medium | null = null, image: readonly number[] | null = null, selection: Selection | undefined;
  const tracks = new Map<number, readonly number[]>();
  function render(): void {
    address.textContent = data.textContent = dump.textContent = whole.textContent = "";
    if (!view.open || !medium || !image || !selection) return;
    const displayed = image, { index, bytes: captured } = selection;
    const cylinder = Math.floor(index / 16), logical = index % 16;
    let track = tracks.get(cylinder);
    if (!track && medium.snapshot() === image) {
      track = medium.inspectTrack(cylinder); tracks.set(cylinder, track);
    }
    if (!track) {
      detail.textContent = "This track was not captured before the disk changed. Enable Live to inspect the current track.";
      return;
    }
    whole.textContent = diskByteDump(track, 0, 4);
    const field = inspectDos33Track(track).find(field => field.addressValid && field.track === cylinder && field.sector === logical);
    detail.textContent = `Track ${cylinder} · ${track.length.toLocaleString("en-US")} encoded bytes · DOS sector ${logical}.`;
    if (!field) { detail.textContent += " No valid matching address field found."; return; }
    detail.textContent += ` Physical sector ${field.physicalSector} → DOS sector ${logical}. Volume ${field.volume}.`;
    address.textContent = `Address field at $${hex(field.addressOffset)}\n`
      + diskByteDump(track.slice(field.addressOffset, field.addressOffset + 14), field.addressOffset, 4)
      + `\n4-and-4: volume $${hex(field.volume, 2)}, track $${hex(field.track, 2)}, physical sector $${hex(field.physicalSector, 2)}`
      + `\nChecksum $${hex(field.checksum, 2)} = $${hex(field.volume, 2)} XOR $${hex(field.track, 2)} XOR $${hex(field.physicalSector, 2)} · valid`;
    const offset = field.dataOffset;
    if (offset === undefined) { data.textContent = "No data prologue found after this address field."; return; }
    dump.textContent = diskByteDump(track.slice(offset, offset + 349), offset, 4);
    data.textContent = `Data field at $${hex(offset)} · D5 AA AD · 342 encoded values + checksum · DE AA EB. `;
    if (!field.bytes) { data.textContent += "Invalid 6-and-2 field, checksum, or epilogue."; return; }
    const decoded = field.bytes, base = index * 256;
    data.textContent += `Checksum $${hex(track[offset + 345]!, 2)} at $${hex(offset + 345)} is valid. `;
    data.textContent += decoded.every((byte, i) => byte === displayed[base + i])
      ? "All 256 decoded bytes match the displayed image sector. " : "Decoded bytes differ from the displayed image sector. ";
    if (captured) data.textContent += decoded.every((byte, i) => byte === captured[i])
      ? "All 256 decoded bytes match the captured transfer." : "Decoded bytes differ from the captured transfer.";
  }
  view.ontoggle = render;
  return {
    show(current: Medium | null, displayed: readonly number[] | null, row: Selection | undefined): void {
      if (medium !== current || image !== displayed) tracks.clear();
      medium = current; image = displayed; selection = row;
      view.hidden = !image || !selection;
      detail.textContent = "";
      render();
    },
  };
}
