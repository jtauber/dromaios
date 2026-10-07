import { createApple2WatchHistory } from "./apple2-watch-history.js";
import { disassemble6502, hex } from "./apple2-explorer.js";
import type { InstructionCatalogue } from "./apple2-explorer.js";
import type { DebugLocation } from "./instruction-debugger.js";
import type { MemoryWatch } from "./apple2-watches.js";
import { apple2RamRegions } from "./apple2-inspection.js";
import { memoryLink } from "./memory-link.js";

export function createApple2WatchHistoryView(root: HTMLElement, instructions: InstructionCatalogue,
  browseCode: (location: DebugLocation) => string | undefined, browseMemory: (address: number) => void) {
  const panel = root.querySelector<HTMLElement>("[data-watch-history]");
  if (!panel) return undefined;
  const history = createApple2WatchHistory(instructions);
  const heading = panel.querySelector<HTMLElement>("[data-watch-history-heading]")!;
  const status = panel.querySelector<HTMLElement>("[data-watch-history-status]")!;
  const output = panel.querySelector<HTMLElement>("[data-watch-history-entries]")!;
  let selected: Pick<MemoryWatch, "address" | "bytes"> | undefined;
  function refresh(): void {
    if (!selected) return;
    const range = `$${hex(selected.address)}${selected.bytes === 2 ? `–${hex(selected.address + 1)}` : ""}`;
    heading.textContent = `History · ${range}`;
    const entries = history.entries(selected);
    const { captured, discarded } = history.counts(selected);
    status.textContent = `${entries.length} accesses shown · ${captured.toLocaleString()} captured for this watch`
      + ` · latest ${history.capacity} retained per watch`
      + (discarded ? ` · ${discarded.toLocaleString()} older accesses discarded` : "");
    output.replaceChildren();
    for (const entry of entries) {
      const row = document.createElement("div"), title = document.createElement("div"), detail = document.createElement("div");
      row.className = "lab-device-event"; title.className = "lab-device-transfer"; detail.className = "lab-hint";
      const assembly = disassemble6502(entry.caller.address, entry.bytes, instructions);
      const code = memoryLink(entry.caller.address, () => {
        const notice = browseCode(entry.caller);
        if (notice) status.textContent = notice;
      });
      code.title = `Browse ${assembly} · observed ${entry.caller.space}`;
      code.setAttribute("aria-label", `Browse instruction $${hex(entry.caller.address)} from watch history`);
      const value = entry.storage ? `$${hex(entry.storage.before, 2)} → $${hex(entry.storage.after, 2)}` : `$${hex(entry.value, 2)}`;
      title.append(code, `  ${entry.kind === "read" ? "READ" : "WRITE"} `, memoryLink(entry.address, browseMemory), `  ${value}`);
      detail.textContent = `#${entry.sequence} · ${assembly}` + (entry.storage
        ? ` · ${apple2RamRegions.find(region => region.part === entry.storage!.region)!.label}`
        : entry.kind === "write" ? " · bus value; no physical RAM write observed" : " · captured bus value");
      row.append(title, detail); output.append(row);
    }
    if (!entries.length) output.textContent = "No retained accesses to this range. Add the watch before running to capture its use.";
  }
  panel.querySelector<HTMLButtonElement>("[data-watch-history-clear]")!.addEventListener("click", () => { history.clear(); refresh(); });
  return {
    observe: history.observe,
    configure: history.configure,
    reset: history.reset,
    refresh,
    select(watch: Pick<MemoryWatch, "address" | "bytes">): void {
      selected = { address: watch.address, bytes: watch.bytes ?? 1 };
      panel.hidden = false; refresh(); heading.tabIndex = -1; heading.focus({ preventScroll: true });
      const scroller = panel.closest<HTMLElement>("[data-workspace-panel]")!;
      scroller.scrollTop += panel.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 10;
    },
  };
}
