import { disassemble6502Rows } from "./6502-disassembly.js";
import type { DisassemblyRow } from "./6502-disassembly.js";
import { address6502Operand, disassemble6502, romRoutine } from "./apple2-explorer.js";
import type { Apple2TraceEntry, InstructionCatalogue, InstructionControlFlow, AddressLabel, MemoryLabel } from "./apple2-explorer.js";

export interface Apple2CodeRow extends DisassemblyRow {
  readonly executed: boolean;
  readonly romMapped: boolean;
  readonly controlFlow: InstructionControlFlow;
}

/** ROM identities follow captured mapping; workspace names apply only to instructions in that ROM. */
export function apple2CodeReferences(row: Apple2CodeRow, instructions: InstructionCatalogue,
  routines: readonly AddressLabel[], labels: readonly MemoryLabel[] = []) {
  const operand = row.complete ? address6502Operand(row.address, row.bytes, instructions) : undefined;
  const label = operand === undefined ? undefined : romRoutine(operand.address, row.romMapped, routines)
    ?? labels.find(label => parseInt(label.address, 16) === operand.address && (label.scope === "hardware"
      || row.romMapped && (label.scope === "rom" || row.address >= 0xd000)));
  return {
    entry: romRoutine(row.address, row.romMapped, routines)
      ?? (row.romMapped ? labels.find(label => label.scope === "rom" && parseInt(label.address, 16) === row.address) : undefined),
    operand: operand && label ? { label, text: operand.target ? `→ ${label.name}`
      : operand.mode === "indirect" ? `(${label.name})` : operand.mode.replace(/absolute|zero page/, label.name),
      target: operand.target } : undefined,
  };
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
