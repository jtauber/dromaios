import type { DebugLocation, DebugStop } from "./instruction-debugger.js";

const formatLocation = (location: DebugLocation) => `$${location.address.toString(16).toUpperCase().padStart(4, "0")} (${location.space})`;

/** One vocabulary for debugger stops in every laboratory. Details describe the captured machine event. */
export function debuggerStatus(stop: DebugStop | undefined, request: string | undefined, running: boolean,
  format: (location: DebugLocation) => string = formatLocation): string {
  if (!stop && running && request === "until") return "Stepping…";
  if (!stop) return running && request ? `Running · ${request === "target" ? "to address" : `step ${request}`}…` : "";
  const reasons = { breakpoint: "Breakpoint", watchpoint: "Watchpoint", step: "Step complete", over: "Step over complete", out: "Step out complete",
    target: "Run-to address reached", limit: "Execution limit reached; destination not reached", pause: "Paused",
    error: "Execution error", "tracking-lost": "Caller tracking lost" };
  return `${reasons[stop.kind]} at ${format(stop.location)}.${stop.detail ? ` ${stop.detail}` : ""}`;
}
