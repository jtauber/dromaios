import type { createApple2Session } from "./apple2-session.js";
import type { DebugLocation } from "./instruction-debugger.js";
import type { InstructionCatalogue } from "./apple2-explorer.js";
import { disassemble6502, hex } from "./apple2-explorer.js";
import { apple2ScreenCell, createApple2ScreenWrites } from "./apple2-screen-inspection.js";
import { memoryLink } from "./memory-link.js";

type Machine = ReturnType<typeof createApple2Session>["machine"];

/** Laboratory-only selection and provenance; the shared screen renderer remains a passive display. */
export function createApple2ScreenInspector(root: HTMLElement, machine: () => Machine, navigation: {
  readonly memory: (address: number) => void;
  readonly watch: (address: number) => void;
  readonly code: (location: DebugLocation) => string | undefined;
}) {
  const panel = root.querySelector<HTMLElement>("[data-screen-inspector]");
  if (!panel) return undefined;
  const screen = root.querySelector<HTMLElement>("[data-apple2-screen]")!;
  const toggle = root.querySelector<HTMLButtonElement>("[data-screen-inspect]")!;
  const cellInfo = panel.querySelector<HTMLElement>("[data-screen-cell]")!, writerInfo = panel.querySelector<HTMLElement>("[data-screen-writer]")!;
  const notice = panel.querySelector<HTMLElement>("[data-screen-notice]")!;
  const watch = panel.querySelector<HTMLButtonElement>("[data-screen-watch]")!;
  const { instructions } = JSON.parse(root.querySelector<HTMLElement>("[data-rom-catalogue]")!.textContent!) as { instructions: InstructionCatalogue };
  const history = createApple2ScreenWrites();
  let active = false, row = 0, column = 0, selected: HTMLElement | undefined;
  let rendered: string | undefined;
  function refresh(): void {
    if (!active) return;
    const { ram, video } = machine(), cell = apple2ScreenCell(ram, video, row, column);
    const span = cell ? screen.querySelector<HTMLElement>(`[data-screen-row="${row}"][data-screen-column="${column}"]`)! : undefined;
    if (span !== selected) {
      selected?.classList.remove("is-inspected"); span?.classList.add("is-inspected"); selected = span;
    }
    const writer = cell && history.at(cell.address), key = JSON.stringify([row, column, cell, writer]);
    if (key === rendered) return;
    rendered = key; notice.textContent = ""; cellInfo.replaceChildren(); writerInfo.replaceChildren(); watch.disabled = !cell;
    if (!cell) { cellInfo.textContent = "This row shows graphics. Select a text cell, or switch the machine to text mode."; return; }
    cellInfo.append(`Row ${row} · column ${column} · page ${cell.page} · `, memoryLink(cell.address, navigation.memory),
      ` · $${hex(cell.byte, 2)} · ${cell.character === " " ? "space" : `“${cell.character}”`} · ${cell.attribute}`);
    if (!writer) { writerInfo.textContent = "No CPU write observed for this cell since history reset."; return; }
    const code = document.createElement("button"); code.type = "button"; code.className = "lab-memory-link";
    code.textContent = `$${hex(writer.caller.address)}`;
    code.title = `Browse current code · observed ${writer.caller.space}; bytes may have changed`;
    code.addEventListener("click", () => { notice.textContent = navigation.code(writer.caller) ?? ""; });
    writerInfo.append(`Last write #${writer.sequence.toLocaleString()} · `, code,
      ` ${disassemble6502(writer.caller.address, writer.bytes, instructions)} · ${writer.caller.space} · $${hex(writer.before, 2)} → $${hex(writer.after, 2)}`,
      writer.before === writer.after ? " (unchanged)" : "",
      cell.byte !== writer.after ? " · current byte differs" : "");
  }
  function setActive(value: boolean): void {
    active = value; panel!.hidden = !value; toggle.setAttribute("aria-pressed", String(value));
    screen.classList.toggle("is-inspecting", value);
    screen.setAttribute("aria-label", value ? "Apple II text inspection. Click a cell or use arrow keys; Escape returns to typing." : "Apple II display");
    if (!value) { selected?.classList.remove("is-inspected"); selected = undefined; }
    else if (!machine().video.visibleRow(row) && machine().video.visibleRow(23)) row = 20;
    refresh(); screen.focus({ preventScroll: true });
  }
  toggle.addEventListener("click", () => setActive(!active));
  screen.addEventListener("click", event => {
    if (!active) return;
    const cell = (event.target as Element).closest<HTMLElement>("[data-screen-row]");
    if (!cell) return;
    row = Number(cell.dataset.screenRow); column = Number(cell.dataset.screenColumn); refresh();
  });
  screen.addEventListener("keydown", event => {
    if (!active) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); setActive(false); return; }
    const direction = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[event.key];
    if (!direction) return;
    event.preventDefault(); row = Math.max(0, Math.min(23, row + direction[0]!)); column = Math.max(0, Math.min(39, column + direction[1]!)); refresh();
  });
  watch.addEventListener("click", () => {
    const { ram, video } = machine(), cell = apple2ScreenCell(ram, video, row, column);
    if (cell) navigation.watch(cell.address);
  });
  return {
    get active() { return active; },
    observe: history.observe,
    reset(): void { history.reset(); rendered = undefined; },
    refresh(running: boolean): void { panel.setAttribute("aria-live", running ? "off" : "polite"); refresh(); },
  };
}
