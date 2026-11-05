import type { Cpu6502StepRecord } from "../../src/components/cpus/generated/6502-cpu.js";
import { applesoftCursor } from "./apple2-applesoft.js";
import type { ApplesoftListing, ApplesoftSourcePosition } from "./apple2-applesoft.js";
import type { ApplesoftHistory } from "./apple2-applesoft-history.js";
import type { createApplesoftBreakpoints } from "./apple2-applesoft-breakpoints.js";
import { apple2DebugLocation } from "./apple2-debugger.js";
import { applesoftStatement } from "./apple2-applesoft-step.js";
import { hex } from "./apple2-explorer.js";
import type { createApple2Session } from "./apple2-session.js";
import { memoryLink } from "./memory-link.js";
import type { DebugStop } from "./instruction-debugger.js";

type Machine = ReturnType<typeof createApple2Session>["machine"];

export function createApplesoftView(root: HTMLElement, browse: (address: number) => void, points: ReturnType<typeof createApplesoftBreakpoints>,
  history: ApplesoftHistory) {
  const panel = root.querySelector<HTMLElement>('[data-workspace-panel="applesoft"]');
  if (!panel) return;
  const status = panel.querySelector<HTMLElement>("[data-applesoft-status]")!;
  const source = panel.querySelector<HTMLElement>("[data-applesoft-source]")!;
  const showCounts = panel.querySelector<HTMLInputElement>("[data-applesoft-show-counts]")!;
  const clearCounts = panel.querySelector<HTMLButtonElement>("[data-applesoft-clear-counts]")!;
  const counters = new Map<HTMLElement, ApplesoftSourcePosition>();
  let countRevision = -1;
  const tokens = new Map<number, { button: HTMLButtonElement; line: number }>();
  const statements = new Map<number, { span: HTMLSpanElement; line: number }>();
  let displayed: ApplesoftListing | undefined;
  let revision = -1;
  let marked: HTMLElement | undefined;
  function refreshCounts(): void {
    if (!showCounts.checked || countRevision === history.countRevision) return;
    for (const [badge, point] of counters) {
      const count = history.count(point);
      if (badge.dataset.count === String(count)) continue;
      badge.dataset.count = String(count);
      const label = `Line ${point.line}, statement ${point.index + 1}, ${count} ${count === 1 ? "visit" : "visits"}`;
      badge.title = label; badge.setAttribute("aria-label", label);
    }
    countRevision = history.countRevision;
  }
  showCounts.addEventListener("change", () => {
    source.classList.toggle("show-counts", showCounts.checked);
    clearCounts.hidden = !showCounts.checked;
    refreshCounts();
  });
  clearCounts.addEventListener("click", () => { history.clearCounts(); refreshCounts(); });
  function render(listing: ApplesoftListing): void {
    tokens.clear(); statements.clear(); marked = undefined;
    counters.clear(); countRevision = -1;
    const fragment = document.createDocumentFragment();
    for (const line of listing.lines) {
      const row = document.createElement("div");
      row.append(String(line.number), " ");
      for (const [index, statement] of line.statements.entries()) {
        if (statement.colonBefore) row.append(":");
        if (statement.parts.some(part => part.text.trim())) {
          const marker = document.createElement("button");
          marker.type = "button"; marker.className = "lab-breakpoint-marker";
          marker.title = `Breakpoint on line ${line.number}, statement ${index + 1}`;
          marker.setAttribute("aria-label", marker.title);
          marker.setAttribute("aria-pressed", String(points.selected(line.number, index, statement)));
          marker.addEventListener("click", () => {
            marker.setAttribute("aria-pressed", String(points.toggle(line.number, index, statement)));
            revision = points.revision;
          });
          const badge = document.createElement("small"); badge.className = "lab-visit-count";
          badge.setAttribute("role", "img");
          counters.set(badge, { line: line.number, index, statement });
          row.append(marker, badge);
        }
        const span = document.createElement("span"); span.tabIndex = -1;
        statements.set(statement.address, { span, line: line.number });
        for (const part of statement.parts) {
          if (part.tokenAddress === undefined) {
            span.append(part.text);
            continue;
          }
          const button = memoryLink(part.tokenAddress, browse, part.text);
          button.setAttribute("aria-label", `${part.text} at $${hex(part.tokenAddress)} in Memory`);
          tokens.set(part.tokenAddress, { button, line: line.number });
          span.append(" ", button, " "); // LIST puts a space on each side of an expanded token.
        }
        row.append(span);
      }
      fragment.append(row);
    }
    source.replaceChildren(fragment);
    displayed = listing; revision = points.revision;
  }
  const refresh = (machine: Machine, latest?: Cpu6502StepRecord, stop?: DebugStop): void => {
    if (panel.hidden) return;
    const listing = points.listing();
    if (listing !== displayed || revision !== points.revision) render(listing);
    refreshCounts();
    if (listing.message) { status.textContent = listing.message; return; }
    const cursor = applesoftCursor(machine.ram, latest);
    const token = cursor && tokens.get(cursor.address);
    const current = token && (cursor.line === undefined || cursor.line === token.line) ? token : undefined;
    const dispatch = applesoftStatement(machine, apple2DebugLocation(machine));
    const group = dispatch && statements.get(dispatch.address);
    const statement = group && group.line === dispatch.line ? group.span : undefined;
    const highlight = statement ?? current?.button;
    if (marked !== highlight) {
      marked?.removeAttribute("aria-current");
      marked = highlight;
      marked?.setAttribute("aria-current", "true");
      if (statement) statement.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    if (stop?.kind === "breakpoint" && stop.detail) status.textContent = `Breakpoint · ${stop.detail}`;
    else if (statement && dispatch) status.textContent = `Next statement · line ${dispatch.line} · $${hex(dispatch.address)}`;
    else if (stop?.kind === "step" && stop.detail) status.textContent = stop.detail;
    else if (current && cursor) status.textContent = `${cursor.source} · line ${current.line} · ${current.button.textContent} at $${hex(cursor.address)}`;
    else status.textContent = `${listing.lines.length} stored ${listing.lines.length === 1 ? "line" : "lines"} · no current keyword`;
  };
  return { refresh, reveal(address: number): void {
    const span = statements.get(address)?.span;
    span?.focus({ preventScroll: true });
    span?.scrollIntoView({ block: "nearest", inline: "nearest" });
  } };
}
