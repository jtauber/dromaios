import type { Catalogue6809 } from "./6809-catalogue.js";
import type { Boundary6809 } from "./6809-instruction-preview.js";
import { decodeCaptured6809, disassemble6809Rows } from "./6809-disassembly.js";

/** History uses fetched bytes, including self-modifying code; forward rows use observed storage. */
export function code6809Rows(read: (address: number) => number | undefined, start: number,
  catalogue: Catalogue6809, records: readonly Boundary6809[] = []) {
  const recent = records.flatMap((record, index) => record.instruction ? [{ record, index }] : []).slice(-3);
  const previous = recent.map(({ record, index }, position) => {
    const instruction = record.instruction!;
    const decoded = decodeCaptured6809(instruction.address, instruction.bytes, catalogue);
    const nextIndex = recent[position + 1]?.index ?? records.length;
    return { ...decoded, bytes: instruction.bytes, complete: record.outcome !== "unsupported" && decoded.complete,
      executed: true, dp: record.before.dp, boundaryAfter: records.slice(index + 1, nextIndex).some(record => !record.instruction) };
  });
  return [...previous, ...disassemble6809Rows(read, start, catalogue, 16 - previous.length)
    .map(row => ({ ...row, executed: false, dp: undefined, boundaryAfter: false }))];
}
