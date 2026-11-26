import type { XtIoTransfer, XtInterruptSource } from "./xt-io-events.js";
import { logical8088, xtHex as hex } from "./8088-disassembly.js";
import { dosReportsErrors, type DosCall } from "./xt-dos-services.js";
import { xtInstructionFetchCount } from "./xt-inspection.js";
import type { XtBoundary } from "./xt-session.js";

export type XtDosCondition = { readonly kind: "dos"; readonly phase: "call" | "return" | "error"; readonly function?: number; readonly filename?: string };
export interface XtAccessCondition {
  readonly kind: "access";
  readonly cs: number;
  readonly ip: number;
  readonly direction: "read" | "write";
  readonly address: number;
  readonly value?: number;
}
type XtAccessEvent = XtAccessCondition & { readonly value: number };
export type XtObservedEvent = XtIoTransfer | XtAccessEvent;
export type XtEventCondition = { readonly kind: "dma"; readonly address?: number }
  | { readonly kind: "input" | "output"; readonly port: number; readonly value?: number }
  | { readonly kind: "interrupt"; readonly source?: XtInterruptSource; readonly vector?: number }
  | { readonly kind: "iret" } | XtDosCondition | XtAccessCondition;
export type XtEventStop = XtEventCondition & { readonly enabled: boolean };
export const xtInterruptSources: readonly XtInterruptSource[] = ["intr", "nmi", "software", "trap", "divide-error"];

export function xtEventStopKey(point: XtEventCondition): string {
  if (point.kind === "access") return `access:${point.cs}:${point.ip}:${point.direction}:${point.address}:${point.value ?? ""}`;
  if (point.kind === "dos") return `dos:${point.phase}:${point.function ?? ""}:${point.filename?.toUpperCase() ?? ""}`;
  if (point.kind === "iret") return point.kind;
  if (point.kind === "dma") return `dma:${point.address ?? ""}`;
  return point.kind === "interrupt" ? `${point.kind}:${point.source ?? ""}:${point.vector ?? ""}`
    : `${point.kind}:${point.port}:${point.value ?? ""}`;
}

/** Reject malformed preferences before replacing any live conditions; discard unknown properties. */
export function validateXtEventStops(values: readonly XtEventStop[]): readonly XtEventStop[] {
  const byte = (value: unknown, maximum = 0xff) => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= maximum;
  if (!Array.isArray(values) || values.length > 64) throw new RangeError("Keep at most 64 event stops.");
  const seen = new Set<string>();
  return values.map(point => {
    if (!point || typeof point !== "object" || typeof point.enabled !== "boolean") throw new RangeError("Invalid event stop.");
    let condition: XtEventCondition;
    if (point.kind === "input" || point.kind === "output") {
      if (!byte(point.port, 0xffff) || point.value !== undefined && !byte(point.value)) throw new RangeError("Use a port from 0000–FFFF and an optional byte from 00–FF.");
      condition = { kind: point.kind, port: point.port, ...(point.value !== undefined && { value: point.value }) };
    } else if (point.kind === "access") {
      const { cs, ip, direction, address, value } = point;
      if (!byte(cs, 0xffff) || !byte(ip, 0xffff) || !byte(address, 0xfffff) || (direction !== "read" && direction !== "write")) {
        throw new RangeError("An access stop needs an exact CS:IP, physical address and read or write direction.");
      }
      if (value !== undefined && !byte(value)) throw new RangeError("An access stop value must be a byte from 00–FF.");
      condition = { kind: "access", cs, ip, direction, address, ...(value !== undefined && { value }) };
    } else if (point.kind === "interrupt") {
      if (point.source !== undefined && !xtInterruptSources.includes(point.source) || point.vector !== undefined && !byte(point.vector)) throw new RangeError("Use an interrupt source and an optional vector from 00–FF.");
      condition = { kind: point.kind, ...(point.source !== undefined && { source: point.source }), ...(point.vector !== undefined && { vector: point.vector }) };
    } else if (point.kind === "dma") {
      if (point.address !== undefined && !byte(point.address, 0xfffff)) throw new RangeError("Use a DMA address from 00000–FFFFF, or leave it blank for any byte.");
      condition = { kind: "dma", ...(point.address !== undefined && { address: point.address }) };
    } else if (point.kind === "dos") {
      if (!["call", "return", "error"].includes(point.phase) || point.function !== undefined && !byte(point.function)) throw new RangeError("Use a DOS call, return, or error and an optional AH from 00–FF.");
      if (point.filename !== undefined && (typeof point.filename !== "string" || !/^[\x20-\x7e]{1,255}$/.test(point.filename))) throw new RangeError("Use an exact filename of 1–255 printable ASCII characters, or leave it blank for any file.");
      condition = { kind: "dos", phase: point.phase, ...(point.function !== undefined && { function: point.function }),
        ...(point.filename !== undefined && { filename: point.filename }) };
    } else if (point.kind === "iret") condition = { kind: "iret" };
    else throw new RangeError("Unknown event stop kind.");
    const key = xtEventStopKey(condition);
    if (seen.has(key)) throw new RangeError("Event stops must be distinct.");
    seen.add(key);
    return { ...condition, enabled: point.enabled };
  });
}

