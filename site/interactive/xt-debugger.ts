import { xtIoTransfers } from "./xt-io-events.js";
import type { XtIoTransfer } from "./xt-io-events.js";
import { validateXtEventStops, matchesXtEvent, matchesXtDosEvent, describeXtEvent, xtEventCondition } from "./xt-event-stops.js";
import type { XtEventCondition, XtEventStop } from "./xt-event-stops.js";
import type { DosCall, createXtDosCalls } from "./xt-dos-services.js";
import { observe8088Boundary } from "./8088-debugger.js";
import type { RamWrite } from "../../src/components/memory/ram.js";
import type { XtBoundary as Boundary } from "./xt-session.js";
import { logical8088, physical8088, xtHex as hex } from "./8088-disassembly.js";
import { createInstructionDebugger, decodeInstructionBreakpoints } from "./instruction-debugger.js";
import type { DebugLocation, InstructionBreakpoint, RunToOptions } from "./instruction-debugger.js";
import { parseMemoryAddress } from "./memory-window.js";
import { createRamWriteCapture } from "./ram-write-capture.js";
import { parseXtAddress, xtDebugLocation } from "./xt-inspection.js";
import type { XtMachine } from "./xt-session.js";

export { xtDebugLocation } from "./xt-inspection.js";

type Target = Pick<InstructionBreakpoint, "address" | "space">;
export interface XtEventHit {
  readonly caller: DebugLocation;
  readonly event: XtIoTransfer;
}
export interface XtWriteHit extends RamWrite {
  readonly caller: DebugLocation;
  readonly record: Boundary;
}

/** Physical and logical locations come from the same captured CPU boundary. */
export function observeXtBoundary(machine: XtMachine, state = machine.cpu.snapshot()) {
  return { state, caller: xtDebugLocation(state) };
}

export function parseXtDebugAddress(text: string): Target {
  const address = parseXtAddress(text), parts = text.split(":");
  return parts.length === 1 ? { address }
    : { address, space: "CS:IP " + logical8088(parseMemoryAddress(parts[0]!), parseMemoryAddress(parts[1]!)) };
}

export function formatXtDebugAddress(point: Target): string {
  return point.space ? `${point.space} · physical $${hex(point.address, 5)}` : `physical $${hex(point.address, 5)}`;
}

export function xtLogicalLocation(location: DebugLocation): { readonly cs: number; readonly ip: number } | undefined {
  const match = /^CS:IP ([0-9A-F]{4}):([0-9A-F]{4})$/.exec(location.space ?? "");
  if (!match) return undefined;
  const cs = parseInt(match[1]!, 16), ip = parseInt(match[2]!, 16);
  return physical8088(cs, ip) === location.address ? { cs, ip } : undefined;
}

function acceptsLogicalSpace(space: string, address: number): boolean {
  return xtLogicalLocation({ space, address }) !== undefined;
}

export function decodeXtBreakpoints(saved: string | null): readonly InstructionBreakpoint[] {
  return decodeInstructionBreakpoints(saved, acceptsLogicalSpace, 0xfffff);
}

function validate(points: readonly InstructionBreakpoint[], maximum: number, logical = false): readonly InstructionBreakpoint[] {
  if (points.length > 64 || points.some(point => !Number.isInteger(point.address) || point.address < 0 || point.address > maximum
    || typeof point.enabled !== "boolean" || point.space !== undefined && (!logical || !acceptsLogicalSpace(point.space, point.address)))
    || new Set(points.map(point => `${point.address}:${point.space ?? ""}`)).size !== points.length) {
    throw new RangeError(`Use at most 64 distinct ${logical ? "physical addresses or CS:IP pairs" : "RAM addresses"} within 00000–${hex(maximum, 5)}.`);
  }
  return points.map(({ address, space, enabled }) => ({ address, ...(space !== undefined && { space }), enabled }));
}

