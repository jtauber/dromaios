import { applesoftKeywords, observeApplesoftListing } from "./apple2-applesoft.js";
import type { ApplesoftListing, ApplesoftStatement } from "./apple2-applesoft.js";
import { applesoftDispatch, applesoftLineInput, applesoftStatement } from "./apple2-applesoft-step.js";
import { hex } from "./apple2-explorer.js";
import type { createApple2Session } from "./apple2-session.js";
import type { DebugLocation } from "./instruction-debugger.js";

type Machine = ReturnType<typeof createApple2Session>["machine"];
interface Point { line: number; index: number; statement: ApplesoftStatement }

const noFirmware: ApplesoftListing = { lines: [], message: "Load the Apple II Plus ROM to read its keyword table." };
const bankedRam: ApplesoftListing = { lines: [], message: "Language Card RAM is mapped in place of the Applesoft ROM." };

/** Compare stored tokens and literal text, independently of where BASIC moved the line. */
function sameSource(a: ApplesoftStatement, b: ApplesoftStatement): boolean {
  return a === b || a.parts.length === b.parts.length && a.parts.every((part, i) => {
    const other = b.parts[i]!;
    return part.text === other.text && (part.tokenAddress === undefined) === (other.tokenAddress === undefined);
  });
}

export function createApplesoftBreakpoints(machine: () => Machine) {
  let owner: Machine | undefined, program: ReturnType<typeof observeApplesoftListing> | undefined;
  let points: Point[] = [], checked: ApplesoftListing | undefined, revision = 0;
  function listing(): ApplesoftListing {
    const current = machine();
    if (owner !== current) {
      program?.detach();
      owner = current; program = undefined; checked = undefined; revision++;
    }
    if (!current.firmware.loaded) return noFirmware;
    if (current.language.ramRead()) return bankedRam;
    program ??= observeApplesoftListing(current.ram, applesoftKeywords(current.firmware));
    return program.read();
  }
  function reconcile(): void {
    const source = listing();
    if (!points.length || source === checked || source === bankedRam) return;
    checked = source;
    points = points.filter(point => {
      const current = source.lines.find(line => line.number === point.line)?.statements[point.index];
      if (!current || !sameSource(point.statement, current)) { revision++; return false; }
      point.statement = current;
      return true;
    });
  }
  function selected(line: number, index: number, statement: ApplesoftStatement): boolean {
    return points.some(p => p.line === line && p.index === index && sameSource(p.statement, statement));
  }
  return {
    listing, selected, reconcile,
    reconnect(): void { if (points.length && owner !== machine()) reconcile(); },
    get active() { return points.length > 0; },
    get revision() { return revision; },
    toggle(line: number, index: number, statement: ApplesoftStatement): boolean {
      const source = listing(), current = source.lines.find(l => l.number === line)?.statements[index];
      if (!current || !sameSource(statement, current)) return false; // A held listing may have gone stale.
      const existing = points.findIndex(p => p.line === line && p.index === index);
      const enable = existing < 0 || !sameSource(points[existing]!.statement, current);
      if (existing >= 0) points.splice(existing, 1);
      if (enable) points.push({ line, index, statement: current });
      revision++;
      return enable;
    },
    match(at: DebugLocation): string | undefined {
      if (at.space !== "rom" || (at.address !== applesoftDispatch && at.address !== applesoftLineInput)) return;
      const dispatch = applesoftStatement(machine(), at);
      // Check at interpreter boundaries, after the line editor has finished moving program bytes.
      reconcile();
      const point = dispatch && points.find(p => p.line === dispatch.line && p.statement.address === dispatch.address);
      if (point) return `Applesoft line ${point.line}, statement ${point.index + 1} at $${hex(point.statement.address)}.`;
    },
  };
}
