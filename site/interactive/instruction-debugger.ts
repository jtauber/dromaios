/** A mapped instruction boundary. Space names belong to the machine adapter. */
export interface DebugLocation { readonly address: number; readonly space: string }
export interface InstructionBreakpoint { readonly address: number; readonly space?: string; readonly enabled: boolean }
export type StackFlow = "call" | "return" | "interrupt" | "interrupt-return";
export interface DebugStep {
  readonly before: DebugLocation;
  readonly after: DebugLocation;
  readonly stackBefore: number;
  readonly stackAfter: number;
  readonly flow?: StackFlow;
  readonly returnAddress: number;
  readonly resetsStack: boolean;
}
export interface DebugStop {
  readonly kind: "breakpoint" | "watchpoint" | "step" | "over" | "out" | "target" | "limit" | "pause" | "error" | "tracking-lost";
  readonly location: DebugLocation;
  readonly detail?: string;
}
export interface ObservedFrame {
  readonly id: number;
  readonly kind: "call" | "interrupt";
  readonly caller: DebugLocation;
  readonly entry: DebugLocation;
  readonly returnAddress: number;
  readonly stack: number;
}
type Plan = { readonly kind: "step" } | { readonly kind: "over"; frame?: number }
  | { readonly kind: "out"; readonly frame: number } | { readonly kind: "target"; readonly address: number; readonly space?: string };
const sameLocation = (a: DebugLocation, b: DebugLocation) => a.address === b.address && a.space === b.space;
const matches = (point: { readonly address: number; readonly space?: string }, location: DebugLocation) =>
  point.address === location.address && (point.space === undefined || point.space === location.space);

/** Execution policy only: no CPU, memory, scheduling, storage, labels, or DOM access. */
export function createInstructionDebugger(budget = 2_000_000) {
  if (!Number.isSafeInteger(budget) || budget < 1) throw new RangeError("The instruction limit must be positive.");
  let breakpoints: readonly InstructionBreakpoint[] = [], plan: Plan | undefined, stop: DebugStop | undefined;
  let skip: DebugLocation | undefined, completed = false, remaining = budget, nextFrame = 0;
  const frames: ObservedFrame[] = [];
  let trackingNote: string | undefined;
  function finish(kind: DebugStop["kind"], location: DebugLocation, detail?: string): void {
    stop = { kind, location, ...(detail && { detail }) }; plan = undefined; skip = undefined; completed = false;
  }
  function start(location: DebugLocation, request?: Plan, crossCurrent = false): void {
    // Continue crosses the breakpoint that stopped us once; a loop back stops again.
    skip = crossCurrent || stop?.kind === "breakpoint" && sameLocation(stop.location, location) ? location : undefined;
    stop = undefined; plan = request; completed = false; remaining = budget;
  }
  function loseTracking(location: DebugLocation, detail: string): void {
    frames.length = 0; trackingNote = detail;
    if (plan?.kind === "out" || plan?.kind === "over" && plan.frame !== undefined) finish("tracking-lost", location, detail);
  }
  return {
    get breakpoints() { return breakpoints; },
    get stop() { return stop; },
    get request() { return plan?.kind; },
    get canStepOut() { return frames.length > 0; },
    get frames(): readonly ObservedFrame[] { return frames.map(frame => ({ ...frame, caller: { ...frame.caller }, entry: { ...frame.entry } })); },
    get trackingNote() { return trackingNote; },
    setBreakpoints(values: readonly InstructionBreakpoint[]): void { breakpoints = values.map(value => ({ ...value })); },
    run(location: DebugLocation): void { start(location); },
    step(location: DebugLocation): void { start(location, { kind: "step" }, true); },
    over(location: DebugLocation, flow?: StackFlow): void { start(location, { kind: flow === "call" ? "over" : "step" }, true); },
    out(location: DebugLocation): void {
      const frame = frames.at(-1);
      if (!frame) throw new Error("No observed caller. Step into a call before using Step out.");
      start(location, { kind: "out", frame: frame.id }, true);
    },
    runTo(location: DebugLocation, address: number, space?: string): void {
      if (!Number.isSafeInteger(address) || address < 0) throw new RangeError("The target address must be a non-negative safe integer.");
      start(location, { kind: "target", address, space });
    },
    pause(location: DebugLocation, detail?: string): void { finish("pause", location, detail); },
    watchpoint(location: DebugLocation, detail: string): void { finish("watchpoint", location, detail); },
    fail(location: DebugLocation, detail: string): void { frames.length = 0; trackingNote = "Execution failed; earlier callers are no longer tracked."; finish("error", location, detail); },
    reset(): void { frames.length = 0; trackingNote = undefined; plan = undefined; stop = undefined; skip = undefined; completed = false; },
    beforeStep(location: DebugLocation): boolean {
      if (stop) return true;
      const bypass = skip !== undefined && sameLocation(skip, location); skip = undefined;
      if (!bypass && breakpoints.some(point => point.enabled && matches(point, location))) finish("breakpoint", location);
      else if (plan?.kind === "target" && matches(plan, location)) finish("target", location);
      else if (completed && plan) finish(plan.kind, location);
      else if (plan && remaining === 0) finish("limit", location);
      return stop !== undefined;
    },
    observe(step: DebugStep): void {
      // Called for every successful instruction, including manual Step and ordinary Run.
      stop = undefined;
      if (plan) remaining--;
      if (step.resetsStack) loseTracking(step.after, "The program replaced the stack pointer; the caller is no longer known.");
      if (step.flow === "call" || step.flow === "interrupt") {
        if (frames.length === 128) loseTracking(step.after, "The observed call history reached its limit.");
        const frame = { id: nextFrame++, kind: step.flow, caller: { ...step.before }, entry: { ...step.after },
          returnAddress: step.returnAddress, stack: step.stackBefore };
        frames.push(frame);
        if (plan?.kind === "over" && plan.frame === undefined) plan.frame = frame.id;
      } else if (step.flow === "return" || step.flow === "interrupt-return") {
        const frame = frames.at(-1), kind = step.flow === "return" ? "call" : "interrupt";
        if (frame?.kind === kind && frame.stack === step.stackAfter && frame.returnAddress === step.after.address) {
          frames.pop();
          if ((plan?.kind === "over" || plan?.kind === "out") && plan.frame === frame.id) completed = true;
        } else loseTracking(step.after, "The return did not match the observed caller; the program may have changed its return address or stack.");
      }
      if (plan?.kind === "step") completed = true;
    },
  };
}

/** Preferences contain addresses and mapping filters, never machine state. */
export function decodeInstructionBreakpoints(saved: string | null, spaces: readonly string[], maximumAddress: number): readonly InstructionBreakpoint[] {
  try {
    const values: unknown = JSON.parse(saved ?? "[]");
    if (!Array.isArray(values) || values.length > 64) return [];
    const seen = new Set<string>();
    return values.filter((value): value is InstructionBreakpoint => {
      if (!value || typeof value !== "object" || !Number.isSafeInteger(value.address) || value.address < 0 || value.address > maximumAddress
        || typeof value.enabled !== "boolean" || value.space !== undefined && !spaces.includes(value.space)) return false;
      const key = `${value.address}:${value.space ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    }).map(({ address, space, enabled }) => ({ address, ...(space !== undefined && { space }), enabled }));
  } catch { return []; }
}
