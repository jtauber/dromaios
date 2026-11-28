import { snapshotRam } from "../../src/machines/snapshot.js";
import type { Coco, CocoVideoSignal } from "../../src/machines/6809/coco/runtime.js";
import { cocoHex as hex } from "./coco-inspection.js";
import type { CocoSessionState } from "./coco-session.js";
import { compareCocoScreens, compareCocoStates } from "./coco-state-comparison.js";
import { createScreenComparisonView } from "./screen-comparison-view.js";

/** Keep a paused observation on screen. Expanding a RAM page never reads the live machine. */
export function createCocoStateComparisonView(panel: HTMLElement, machine: () => Coco, actions: {
  browseRam(address: number): string | undefined;
  watchWrites(address: number): void;
  signal(): CocoVideoSignal;
  inspectPixel(x: number, y: number): string | undefined;
}) {
  const summary = panel.querySelector<HTMLElement>("[data-comparison-summary]")!;
  const output = panel.querySelector<HTMLElement>("[data-comparison-differences]")!;
  const message = panel.querySelector<HTMLElement>("[data-comparison-message]")!;
  const screen = createScreenComparisonView(panel, (x, y) => { message.textContent = actions.inspectPixel(x, y) ?? ""; });
  const count = (n: number, unit: string) => `${n.toLocaleString()} ${unit}${n === 1 ? "" : "s"}`;
  return {
    clear(): void { summary.textContent = message.textContent = ""; output.replaceChildren(); screen.clear(); },
    show(name: string, { hardware: saved }: CocoSessionState): void {
      const board = machine(), current = { cpu: board.cpu.snapshot(), ram: snapshotRam(board.ram) };
      const { cpu, pages, byteCount } = compareCocoStates(saved, current);
      const signal = actions.signal(), label = { direct: "Direct", composite: "Composite", "composite-reversed": "Composite (swapped)" }[signal];
      screen.show(label, () => compareCocoScreens(saved, board, signal));
      const flags = cpu.filter(field => field.kind === "flag").length;
      summary.textContent = `“${name}” → captured at $${hex(current.cpu.pc)} · `
        + [count(cpu.length - flags, "register"), count(flags, "flag"), count(byteCount, "RAM byte")].join(", ") + " changed.";
      if (saved.ram.length !== current.ram.length) {
        const last = Math.min(saved.ram.length, current.ram.length) - 1;
        summary.textContent += ` RAM capacity ${saved.ram.length / 1024} → ${current.ram.length / 1024} KiB. Compared $0000–$${hex(last)}.`;
      }
      for (const { target, width, before, after } of cpu) {
        const row = document.createElement("div");
        row.textContent = `${target}  ${hex(before, width)} → ${hex(after, width)}`; output.append(row);
      }
      for (const { base, bytes } of pages) {
        const page = document.createElement("details"), heading = document.createElement("summary");
        heading.textContent = `$${hex(base)}–$${hex(base + 255)} · ${count(bytes.length, "byte")}`;
        page.append(heading); output.append(page);
        // Even a completely different 64 KiB image needs only one heading per page.
        const showBytes = () => {
          if (!page.open || page.childElementCount > 1) return;
          for (const { address, before, after } of bytes) {
            const row = document.createElement("div"), link = document.createElement("button");
            link.type = "button"; link.className = "lab-memory-link"; link.textContent = "$" + hex(address);
            link.title = "Show physical RAM in Memory";
            link.onclick = () => { message.textContent = actions.browseRam(address) ?? ""; };
            const watch = document.createElement("button");
            watch.type = "button"; watch.textContent = "Watch writes";
            watch.setAttribute("aria-label", `Watch writes to $${hex(address)}`);
            watch.onclick = () => {
              try {
                actions.watchWrites(address);
                message.textContent = `Watching writes to physical RAM $${hex(address)}.`;
              } catch (cause) { message.textContent = (cause as Error).message; }
            };
            row.append(link, `  ${hex(before, 2)} → ${hex(after, 2)}  `, watch); page.append(row);
          }
        };
        page.addEventListener("toggle", showBytes);
        page.open = byteCount <= 16;
      }
    },
  };
}
