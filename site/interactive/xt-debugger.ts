import { xtIoTransfers } from "./xt-io-events.js";
import { watchXtEgaPixel, type XtPixelChange } from "./xt-ega-pixel.js";
import { createXtEgaPlaneWatches, planeByteLabel, type EgaPlaneStore } from "./xt-ega-plane-watch.js";
import type { XtIoTransfer } from "./xt-io-events.js";
import { validateXtEventStops, matchesXtEvent, matchesXtDosEvent, describeXtEvent, xtEventCondition } from "./xt-event-stops.js";
import type { XtEventCondition, XtEventStop } from "./xt-event-stops.js";
import type { DosCall, createXtDosCalls } from "./xt-dos-services.js";
import { observe8088Boundary } from "./8088-debugger.js";
import type { RamWrite } from "../../src/components/memory/ram.js";
import type { XtBoundary as Boundary } from "./xt-session.js";
import { decode8088, logical8088, physical8088, xtHex as hex, type Catalogue8088 } from "./8088-disassembly.js";
import { createInstructionDebugger, decodeInstructionBreakpoints } from "./instruction-debugger.js";
import type { DebugLocation, InstructionBreakpoint, RunToOptions } from "./instruction-debugger.js";
import { parseMemoryAddress } from "./memory-window.js";
import { createRamWriteCapture } from "./ram-write-capture.js";
import { parseXtAddress, xtDebugLocation, xtInstructionFetchCount } from "./xt-inspection.js";
import type { XtMachine } from "./xt-session.js";

export { xtDebugLocation } from "./xt-inspection.js";

type Target = Pick<InstructionBreakpoint, "address" | "space">;
export interface XtEventHit {
  readonly caller: DebugLocation;
  readonly event: XtIoTransfer;
}
export interface XtMemoryWatchReport {
  readonly caller: DebugLocation;
  readonly instruction: Boundary["instruction"];
  readonly detail: string;
}
export interface XtWriteHit extends XtMemoryWatchReport, RamWrite {
  readonly record: Boundary;
}

function watchedDataRead(record: Boundary, addresses: ReadonlySet<number>) {
  for (let i = xtInstructionFetchCount(record); i < record.accesses.length; i++) {
    const access = record.accesses[i]!;
    if (access.kind === "read" && addresses.has(access.address)) return access;
  }
}

function boundaryName(record: Boundary, cpu?: Catalogue8088): string {
  const { cs, ip } = record.before, bytes = record.instruction?.bytes;
  if (!bytes) return ("source" in record ? record.source : record.interrupt?.source ?? "CPU").toUpperCase() + " entry";
  return cpu ? decode8088(cpu, cs, ip, i => bytes[i]).assembly : "Instruction";
}

function writeReport(write: RamWrite, record: Boundary, caller: DebugLocation, cpu?: Catalogue8088): XtWriteHit {
  const change = `wrote RAM $${hex(write.address, 5)}: $${hex(write.before, 2)} → $${hex(write.after, 2)}`;
  const dma = record.dma;
  if (dma?.direction === "disk-to-memory" && dma.address === write.address) {
    return { ...write, caller, record, instruction: null, detail: `DMA2 ${change} from disk offset $${hex(dma.offset, 5)}.` };
  }
  return { ...write, caller, record, instruction: record.instruction,
    detail: `${boundaryName(record, cpu)} at ${formatXtDebugAddress(caller)} ${change}.` };
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
    throw new RangeError(`Use at most 64 distinct ${logical ? "physical addresses or CS:IP pairs" : "physical addresses"} within 00000–${hex(maximum, 5)}.`);
  }
  return points.map(({ address, space, enabled }) => ({ address, ...(space !== undefined && { space }), enabled }));
}

