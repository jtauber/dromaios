import { checkUnsigned } from "../../src/components/validation.js";

export interface DisassemblyRow {
  readonly address: number;
  readonly bytes: readonly (number | undefined)[];
  readonly assembly: string;
  readonly complete: boolean;
}

/** A bounded forward window; each decoder owns instruction length and operand wrapping. */
export function disassemblyRows<Row extends DisassemblyRow>(start: number, count: number,
  decode: (address: number) => Row): readonly Row[] {
  checkUnsigned("Disassembly address", start, 0xffff);
  checkUnsigned("Disassembly row count", count, 256);
  const rows: Row[] = [];
  for (let address = start; address <= 0xffff && rows.length < count;) {
    const row = decode(address);
    if (!row.bytes.length) throw new Error("A disassembly row must advance at least one byte.");
    rows.push(row); address += row.bytes.length;
  }
  return rows;
}
