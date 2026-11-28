import { cocoMemorySupported, cocoRamAddress } from "../../src/machines/6809/coco/memory.js";
import { inspectCocoPixel, type Coco, type CocoPixel, type CocoVideoSignal, type stepCoco } from "../../src/machines/6809/coco/runtime.js";
import type { RamWrite } from "../../src/components/memory/ram.js";
import { createInstructionDebugger, decodeInstructionBreakpoints } from "./instruction-debugger.js";
import type { DebugLocation } from "./instruction-debugger.js";
import { observeCocoRoms } from "./coco-rom-guide.js";
import { cocoHex as hex, cocoMonitorColours, cocoPixelStorage, readCocoStorage } from "./coco-inspection.js";
import type { Catalogue6809 } from "./6809-catalogue.js";
import { decode6809, decodeCaptured6809 } from "./6809-disassembly.js";
import { create6809DebugObserver } from "./6809-debugger.js";
import { createMappedAccessStops, mappedLocationText } from "./mapped-access-stops.js";
import { dataReads6809, type DataRead6809 } from "./6809-encoding.js";
import type { CocoWriteAccess } from "./coco-watch-history.js";
import { createRamWriteCapture } from "./ram-write-capture.js";

export interface CocoAddressStop { readonly address: number; readonly enabled: boolean }
type Boundary = ReturnType<typeof stepCoco>;
export interface CocoWriteHit extends RamWrite {
  readonly kind: "write";
  readonly caller: DebugLocation;
  readonly record: Boundary;
}
interface CocoReadHit extends DataRead6809 { readonly caller: DebugLocation; readonly record: Boundary }
interface PixelTarget { x: number; y: number; signal: CocoVideoSignal; previous: CocoPixel }
interface CocoPixelHit {
  x: number; y: number; before: CocoPixel; after: CocoPixel; caller: DebugLocation; instruction: string; transition: string;
}

function describePixel(dot: CocoPixel): string {
  return `${cocoPixelStorage(dot)} · #${hex(cocoMonitorColours[dot.colour]!, 6)}`;
}

export function cocoDebugLocation(machine: Coco, address = machine.cpu.snapshot().pc): DebugLocation {
  const mapping = observeCocoRoms(machine);
  const physical = cocoRamAddress(machine, address);
  return { address, space: !cocoMemorySupported(machine) ? "unavailable" : physical !== undefined ? (physical === address ? "ram" : "upper RAM")
    : machine.cartridge?.inserted() && address >= 0xc000 && address < 0xff00 ? "cartridge" : mapping.mapped(address) ? "rom" : "unavailable" };
}

/** Reuse a preceding boundary's CPU state, but observe the current SAM/cartridge mapping. */
export function observeCocoBoundary(machine: Coco, state = machine.cpu.snapshot()) {
  return { state, caller: cocoDebugLocation(machine, state.pc) };
}

/** Breakpoints use logical CPU addresses; write watchpoints use physical RAM, separate from saved machine state. */
export function decodeCocoAddressStops(saved: string | null, maximum: number): readonly CocoAddressStop[] {
  return decodeInstructionBreakpoints(saved, [], maximum).map(({ address, enabled }) => ({ address, enabled }));
}

