import type { createCocoDebugger } from "./coco-debugger.js";
import { createBreakpointView } from "./breakpoint-view.js";
import { createDebuggerStatus } from "./debugger-status-view.js";

/** CoCo addresses and navigation supplied to the shared debugger tools. */
export function createCocoDebuggerView(root: HTMLElement, debug: ReturnType<typeof createCocoDebugger>, actions: {
  readonly changed: () => void;
  readonly code: (address: number) => void;
  readonly memory: (address: number) => void;
  readonly logicalMemory: (address: number) => void;
  readonly readHistory: (address: number) => void;
  readonly history: (address: number) => void;
  readonly watchesChanged: () => void;
}) {
  const breakpoints = createBreakpointView(root.querySelector("[data-coco-breakpoints]"), {
    kind: "breakpoint", key: "dromaios:debugger:coco:breakpoints", maximum: 0xffff,
    values: () => debug.breakpoints, set: debug.setBreakpoints, changed: actions.changed,
  })!;
  const writes = createBreakpointView(root.querySelector("[data-coco-watchpoints]"), {
    kind: "watchpoint", key: "dromaios:debugger:coco:watchpoints", maximum: 0xffff,
    values: () => debug.watchpoints, set: debug.setWatchpoints, changed: actions.watchesChanged, history: actions.history,
  })!;
  createBreakpointView(root.querySelector("[data-coco-read-watches]"), {
    kind: "watchpoint", key: "dromaios:debugger:coco:read-watches", maximum: 0xffff,
    values: () => debug.readWatchpoints, set: debug.setReadWatchpoints, changed: actions.watchesChanged, history: actions.readHistory,
  });
  const status = createDebuggerStatus(root);
  const code = root.querySelector<HTMLButtonElement>("[data-watchpoint-code]")!;
  const memory = root.querySelector<HTMLButtonElement>("[data-watchpoint-memory]")!;
  const navigation = root.querySelector<HTMLElement>("[data-watchpoint-navigation]")!;
  code.addEventListener("click", () => { if (debug.hit) actions.code(debug.hit.caller.address); });
  memory.addEventListener("click", () => {
    const hit = debug.hit;
    if (hit) (hit.kind === "read" ? actions.logicalMemory : actions.memory)(hit.address);
  });
  return {
    has: (address: number) => breakpoints.at(address)?.enabled ?? false,
    toggle: breakpoints.toggle,
    watchWrites: writes.add,
    refresh(running: boolean): void {
      const hit = debug.hit;
      navigation.hidden = code.disabled = memory.disabled = !hit;
      code.textContent = hit?.kind === "read" ? (hit.record.instruction ? "View reader" : "View interrupted PC") : "View writer";
      memory.textContent = hit?.kind === "read" ? "View read address" : "View written RAM";
      status.refresh(debug.stop, debug.request, running);
    },
  };
}
