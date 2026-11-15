/** Host-time display cadence; never a source of emulated clocks or execution limits. */
export function createRefreshCadence(intervalMs: number) {
  let last = -Infinity;
  return {
    due(now: number, running: boolean): boolean {
      if (running && now - last < intervalMs) return false;
      last = now;
      return true;
    },
  };
}
