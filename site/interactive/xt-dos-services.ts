import type { Cpu8088Snapshot } from "../../src/components/cpus/generated/8088-cpu.js";
import type { XtBoundary } from "./xt-session.js";
import { opcode8088Index } from "./8088-encoding.js";
import { physical8088 } from "./8088-disassembly.js";
import { dosHandleTable, type DosHandleTableProfile } from "./xt-dos-handle-table.js";
import { createDosHandles, type DosHandleContract } from "./xt-dos-handles.js";

export type DosRegister = "AL" | "AX" | "BX" | "CX" | "DX";
export interface DosService {
  readonly function: string;
  readonly name: string;
  readonly description: string;
  readonly arguments: readonly { readonly register: DosRegister; readonly label: string }[];
  readonly buffer?: { readonly label: string; readonly direction: "input" | "output"; readonly length: "CX" | "00" | "24" };
  readonly result: { readonly kind: "none" | "status" | "handle" | "count" | "terminate" | "exit-status"; readonly description: string };
  readonly handles?: DosHandleContract;
}
export interface DosServices {
  readonly services: readonly DosService[];
  readonly errors: Readonly<Record<string, string>>;
  readonly handleTable: DosHandleTableProfile;
  readonly forgetHandles: { readonly interrupts: readonly string[]; readonly functions: readonly string[] };
}
export interface DosBuffer {
  readonly segment: number;
  readonly offset: number;
  readonly length?: number;
  readonly bytes: readonly number[];
  readonly end: "complete" | "limit" | "unavailable";
}
export interface DosRequest {
  readonly service: DosService;
  readonly caller: { readonly cs: number; readonly ip: number };
  readonly arguments: readonly { readonly register: DosRegister; readonly label: string; readonly value: number }[];
  readonly buffer?: DosBuffer;
  readonly filename?: string;
  readonly handle?: number;
  readonly targetHandle?: number;
  readonly returnTo: { readonly cs: number; readonly ip: number; readonly ss: number; readonly sp: number };
}
export interface DosResult {
  readonly ax: number;
  readonly carry: boolean;
  readonly buffer?: DosBuffer;
}
export interface DosCall extends DosRequest {
  readonly id: number;
  readonly state: "pending" | "returned" | "no-return" | "untracked";
  readonly result?: DosResult;
}
/** Only these declared contracts assign an error meaning to returned carry. */
export function dosReportsErrors(service: DosService): boolean {
  return ["status", "handle", "count"].includes(service.result.kind);
}
type Read = (address: number) => number | undefined;

const sampleLimit = 256;
/** Observe declared storage only, wrapping offsets and physical addresses exactly as the 8088 does. */
function buffer(read: Read, segment: number, offset: number, length: number | "00" | "24", contents: boolean): DosBuffer {
  const bytes: number[] = [], count = typeof length === "number" ? length : undefined;
  let end: DosBuffer["end"] = "complete";
  if (contents) {
    const limit = Math.min(count ?? 0x10000, sampleLimit);
    for (let i = 0; i < limit; i++) {
      const value = read(physical8088(segment, offset + i));
      if (value === undefined) { end = "unavailable"; break; }
      if (typeof length === "string" && value === parseInt(length, 16)) return { segment, offset, bytes, end };
      bytes.push(value);
    }
    if (end === "complete" && (count === undefined || count > sampleLimit)) end = "limit";
  }
  return { segment, offset, ...(count !== undefined && { length: count }), bytes, end };
}