/** Shared execution policy, with completed physical RAM stores observed only during a CPU boundary. */
export function createCocoDebugger(machine: () => Coco, catalogue: Catalogue6809, budget = 2_000_000) {
  const policy = createInstructionDebugger(budget), observer = create6809DebugObserver(policy, catalogue);
  const accessStops = createMappedAccessStops(["ram", "upper RAM", "rom", "cartridge", "unavailable"], ["read", "write"]);
  const writes = createRamWriteCapture(() => machine().ram);
  let watches: readonly CocoAddressStop[] = [], hit: CocoWriteHit | CocoReadHit | undefined;
  let readWatches: readonly CocoAddressStop[] = [], readAddresses = new Set<number>();
  let pixelTarget: PixelTarget | undefined, pixelHit: CocoPixelHit | undefined;
  function clearHits(): void { hit = undefined; pixelTarget = undefined; pixelHit = undefined; }
  const location = (address?: number) => cocoDebugLocation(machine(), address);
  function observePixel(target: PixelTarget, record: Boundary, caller: DebugLocation, at: DebugLocation): void {
    const { x, y, previous: before } = target, after = inspectCocoPixel(machine(), x, y, target.signal);
    if (!after) {
      if (!policy.stop) policy.pause(at, "Pixel run ended because this display mode does not support inspection.");
    } else if (before.colour !== after.colour) {
      const instruction = record.instruction ? decodeCaptured6809(caller.address, record.instruction.bytes, catalogue).assembly
        : "source" in record ? `${record.source.toUpperCase()} entry` : record.outcome;
      const transition = `${describePixel(before)} → ${describePixel(after)}`;
      pixelHit = { x, y, before, after, caller, instruction, transition };
      if (!policy.stop) policy.event(at, `Pixel (${x},${y}) changed at $${hex(caller.address)} (${instruction}). ${transition}.`);
    } else target.previous = after;
  }
  function validate(points: readonly CocoAddressStop[], maximum: number): readonly CocoAddressStop[] {
    if (points.length > 64 || points.some(point => !Number.isInteger(point.address) || point.address < 0 || point.address > maximum
      || typeof point.enabled !== "boolean") || new Set(points.map(point => point.address)).size !== points.length) {
      throw new RangeError(`Use at most 64 distinct addresses from $0000 to $${hex(maximum)}.`);
    }
    return points.map(({ address, enabled }) => ({ address, enabled }));
  }
  function stopOnAccess(record: Boundary, caller: DebugLocation, access: DataRead6809 | CocoWriteAccess): void {
    const { address, bytes } = record.instruction!;
    const assembly = decodeCaptured6809(address, bytes, catalogue).assembly;
    hit = access.kind === "write" ? { kind: "write", ...access.storage, caller, record } : { ...access, caller, record };
    policy.event(location(record.after.pc), `${accessStops.describe({ caller, ...access })} = $${hex(access.value, 2)} · ${assembly}.`);
  }
  function stopOnRead(record: Boundary, caller: DebugLocation, after: DebugLocation): boolean {
    if (!readAddresses.size && !accessStops.values().some(point => point.enabled && point.kind === "read")) return false;
    const reads = dataReads6809(record), specific = record.instruction && accessStops.match(caller, reads);
    if (specific) { stopOnAccess(record, caller, specific); return true; }
    const read = reads.find(access => readAddresses.has(access.address));
    if (!read) return false;
    hit = { ...read, caller, record };
    const source = record.instruction ? mappedLocationText(caller) : `${"source" in record ? record.source.toUpperCase() : "CPU"} entry`;
    policy.watchpoint(after, `${source} · READ $${hex(read.address)} = $${hex(read.value, 2)}.`);
    return true;
  }
  return {
    accessStops,
    observeAccesses(record: Boundary, caller: DebugLocation, transfers: readonly CocoWriteAccess[]): void {
      if (record.outcome !== "executed" || !record.instruction || policy.stop?.kind === "error") return;
      const access = accessStops.match(caller, transfers);
      if (access) stopOnAccess(record, caller, access);
    },
    get breakpoints(): readonly CocoAddressStop[] { return policy.breakpoints; },
    get watchpoints() { return watches; },
    get stop() { return policy.stop; },
    get request() { return policy.request; },
    get hit() { return hit; },
    get pixelTarget(): { readonly x: number; readonly y: number } | undefined { return pixelTarget; },
    get pixelHit() { return pixelHit; },
    get readWatchpoints() { return readWatches; },
    setReadWatchpoints(points: readonly CocoAddressStop[]): void {
      readWatches = validate(points, 0xffff);
      readAddresses = new Set(readWatches.filter(point => point.enabled).map(point => point.address));
    },
    get frames() { return policy.frames; },
    get trackingNote() { return policy.trackingNote; },
    get canStepOut() { return policy.canStepOut; },
    setBreakpoints(points: readonly CocoAddressStop[]): void { policy.setBreakpoints(validate(points, 0xffff)); },
    setWatchpoints(points: readonly CocoAddressStop[]): void {
      watches = validate(points, 0xffff);
      writes.watch(watches.filter(point => point.enabled).map(point => point.address));
    },
    run(): void { clearHits(); policy.run(location()); },
    step(): void {
      clearHits(); policy.step(location());
      policy.beforeStep(location()); // Manual Step crosses the current breakpoint once.
    },
    over(): void {
      clearHits();
      const selected = machine(), state = selected.cpu.snapshot();
      const disk = selected.cartridge?.inserted() ? undefined : selected.disk;
      const external = disk?.halted || disk?.inspect().nmi_pending && state.nmiArmed
        || selected.pias.firq && !state.flags.f || selected.pias.irq && !state.flags.i;
      const decoded = !external && state.waitMode === "none"
        ? decode6809(address => readCocoStorage(selected, address), state.pc, catalogue) : undefined;
      policy.over(location(), decoded?.complete ? decoded.shape?.stack?.flow : undefined);
    },
    out(): void { clearHits(); policy.out(location()); },
    runTo(address: number, space?: "rom", when?: () => boolean): void {
      if (!Number.isInteger(address) || address < 0 || address > 0xffff) throw new RangeError("Use a 16-bit target address.");
      clearHits(); policy.runTo(location(), address, space, { when });
    },
    runUntilPixelChanges(x: number, y: number, signal: CocoVideoSignal): void {
      const previous = inspectCocoPixel(machine(), x, y, signal);
      if (!previous) throw new Error("Select a dot in Text / SG4 or bitmap graphics first.");
      clearHits(); pixelTarget = { x, y, signal, previous };
      policy.stepUntil(location(), () => undefined); // Use the same boundary budget as Run to address.
    },
    pause(detail?: string): void { pixelTarget = undefined; policy.pause(location(), detail); },
    beforeStep(caller = location()): boolean {
      const stopped = policy.beforeStep(caller);
      if (stopped) pixelTarget = undefined;
      return stopped;
    },
    capture(step: () => Boundary, caller = location()): Boundary {
      try {
        const { record, write } = writes.capture(step);
        const after = location(record.after.pc);
        observer.observe(record, caller, after);
        if (policy.stop?.kind === "error") { pixelTarget = undefined; return record; }
        if (!stopOnRead(record, caller, after)) {
          if (write) {
            hit = { kind: "write", ...write, caller, record };
            policy.watchpoint(after, describeCocoWriteHit(hit, catalogue));
          } else if (policy.request === "step") policy.beforeStep(after);
        }
        if (pixelTarget) {
          observePixel(pixelTarget, record, caller, after);
          if (policy.stop) pixelTarget = undefined;
        }
        return record;
      } catch (cause) {
        clearHits(); observer.reset(); policy.fail(location(), cause instanceof Error ? cause.message : String(cause));
        throw cause;
      }
    },
    reset(): void { policy.reset(); observer.reset(); clearHits(); writes.reconnect(); },
    dispose: writes.dispose,
  };
}

function describeCocoWriteHit(hit: CocoWriteHit, catalogue: Catalogue6809): string {
  const instruction = hit.record.instruction;
  const source = instruction ? `$${hex(instruction.address)} (${decodeCaptured6809(instruction.address, instruction.bytes, catalogue).assembly})`
    : `${"source" in hit.record ? hit.record.source.toUpperCase() : "CPU"} ${hit.record.outcome} at PC $${hex(hit.caller.address)}`;
  return `${source} wrote RAM $${hex(hit.address)}: $${hex(hit.before, 2)} → $${hex(hit.after, 2)}. Stopped after the complete boundary.`;
}
