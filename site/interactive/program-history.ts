import type { FetchedInstruction } from "../../src/components/cpus/execution-records.js";

/** Keep lifetime visit counts and the most recent twelve transitions, separate from CPU state. */
export function createProgramHistory(initialPC: number, instructionAddresses: readonly number[]) {
  const visits = new Map<number, number>();
  const skipped = new Set<number>();
  const path = [initialPC];
  let truncated = false;
  return {
    get visits(): ReadonlyMap<number, number> { return visits; },
    get skipped(): ReadonlySet<number> { return skipped; },
    get path(): readonly number[] { return path; },
    get truncated() { return truncated; },
    record(instruction: FetchedInstruction, nextPC: number): void {
      visits.set(instruction.address, (visits.get(instruction.address) ?? 0) + 1);
      skipped.delete(instruction.address);
      // A forward transfer can pass over instructions; comparing PC alone fails after a backward jump.
      const following = instruction.address + instruction.bytes.length;
      for (const address of instructionAddresses) {
        if (address >= following && address < nextPC && !visits.has(address)) skipped.add(address);
      }
      path.push(nextPC);
      if (path.length > 13) {
        path.shift();
        truncated = true;
      }
    },
  };
}

export type ProgramHistory = ReturnType<typeof createProgramHistory>;