export function decodeXtEventStops(saved: string | null): readonly XtEventStop[] {
  try { return validateXtEventStops(JSON.parse(saved ?? "[]")); }
  catch { return []; }
}

/** Only CPU operand accesses have an originating instruction. DMA is captured separately. */
export function* xtInstructionAccesses(record: XtBoundary): Iterable<XtAccessEvent> {
  if (!record.instruction) return;
  const { cs, ip } = record.before;
  for (let i = xtInstructionFetchCount(record); i < record.accesses.length; i++) {
    const access = record.accesses[i]!;
    if (access.kind === "read" || access.kind === "write") {
      yield { kind: "access", cs, ip, direction: access.kind, address: access.address, value: access.value };
    }
  }
}

export function matchesXtEvent(point: XtEventCondition, event: XtObservedEvent): boolean {
  if (point.kind === "access") return event.kind === "access" && point.cs === event.cs && point.ip === event.ip
    && point.address === event.address && point.direction === event.direction && (point.value === undefined || point.value === event.value);
  if (point.kind === "dos") return false;
  if (point.kind === "dma") return event.kind === "dma" && (point.address === undefined || point.address === event.address);
  if (point.kind === "input" || point.kind === "output") return point.kind === event.kind && "port" in event
    && point.port === event.port && (point.value === undefined || point.value === event.value);
  if (point.kind === "interrupt") return event.kind === "interrupt"
    && (point.source === undefined || point.source === event.source) && (point.vector === undefined || point.vector === event.vector);
  return event.kind === "iret";
}

/** Match only the call or return observed at this boundary, never a retained history entry. */
export function matchesXtDosEvent(point: XtEventCondition, call: DosCall): boolean {
  if (point.kind !== "dos" || point.function !== undefined && point.function !== parseInt(call.service.function, 16)) return false;
  if (point.filename !== undefined && point.filename.toUpperCase() !== call.filename?.toUpperCase()) return false;
  if (point.phase === "call") return call.state === "pending" || call.state === "no-return";
  return call.state === "returned" && (point.phase === "return" || dosReportsErrors(call.service) && call.result?.carry === true);
}

/** INTA selects its completed INTR entry, rather than pausing midway through the saved frame. */
export function xtEventCondition(event: XtObservedEvent): XtEventCondition {
  if (event.kind === "access") {
    const { cs, ip, direction, address } = event;
    return { kind: "access", cs, ip, direction, address };
  }
  if (event.kind === "dma") return { kind: "dma", address: event.address };
  if ("port" in event) return { kind: event.kind, port: event.port, value: event.value };
  if (event.kind === "acknowledge") return { kind: "interrupt", source: "intr", vector: event.value };
  if (event.kind === "interrupt") return { kind: event.kind, source: event.source, vector: event.vector };
  return { kind: "iret" };
}

export function describeXtEvent(point: XtEventCondition): string {
  if (point.kind === "access") return `CS:IP ${logical8088(point.cs, point.ip)} · ${point.direction.toUpperCase()} $${hex(point.address, 5)}`
    + (point.value === undefined ? "" : ` = $${hex(point.value, 2)}`);
  if (point.kind === "dos") return `DOS ${point.phase} · INT 21h · ${point.function === undefined ? "any described service" : "AH=$" + hex(point.function, 2)}${point.filename === undefined ? "" : " · " + JSON.stringify(point.filename)}`;
  if (point.kind === "iret") return "IRET";
  if (point.kind === "dma") return `DMA2 · ${point.address === undefined ? "any RAM byte" : "RAM $" + hex(point.address, 5)}`;
  if (point.kind === "interrupt") return `${point.source?.toUpperCase() ?? "Any interrupt"} · vector ${point.vector === undefined ? "any" : "$" + hex(point.vector, 2)}`;
  return `${point.kind === "input" ? "IN" : "OUT"} $${hex(point.port, 4)}${point.value === undefined ? " · any value" : " = $" + hex(point.value, 2)}`;
}
