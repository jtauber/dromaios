import { describeXtEvent, xtEventCondition } from "./xt-event-stops.js";
import type { XtEventCondition } from "./xt-event-stops.js";
import type { Cpu8088Snapshot } from "../../src/components/cpus/generated/8088-cpu.js";
import type { XtIo } from "../../src/machines/8088/pc-xt/io.js";
import type { Catalogue8088 } from "./8088-disassembly.js";
import { xtHex as hex } from "./8088-disassembly.js";
import type { DebugLocation } from "./instruction-debugger.js";
import { memoryLink } from "./memory-link.js";
import { xtHistoryAssembly } from "./xt-history.js";
import type { createXtIoTrace } from "./xt-io-trace.js";

export interface XtIoLabels {
  readonly ports: readonly { readonly address: string; readonly input?: string; readonly output?: string }[];
  readonly irqs: readonly string[];
}

/** Present captured transfers and detached state. This view has no guest bus connection. */
export function createXtIoView(root: HTMLElement, trace: ReturnType<typeof createXtIoTrace>, cpu: Catalogue8088,
  labels: XtIoLabels, browse: (location: DebugLocation) => void, stopOn: (condition: XtEventCondition) => void, browseMemory: (address: number) => void) {
  const at = <T extends HTMLElement>(name: string) => root.querySelector<T>(`[data-${name}]`)!;
  const record = at<HTMLInputElement>("io-recording"), ports = at<HTMLInputElement>("io-ports"), interrupts = at<HTMLInputElement>("io-interrupts");
  const dma = at<HTMLInputElement>("io-dma");
  const portLabels = new Map(labels.ports.map(port => [parseInt(port.address, 16), port]));
  let lastTrace: string | undefined;
  function code(location: DebugLocation, prefix = ""): HTMLButtonElement {
    const link = memoryLink(location.address, () => browse(location), prefix + location.space.replace("CS:IP ", ""));
    link.title = `Browse ${location.space} · physical $${hex(location.address, 5)}`;
    link.setAttribute("aria-label", link.title);
    return link;
  }
  function refreshTrace(): void {
    const key = `${trace.captured}:${trace.recording}:${ports.checked}:${interrupts.checked}:${dma.checked}`;
    if (key === lastTrace) return;
    lastTrace = key;
    const entries = trace.entries().filter(({ transfer }) => transfer.kind === "dma" ? dma.checked : "port" in transfer ? ports.checked : interrupts.checked);
    at("io-status").textContent = `${trace.recording ? "Recording" : "Recording paused"} · ${entries.length} shown · ${trace.capacity} events retained at most`
      + (trace.discarded ? ` · ${trace.discarded.toLocaleString()} older discarded` : "");
    const output = at("io-entries"); output.replaceChildren();
    for (const entry of [...entries].reverse()) {
      const row = document.createElement("div"), heading = document.createElement("div"), detail = document.createElement("div");
      row.className = "lab-device-event"; heading.className = "lab-device-transfer"; detail.className = "lab-hint";
      const transfer = entry.transfer;
      if (transfer.kind === "dma") {
        const ram = memoryLink(transfer.address, () => browseMemory(transfer.address), `RAM $${hex(transfer.address, 5)}`);
        const disk = `disk +$${hex(transfer.offset, 5)}`;
        heading.append("DMA2 · ");
        if (transfer.direction === "disk-to-memory") heading.append(disk, " → ", ram);
        else heading.append(ram, " → ", disk);
        heading.append(` · $${hex(transfer.value, 2)}${transfer.terminal ? " · terminal count" : ""}`);
      } else heading.append(code(entry.caller), "  ");
      if ("port" in transfer) {
        const label = portLabels.get(transfer.port)?.[transfer.kind];
        heading.append(`${transfer.kind === "input" ? "IN" : "OUT"} $${hex(transfer.port, 4)} · $${hex(transfer.value, 2)}${label ? ` · ${label}` : ""}`);
      } else if (transfer.kind === "acknowledge") heading.append(`INTA · vector $${hex(transfer.value, 2)}`);
      else if (transfer.kind !== "dma") {
        heading.append(transfer.kind === "iret" ? "IRET → " : `${transfer.source.toUpperCase()} · vector $${hex(transfer.vector, 2)} → `,
          code(transfer.target));
      }
      const assembly = entry.bytes.length ? xtHistoryAssembly(cpu, entry.caller, entry.bytes) : "External CPU boundary";
      detail.append(`#${entry.sequence} · ${entry.ticks.toLocaleString()} ticks at boundary end · `);
      if (transfer.kind === "dma") detail.append("DMA precedes CPU at ", code(entry.caller));
      else detail.append(assembly);
      const stop = document.createElement("button"), condition = xtEventCondition(transfer);
      stop.type = "button"; stop.textContent = "Stop on this event";
      stop.title = `Add ${describeXtEvent(condition)}; stops after a complete boundary.`;
      stop.setAttribute("aria-label", `Stop on this event: ${describeXtEvent(condition)}`);
      stop.onclick = () => stopOn(condition);
      row.append(heading, detail, stop); output.append(row);
    }
    if (!entries.length) output.textContent = "No captured events match these filters. Enable Record, then Step or Run.";
  }
  record.addEventListener("change", () => { trace.recording = record.checked; refreshTrace(); });
  for (const control of [ports, interrupts, dma]) control.addEventListener("change", refreshTrace);
  at("io-clear").addEventListener("click", () => { trace.clear(); lastTrace = undefined; refreshTrace(); });
  return {
    refreshTrace,
    reset(): void { trace.clear(); lastTrace = undefined; },
    refreshPic(state: ReturnType<XtIo["interruptState"]>, cpu: Cpu8088Snapshot): void {
      const { pic, vector } = state;
      const phases = ["Not initialized", "Awaiting ICW2", "Awaiting ICW4", "Ready"];
      at("pic-summary").textContent = `${phases[pic.phase]} · base $${hex(pic.base, 2)} · IRR $${hex(pic.irr, 2)} · IMR $${hex(pic.imr, 2)} · ISR $${hex(pic.isr, 2)} · port 20 reads ${pic.read_isr ? "ISR" : "IRR"}`;
      at("pic-cpu").textContent = `PIC INT ${vector === null ? "low" : `high · selected vector $${hex(vector, 2)}`}`
        + ` · CPU IF ${+cpu.flags.if} · INTR delay ${+cpu.interruptDeferred} · recognition delay ${+cpu.recognitionDeferred}`
        + ` · board sample delay ${+state.intrRaisedDuringCpu} · trap pending ${+cpu.trapPending} · NMI pending ${+state.nmiPending}`;
      const rows = at("pic-lines"); rows.replaceChildren();
      for (let line = 0; line < 8; line++) {
        const row = document.createElement("tr"), mask = 1 << line;
        if (vector !== null && (vector & 7) === line) row.className = "xt-irq-selected";
        for (const text of [`IRQ${line}`, labels.irqs[line]!, pic.phase === 3 ? hex(pic.base | line, 2) : "—",
          ...[pic.levels, pic.irr, pic.imr, pic.isr].map(bits => String(Number(Boolean(bits & mask))))]) {
          const cell = document.createElement("td"); cell.textContent = text; row.append(cell);
        }
        rows.append(row);
      }
    },
  };
}