/** Adapt XT boundaries and physical RAM stores to the shared stopping policy. */
export function createXtDebugger(machine: () => XtMachine, budget = 2_000_000, dosCalls?: ReturnType<typeof createXtDosCalls>) {
  const policy = createInstructionDebugger(budget), writes = createRamWriteCapture(() => machine().ram);
  const location = () => xtDebugLocation(machine().cpu.snapshot());
  let watches: readonly InstructionBreakpoint[] = [], hit: XtWriteHit | undefined;
  let events: readonly XtEventStop[] = [], activeEvents: readonly XtEventStop[] = [], eventHit: XtEventHit | undefined;
  let dosHit: DosCall | undefined;
  let targetEvent: XtEventCondition | undefined;
  let eventCondition: (() => boolean) | undefined;
  function clearHit(): void { hit = undefined; eventHit = undefined; dosHit = undefined; targetEvent = undefined; eventCondition = undefined; }
  return {
    get eventStops() { return events; },
    get eventHit() { return eventHit; },
    get dosHit() { return dosHit; },
    setEventStops(points: readonly XtEventStop[]): void {
      events = validateXtEventStops(points); activeEvents = events.filter(point => point.enabled);
    },
    get frames() { return policy.frames; },
    get trackingNote() { return policy.trackingNote; },
    get canStepOut() { return policy.canStepOut; },
    get breakpoints() { return policy.breakpoints; },
    get watchpoints() { return watches; },
    get stop() { return policy.stop; },
    get request() { return policy.request; },
    get hit() { return hit; },
    setBreakpoints(points: readonly InstructionBreakpoint[]): void { policy.setBreakpoints(validate(points, 0xfffff, true)); },
    setWatchpoints(points: readonly InstructionBreakpoint[]): void {
      watches = validate(points, machine().ram.size - 1);
      writes.watch(watches.filter(point => point.enabled).map(point => point.address));
    },
    run(): void { clearHit(); policy.run(location()); },
    step(): void { clearHit(); policy.step(location()); policy.beforeStep(location()); },
    over(): void { clearHit(); policy.overBoundary(location()); },
    out(): void { clearHit(); policy.out(location()); },
    runTo(target: Target, options?: RunToOptions): void {
      const point = validate([{ ...target, enabled: true }], 0xfffff, true)[0]!;
      clearHit(); policy.runTo(location(), point.address, point.space, options);
    },
    runToEvent(condition: XtEventCondition, when?: () => boolean): void {
      const target = validateXtEventStops([{ ...condition, enabled: true }])[0]!;
      clearHit(); targetEvent = target; eventCondition = when;
      policy.stepUntil(location(), () => undefined); // Retain the shared instruction budget.
    },
    pause(detail?: string): void { policy.pause(location(), detail); },
    beforeStep(current: DebugLocation | (() => DebugLocation) = location): boolean { return policy.beforeStep(current); },
    capture(step: () => Boundary): Boundary {
      try {
        const { record, write } = writes.capture(step);
        if (record.outcome === "unsupported") policy.fail(xtDebugLocation(record.after), "Unsupported instruction.");
        else {
          const dosCall = dosCalls?.observe(record);
          observe8088Boundary(policy, record);
          if (write) {
            hit = { ...write, caller: xtDebugLocation(record.before), record };
            policy.watchpoint(xtDebugLocation(record.after), describeXtWriteHit(hit));
          } else if (activeEvents.length || targetEvent) {
            const event = xtIoTransfers(record).find(event => targetEvent && matchesXtEvent(targetEvent, event) && (eventCondition?.() ?? true)
              || activeEvents.some(point => matchesXtEvent(point, event)));
            if (event) {
              eventHit = { caller: xtDebugLocation(record.before), event };
              policy.event(xtDebugLocation(record.after), `${describeXtEvent(xtEventCondition(event))} ${event.kind === "dma" ? "before the CPU boundary at" : "from"} ${formatXtDebugAddress(eventHit.caller)}. Stopped after the complete CPU/board boundary.`);
            } else if (dosCall) {
              const condition = targetEvent && matchesXtDosEvent(targetEvent, dosCall) && (eventCondition?.() ?? true) ? targetEvent
                : activeEvents.find(point => matchesXtDosEvent(point, dosCall));
              if (condition) {
                dosHit = dosCall;
                const caller = logical8088(dosCall.caller.cs, dosCall.caller.ip), result = dosCall.result;
                policy.event(xtDebugLocation(record.after), `${describeXtEvent(condition)} · ${dosCall.service.name} from ${caller}. `
                  + (result ? `AX=${hex(result.ax, 4)} · CF=${+result.carry}. Stopped after the observed return.` : "Stopped after the complete INT 21h entry."));
              }
            }
          }
          if (policy.request === "step") policy.beforeStep(xtDebugLocation(record.after));
        }
        return record;
      } catch (cause) {
        clearHit(); policy.fail(location(), cause instanceof Error ? cause.message : String(cause));
        throw cause;
      }
    },
    reset(): void { policy.reset(); clearHit(); dosCalls?.reset(); writes.reconnect(); },
    dispose: writes.dispose,
  };
}

export function describeXtWriteHit(hit: XtWriteHit): string {
  const dma = hit.record.dma;
  if (dma?.direction === "disk-to-memory" && dma.address === hit.address) return `DMA2 wrote RAM $${hex(hit.address, 5)}: $${hex(hit.before, 2)} → $${hex(hit.after, 2)} from disk offset $${hex(dma.offset, 5)}. Stopped after the complete CPU/board boundary.`;
  const source = hit.record.instruction ? "Instruction" : "source" in hit.record ? hit.record.source.toUpperCase() + " entry" : "CPU boundary";
  return `${source} at ${formatXtDebugAddress(hit.caller)} wrote RAM $${hex(hit.address, 5)}: $${hex(hit.before, 2)} → $${hex(hit.after, 2)}. Stopped after the complete CPU boundary.`;
}
