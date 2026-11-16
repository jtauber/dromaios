import type { Fat12Region } from "./fat12.js";
import type { XtDiskOperation } from "./xt-disk-activity.js";

export function xtDiskActivityMatches(operation: XtDiskOperation, regions: readonly Fat12Region[]): boolean {
  const overlaps = (start: number, length: number) => regions.some(region => start < region.offset + region.length && start + length > region.offset);
  if (operation.sectors.some(sector => overlaps(sector.offset + sector.firstByte, sector.bytes))) return true;
  // A rejected data command can have a meaningful target without a single DMA grant.
  if (operation.bytes || operation.parameters.length < 5 || operation.command === undefined) return false;
  if ((operation.command & 0x1f) !== 6 && (operation.command & 0x3f) !== 5) return false;
  const [, c, h, r] = operation.parameters;
  return c! < 40 && h! < 2 && r! >= 1 && r! <= 9 && overlaps(((c! * 2 + h!) * 9 + r! - 1) * 512, 512);
}

/** Clip observed DMA spans to actual directory/FAT/file bytes. Slack is excluded from file links. */
export function xtFileTransfers(regions: readonly Fat12Region[], operations: readonly XtDiskOperation[]) {
  return operations.flatMap(operation => operation.sectors.flatMap(sector => regions.flatMap(region => {
    const start = Math.max(sector.offset + sector.firstByte, region.offset);
    const end = Math.min(sector.offset + sector.lastByte + 1, region.offset + (region.fileBytes ?? region.length));
    if (end <= start) return [];
    return [{ operation: operation.id, kind: region.kind, label: region.label, direction: sector.direction,
      offset: start, bytes: end - start, address: sector.firstAddress + start - sector.offset - sector.firstByte,
      ...(region.fileOffset !== undefined && { fileOffset: region.fileOffset + start - region.offset }) }];
  })));
}
