import type { XtIo } from "../../src/machines/8088/pc-xt/io.js";
import { physical8088 } from "./8088-disassembly.js";
import { fat12FileSectors, fat12FileRegions, inspectFat12, type Fat12Entry, type Fat12Region } from "./fat12.js";
import { dosFileRange, type DosCall } from "./xt-dos-services.js";
import type { createXtDiskActivity, XtDiskActivityMark } from "./xt-disk-activity.js";
import { xtFileTransfers } from "./xt-disk-file-transfers.js";

export interface DosFileLink {
  readonly call: DosCall;
  readonly range: { readonly offset: number; readonly length: number };
  readonly memory: readonly { readonly address: number; readonly length: number; readonly fileOffset: number }[];
  readonly entry?: Fat12Entry;
  readonly regions: readonly Fat12Region[];
  readonly transfers: ReturnType<typeof xtFileTransfers>;
  readonly epoch: number;
  readonly complete: boolean;
  readonly dmaBytes: number;
  readonly note?: string;
}

/** Split a caller's buffer at both 16-bit offset and 20-bit physical wraps. */
export function dosBufferRegions(segment: number, offset: number, fileOffset: number, length: number) {
  const regions: { address: number; length: number; fileOffset: number }[] = [];
  while (length) {
    const address = physical8088(segment, offset), count = Math.min(length, 0x10000 - offset, 0x100000 - address);
    regions.push({ address, length: count, fileOffset });
    length -= count; fileOffset += count; offset = (offset + count) & 0xffff;
  }
  return regions;
}

/** Join at the observed return, never by reinterpreting old calls against today's disk. */
export function createXtDosFileLinks(current: () => XtIo, activity: ReturnType<typeof createXtDiskActivity>) {
  const pending = new Map<number, { io: XtIo; mark: XtDiskActivityMark }>();
  const links = new Map<number, DosFileLink>();
  return {
    get: (call: DosCall) => links.get(call.id),
    reset(): void { pending.clear(); links.clear(); },
    observe(call: DosCall): void {
      if (call.service.result.kind !== "count" || !call.file) return;
      if (call.state === "pending") {
        pending.set(call.id, { io: current(), mark: activity.mark() });
        if (pending.size > 16) pending.delete(pending.keys().next().value!);
        return;
      }
      const start = pending.get(call.id); pending.delete(call.id);
      const range = call.result && dosFileRange(call, call.result);
      if (!start || !range || !range.length) return;
      const io = current(), window = activity.since(start.mark), identity = call.result!.file?.disk, before = call.file.disk;
      let entry: Fat12Entry | undefined, regions: Fat12Region[] = [], note: string | undefined;
      if (start.io !== io || start.mark.epoch !== activity.epoch) note = "Machine, media, or activity history changed during the call; allocation unavailable.";
      else if (!identity || identity.drive !== 0) note = "No identified local Drive A file; allocation unavailable.";
      else if (before && (before.drive !== identity.drive || before.directory !== identity.directory || before.name !== identity.name
        || before.firstCluster !== 0 && before.firstCluster !== identity.firstCluster)) note = "The open file's disk identity changed during the call; allocation unavailable.";
      else {
        const image = io.inspectDiskette();
        try {
          const volume = image && inspectFat12(image);
          entry = volume?.entries.find(e => e.kind === "file" && e.offset === identity.directory && e.firstCluster === identity.firstCluster
            && e.name.split(".")[0]!.padEnd(8) + (e.name.split(".")[1] ?? "").padEnd(3) === identity.name);
          if (!entry || !volume) note = "DOS's open file does not match a root entry on the mounted disk.";
          else if (entry.issues.length || volume.warnings.length) note = "The on-disk allocation is incomplete or inconsistent; it may still be buffered by DOS.";
          else {
            regions = fat12FileSectors(fat12FileRegions(volume, entry), range.offset, range.length);
            if (regions.reduce((sum, r) => sum + r.length, 0) !== range.length) {
              regions = []; note = "The completed range is not yet present in the on-disk file size or allocation.";
            }
          }
        } catch (error) { note = error instanceof Error ? error.message : String(error); }
      }
      const direction = call.service.buffer!.direction === "output" ? "disk-to-memory" : "memory-to-disk";
      const transfers = xtFileTransfers(regions, window.operations).filter(t => t.direction === direction);
      links.set(call.id, { call, range, entry, regions, transfers, epoch: start.mark.epoch,
        memory: dosBufferRegions(call.buffer!.segment, call.buffer!.offset, range.offset, range.length),
        complete: start.io === io && window.complete, dmaBytes: window.operations.reduce((sum, op) => sum + op.bytes, 0), ...(note && { note }) });
      if (links.size > 128) links.delete(links.keys().next().value!);
    },
  };
}
