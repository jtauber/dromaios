import { createBreakpointView } from "./breakpoint-view.js";
import { createDebuggerStatus } from "./debugger-status-view.js";
import { decodeXtBreakpoints, formatXtDebugAddress, parseXtDebugAddress } from "./xt-debugger.js";
import type { createXtDebugger } from "./xt-debugger.js";
import { parseXtAddress } from "./xt-inspection.js";
import { xtHex as hex } from "./8088-disassembly.js";
import type { RomGuide } from "./rom-guide.js";

/** Shared stop editors, with XT address notation and navigation. */
export function createXtDebuggerView(root: HTMLElement, debug: ReturnType<typeof createXtDebugger>, options: {
  readonly ramMaximum: number;
  readonly changed: () => void;
  readonly memory: (address: number) => void;
  readonly history: (address: number) => void;
  readonly watchesChanged: () => void;
  readonly labels: RomGuide["labels"];
}) {
  createBreakpointView(root.querySelector("[data-xt-breakpoints]"), {
    kind: "breakpoint", key: "dromaios:debugger:xt:breakpoints", maximum: 0xfffff,
    parseAddress: parseXtDebugAddress, formatAddress: formatXtDebugAddress, decode: decodeXtBreakpoints,
    values: () => debug.breakpoints, set: debug.setBreakpoints, changed: options.changed,
  });
  const labels = options.labels.filter(label => label.scope === "workspace").flatMap(label =>
    Array.from({ length: label.bytes ?? 1 }, (_, byte) => ({ address: parseInt(label.address, 16) + byte,
      name: label.name + (byte ? "+1" : ""), description: label.description + (label.bytes === 2 ? ` (${byte ? "high" : "low"} byte)` : "") })));
  const watches = createBreakpointView(root.querySelector("[data-xt-watchpoints]"), {
    kind: "watchpoint", key: "dromaios:debugger:xt:watchpoints", maximum: options.ramMaximum,
    parseAddress: text => ({ address: parseXtAddress(text) }),
    formatAddress: point => {
      const label = labels.find(label => label.address === point.address);
      return "RAM $" + hex(point.address, 5) + (label ? " · " + label.name : "");
    },
    values: () => debug.watchpoints, set: debug.setWatchpoints, changed: options.watchesChanged, history: options.history,
  })!;
  const choice = root.querySelector<HTMLSelectElement>("[data-bios-byte]")!;
  const description = root.querySelector<HTMLElement>("[data-bios-byte-description]")!;
  for (const label of labels) choice.add(new Option(`${label.name} · ${hex(label.address, 5)}`, String(label.address)));
  choice.onchange = () => { description.textContent = labels[choice.selectedIndex]!.description; };
  description.textContent = labels[0]?.description ?? "";
  root.querySelector<HTMLButtonElement>("[data-bios-byte-memory]")!.onclick = () => options.memory(Number(choice.value));
  root.querySelector<HTMLButtonElement>("[data-bios-byte-watch]")!.onclick = () => {
    try { watches.add(Number(choice.value)); }
    catch (cause) { description.textContent = (cause as Error).message; }
  };
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
