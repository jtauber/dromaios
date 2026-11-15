import { observe8088Boundary } from "./8088-debugger.js";
import type { RamWrite } from "../../src/components/memory/ram.js";
import type { Cpu8088Snapshot } from "../../src/components/cpus/generated/8088-cpu.js";
import type { stepTimedXtCpu } from "../../src/machines/8088/pc-xt/interrupts.js";
import { logical8088, physical8088, xtHex as hex } from "./8088-disassembly.js";
import { createInstructionDebugger, decodeInstructionBreakpoints } from "./instruction-debugger.js";
import type { DebugLocation, InstructionBreakpoint, RunToOptions } from "./instruction-debugger.js";
import { parseMemoryAddress } from "./memory-window.js";
import { createRamWriteCapture } from "./ram-write-capture.js";
import { parseXtAddress } from "./xt-inspection.js";
import type { XtMachine } from "./xt-session.js";

type Boundary = ReturnType<typeof stepTimedXtCpu>["record"];
type Target = Pick<InstructionBreakpoint, "address" | "space">;
export interface XtWriteHit extends RamWrite {
  readonly caller: DebugLocation;
  readonly record: Boundary;
}

/** Physical bytes identify aliases; the exact logical pair identifies one execution location. */
export function xtDebugLocation(state: Pick<Cpu8088Snapshot, "cs" | "ip" | "pc">): DebugLocation {
  return { address: state.pc, space: "CS:IP " + logical8088(state.cs, state.ip) };
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
export function createXtDebugger(machine: () => XtMachine, budget = 2_000_000) {
  const policy = createInstructionDebugger(budget), writes = createRamWriteCapture(() => machine().ram);
  const location = () => xtDebugLocation(machine().cpu.snapshot());
  let watches: readonly InstructionBreakpoint[] = [], hit: XtWriteHit | undefined;
  return {
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
    run(): void { hit = undefined; policy.run(location()); },
    step(): void { hit = undefined; policy.step(location()); policy.beforeStep(location()); },
    over(): void { hit = undefined; policy.overBoundary(location()); },
    out(): void { hit = undefined; policy.out(location()); },
    runTo(target: Target, options?: RunToOptions): void {
      const point = validate([{ ...target, enabled: true }], 0xfffff, true)[0]!;
      hit = undefined; policy.runTo(location(), point.address, point.space, options);
    },
    pause(detail?: string): void { policy.pause(location(), detail); },
    beforeStep(current: DebugLocation | (() => DebugLocation) = location): boolean { return policy.beforeStep(current); },
    capture(step: () => Boundary): Boundary {
      try {
        const { record, write } = writes.capture(step);
        if (record.outcome === "unsupported") policy.fail(xtDebugLocation(record.after), "Unsupported instruction.");
        else {
          observe8088Boundary(policy, record);
          if (write) {
            hit = { ...write, caller: xtDebugLocation(record.before), record };
            policy.watchpoint(xtDebugLocation(record.after), describeXtWriteHit(hit));
          } else if (policy.request === "step") policy.beforeStep(xtDebugLocation(record.after));
        }
        return record;
      } catch (cause) {
        hit = undefined; policy.fail(location(), cause instanceof Error ? cause.message : String(cause));
        throw cause;
      }
    },
    reset(): void { policy.reset(); hit = undefined; writes.reconnect(); },
    dispose: writes.dispose,
  };
}

export function describeXtWriteHit(hit: XtWriteHit): string {
  const source = hit.record.instruction ? "Instruction" : "source" in hit.record ? hit.record.source.toUpperCase() + " entry" : "CPU boundary";
  return `${source} at ${formatXtDebugAddress(hit.caller)} wrote RAM $${hex(hit.address, 5)}: $${hex(hit.before, 2)} → $${hex(hit.after, 2)}. Stopped after the complete CPU boundary.`;
}