/** Require actual software INT 21h delivery, including in a private next-boundary preview. */
export function dosRequest(catalogue: DosServices, record: XtBoundary, read: Read): DosRequest | undefined {
  if (!record.instruction || record.outcome !== "executed" || !("interrupt" in record) || !record.interrupt
    || record.interrupt.source !== "software" || record.interrupt.vector !== 0x21) return undefined;
  const cpu = record.before, service = catalogue.services.find(service => parseInt(service.function, 16) === cpu.ah);
  if (!service) return undefined;
  const spec = service.buffer;
  return {
    service, caller: { cs: cpu.cs, ip: cpu.ip },
    arguments: service.arguments.map(({ register, label }) => ({ register, label, value: Number(cpu[register.toLowerCase() as keyof Cpu8088Snapshot]) })),
    ...(spec && { buffer: buffer(read, cpu.ds, cpu.dx, spec.length === "CX" ? cpu.cx : spec.length, spec.direction === "input") }),
    returnTo: { cs: cpu.cs, ip: (cpu.ip + record.instruction.bytes.length) & 0xffff, ss: cpu.ss, sp: cpu.sp },
  };
}

/** Bounded observed calls, independent of CPU emulation, drawing, and the shared stopping policy. */
export function createXtDosCalls(catalogue: DosServices, read: Read) {
  const history: DosCall[] = [], handles = createDosHandles(() => dosHandleTable(catalogue.handleTable, read));
  const forgottenInterrupts = catalogue.forgetHandles.interrupts.map(value => parseInt(value, 16));
  const forgottenFunctions = catalogue.forgetHandles.functions.map(value => parseInt(value, 16));
  let sequence = 0, revision = 0;
  let pending: number[] = [];
  function abandon(clearHandles = true): void {
    if (clearHandles) handles.reset();
    for (const id of pending) {
      const index = history.findIndex(call => call.id === id);
      if (index >= 0) history[index] = { ...history[index]!, state: "untracked" };
    }
    pending = [];
  }
  return {
    get revision() { return revision; },
    handles: handles.entries,
    entries(): readonly DosCall[] { return history.slice(); },
    reset(): void { history.length = 0; pending = []; handles.reset(); revision++; },
    preview(record: XtBoundary): DosRequest | undefined {
      const request = dosRequest(catalogue, record, read);
      return request && handles.capture(request);
    },
    observe(record: XtBoundary): DosCall | undefined {
      if (record.instruction && record.outcome === "executed" && "interrupt" in record && record.interrupt?.source === "software"
        && (forgottenInterrupts.includes(record.interrupt.vector) || record.interrupt.vector === 0x21 && forgottenFunctions.includes(record.before.ah))) {
        abandon(); revision++;
      }
      const raw = dosRequest(catalogue, record, read);
      if (raw && handles.refresh()) abandon(false);
      const request = raw && handles.capture(raw);
      if (request) {
        const terminates = request.service.result.kind === "terminate";
        if (terminates || pending.length === 16) abandon();
        const call: DosCall = { ...request, id: ++sequence, state: terminates ? "no-return" : "pending" };
        history.push(call); if (!terminates) pending.push(call.id);
        if (history.length > 128) {
          const removed = history.shift()!;
          if (pending.includes(removed.id)) abandon();
        }
        revision++; return call;
      }
      if (!pending.length || record.outcome !== "executed" || !record.instruction) return;
      const opcode = record.instruction.bytes[opcode8088Index(record.instruction.bytes)];
      if (opcode !== 0xcf && opcode !== 0xca && opcode !== 0xcb) return;
      const cpu = record.after;
      let index = history.length - 1;
      for (; index >= 0; index--) {
        const call = history[index]!;
        if (pending.includes(call.id) && call.returnTo.cs === cpu.cs && call.returnTo.ip === cpu.ip
          && call.returnTo.ss === cpu.ss && call.returnTo.sp === cpu.sp) break;
      }
      if (index < 0) return;
      if (handles.refresh()) { abandon(false); revision++; return; }
      const call = history[index]!, input = call.buffer;
      const output = input && call.service.buffer?.direction === "output" && !cpu.flags.cf
        ? buffer(read, input.segment, input.offset, Math.min(cpu.ax, input.length!), true) : undefined;
      const completed: DosCall = { ...call, state: "returned", result: { ax: cpu.ax, carry: cpu.flags.cf, ...(output && { buffer: output }) } };
      handles.returned(call, completed.result!);
      history[index] = completed;
      pending = pending.filter(id => id !== call.id); revision++;
      return completed;
    },
  };
}
