import type { AddressLabel, MemoryLabel, RomRegion } from "./rom-reference.js";
import type { DebugLocation } from "./instruction-debugger.js";
const hex = (value: number) => value.toString(16).toUpperCase().padStart(4, "0");

export interface RomRoutine extends AddressLabel {
  readonly details?: {
    readonly inputs: string;
    readonly outputs: string;
    readonly workspace: readonly string[];
    readonly related: readonly string[];
  };
}
export interface RomInstructionNote { readonly address: string; readonly bytes: string; readonly text: string }
export interface RomCheckpoint {
  readonly title: string;
  readonly address: string;
  readonly prepare: string;
  readonly observe: string;
  readonly routine: string;
}
export interface RomWalkthrough {
  readonly id: string;
  readonly title: string;
  readonly setup: string;
  readonly steps: readonly RomCheckpoint[];
}
export interface RomGuide {
  readonly routines: readonly RomRoutine[];
  readonly labels: readonly MemoryLabel[];
  readonly regions: readonly RomRegion[];
  readonly notes: readonly RomInstructionNote[];
  readonly walkthroughs: readonly RomWalkthrough[];
}

/** Notes describe this ROM's instructions, never RAM at the same address or mismatched captured bytes. */
export function createRomNotes(notes: readonly RomInstructionNote[]) {
  const entries = new Map(notes.map(note => [parseInt(note.address, 16), { text: note.text, bytes: note.bytes.split(" ").map(byte => parseInt(byte, 16)) }]));
  return (row: { readonly address: number; readonly bytes: readonly (number | undefined)[]; readonly complete: boolean; readonly romMapped: boolean }): string | undefined => {
    const note = entries.get(row.address);
    return row.romMapped && row.complete && note?.bytes.length === row.bytes.length
      && note.bytes.every((byte, index) => byte === row.bytes[index]) ? note.text : undefined;
  };
}

/** A matching PC is an instruction boundary, not proof of the walkthrough's preconditions or completion. */
export function romCheckpointPosition(checkpoint: RomCheckpoint, location: DebugLocation | undefined, available: boolean, running: boolean): string {
  if (!available || !location) return "Execution unavailable. See the ROM and Execution panels.";
  if (running) return `Running · selected checkpoint $${checkpoint.address} in ROM.`;
  return location.space === "rom" && location.address === parseInt(checkpoint.address, 16)
    ? `At checkpoint address $${checkpoint.address} in ROM. Compare the observations below.`
    : `Paused at $${hex(location.address)} (${location.space}) · checkpoint $${checkpoint.address} in ROM.`;
}
