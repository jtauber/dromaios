import type { MemoryAccess } from "./memory-access.ts";

/** Bytes actually fetched for an instruction; the CPU defines the start address's meaning. */
export interface FetchedInstruction {
  readonly address: number;
  readonly bytes: readonly number[];
}

/** Snapshots and ordered accesses from a step or reset; Snapshot supplies its own readonly fields. */
export interface StateTransition<Snapshot> {
  readonly before: Snapshot;
  readonly after: Snapshot;
  readonly accesses: readonly MemoryAccess[];
}
