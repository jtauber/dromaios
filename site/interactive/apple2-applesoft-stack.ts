import { applesoftReal, applesoftStatementText, applesoftVariables } from "./apple2-applesoft.js";
import type { ApplesoftListing, ApplesoftVariable } from "./apple2-applesoft.js";
import { applesoftStatement } from "./apple2-applesoft-step.js";
import { apple2DebugLocation } from "./apple2-debugger.js";
import type { createApple2Session } from "./apple2-session.js";
import type { Ram } from "../../src/components/memory/ram.js";

type Machine = ReturnType<typeof createApple2Session>["machine"];
type Destination = { kind: "statement"; line: number; address: number; text: string } | { kind: "end" | "direct" };
interface Frame { address: number; destination: Destination }
type BasicFrame = (Frame & { kind: "GOSUB" }) | (Frame & { kind: "FOR"; variable: string; value: string; limit: string; step: string });
interface BasicStack { frames: BasicFrame[]; message?: string }

/** Both RETURN and NEXT resume after the source statement that installed the record. */
function continuation(listing: ApplesoftListing, lineNumber: number, pointer: number, keyword: "GOSUB" | "FOR"): Destination | undefined {
  if (lineNumber >= 0xff00 && pointer >= 0x200 && pointer < 0x300) return { kind: "direct" };
  const index = listing.lines.findIndex(l => l.number === lineNumber);
  const line = listing.lines[index];
  if (!line || pointer > line.terminator) return;
  let slot = line.statements.length - 1;
  while (slot >= 0 && line.statements[slot]!.address > pointer) slot--;
  const call = line.statements[slot];
  if (!call?.parts.some(part => part.text === keyword && part.tokenAddress !== undefined && part.tokenAddress <= pointer)) return;
  // Consecutive colons and a trailing colon have empty slots in the listing.
  for (let i = index; i < listing.lines.length; i++) {
    const nextLine = listing.lines[i]!;
    for (let j = i === index ? slot + 1 : 0; j < nextLine.statements.length; j++) {
      const statement = nextLine.statements[j]!;
      const text = applesoftStatementText(statement);
      if (text) return { kind: "statement", line: nextLine.number, address: statement.address, text };
    }
  }
  return { kind: "end" };
}

/** Walk complete records at the verified ROM's statement dispatcher, innermost first. */
export function applesoftStack(machine: Machine, listing: ApplesoftListing): BasicStack {
  if (listing.message) return { frames: [], message: listing.message };
  const current = applesoftStatement(machine, apple2DebugLocation(machine));
  if (!current || !listing.lines.find(l => l.number === current.line)?.statements.some(s => s.address === current.address)) {
    return { frames: [], message: "Use Step BASIC statement or a BASIC breakpoint to inspect the stack." };
  }
  return applesoftStackFrames(machine.ram, machine.cpu.snapshot().sp, listing);
}

export function applesoftStackFrames(ram: Pick<Ram, "read" | "size">, sp: number, listing: ApplesoftListing): BasicStack {
  const frames: BasicFrame[] = [], word = (at: number) => ram.read(at) | ram.read(at + 1) << 8;
  const interrupted = { frames, message: "Incomplete or unrecognized Applesoft stack record." };
  // JSR at $D820 leaves $D822 above the BASIC records. Each GOSUB also retains its caller's JSR.
  const dispatcherReturn = (at: number) => at <= 0x1fe && word(at) === 0xd822;
  let at = 0x101 + sp;
  if (!dispatcherReturn(at)) return interrupted;
  at += 2;
  let variables: ApplesoftVariable[] | undefined;
  while (at <= 0x1ff) {
    const marker = ram.read(at);
    if (marker === 0xb0) {
      if (!dispatcherReturn(at + 5)) return interrupted;
      const destination = continuation(listing, word(at + 1), word(at + 3), "GOSUB");
      if (!destination) return interrupted;
      frames.push({ kind: "GOSUB", address: at, destination });
      at += 7;
    } else if (marker === 0x81) {
      if (at + 17 > 0x1ff) return interrupted;
      // FOR saves its text pointer high byte first. The loop variable pointer addresses its five-byte value.
      const pointer = ram.read(at + 16) << 8 | ram.read(at + 17);
      const destination = continuation(listing, word(at + 14), pointer, "FOR");
      const valueAddress = word(at + 1);
      variables ??= applesoftVariables(ram).variables;
      const variable = variables.find(v => v.address + 2 === valueAddress && v.type === "Real");
      const sign = ram.read(at + 8);
      if (!destination || !variable || (sign !== 0 && sign !== 1 && sign !== 0xff)) return interrupted;
      frames.push({ kind: "FOR", address: at, destination, variable: variable.name, value: variable.value,
        step: applesoftReal(ram, at + 3, sign === 0xff), limit: applesoftReal(ram, at + 9) });
      at += 18;
    } else break;
  }
  return { frames };
}
