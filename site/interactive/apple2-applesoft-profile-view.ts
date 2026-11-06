import { applesoftStatementText, resolveApplesoftSource } from "./apple2-applesoft.js";
import type { ApplesoftListing, ApplesoftSourcePosition } from "./apple2-applesoft.js";
import type { ApplesoftProfile } from "./apple2-applesoft-profile.js";

export function createApplesoftProfileView(panel: HTMLElement, profile: ApplesoftProfile,
  listing: () => ApplesoftListing, reveal: (address: number) => void) {
  const table = panel.querySelector<HTMLTableElement>("[data-basic-profile]")!, body = table.tBodies[0]!;
  const status = panel.querySelector<HTMLElement>("[data-basic-profile-status]")!;
  const clear = panel.querySelector<HTMLButtonElement>("[data-basic-profile-clear]")!;
  let displayed: string | undefined, source: ApplesoftListing | undefined;
  function link(point: ApplesoftSourcePosition, caller: boolean): HTMLButtonElement {
    const button = document.createElement("button"); button.type = "button"; button.className = "lab-memory-link";
    button.textContent = caller ? `${point.line} · ${applesoftStatementText(point.statement)}` : String(point.line);
    button.title = `Show line ${point.line}, statement ${point.index + 1} in Applesoft listing`;
    button.disabled = !resolveApplesoftSource(listing(), point);
    button.addEventListener("click", () => {
      const current = resolveApplesoftSource(listing(), point);
      if (current) reveal(current.address); else refresh();
    });
    return button;
  }
  function refresh(): void {
    const entries = profile.entries(), current = listing(), key = JSON.stringify(entries);
    if (displayed === key && source === current) return;
    displayed = key; source = current;
    clear.disabled = !entries.length; table.hidden = !entries.length;
    status.hidden = !!entries.length;
    body.replaceChildren();
    for (const entry of entries) {
      const row = body.insertRow();
      row.insertCell().append(link(entry.target, false));
      row.insertCell().append(link(entry.caller, true));
      for (const value of [entry.calls, entry.returned, entry.active]) row.insertCell().textContent = String(value);
    }
  }
  clear.addEventListener("click", () => { profile.clear(); refresh(); });
  return refresh;
}
