import { decode8088, physical8088 } from "./8088-disassembly.js";
import type { Catalogue8088, Row8088 } from "./8088-disassembly.js";
import type { FetchedInstruction } from "../../src/components/cpus/execution-records.js";
import type { XtMachine } from "./xt-session.js";
import { parseMemoryAddress } from "./memory-window.js";

export interface XtBoundary {
  readonly before: { readonly cs: number; readonly ip: number };
  readonly instruction: FetchedInstruction | null;
}
export interface XtStorageRegion {
  readonly start: number;
  readonly size: number;
  readonly component: "ram" | "video" | "bios" | "basic" | "ega" | "option";
  readonly offset: number;
}
export interface XtCatalogue { readonly cpu: Catalogue8088; readonly storage: readonly XtStorageRegion[] }

/** Explicit segment:offset input wraps onto the original 8088's twenty address pins. */
export function parseXtAddress(text: string): number {
  const parts = text.split(":");
  if (parts.length === 1) return parseMemoryAddress(text, 0xfffff);
  if (parts.length === 2) return physical8088(parseMemoryAddress(parts[0]!), parseMemoryAddress(parts[1]!));
  throw new RangeError("Enter a physical hexadecimal address or segment:offset.");
}

/** Resolve an observed physical byte using only the board's declared storage and aliases. */
export function readXtStorage(machine: XtMachine, regions: readonly XtStorageRegion[], address: number): number | undefined {
  const region = regions.find(r => address >= r.start && address < r.start + r.size);
  if (!region) return undefined;
  const offset = region.offset + address - region.start;
  if (region.component === "ega") return "ega" in machine ? machine.ega.peek(offset) : undefined;
  const storage = region.component === "video" ? ("video" in machine ? machine.video : undefined)
    : region.component === "option" ? ("option" in machine ? machine.option : undefined) : machine[region.component];
  const value = storage?.read(offset);
  return typeof value === "number" ? value : undefined;
}

export function xtCodeRows(cpu: Catalogue8088, state: { readonly cs: number; readonly ip: number },
  read: (physical: number) => number | undefined, records: readonly XtBoundary[]) {
  const rows: { row: Row8088; kind: "executed" | "current" | "ahead" }[] = [];
  for (let i = records.length - 1; i >= 0 && rows.length < 3; i--) {
    const { before, instruction } = records[i]!;
    if (instruction) rows.unshift({ row: decode8088(cpu, before.cs, before.ip, index => instruction.bytes[index]), kind: "executed" });
  }
  let ip = state.ip;
  for (let i = 0; i < 10; i++) {
    const row = decode8088(cpu, state.cs, ip, index => read(physical8088(state.cs, ip + index)));
    rows.push({ row, kind: i === 0 ? "current" : "ahead" });
    if (!row.complete) break;
    ip = (ip + row.bytes.length) & 0xffff;
  }
  return rows;
}
