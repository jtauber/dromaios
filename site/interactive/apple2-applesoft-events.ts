import { applesoftDataSource, applesoftSourceAt, applesoftVariableAt } from "./apple2-applesoft.js";
import type { ApplesoftListing, ApplesoftSourcePosition, ApplesoftVariable } from "./apple2-applesoft.js";
import { applesoftDispatch } from "./apple2-applesoft-step.js";
import type { createApple2Session } from "./apple2-session.js";
import type { Cpu6502StepRecord } from "../../src/components/cpus/generated/6502-cpu.js";
import type { DebugLocation } from "./instruction-debugger.js";

type Machine = ReturnType<typeof createApple2Session>["machine"];
interface Origin { readonly line: number; readonly source?: ApplesoftSourcePosition }
interface DataItem { readonly address: number; readonly source: ApplesoftSourcePosition }
type EventDetail =
  | { readonly kind: "PEEK" | "POKE"; readonly address: number; readonly value: number }
  | { readonly kind: "READ"; readonly data: DataItem; readonly variable: ApplesoftVariable }
  | { readonly kind: "RESTORE"; readonly previous: number; readonly address: number };
export type ApplesoftEvent = EventDetail & { readonly number: number; readonly origin: Origin };

/** Software observations for the verified Apple II Plus ROM; all inspection reads main RAM only. */
export function createApplesoftEvents(listing: () => ApplesoftListing) {
  const entries: ApplesoftEvent[] = [];
  let recording = true, total = 0;
  let statement: (Origin & { token: number }) | undefined;
  let reading: Origin | undefined, item: DataItem | undefined;
  let restoring: { origin: Origin; previous: number } | undefined;
  function forgetPending(): void { statement = reading = item = restoring = undefined; }
  function append(origin: Origin, detail: EventDetail): void {
    entries.push({ ...detail, origin, number: ++total });
    if (entries.length > 200) entries.shift();
  }
  return {
    get entries(): readonly ApplesoftEvent[] { return entries; },
    get total() { return total; },
    get recording() { return recording; },
    record(enabled: boolean): void { recording = enabled; forgetPending(); },
    clear(): void { entries.length = 0; total = 0; forgetPending(); },
    observe(machine: Machine, before: DebugLocation, record: Cpu6502StepRecord): void {
      if (!recording) return;
      if (record.outcome !== "executed") { forgetPending(); return; }
      // The interpreter calls RAM helpers and the Monitor. Banked code at these ROM
      // addresses is not an Applesoft hook; losing the ROM mapping invalidates pending work.
      if (before.space !== "rom") {
        if (machine.language.ramRead()) forgetPending();
        return;
      }
      const pc = before.address, { ram } = machine;
      const word = (at: number) => ram.read(at) | ram.read(at + 1) << 8;
      if (pc === 0xd412 || pc === 0xf2e9) { forgetPending(); return; }
      if (pc === applesoftDispatch) {
        forgetPending();
        const address = word(0xb8), line = word(0x75);
        if (address < ram.size) statement = { line, source: applesoftSourceAt(listing(), line, address), token: ram.read(address) };
        return;
      }
      if (!statement) return; // Recording enabled mid-statement starts at the next dispatch.
      const bytes = record.instruction.bytes;
      if ((pc === 0xe76f && bytes[0] === 0xb1 || pc === 0xe781 && bytes[0] === 0x91) && bytes[1] === 0x50) {
        // LDA/STA ($50),Y: the final recorded access is the real bus transfer,
        // including a soft switch's returned value. Never repeat that read.
        const access = record.accesses.at(-1), kind = pc === 0xe76f ? "PEEK" : "POKE";
        if (access?.kind === (kind === "PEEK" ? "read" : "write")) append(statement, { kind, address: access.address, value: access.value });
      } else if (pc === 0xd849 && statement.token === 0xae) {
        // RUN and CLEAR also call this routine; only the RESTORE statement is an event.
        restoring = { origin: statement, previous: word(0x7d) };
      } else if (pc === 0xd855 && restoring) {
        append(restoring.origin, { kind: "RESTORE", previous: restoring.previous, address: word(0x7d) });
        restoring = undefined;
      } else if (pc === 0xdbe2) {
        reading = statement;
      } else if (pc === 0xdc2e && reading && ram.read(0x15) === 0x98) {
        // CHRGET has reached this item's first byte, including an opening quote.
        const address = word(0xb8), source = applesoftDataSource(listing(), address);
        item = source ? { address, source } : undefined;
      } else if (pc === 0xdc72 && reading && item && ram.read(0x15) === 0x98) {
        // Both numeric and string assignment return here, BEFORE the next variable
        // or INPDONE. Earlier assignments survive a later OUT OF DATA error.
        const variable = applesoftVariableAt(ram, word(0x85));
        if (variable) append(reading, { kind: "READ", data: item, variable });
        item = undefined;
      }
    },
  };
}
export type ApplesoftEvents = ReturnType<typeof createApplesoftEvents>;
