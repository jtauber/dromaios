import type { StorageWrite } from "./change-log.js";
import type { MemoryRange, WatchAccess, WatchBoundary, createMemoryWatchHistory } from "./memory-watch-history.js";
import type { DebugLocation } from "./instruction-debugger.js";
import { memoryLink } from "./memory-link.js";

const hex = (value: number, width = 4) => value.toString(16).toUpperCase().padStart(width, "0");

/** Captured history and navigation share one view; adapters supply assembly and storage labels. */
export function createMemoryWatchHistoryView<Write extends StorageWrite>(root: HTMLElement,
  history: Pick<ReturnType<typeof createMemoryWatchHistory<Write>>, "entries" | "counts" | "capacity" | "clear">,
  options: {
    readonly assembly: (boundary: WatchBoundary) => string;
    readonly storageLabel: (write: Write) => string;
    readonly browseCode: (location: DebugLocation, bytes: readonly number[]) => string | undefined;
    readonly browseMemory: (address: number) => void;
    readonly stopOnAccess?: (entry: WatchAccess<Write>) => void;
    readonly stopOnValue?: (entry: WatchAccess<Write>) => void;
    readonly addressWidth?: number;
    readonly location?: (location: DebugLocation) => string;
  }) {
  const { browseCode, browseMemory } = options;
  const addressText = (address: number) => "$" + hex(address, options.addressWidth ?? 4);
  const panel = root.querySelector<HTMLElement>("[data-watch-history]");
  if (!panel) return undefined;
  const heading = panel.querySelector<HTMLElement>("[data-watch-history-heading]")!;
  const status = panel.querySelector<HTMLElement>("[data-watch-history-status]")!;
  const output = panel.querySelector<HTMLElement>("[data-watch-history-entries]")!;
  let selected: MemoryRange | undefined;
  function refresh(): void {
    if (!selected) return;
    const range = `${addressText(selected.address)}${selected.bytes === 2 ? `–${addressText(selected.address + 1)}` : ""}`;
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
      const location = options.location?.(entry.caller) ?? addressText(entry.caller.address);
      const code = memoryLink(entry.caller.address, () => {
        const notice = browseCode(entry.caller, entry.bytes);
        if (notice) status.textContent = notice;
      }, location);
      code.title = `Browse ${assembly} · observed ${entry.caller.space}`;
      code.setAttribute("aria-label", `Browse ${entry.event ? "interrupted PC" : "instruction"} ${location} from watch history`);
      const value = entry.storage ? `$${hex(entry.storage.before, 2)} → $${hex(entry.storage.after, 2)}` : `$${hex(entry.value, 2)}`;
      title.append(code, `  ${entry.kind === "read" ? "READ" : "WRITE"} `, memoryLink(entry.address, browseMemory, addressText(entry.address)), `  ${value}`);
      detail.textContent = `#${entry.sequence} · ${assembly}` + (entry.storage
        ? ` · ${options.storageLabel(entry.storage)}`
        : entry.kind === "write" ? " · bus value; no physical RAM write observed" : " · captured bus value");
      row.append(title, detail);
      const { stopOnAccess, stopOnValue } = options;
      if (stopOnAccess && entry.bytes.length && !entry.event) {
        const stopButton = (label: string, add: (entry: WatchAccess<Write>) => void, condition = "") => {
          const button = document.createElement("button");
          button.type = "button"; button.textContent = label;
          button.onclick = () => {
            try {
              add(entry);
              status.textContent = `Event stop enabled for ${location} · ${entry.kind.toUpperCase()} ${addressText(entry.address)}${condition}.`;
            } catch (cause) { status.textContent = (cause as Error).message; }
          };
          return button;
        };
        if (stopOnValue) {
          const group = document.createElement("div"), byte = "$" + hex(entry.value, 2);
          group.className = "basic-controls"; group.setAttribute("role", "group"); group.setAttribute("aria-label", "Stop on this access");
          group.append("Stop on this access", stopButton("Any value", stopOnAccess), stopButton(`This value (${byte})`, stopOnValue, ` = ${byte}`));
          row.append(group);
        } else row.append(stopButton("Stop on this access", stopOnAccess));
      }
      output.append(row);
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
