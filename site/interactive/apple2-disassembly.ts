import { disassemble6502Rows } from "./6502-disassembly.js";
import type { DisassemblyRow } from "./6502-disassembly.js";
import { disassemble6502 } from "./apple2-explorer.js";
import type { Apple2TraceEntry, InstructionCatalogue, InstructionControlFlow } from "./apple2-explorer.js";

export interface Apple2CodeRow extends DisassemblyRow {
  readonly executed: boolean;
  readonly romMapped: boolean;
  readonly controlFlow: InstructionControlFlow;
}

/** Captured execution leads into live memory at PC; both use the chapter's control-flow classification. */
export function apple2CodeRows(read: (address: number) => number | undefined, start: number,
  instructions: InstructionCatalogue, romMapped: boolean, records: readonly Apple2TraceEntry[] = []): readonly Apple2CodeRow[] {
  const previous = records.slice(-3).map(({ record, romMapped }) => ({
    ...record.instruction, assembly: disassemble6502(record.instruction.address, record.instruction.bytes, instructions),
    complete: record.outcome === "executed", executed: true, romMapped,
  }));
  const rows = [...previous, ...disassemble6502Rows(read, start, instructions, 16 - previous.length)
    .map(row => ({ ...row, executed: false, romMapped }))];
  return rows.map(row => {
    const opcode = row.bytes[0], instruction = opcode === undefined ? undefined : instructions[opcode];
    return { ...row, controlFlow: instruction?.controlFlow ?? "sequential" };
  });
}
