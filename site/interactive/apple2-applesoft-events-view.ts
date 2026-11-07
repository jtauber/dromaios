import { applesoftStatementText, resolveApplesoftSource } from "./apple2-applesoft.js";
import type { ApplesoftListing, ApplesoftSourcePosition } from "./apple2-applesoft.js";
import type { ApplesoftEvent, ApplesoftEvents } from "./apple2-applesoft-events.js";
import { hex } from "./apple2-explorer.js";

export function createApplesoftEventsView(root: HTMLElement, history: ApplesoftEvents, listing: () => ApplesoftListing,
  memory: (address: number) => void, reveal: (address: number) => void) {
  const panel = root.querySelector<HTMLElement>('[data-workspace-panel="applesoft-events"]');
  if (!panel) return;
  const list = panel.querySelector("ol")!, record = panel.querySelector<HTMLInputElement>("[data-basic-events-record]")!;
  const clear = panel.querySelector<HTMLButtonElement>("[data-basic-events-clear]")!;
  const status = panel.querySelector<HTMLElement>("[data-basic-events-status]")!;
  let latest: ApplesoftEvent | undefined, displayed: ApplesoftListing | undefined, total = 0;
  function describe(): void {
    status.textContent = `${history.recording ? "Recording" : "Recording off"} · ${total} events`
      + (total > 200 ? ` · last 200 retained` : "");
  }
  function memoryLink(address: number, label: string): HTMLButtonElement {
    const button = document.createElement("button"); button.type = "button"; button.className = "lab-memory-link";
    button.textContent = label; button.title = `Browse current Memory at $${hex(address)}`;
    button.setAttribute("aria-label", `${label} at $${hex(address)} in Memory`);
    button.onclick = () => memory(address); return button;
  }
  function sourceLink(point: ApplesoftSourcePosition, label: string): HTMLButtonElement {
    const button = document.createElement("button"); button.type = "button"; button.className = "lab-memory-link";
    button.textContent = label;
    const check = () => {
      const current = resolveApplesoftSource(listing(), point);
      button.disabled = !current;
      button.title = current ? `Show line ${point.line}, statement ${point.index + 1} in Applesoft listing` : "Statement unavailable in the current listing";
      return current;
    };
    check();
    button.onclick = () => { const current = check(); if (current) reveal(current.address); };
    return button;
  }
  const refresh = (): void => {
    if (panel.hidden) return;
    const source = listing();
    if (latest === history.entries.at(-1) && displayed === source) return;
    const follow = list.scrollHeight - list.clientHeight - list.scrollTop <= 2;
    list.replaceChildren();
    for (const event of history.entries) {
      const row = document.createElement("li"), detail = document.createElement("div"), origin = document.createElement("div");
      const kind = document.createElement("strong"); kind.textContent = event.kind; detail.append(kind, " ");
      if (event.kind === "READ") {
        detail.append(memoryLink(event.variable.address, event.variable.name), ` ← ${event.variable.value} · `,
          memoryLink(event.data.address, `DATA $${hex(event.data.address)}`), " · ", sourceLink(event.data.source, `line ${event.data.source.line}`));
        if (event.variable.contentsAddress !== undefined) detail.append(" · ", memoryLink(event.variable.contentsAddress, "characters"));
      } else if (event.kind === "RESTORE") {
        detail.append(`$${hex(event.previous)} → `, memoryLink(event.address, `$${hex(event.address)}`));
      } else {
        detail.append(memoryLink(event.address, `$${hex(event.address)}`), ` ${event.kind === "PEEK" ? "→" : "←"} $${hex(event.value, 2)} (${event.value})`);
      }
      const point = event.origin.source;
      origin.className = "lab-hint";
      if (point) origin.append(sourceLink(point, `${point.line} · ${applesoftStatementText(point.statement)}`));
      else origin.textContent = event.origin.line >= 0xff00 ? "Direct command" : `Line ${event.origin.line} · source unavailable`;
      row.append(detail, origin); list.append(row);
    }
    latest = history.entries.at(-1); displayed = source; total = history.total;
    list.start = total - history.entries.length + 1;
    clear.disabled = total === 0; describe();
    if (follow) list.scrollTop = list.scrollHeight;
  };
  record.onchange = () => { history.record(record.checked); describe(); };
  clear.onclick = () => { history.clear(); displayed = undefined; refresh(); };
  return { refresh };
}
