import type { applesoftMemoryLayout } from "./apple2-applesoft.js";
import { hex } from "./apple2-explorer.js";
import { memoryLink } from "./memory-link.js";

export function createApplesoftMemoryView(panel: HTMLElement, browse: (address: number) => void) {
  const section = panel.querySelector<HTMLElement>("[data-applesoft-memory]")!;
  const status = section.querySelector<HTMLElement>("[data-basic-memory-status]")!;
  const bar = section.querySelector<HTMLElement>("[data-basic-memory-bar]")!;
  const table = section.querySelector<HTMLTableElement>("table")!, body = table.tBodies[0]!;
  let displayed: string | undefined;
  return (layout: ReturnType<typeof applesoftMemoryLayout> | undefined): void => {
    const key = JSON.stringify(layout);
    if (key === displayed) return;
    displayed = key; section.hidden = layout === undefined;
    body.replaceChildren(); bar.replaceChildren();
    if (!layout) return;
    status.textContent = layout.message ?? ""; status.hidden = !layout.message;
    table.hidden = bar.hidden = !layout.regions.length;
    for (const region of layout.regions) {
      const bytes = region.end - region.start, row = body.insertRow();
      row.dataset.region = region.name;
      const label = document.createElement("th"); label.scope = "row"; label.textContent = region.name; row.append(label);
      const range = row.insertCell();
      if (bytes) {
        const link = memoryLink(region.start, browse, `$${hex(region.start)}–$${hex(region.end - 1)}`);
        link.setAttribute("aria-label", `${region.name} at $${hex(region.start)} in Memory`);
        range.append(link);
      } else range.textContent = "—";
      row.insertCell().textContent = bytes.toLocaleString("en-US");
      const segment = document.createElement("span"); segment.dataset.region = region.name;
      segment.style.flex = `${bytes} 0 0`; segment.title = `${region.name} · ${bytes.toLocaleString("en-US")} bytes`;
      bar.append(segment);
    }
  };
}
