import type { XtIoTransfer, XtInterruptSource } from "./xt-io-events.js";
import { xtHex as hex } from "./8088-disassembly.js";

export type XtEventCondition = { readonly kind: "dma"; readonly address?: number }
  | { readonly kind: "input" | "output"; readonly port: number; readonly value?: number }
  | { readonly kind: "interrupt"; readonly source?: XtInterruptSource; readonly vector?: number }
  | { readonly kind: "iret" };
export type XtEventStop = XtEventCondition & { readonly enabled: boolean };
export const xtInterruptSources: readonly XtInterruptSource[] = ["intr", "nmi", "software", "trap", "divide-error"];

export function xtEventStopKey(point: XtEventCondition): string {
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
    } else if (point.kind === "interrupt") {
      if (point.source !== undefined && !xtInterruptSources.includes(point.source) || point.vector !== undefined && !byte(point.vector)) throw new RangeError("Use an interrupt source and an optional vector from 00–FF.");
      condition = { kind: point.kind, ...(point.source !== undefined && { source: point.source }), ...(point.vector !== undefined && { vector: point.vector }) };
    } else if (point.kind === "dma") {
      if (point.address !== undefined && !byte(point.address, 0xfffff)) throw new RangeError("Use a DMA address from 00000–FFFFF, or leave it blank for any byte.");
      condition = { kind: "dma", ...(point.address !== undefined && { address: point.address }) };
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

export function matchesXtEvent(point: XtEventCondition, event: XtIoTransfer): boolean {
  if (point.kind === "dma") return event.kind === "dma" && (point.address === undefined || point.address === event.address);
  if (point.kind === "input" || point.kind === "output") return point.kind === event.kind && "port" in event
    && point.port === event.port && (point.value === undefined || point.value === event.value);
  if (point.kind === "interrupt") return event.kind === "interrupt"
    && (point.source === undefined || point.source === event.source) && (point.vector === undefined || point.vector === event.vector);
  return event.kind === "iret";
}

/** INTA selects its completed INTR entry, rather than pausing midway through the saved frame. */
export function xtEventCondition(event: XtIoTransfer): XtEventCondition {
  if (event.kind === "dma") return { kind: "dma", address: event.address };
  if ("port" in event) return { kind: event.kind, port: event.port, value: event.value };
  if (event.kind === "acknowledge") return { kind: "interrupt", source: "intr", vector: event.value };
  if (event.kind === "interrupt") return { kind: event.kind, source: event.source, vector: event.vector };
  return { kind: "iret" };
}

export function describeXtEvent(point: XtEventCondition): string {
  if (point.kind === "iret") return "IRET";
  if (point.kind === "dma") return `DMA2 · ${point.address === undefined ? "any RAM byte" : "RAM $" + hex(point.address, 5)}`;
  if (point.kind === "interrupt") return `${point.source?.toUpperCase() ?? "Any interrupt"} · vector ${point.vector === undefined ? "any" : "$" + hex(point.vector, 2)}`;
  return `${point.kind === "input" ? "IN" : "OUT"} $${hex(point.port, 4)}${point.value === undefined ? " · any value" : " = $" + hex(point.value, 2)}`;
}
