import type { Coco, stepCoco } from "../../src/machines/6809/coco/runtime.js";
import type { RamWrite } from "../../src/components/memory/ram.js";
import { createInstructionDebugger, decodeInstructionBreakpoints } from "./instruction-debugger.js";
import type { DebugLocation } from "./instruction-debugger.js";
import { observeCocoRoms } from "./coco-rom-guide.js";
import { cocoHex as hex } from "./coco-inspection.js";

export interface CocoAddressStop { readonly address: number; readonly enabled: boolean }
type Boundary = ReturnType<typeof stepCoco>;
export interface CocoWriteHit extends RamWrite {
  readonly caller: DebugLocation;
  readonly record: Boundary;
}

export function cocoDebugLocation(machine: Coco): DebugLocation {
  const address = machine.cpu.snapshot().pc, mapping = observeCocoRoms(machine);
  return { address, space: !machine.sam.supportedMemory() ? "unavailable" : address < 0x8000 ? "ram"
    : mapping.mapped(address) ? "rom" : "unavailable" };
}

/** This fixed-map profile needs address-only preferences, separate from saved machine state. */
export function decodeCocoAddressStops(saved: string | null, maximum: number): readonly CocoAddressStop[] {
  return decodeInstructionBreakpoints(saved, [], maximum).map(({ address, enabled }) => ({ address, enabled }));
}

/** Shared execution policy, with completed physical RAM stores observed only during a CPU boundary. */
export function createCocoDebugger(machine: () => Coco, budget = 2_000_000) {
  const policy = createInstructionDebugger(budget);
  let watches: readonly CocoAddressStop[] = [], watched = new Set<number>();
  let ram: Coco["ram"] | undefined, detach = () => {};
  let capture: { write?: RamWrite } | undefined, hit: CocoWriteHit | undefined;
  const location = () => cocoDebugLocation(machine());
  function observeRam(): void {
    const next = watched.size ? machine().ram : undefined;
    if (ram === next) return;
    detach(); ram = next;
    detach = ram?.observeWrites(write => {
      if (capture && !capture.write && watched.has(write.address)) capture.write = { ...write };
    }) ?? (() => {});
  }
  function validate(points: readonly CocoAddressStop[], maximum: number): readonly CocoAddressStop[] {
    if (points.length > 64 || points.some(point => !Number.isInteger(point.address) || point.address < 0 || point.address > maximum
      || typeof point.enabled !== "boolean") || new Set(points.map(point => point.address)).size !== points.length) {
      throw new RangeError(`Use at most 64 distinct addresses from $0000 to $${hex(maximum)}.`);
    }
    return points.map(({ address, enabled }) => ({ address, enabled }));
  }
  return {
    get breakpoints(): readonly CocoAddressStop[] { return policy.breakpoints; },
    get watchpoints() { return watches; },
    get stop() { return policy.stop; },
    get request() { return policy.request; },
    get hit() { return hit; },
    setBreakpoints(points: readonly CocoAddressStop[]): void { policy.setBreakpoints(validate(points, 0xffff)); },
    setWatchpoints(points: readonly CocoAddressStop[]): void {
      watches = validate(points, 0x7fff); watched = new Set(watches.filter(point => point.enabled).map(point => point.address));
      observeRam();
    },
    run(): void { hit = undefined; policy.run(location()); },
    step(): void {
      hit = undefined; policy.step(location());
      policy.beforeStep(location()); // Manual Step crosses the current breakpoint once.
    },
    runTo(address: number, space?: "rom"): void {
      if (!Number.isInteger(address) || address < 0 || address > 0xffff) throw new RangeError("Use a 16-bit target address.");
      hit = undefined; policy.runTo(location(), address, space);
    },
    pause(detail?: string): void { policy.pause(location(), detail); },
    beforeStep(): boolean { return policy.beforeStep(location()); },
    capture(step: () => Boundary): Boundary {
      observeRam(); const caller = location(); capture = {};
      try {
        const record = step();
        policy.observeBoundary();
        if (capture.write) {
          hit = { ...capture.write, caller, record };
          policy.watchpoint(location(), describeCocoWriteHit(hit));
        } else if (policy.request === "step") policy.beforeStep(location());
        return record;
      } catch (cause) {
        hit = undefined; policy.fail(location(), cause instanceof Error ? cause.message : String(cause));
        throw cause;
      } finally { capture = undefined; }
    },
    reset(): void { policy.reset(); hit = undefined; capture = undefined; observeRam(); },
    dispose(): void { detach(); ram = undefined; },
  };
}

export function describeCocoWriteHit(hit: CocoWriteHit): string {
  const source = hit.record.instruction ? `Instruction $${hex(hit.record.instruction.address)}`
    : `${"source" in hit.record ? hit.record.source.toUpperCase() : "CPU"} ${hit.record.outcome} at PC $${hex(hit.caller.address)}`;
  return `${source} wrote RAM $${hex(hit.address)}: $${hex(hit.before, 2)} → $${hex(hit.after, 2)}. Stopped after the complete boundary.`;
}
