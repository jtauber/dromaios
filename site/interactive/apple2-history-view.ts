import { formatApple2Instruction, formatApple2Trace } from "./apple2-explorer.js";
import type { Apple2TraceEntry, InstructionCatalogue, AddressLabel } from "./apple2-explorer.js";

/** Captured execution only: selecting a step never reads or changes the live machine. */
export function createApple2History(root: HTMLElement, catalogue: {
  readonly instructions: InstructionCatalogue; readonly routines: readonly AddressLabel[];
}) {
  const panel = root.querySelector<HTMLElement>("[data-execution-history]");
  if (panel === null) return undefined;
  const element = <T extends HTMLElement>(name: string) => panel.querySelector<T>(`[data-history-${name}]`)!;
  const list = element("list"), detail = element("detail"), status = element("status");
  const follow = element<HTMLInputElement>("follow");
  let entries: readonly Apple2TraceEntry[] = [], latest: readonly Apple2TraceEntry[] = [], selected: Apple2TraceEntry | undefined;
  // Key each button by its captured record, so repeated visits to one address remain distinct.
  const buttons = new Map<Apple2TraceEntry, HTMLButtonElement>();
  follow.addEventListener("change", () => { if (follow.checked) entries = latest; render(); });

  function render(): void {
    if (entries.length === 0) { selected = undefined; follow.checked = true; }
    else if (follow.checked) selected = entries[0];
    for (const [entry, button] of buttons) {
      if (!entries.includes(entry)) { button.remove(); buttons.delete(entry); }
    }
    for (const [index, entry] of entries.entries()) {
      let button = buttons.get(entry);
      if (button === undefined) {
        button = document.createElement("button"); button.type = "button";
        button.textContent = formatApple2Instruction(entry, catalogue.instructions);
        button.addEventListener("click", () => { selected = entry; follow.checked = false; render(); });
        buttons.set(entry, button);
      }
      button.setAttribute("aria-pressed", String(selected === entry));
      if (list.children[index] !== button) list.insertBefore(button, list.children[index] ?? null);
    }
    status.textContent = selected === undefined ? "No instructions recorded yet. Step to begin."
      : follow.checked ? "Latest instruction"
      : entries.includes(selected) ? "Selected instruction" : "Selected instruction · outside the latest twelve";
    detail.textContent = selected === undefined ? "" : formatApple2Trace(selected, catalogue.instructions, catalogue.routines);
    follow.disabled = entries.length === 0;
  }
  return {
    refresh(records: readonly Apple2TraceEntry[], update: boolean): void {
      latest = [...records].reverse();
      if (update) { entries = latest; render(); }
    },
  };
}
