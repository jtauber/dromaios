/** A temporary PC stop, bounded by the host's completed-boundary counter. No memory reads. */
export function createExecutionTarget(limit = 2_000_000) {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError("The execution limit must be positive.");
  let target: number | undefined, deadline = 0, stopped: "reached" | "limit" | undefined;
  return {
    get address() { return target; },
    get stopped() { return stopped; },
    start(address: number, steps: number): void {
      if (!Number.isInteger(address) || address < 0 || address > 0xffff) throw new RangeError("The target must be a 16-bit address.");
      target = address; deadline = steps + limit; stopped = undefined;
    },
    cancel(): void { target = undefined; stopped = undefined; },
    beforeStep(pc: number, steps: number): boolean {
      if (target === undefined) return false;
      if (pc === target) stopped = "reached";
      else if (steps >= deadline) stopped = "limit";
      return stopped !== undefined;
    },
  };
}
