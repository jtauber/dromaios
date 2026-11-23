import { createXtEventStopsView } from "./xt-event-stops-view.js";
import { createBreakpointView } from "./breakpoint-view.js";
import { createDebuggerStatus } from "./debugger-status-view.js";
import { decodeXtBreakpoints, formatXtDebugAddress, parseXtDebugAddress, xtDebugLocation } from "./xt-debugger.js";
import { egaPlanes } from "./xt-ega-plane-watch.js";
import type { DebugLocation } from "./instruction-debugger.js";
import type { createXtDebugger, XtMemoryWatchReport } from "./xt-debugger.js";
import type { FetchedInstruction } from "../../src/components/cpus/execution-records.js";
import { parseXtAddress } from "./xt-inspection.js";
import { xtHex as hex } from "./8088-disassembly.js";
import type { RomGuide } from "./rom-guide.js";
import type { DosServices } from "./xt-dos-services.js";

/** Shared stop editors, with XT address notation and navigation. */
export function createXtDebuggerView(root: HTMLElement, debug: ReturnType<typeof createXtDebugger>, options: {
  readonly ramMaximum: number;
  readonly changed: () => void;
  readonly memory: (address: number) => void;
  readonly selection: { readonly inputAddress: number | undefined; applyAddress(): number | undefined };
  readonly code: (location: DebugLocation, instruction?: FetchedInstruction) => void;
  readonly history: (address: number) => void;
  readonly watchesChanged: () => void;
  readonly labels: RomGuide["labels"];
  readonly dos: DosServices;
}) {
  createBreakpointView(root.querySelector("[data-xt-breakpoints]"), {
    kind: "breakpoint", key: "dromaios:debugger:xt:breakpoints", maximum: 0xfffff,
    parseAddress: parseXtDebugAddress, formatAddress: formatXtDebugAddress, decode: decodeXtBreakpoints,
    values: () => debug.breakpoints, set: debug.setBreakpoints, changed: options.changed,
  });
  const eventStops = createXtEventStopsView(root, {
    values: () => debug.eventStops, set: debug.setEventStops, changed: options.changed, dos: options.dos,
  });
  const planes = createBreakpointView(root.querySelector("[data-xt-plane-watches]"), {
    kind: "watchpoint", key: "dromaios:debugger:xt:ega:plane-watches", maximum: 0xffff,
    spaces: egaPlanes.map(name => ({ value: name, label: name, accepts: () => true })),
    formatAddress: p => `${p.space}:$${hex(p.address, 4)}`,
    values: () => debug.planeWatchpoints, set: debug.setPlaneWatchpoints, changed: options.changed,
  });
  const planeWriter = root.querySelector<HTMLButtonElement>("[data-plane-writer]");
  if (planeWriter) planeWriter.onclick = () => {
    if (debug.planeHit && !debug.planeHit.dma) options.code(xtDebugLocation(debug.planeHit.record.before));
  };
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
    values: () => debug.watchpoints, set: debug.setWatchpoints, history: options.history,
    changed: () => { options.watchesChanged(); refreshMemoryWatches(); },
  })!;
  const reads = createBreakpointView(root.querySelector("[data-xt-read-watches]"), {
    kind: "watchpoint", key: "dromaios:debugger:xt:read-watchpoints", maximum: 0xfffff,
    parseAddress: text => ({ address: parseXtAddress(text) }), formatAddress: formatXtDebugAddress,
    values: () => debug.readWatchpoints, set: debug.setReadWatchpoints, changed: options.changed,
  })!;
  const watchReads = root.querySelector<HTMLButtonElement>("[data-memory-watch-reads]")!;
  const watchWrites = root.querySelector<HTMLButtonElement>("[data-memory-watch-writes]")!;
  const selected = root.querySelector<HTMLElement>("[data-memory-watch-address]")!;
  function refreshMemoryWatches(): void {
    const address = options.selection.inputAddress, text = address === undefined ? "" : "$" + hex(address, 5);
    watchReads.disabled = address === undefined;
    watchWrites.disabled = address === undefined || address > options.ramMaximum;
    watchReads.setAttribute("aria-pressed", String(address !== undefined && !!reads.at(address)?.enabled));
    watchWrites.setAttribute("aria-pressed", String(address !== undefined && !!watches.at(address)?.enabled));
    if (selected.textContent !== text) selected.textContent = text;
  }
  for (const [button, editor] of [[watchReads, reads], [watchWrites, watches]] as const) {
    button.onclick = () => {
      const address = options.selection.applyAddress();
      if (address !== undefined) editor.toggle(address);
    };
  }
  function watchReport(resultSelector: string, linkSelector: string, hit: () => XtMemoryWatchReport | undefined) {
    const result = root.querySelector<HTMLElement>(resultSelector)!, link = root.querySelector<HTMLButtonElement>(linkSelector)!;
    link.onclick = () => {
      const report = hit();
      if (report?.instruction) options.code(report.caller, report.instruction);
    };
    return () => {
      const report = hit(), detail = report?.detail ?? "";
      if (result.textContent !== detail) result.textContent = detail;
      result.hidden = !report; link.hidden = !report?.instruction;
    };
  }
  const showRead = watchReport("[data-memory-read-hit]", "[data-memory-reader]", () => debug.readHit);
  const showWrite = watchReport("[data-memory-write-hit]", "[data-memory-writer]", () => debug.hit);
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
    refreshMemoryWatches,
    watchPlane(plane: number, offset: number): void { planes?.add(offset, egaPlanes[plane]); },
    addEventStop: eventStops.add,
    refresh(running: boolean): void {
      refreshMemoryWatches(); showRead(); showWrite();
      if (planeWriter) planeWriter.hidden = !debug.planeHit || debug.planeHit.dma;
      memory.hidden = !debug.hit;
      status.refresh(debug.stop, debug.request, running);
    },
  };
}
