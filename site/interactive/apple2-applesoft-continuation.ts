import type { Ram } from "../../src/components/memory/ram.js";
import { applesoftNextStatement, applesoftSourceAt } from "./apple2-applesoft.js";
import type { ApplesoftListing, ApplesoftSourcePosition } from "./apple2-applesoft.js";

interface Continuation {
  readonly line: number;
  readonly pointer: number;
  readonly kind: "unavailable" | "unresolved" | "statement" | "end";
  readonly destination?: ApplesoftSourcePosition;
}

/** CONT tests OLDTEXT's high byte, then restores it and OLDIN. These are also working storage during RUN. */
export function applesoftContinuation(ram: Pick<Ram, "read" | "size">, listing: ApplesoftListing): Continuation {
  const word = (at: number) => ram.read(at) | ram.read(at + 1) << 8;
  const line = word(0x77), pointer = word(0x79), raw = { line, pointer };
  if (pointer < 0x100) return { ...raw, kind: "unavailable" };
  if (listing.message || pointer >= ram.size) return { ...raw, kind: "unresolved" };
  // At a line terminator NEWSTT reads the next header. OLDIN may be stale after a natural program end.
  const stored = listing.lines.find(item => pointer === item.terminator || item.number === line
    && pointer >= item.statements[0]!.address && pointer < item.terminator);
  if (!stored) return { ...raw, kind: "unresolved" };
  const previous = applesoftSourceAt(listing, stored.number, pointer);
  if (!previous) return { ...raw, kind: "unresolved" };
  if (pointer !== stored.terminator) {
    // A quoted colon is data, not a statement boundary. Require the next parsed colon-separated slot.
    let address = pointer + 1;
    while (address < stored.terminator && ram.read(address) === 0x20) address++;
    const next = stored.statements[previous.index + 1];
    if (ram.read(pointer) !== 0x3a || !next?.colonBefore || next.address !== address) return { ...raw, kind: "unresolved" };
  }
  const destination = applesoftNextStatement(listing, previous);
  return { ...raw, kind: destination ? "statement" : "end", destination };
}
