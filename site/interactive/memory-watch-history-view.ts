import type { StorageWrite } from "./change-log.js";
import type { MemoryRange, WatchBoundary, createMemoryWatchHistory } from "./memory-watch-history.js";
import type { DebugLocation } from "./instruction-debugger.js";
import { memoryLink } from "./memory-link.js";

const hex = (value: number, width = 4) => value.toString(16).toUpperCase().padStart(width, "0");

/** Captured history and navigation share one view; adapters supply assembly and storage labels. */
export function createMemoryWatchHistoryView<Write extends StorageWrite>(root: HTMLElement,
  history: Pick<ReturnType<typeof createMemoryWatchHistory<Write>>, "entries" | "counts" | "capacity" | "clear">,
  options: {
    readonly assembly: (boundary: WatchBoundary) => string;
    readonly storageLabel: (write: Write) => string;
    readonly browseCode: (location: DebugLocation) => string | undefined;
    readonly browseMemory: (address: number) => void;
  }) {
  const { browseCode, browseMemory } = options;
  const panel = root.querySelector<HTMLElement>("[data-watch-history]");
  if (!panel) return undefined;
  const heading = panel.querySelector<HTMLElement>("[data-watch-history-heading]")!;
  const status = panel.querySelector<HTMLElement>("[data-watch-history-status]")!;
  const output = panel.querySelector<HTMLElement>("[data-watch-history-entries]")!;
  let selected: MemoryRange | undefined;
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
      const assembly = entry.event ?? options.assembly(entry);
      const code = memoryLink(entry.caller.address, () => {
        const notice = browseCode(entry.caller);
        if (notice) status.textContent = notice;
      });
      code.title = `Browse ${assembly} · observed ${entry.caller.space}`;
      code.setAttribute("aria-label", `Browse ${entry.event ? "interrupted PC" : "instruction"} $${hex(entry.caller.address)} from watch history`);
      const value = entry.storage ? `$${hex(entry.storage.before, 2)} → $${hex(entry.storage.after, 2)}` : `$${hex(entry.value, 2)}`;
      title.append(code, `  ${entry.kind === "read" ? "READ" : "WRITE"} `, memoryLink(entry.address, browseMemory), `  ${value}`);
      detail.textContent = `#${entry.sequence} · ${assembly}` + (entry.storage
        ? ` · ${options.storageLabel(entry.storage)}`
        : entry.kind === "write" ? " · bus value; no physical RAM write observed" : " · captured bus value");
      row.append(title, detail); output.append(row);
    }
    if (!entries.length) output.textContent = "No retained accesses to this range. Add the watch before running to capture its use.";
  }
  panel.querySelector<HTMLButtonElement>("[data-watch-history-clear]")!.addEventListener("click", () => { history.clear(); refresh(); });
  return {
    refresh,
    select(watch: MemoryRange): void {
      selected = { address: watch.address, bytes: watch.bytes ?? 1 };
      panel.hidden = false; refresh(); heading.tabIndex = -1; heading.focus({ preventScroll: true });
      const scroller = panel.closest<HTMLElement>("[data-workspace-panel]")!;
      scroller.scrollTop += panel.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 10;
    },
  };
}
