import { createBreakpointView } from "./breakpoint-view.js";
import { createDebuggerStatus } from "./debugger-status-view.js";
import { decodeXtBreakpoints, formatXtDebugAddress, parseXtDebugAddress } from "./xt-debugger.js";
import type { createXtDebugger } from "./xt-debugger.js";
import { parseXtAddress } from "./xt-inspection.js";
import { xtHex as hex } from "./8088-disassembly.js";

/** Shared stop editors, with XT address notation and navigation. */
export function createXtDebuggerView(root: HTMLElement, debug: ReturnType<typeof createXtDebugger>, options: {
  readonly ramMaximum: number;
  readonly changed: () => void;
  readonly memory: (address: number) => void;
}) {
  createBreakpointView(root.querySelector("[data-xt-breakpoints]"), {
    kind: "breakpoint", key: "dromaios:debugger:xt:breakpoints", maximum: 0xfffff,
    parseAddress: parseXtDebugAddress, formatAddress: formatXtDebugAddress, decode: decodeXtBreakpoints,
    values: () => debug.breakpoints, set: debug.setBreakpoints, changed: options.changed,
  });
  createBreakpointView(root.querySelector("[data-xt-watchpoints]"), {
    kind: "watchpoint", key: "dromaios:debugger:xt:watchpoints", maximum: options.ramMaximum,
    parseAddress: text => ({ address: parseXtAddress(text) }), formatAddress: point => "RAM $" + hex(point.address, 5),
    values: () => debug.watchpoints, set: debug.setWatchpoints, changed: options.changed,
  });
  const status = createDebuggerStatus(root, formatXtDebugAddress);
  const memory = root.querySelector<HTMLButtonElement>("[data-watchpoint-memory]")!;
  memory.onclick = () => { if (debug.hit) options.memory(debug.hit.address); };
  return {
    refresh(running: boolean): void {
      memory.hidden = !debug.hit;
      status.refresh(debug.stop, debug.request, running);
    },
  };
}
