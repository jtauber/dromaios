import { applesoftStatementText, resolveApplesoftSource } from "./apple2-applesoft.js";
import type { ApplesoftListing, ApplesoftSourcePosition } from "./apple2-applesoft.js";
import type { ApplesoftHistory } from "./apple2-applesoft-history.js";

export function createApplesoftHistoryView(root: HTMLElement, history: ApplesoftHistory, listing: () => ApplesoftListing, reveal: (address: number) => void) {
  const panel = root.querySelector<HTMLElement>('[data-workspace-panel="applesoft-history"]');
  if (!panel) return;
  const list = panel.querySelector("ol")!, clear = panel.querySelector<HTMLButtonElement>("[data-basic-history-clear]")!;
  const status = panel.querySelector<HTMLElement>("[data-basic-history-status]")!;
  const rows = new Map<ApplesoftSourcePosition, HTMLLIElement>();
  let displayed: ApplesoftListing | undefined, latest: ApplesoftSourcePosition | undefined;
  const refresh = (): void => {
    if (panel.hidden) return;
    const { visits, total } = history, source = listing();
    if (displayed === source && latest === visits.at(-1)) return;
    const follow = list.scrollHeight - list.clientHeight - list.scrollTop <= 2;
    for (const [visit, row] of rows) if (!visits.includes(visit)) { row.remove(); rows.delete(visit); }
    for (const visit of visits) {
      let row = rows.get(visit);
      if (row && displayed === source) continue;
      if (!row) {
        row = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button"; button.className = "lab-memory-link";
        button.textContent = `${visit.line} · ${applesoftStatementText(visit.statement)}`;
        button.addEventListener("click", () => {
          // A held view can outlive an edit. Check the current source even for a visible link.
          const current = resolveApplesoftSource(listing(), visit);
          if (current) reveal(current.address); else refresh();
        });
        row.append(button); list.append(row); rows.set(visit, row);
      }
      const button = row.firstElementChild as HTMLButtonElement;
      button.disabled = !resolveApplesoftSource(source, visit);
      button.title = button.disabled ? "Statement unavailable in the current listing" : "Show statement in Applesoft listing";
    }
    list.start = total - visits.length + 1;
    clear.disabled = total === 0;
    status.textContent = !total ? "No numbered statements recorded yet."
      : total > visits.length ? `Showing the last ${visits.length} of ${total.toLocaleString()} visits.` : "";
    status.hidden = !status.textContent;
    if (follow) list.scrollTop = list.scrollHeight;
    displayed = source; latest = visits.at(-1);
  };
  clear.addEventListener("click", () => { history.clear(); refresh(); });
  return { refresh };
}
