import { createApple2MemoryView } from "./apple2-memory-view.js";
import { createInspectorChoices } from "./inspector-controls.js";
import type { MemoryLabel } from "./apple2-explorer.js";
import { hex } from "./apple2-explorer.js";
import type { Apple2MemoryChange } from "./apple2-inspection.js";
import { createWorkspacePosition, monitorWorkspace, workspaceValue } from "./apple2-workspace-values.js";
import { memoryLink, memoryWatchButton } from "./memory-link.js";
import type { UpcomingMemoryAccesses } from "./apple2-memory-accesses.js";
import { markMemoryAccess } from "./memory-access-view.js";

export function createApple2ZeroPage(container: HTMLElement | null, labels: readonly MemoryLabel[], browse: (address: number) => void) {
  const hexView = createApple2MemoryView(container, 256);
  if (!container || !hexView) return undefined;
  const names = document.createElement("div"); names.className = "lab-workspace-values"; names.hidden = true;
  const notice = document.createElement("p"); notice.className = "lab-hint";
  notice.textContent = "Monitor workspace conventions; other software may reuse these bytes. Words are low byte first.";
  names.append(notice); container.after(names);
  const rows = monitorWorkspace(labels).map(label => {
    const row = document.createElement("div"), value = document.createElement("span"), name = document.createElement("span");
    row.className = "lab-workspace-value"; name.textContent = label.name; name.title = label.description;
    value.className = "lab-workspace-number";
    const description = document.createElement("span"); description.className = "lab-workspace-description";
    description.textContent = label.description;
    const watch = memoryWatchButton(label.address); watch.textContent = "Watch";
    description.append(" · ", watch);
    row.append(memoryLink(label.address, browse), value, name, description); names.append(row);
    return { ...label, row, value };
  });
  const position = createWorkspacePosition(rows), scroller = container.closest<HTMLElement>("[data-workspace-panel]")!;
  let displayedTarget: number | undefined;
  const positionKey = "dromaios:inspectors:apple2:zero-position";
  let savedPosition: "fixed" | "changes" = "fixed";
  try { if (window.localStorage.getItem(positionKey) === "changes") savedPosition = "changes"; } catch { /* Stay fixed. */ }
  const follow = createInspectorChoices("Named zero page position", [
    { value: "fixed", label: "FIX", title: "Fixed position" },
    { value: "changes", label: "CHG", title: "Follow changed workspace values" },
  ], savedPosition, mode => {
    reveal();
    try { window.localStorage.setItem(positionKey, mode); } catch { /* Keep the choice for this visit. */ }
  });
  function reveal(): void {
    if (names.hidden || follow.value !== "changes") return;
    const row = rows.find(row => row.address === displayedTarget)?.row;
    if (!row || !scroller.clientHeight) return;
    const bounds = row.getBoundingClientRect(), viewport = scroller.getBoundingClientRect();
    // Scroll only this inspector, and leave an already visible value in place.
    if (bounds.top < viewport.top) scroller.scrollTop += bounds.top - viewport.top;
    else if (bounds.bottom > viewport.bottom) scroller.scrollTop += bounds.bottom - viewport.bottom;
  }
  const key = "dromaios:inspectors:apple2:zero-view";
  let saved: "hex" | "names" = "hex";
  try { if (window.localStorage.getItem(key) === "names") saved = "names"; } catch { /* Use hex. */ }
  const choice = createInspectorChoices("Zero page view", [
    { value: "hex", label: "HEX", title: "Hexadecimal bytes" }, { value: "names", label: "NAMES", title: "Named Monitor workspace" },
  ], saved, mode => {
    show(mode);
    try { window.localStorage.setItem(key, mode); } catch { /* Keep the choice for this visit. */ }
  });
  function show(mode: string): void {
    container!.hidden = mode !== "hex"; names.hidden = mode !== "names"; hexView!.control.hidden = mode !== "hex";
    follow.element.hidden = mode !== "names"; reveal();
  }
  show(saved);
  const control = document.createElement("span"); control.className = "lab-inspector-controls";
  control.append(choice.element, hexView.control, follow.element);
  return {
    control,
    observe: position.observe,
    reset(): void { position.reset(); displayedTarget = undefined; },
    render(read: (address: number) => number | undefined, changes: ReadonlyMap<number, Apple2MemoryChange>, installed: boolean, upcoming: UpcomingMemoryAccesses): void {
      hexView.render(read, 0, changes, upcoming);
      notice.textContent = installed ? "Monitor workspace conventions; other software may reuse these bytes. Words are low byte first."
        : "No ROM installed. These are the Monitor's workspace conventions, shown against initial RAM.";
      for (const row of rows) {
        const value = workspaceValue(row.address, row.bytes, read);
        const before = workspaceValue(row.address, row.bytes, address => changes.get(address)?.before ?? read(address));
        const changed = value !== undefined && before !== undefined && value !== before;
        row.value.textContent = value === undefined ? "—" : `$${hex(value, row.bytes * 2)}`;
        row.value.classList.toggle("is-changed", changed);
        markMemoryAccess(row.value, upcoming, row.address, row.bytes,
          changed ? `Changed from $${hex(before, row.bytes * 2)} in the last instruction` : "");
      }
      displayedTarget = position.target; reveal();
    },
  };
}
