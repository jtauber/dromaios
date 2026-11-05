import type { ApplesoftListing, ApplesoftSourcePosition } from "./apple2-applesoft.js";
import { sameApplesoftSource } from "./apple2-applesoft.js";
import { applesoftLineInput, applesoftStatement } from "./apple2-applesoft-step.js";
import type { createApple2Session } from "./apple2-session.js";
import type { DebugLocation } from "./instruction-debugger.js";

type Machine = ReturnType<typeof createApple2Session>["machine"];
const positionKey = (point: ApplesoftSourcePosition) => `${point.line}:${point.index}`;

/** Each executed dispatch starts one visit, including repeat visits to the same source. */
export function createApplesoftHistory(listing: () => ApplesoftListing) {
  const visits: ApplesoftSourcePosition[] = [];
  const counts = new Map<string, ApplesoftSourcePosition & { count: number }>();
  let countedSource: ApplesoftListing | undefined, countRevision = 0;
  let total = 0;

  // Only reconcile at interpreter boundaries, after the line editor has finished moving bytes.
  function reconcile(source: ApplesoftListing): void {
    if (source === countedSource) return;
    countedSource = source;
    if (!counts.size) return;
    const lines = new Map(source.lines.map(line => [line.number, line]));
    for (const [key, point] of counts) {
      const current = lines.get(point.line)?.statements[point.index];
      if (current && sameApplesoftSource(point.statement, current)) point.statement = current;
      else { counts.delete(key); countRevision++; }
    }
  }
  return {
    get visits(): readonly ApplesoftSourcePosition[] { return visits; },
    get total() { return total; },
    get countRevision() { return countRevision; },
    count(point: ApplesoftSourcePosition): number {
      const entry = counts.get(positionKey(point));
      return entry && sameApplesoftSource(entry.statement, point.statement) ? entry.count : 0;
    },
    observe(machine: Machine, before: DebugLocation): void {
      if (before.address === applesoftLineInput && before.space === "rom" && counts.size) reconcile(listing());
      // $D828 begins with BEQ. Its execution leaves CURLIN, TXTPTR and the program bytes intact.
      const dispatch = applesoftStatement(machine, before);
      if (!dispatch) return;
      const source = listing();
      reconcile(source);
      const line = source.lines.find(line => line.number === dispatch.line);
      if (!line) return;
      const index = line.statements.findIndex(statement => statement.address === dispatch.address);
      if (index < 0) return;
      total++;
      const point = { line: line.number, index, statement: line.statements[index]! };
      visits.push(point);
      if (visits.length > 32) visits.shift();
      const key = positionKey(point), entry = counts.get(key);
      if (entry) entry.count++;
      else counts.set(key, { ...point, count: 1 });
      countRevision++;
    },
    clear(): void { visits.length = 0; total = 0; },
    clearCounts(): void { counts.clear(); countedSource = undefined; countRevision++; },
  };
}
export type ApplesoftHistory = ReturnType<typeof createApplesoftHistory>;
