import type { ApplesoftListing, ApplesoftSourcePosition } from "./apple2-applesoft.js";
import { applesoftStatement } from "./apple2-applesoft-step.js";
import type { createApple2Session } from "./apple2-session.js";
import type { DebugLocation } from "./instruction-debugger.js";

type Machine = ReturnType<typeof createApple2Session>["machine"];

/** Each executed dispatch starts one visit, including repeat visits to the same source. */
export function createApplesoftHistory(listing: () => ApplesoftListing) {
  const visits: ApplesoftSourcePosition[] = [];
  let total = 0;
  return {
    get visits(): readonly ApplesoftSourcePosition[] { return visits; },
    get total() { return total; },
    observe(machine: Machine, before: DebugLocation): void {
      // $D828 begins with BEQ. Its execution leaves CURLIN, TXTPTR and the program bytes intact.
      const dispatch = applesoftStatement(machine, before);
      if (!dispatch) return;
      const line = listing().lines.find(line => line.number === dispatch.line);
      if (!line) return;
      const index = line.statements.findIndex(statement => statement.address === dispatch.address);
      if (index < 0) return;
      total++;
      visits.push({ line: line.number, index, statement: line.statements[index]! });
      if (visits.length > 32) visits.shift();
    },
    clear(): void { visits.length = 0; total = 0; },
  };
}
