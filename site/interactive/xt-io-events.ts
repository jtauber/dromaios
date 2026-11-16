import type { stepXtSessionCpu } from "./xt-session.js";
import type { DebugLocation } from "./instruction-debugger.js";
import type { Cpu8088Delivery, Cpu8088InterruptSource } from "../../src/components/cpus/generated/8088-cpu.js";
import { xtDebugLocation } from "./xt-inspection.js";
import { opcode8088Index } from "./8088-encoding.js";

type Boundary = ReturnType<typeof stepXtSessionCpu>;
export type XtInterruptSource = Cpu8088Delivery["source"] | Cpu8088InterruptSource;
export type XtIoTransfer = { readonly kind: "input" | "output"; readonly port: number; readonly value: number }
  | { readonly kind: "acknowledge"; readonly value: number }
  | { readonly kind: "interrupt"; readonly source: XtInterruptSource; readonly vector: number; readonly target: DebugLocation }
  | { readonly kind: "iret"; readonly target: DebugLocation };

/** Decode completed, captured events for both trace history and debugger conditions. No bus access. */
export function xtIoTransfers(record: Boundary): readonly XtIoTransfer[] {
  if (record.outcome !== "executed" && record.outcome !== "accepted") return [];
  const transfers: XtIoTransfer[] = [];
  for (const access of record.accesses) {
    if (access.kind === "input" || access.kind === "output") transfers.push({ kind: access.kind, port: access.port, value: access.value });
    else if (access.kind === "acknowledge") transfers.push({ kind: access.kind, value: access.value });
  }
  const interrupt = record.outcome === "accepted" ? record : "interrupt" in record ? record.interrupt : undefined;
  if (interrupt) transfers.push({ kind: "interrupt", source: interrupt.source, vector: interrupt.vector, target: xtDebugLocation(record.after) });
  const bytes = record.instruction?.bytes ?? [];
  if (bytes[opcode8088Index(bytes)] === 0xcf) transfers.push({ kind: "iret", target: xtDebugLocation(record.after) });
  return transfers;
}
