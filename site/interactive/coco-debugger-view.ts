import type { createCocoDebugger } from "./coco-debugger.js";
import { createBreakpointView } from "./breakpoint-view.js";
import { createDebuggerStatus } from "./debugger-status-view.js";

/** CoCo addresses and navigation supplied to the shared debugger tools. */
export function createCocoDebuggerView(root: HTMLElement, debug: ReturnType<typeof createCocoDebugger>, actions: {
  readonly changed: () => void;
  readonly code: (address: number) => void;
  readonly memory: (address: number) => void;
  readonly history: (address: number) => void;
  readonly watchesChanged: () => void;
}) {
  const breakpoints = createBreakpointView(root.querySelector("[data-coco-breakpoints]"), {
    kind: "breakpoint", key: "dromaios:debugger:coco:breakpoints", maximum: 0xffff,
    values: () => debug.breakpoints, set: debug.setBreakpoints, changed: actions.changed,
  })!;
  createBreakpointView(root.querySelector("[data-coco-watchpoints]"), {
    kind: "watchpoint", key: "dromaios:debugger:coco:watchpoints", maximum: 0x7fff,
    values: () => debug.watchpoints, set: debug.setWatchpoints, changed: actions.watchesChanged, history: actions.history,
  });
  const status = createDebuggerStatus(root);
  const code = root.querySelector<HTMLButtonElement>("[data-watchpoint-code]")!;
  const memory = root.querySelector<HTMLButtonElement>("[data-watchpoint-memory]")!;
  const navigation = root.querySelector<HTMLElement>("[data-watchpoint-navigation]")!;
  code.addEventListener("click", () => { if (debug.hit) actions.code(debug.hit.caller.address); });
  memory.addEventListener("click", () => { if (debug.hit) actions.memory(debug.hit.address); });
  return {
    has: (address: number) => breakpoints.at(address)?.enabled ?? false,
    toggle: breakpoints.toggle,
    refresh(running: boolean): void {
      code.disabled = memory.disabled = !debug.hit;
      navigation.hidden = !debug.hit;
      status.refresh(debug.stop, debug.request, running);
    },
  };
}
