import type { DiskIITransfer } from "../../src/components/devices/apple2-disk-ii.js";
import { decodeDos33Data, dos33LogicalSectors, dos33SectorSpan } from "../../src/components/devices/dos33-disk.js";
import { inspectDos33Address } from "./dos33-track.js";

type Byte = DiskIITransfer & { readonly number: number };
export interface Dos33ObservedField {
  readonly kind: "address" | "data";
  readonly track: number;
  readonly physicalSector: number;
  readonly sector: number | undefined;
  readonly first: number;
  readonly last: number;
  readonly valid: boolean;
  readonly bytes?: readonly number[];
}

/** Recognize fields from consecutive consumed bytes; never look ahead in the medium. */
export function createDos33StreamInspector() {
  let previous: Byte | undefined, address: Dos33ObservedField | undefined;
  let field: { kind: "address" | "data"; first: number; bytes: number[] } | undefined;
  const prefix: number[] = [];
  function interrupt(): void { previous = address = field = undefined; prefix.length = 0; }
  return {
    interrupt,
    consume(byte: Byte): Dos33ObservedField | undefined {
      if (byte.kind === "write") { interrupt(); return; }
      if (previous && (byte.halfTrack !== previous.halfTrack || byte.track !== previous.track
        || byte.length !== previous.length || byte.position !== (previous.position + 1) % previous.length)) interrupt();
      previous = byte;
      // A later sector cannot borrow an old address if its own address field was missed.
      if (address && byte.number - address.last > dos33SectorSpan) address = undefined;
      if (!field) {
        prefix.push(byte.value); if (prefix.length > 3) prefix.shift();
        if (prefix[0] === 0xd5 && prefix[1] === 0xaa && (prefix[2] === 0x96 || prefix[2] === 0xad)) {
          field = { kind: prefix[2] === 0x96 ? "address" : "data", first: byte.number - 2, bytes: [...prefix] };
          if (field.kind === "address") address = undefined;
          prefix.length = 0;
        }
        return;
      }
      field.bytes.push(byte.value);
      if (field.bytes.length !== (field.kind === "address" ? 13 : 346)) return;
      const completed = field; field = undefined;
      if (completed.kind === "address") {
        const decoded = inspectDos33Address(completed.bytes), sector = dos33LogicalSectors[decoded.physicalSector];
        const result: Dos33ObservedField = { kind: "address", track: byte.track, physicalSector: decoded.physicalSector, sector,
          first: completed.first, last: byte.number, valid: decoded.valid && decoded.track === byte.track && sector !== undefined };
        address = result.valid ? result : undefined;
        return result;
      }
      const selected = address; address = undefined;
      if (!selected) return;
      const bytes = decodeDos33Data(completed.bytes.slice(3));
      return { ...selected, kind: "data", first: completed.first, last: byte.number,
        valid: bytes !== undefined, ...(bytes && { bytes: Object.freeze(Array.from(bytes)) }) };
    },
  };
}
