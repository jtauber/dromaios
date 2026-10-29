import { disassemblyRows } from "./disassembly.js";
import type { DisassemblyRow } from "./disassembly.js";
export type { DisassemblyRow } from "./disassembly.js";
import { disassemble6502, hex } from "./apple2-explorer.js";
import type { InstructionCatalogue } from "./apple2-explorer.js";

/** Decode forwards through observable storage. Data accesses and CPU execution are never needed. */
export function disassemble6502Rows(read: (address: number) => number | undefined, start: number,
  instructions: InstructionCatalogue, count = 16): readonly DisassemblyRow[] {
  return disassemblyRows(start, count, address => {
    const opcode = read(address), instruction = opcode === undefined ? undefined : instructions[opcode];
    const bytes = [opcode];
    for (let offset = 1; offset < (instruction?.length ?? 1); offset++) bytes.push(read((address + offset) & 0xffff));
    return { address, bytes, complete: instruction !== undefined && bytes.every(byte => byte !== undefined),
      assembly: opcode === undefined ? "Unavailable" : instruction === undefined ? `.byte $${hex(opcode, 2)}`
        : disassemble6502(address, bytes, instructions) };
  });
}
