import type { createApple2Session } from "./apple2-session.js";
import type { Cpu6502StepRecord } from "../../src/components/cpus/generated/6502-cpu.js";
import type { Apple2MemoryChange } from "./apple2-inspection.js";
import type { DebugLocation } from "./instruction-debugger.js";
import type { InstructionCatalogue } from "./apple2-explorer.js";
import { disassemble6502, hex } from "./apple2-explorer.js";
import { apple2LoresPixel, apple2ScreenCell, createApple2ScreenWrites } from "./apple2-screen-inspection.js";
import { createIntegerPlotTrace } from "./apple2-integer-plot.js";
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
  const history = createApple2ScreenWrites(), plots = createIntegerPlotTrace();
  // A text cell spans two rows of the 40 × 48 low-resolution grid.
  let active = false, x = 0, y = 0, selected: HTMLElement | undefined;
  let rendered: string | undefined;
  function selection() {
    const { ram, video } = machine();
    return apple2ScreenCell(ram, video, y >> 1, x) ?? apple2LoresPixel(ram, video, x, y);
  }
  function refresh(): void {
    if (!active) return;
    const cell = selection(), pixel = cell && "colour" in cell;
    const writer = cell && (pixel ? history.colourChange(cell.address, y) : history.at(cell.address));
    const key = JSON.stringify([x, y, cell, writer]);
    if (key === rendered) return;
    rendered = key; notice.textContent = ""; cellInfo.replaceChildren(); writerInfo.replaceChildren(); watch.disabled = !cell;
    if (selected) delete selected.dataset.inspected;
    selected = cell ? screen.querySelector<HTMLElement>(`[data-screen-row="${y >> 1}"][data-screen-column="${x}"]`)! : undefined;
    if (selected) selected.dataset.inspected = pixel ? (y & 1 ? "bottom" : "top") : "cell";
    if (!cell) { cellInfo.textContent = "High-resolution row. Select a visible text cell to inspect it."; return; }
    const location = pixel ? `Pixel (${x},${y})` : `Row ${cell.row} · column ${cell.column}`;
    const detail = pixel ? `${y & 1 ? "high nibble (bits 7–4)" : "low nibble (bits 3–0)"} · colour ${cell.colour}`
      : `${cell.character === " " ? "space" : `“${cell.character}”`} · ${cell.attribute}`;
    cellInfo.append(`${location} · page ${cell.page} · `, memoryLink(cell.address, navigation.memory), ` · $${hex(cell.byte, 2)} · ${detail}`);
    if (!writer) { writerInfo.textContent = pixel ? "No change to these four bits observed since history reset." : "No CPU write observed for this cell since history reset."; return; }
    const code = document.createElement("button"); code.type = "button"; code.className = "lab-memory-link";
    code.textContent = `$${hex(writer.caller.address)}`;
    code.title = `Browse current code · observed ${writer.caller.space}; bytes may have changed`;
    code.addEventListener("click", () => { notice.textContent = navigation.code(writer.caller) ?? ""; });
    writerInfo.append(`${pixel ? "Last colour change" : "Last write"} #${writer.sequence.toLocaleString()} · `, code,
      ` ${disassemble6502(writer.caller.address, writer.bytes, instructions)} · ${writer.caller.space} · $${hex(writer.before, 2)} → $${hex(writer.after, 2)}`,
      writer.before === writer.after ? " (unchanged)" : "",
      !pixel && cell.byte !== writer.after ? " · current byte differs" : "");
    if (pixel && writer.plot) writerInfo.append(` · Integer BASIC line ${writer.plot.line}, PLOT at `, memoryLink(writer.plot.token, navigation.memory));
  }
  function setActive(value: boolean): void {
    active = value; panel!.hidden = !value; toggle.setAttribute("aria-pressed", String(value));
    screen.classList.toggle("is-inspecting", value);
    screen.setAttribute("aria-label", value ? "Inspect Apple II text or low-resolution pixels. Click or use the arrow keys. Escape returns to typing." : "Apple II display");
    rendered = undefined;
    if (!value && selected) { delete selected.dataset.inspected; selected = undefined; }
    else if (value && !selection() && machine().video.visibleRow(23)) y = 40;
    refresh(); screen.focus({ preventScroll: true });
  }
  toggle.addEventListener("click", () => setActive(!active));
  screen.addEventListener("click", event => {
    if (!active) return;
    const cell = (event.target as Element).closest<HTMLElement>("[data-screen-row]");
    if (!cell) return;
    const rect = cell.getBoundingClientRect();
    x = Number(cell.dataset.screenColumn);
    y = 2 * Number(cell.dataset.screenRow) + Number(event.clientY >= rect.top + rect.height / 2);
    refresh();
  });
  screen.addEventListener("keydown", event => {
    if (!active) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); setActive(false); return; }
    const direction = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[event.key];
    if (!direction) return;
    event.preventDefault();
    const dy = direction[0]!;
    let nextY = y + dy;
    if (machine().video.visibleRow(y >> 1) && (nextY >> 1) === (y >> 1)) nextY += dy;
    y = Math.max(0, Math.min(47, nextY)); x = Math.max(0, Math.min(39, x + direction[1]!)); refresh();
  });
  watch.addEventListener("click", () => {
    const cell = selection();
    if (cell) navigation.watch(cell.address);
  });
  return {
    get active() { return active; },
    selectPixel(column: number, row: number): void { x = column; y = row; setActive(true); },
    observe(record: Cpu6502StepRecord, caller: DebugLocation, writes: readonly Apple2MemoryChange[]) {
      history.observe(record, caller, writes, plots.observe(record, caller, machine().ram));
    },
    reset(): void { history.reset(); plots.reset(); rendered = undefined; },
    refresh(running: boolean): void { panel.setAttribute("aria-live", running ? "off" : "polite"); refresh(); },
  };
}
