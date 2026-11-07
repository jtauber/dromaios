import { resolveApplesoftSource, sameApplesoftSource } from "./apple2-applesoft.js";
import type { ApplesoftListing, ApplesoftSourcePosition, ApplesoftStatement } from "./apple2-applesoft.js";

export interface ApplesoftTarget {
  readonly line: number;
  readonly destination?: ApplesoftSourcePosition;
}
export interface ApplesoftBranch {
  readonly source: ApplesoftSourcePosition;
  readonly context: readonly ApplesoftStatement[];
  readonly kind: "GOTO" | "GOSUB" | "THEN" | "ON GOTO" | "ON GOSUB" | "ONERR GOTO";
  readonly conditional: boolean;
  readonly targets: readonly ApplesoftTarget[];
  readonly unresolved: boolean;
}

/** Potential explicit transfers in stored source, without evaluating expressions or running BASIC. */
export function applesoftBranches(listing: ApplesoftListing): ApplesoftBranch[] {
  const lines = new Map(listing.lines.map(line => [line.number, line]));
  const branches: ApplesoftBranch[] = [];
  for (const line of listing.lines) {
    // A false IF skips the rest of its line, including later colon-separated statements.
    let conditional = false;
    for (const [index, statement] of line.statements.entries()) {
      const parts = statement.parts.filter(part => part.tokenAddress !== undefined || part.text.trim());
      const first = parts[0];
      if (first?.tokenAddress !== statement.address) continue;
      if (first.text === "IF") conditional = true;
      let kind: ApplesoftBranch["kind"], operand: number;
      if (first.text === "GOTO" || first.text === "GOSUB") {
        kind = first.text; operand = 1;
      } else if (first.text === "IF") {
        const then = parts.findIndex(part => part.tokenAddress !== undefined && part.text === "THEN");
        // THEN <statement> has its own dispatch/statement in the decoded listing.
        if (then < 0 || then === parts.length - 1) continue;
        kind = "THEN"; operand = then + 1;
      } else if (first.text === "ON" || first.text === "ONERR") {
        const transfer = parts.findIndex(part => part.tokenAddress !== undefined && (part.text === "GOTO" || part.text === "GOSUB"));
        if (transfer < 0 || first.text === "ONERR" && (transfer !== 1 || parts[transfer]!.text !== "GOTO")) continue;
        kind = first.text === "ONERR" ? "ONERR GOTO" : parts[transfer]!.text === "GOTO" ? "ON GOTO" : "ON GOSUB";
        operand = transfer + 1;
      } else continue;
      const tail = parts.slice(operand), text = tail.map(part => part.text).join("").replaceAll(" ", "");
      const multiple = kind === "ON GOTO" || kind === "ON GOSUB";
      // Only complete literal operands are linked. The ROM tolerates some unusual
      // suffixes; this inspector does not pretend to validate or evaluate those forms.
      const numbers = tail.every(part => part.tokenAddress === undefined) && (multiple ? /^\d+(,\d+)*$/ : /^\d+$/).test(text)
        ? text.split(",").map(Number) : [];
      const resolved = numbers.length > 0 && numbers.every(number => number < 64000);
      const targets = resolved ? numbers.map(number => {
        const statement = lines.get(number)?.statements[0];
        return { line: number, destination: statement && { line: number, index: 0, statement } };
      }) : [];
      branches.push({ source: { line: line.number, index, statement }, context: line.statements, kind, conditional, targets, unresolved: !resolved });
    }
  }
  return branches;
}

/** Held links require unchanged source context and target text; relocation alone is harmless. */
export function resolveApplesoftBranch(listing: ApplesoftListing, branch: ApplesoftBranch, target: ApplesoftTarget) {
  const line = listing.lines.find(line => line.number === branch.source.line);
  if (!line || line.statements.length !== branch.context.length || !line.statements.every((statement, i) => sameApplesoftSource(statement, branch.context[i]!))) return;
  const source = resolveApplesoftSource(listing, branch.source);
  const destination = target.destination && resolveApplesoftSource(listing, target.destination);
  if (source && destination) return { source, destination };
}