/** Adapt XT boundaries and physical RAM stores to the shared stopping policy. */
export function createXtDebugger(machine: () => XtMachine, budget = 2_000_000, dosCalls?: ReturnType<typeof createXtDosCalls>, cpu?: Catalogue8088) {
  const policy = createInstructionDebugger(budget), writes = createRamWriteCapture(() => machine().ram);
  const planeWatches = createXtEgaPlaneWatches(() => {
    const board = machine(); return "ega" in board ? board.ega : undefined;
  });
  let planeHit: (EgaPlaneStore & { readonly record: Boundary; readonly dma: boolean }) | undefined;
  const location = () => xtDebugLocation(machine().cpu.snapshot());
  let watches: readonly InstructionBreakpoint[] = [], hit: XtWriteHit | undefined;
  let readWatches: readonly InstructionBreakpoint[] = [], readAddresses = new Set<number>();
  let readHit: (XtMemoryWatchReport & { address: number; value: number }) | undefined;
  let events: readonly XtEventStop[] = [], activeEvents: readonly XtEventStop[] = [], eventHit: XtEventHit | undefined;
  let dosHit: DosCall | undefined;
  let targetEvent: XtEventCondition | undefined;
  let eventCondition: (() => boolean) | undefined;
  let pixelWatch: ReturnType<typeof watchXtEgaPixel> | undefined, pixelHit: XtPixelChange | undefined;
  function endPixelWatch(): void {
    pixelWatch?.dispose(); pixelWatch = undefined;
  }
  function clearHit(): void {
    hit = undefined; readHit = undefined; eventHit = undefined; dosHit = undefined; targetEvent = undefined; eventCondition = undefined;
    endPixelWatch(); pixelHit = undefined; planeHit = undefined;
  }
  return {
    get planeWatchpoints() { return planeWatches.values; },
    setPlaneWatchpoints: planeWatches.set,
    get planeHit() { return planeHit; },
    get pixelTarget(): { readonly x: number; readonly y: number } | undefined { return pixelWatch; },
    get pixelHit() { return pixelHit; },
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
    get readHit() { return readHit; },
    get readWatchpoints() { return readWatches; },
    setReadWatchpoints(points: readonly InstructionBreakpoint[]): void {
      readWatches = validate(points, 0xfffff);
      readAddresses = new Set(readWatches.filter(point => point.enabled).map(point => point.address));
    },
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
    runUntilPixelChanges(x: number, y: number): void {
      const board = machine();
      if (!("ega" in board)) throw new Error("Pixel stops require the EGA display.");
      const watch = watchXtEgaPixel(board.ega, x, y);
      clearHit(); pixelWatch = watch;
      policy.stepUntil(location(), () => undefined);
    },
    pause(detail?: string): void { endPixelWatch(); policy.pause(location(), detail); },
    beforeStep(current: DebugLocation | (() => DebugLocation) = location): boolean {
      const stopped = policy.beforeStep(current);
      if (stopped) endPixelWatch();
      return stopped;
    },
    capture(step: () => Boundary): Boundary {
      try {
        pixelWatch?.beginBoundary();
        const { record, write } = writes.capture(planeWatches.enabled ? () => planeWatches.capture(step) : step);
        if (record.outcome === "unsupported") policy.fail(xtDebugLocation(record.after), "Unsupported instruction.");
        else {
          const dosCall = dosCalls?.observe(record);
          observe8088Boundary(policy, record);
          const read = readAddresses.size ? watchedDataRead(record, readAddresses) : undefined;
          if (read || write || planeWatches.store) {
            const details = [], caller = xtDebugLocation(record.before);
            if (read) {
              const detail = `${caller.space} · ${boundaryName(record, cpu)} read $${hex(read.value, 2)} from physical $${hex(read.address, 5)}.`;
              readHit = { address: read.address, value: read.value, caller, instruction: record.instruction, detail }; details.push(detail);
            }
            if (write) {
              hit = writeReport(write, record, caller, cpu); details.push(hit.detail);
            }
            if (planeWatches.store) {
              const { plane, write } = planeWatches.store, physical = 0xa0000 + write.address;
              const dma = record.dma?.direction === "disk-to-memory" && record.dma.address === physical;
              planeHit = { plane, write, record, dma };
              details.push(`${dma ? "DMA2 before" : "CPU at"} ${formatXtDebugAddress(caller)} wrote EGA ${planeByteLabel(plane, write.offset)} through $${hex(physical, 5)} · $${hex(write.before[plane]!, 2)} → $${hex(write.after[plane]!, 2)}.`);
            }
            policy.watchpoint(xtDebugLocation(record.after), details.join(" "));
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
          if (pixelWatch) {
            const change = pixelWatch.observe(record);
            if (change === "mode-ended") {
              if (!policy.stop) policy.pause(xtDebugLocation(record.after), "Pixel watch ended when the EGA left mode 0Dh.");
            } else if (change) {
              pixelHit = change;
              if (!policy.stop) policy.event(xtDebugLocation(record.after),
                `Pixel (${change.x},${change.y}) changed from ${change.before.colour} to ${change.after.colour}. See Screen for the instruction and plane values.`);
            }
          }
          if (policy.request === "step") policy.beforeStep(xtDebugLocation(record.after));
        }
        if (pixelWatch && policy.stop) endPixelWatch();
        return record;
      } catch (cause) {
        clearHit(); policy.fail(location(), cause instanceof Error ? cause.message : String(cause));
        throw cause;
      }
    },
    reset(): void { policy.reset(); clearHit(); dosCalls?.reset(); writes.reconnect(); planeWatches.reconnect(); },
    dispose(): void { endPixelWatch(); writes.dispose(); planeWatches.dispose(); },
  };
}
