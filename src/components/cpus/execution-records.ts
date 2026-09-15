import type { MemoryAccess } from "./memory-access.ts";

/** Bytes actually fetched for an instruction; the CPU defines the start address's meaning. */
export interface FetchedInstruction {
  readonly address: number;
  readonly bytes: readonly number[];
}

/** Snapshots and ordered accesses from a step or reset; Snapshot supplies its own readonly fields. */
export interface StateTransition<Snapshot, Access = MemoryAccess> {
  readonly before: Snapshot;
  readonly after: Snapshot;
  readonly accesses: readonly Access[];
}

/** Ordinary execution or rejection of a fetched encoding. CPU-specific faults extend this union. */
export type InstructionStep<Snapshot, Access = MemoryAccess> = StateTransition<Snapshot, Access> & {
  readonly instruction: FetchedInstruction;
} & (
  | { readonly outcome: "executed" }
  | { readonly outcome: "unsupported"; readonly reason: "opcode" }
);

/** HALT either executes an instruction or reports an already halted CPU without fetching. */
export type HaltedStep<Snapshot, Access = MemoryAccess> = StateTransition<Snapshot, Access> & {
  readonly outcome: "halted";
  readonly instruction: FetchedInstruction | null;
};
