import { checkUnsigned } from "../../src/components/validation.js";
import { disassemble6502, hex } from "./apple2-explorer.js";
import type { InstructionCatalogue } from "./apple2-explorer.js";

export interface DisassemblyRow {
  readonly address: number;
  readonly bytes: readonly (number | undefined)[];
  readonly assembly: string;
  readonly complete: boolean;
}

/** Decode forwards through observable storage. Data accesses and CPU execution are never needed. */
export function disassemble6502Rows(read: (address: number) => number | undefined, start: number,
  instructions: InstructionCatalogue, count = 16): readonly DisassemblyRow[] {
  checkUnsigned("Disassembly address", start, 0xffff);
  checkUnsigned("Disassembly row count", count, 256);
  const rows: DisassemblyRow[] = [];
  for (let address = start; address <= 0xffff && rows.length < count;) {
    const opcode = read(address), instruction = opcode === undefined ? undefined : instructions[opcode];
    const bytes = [opcode];
    for (let offset = 1; offset < (instruction?.length ?? 1); offset++) bytes.push(read((address + offset) & 0xffff));
    rows.push({ address, bytes, complete: instruction !== undefined && bytes.every(byte => byte !== undefined),
      assembly: opcode === undefined ? "Unavailable" : instruction === undefined ? `.byte $${hex(opcode, 2)}`
        : disassemble6502(address, bytes, instructions) });
    // Operand fetches wrap like the CPU; the displayed address window ends at FFFF.
    address += bytes.length;
  }
  return rows;
}
