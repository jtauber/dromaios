import { mountAltairExplorer } from "./altair-explorer.js";
import { altairOperandAddress, altairProgramBytes, altairProgramStart, createAltairProgram } from "./altair-program.js";
import { format8080Trace } from "./instruction-trace.js";
import { hex } from "./register-programs.js";

/** Execute the bytes entered through the panel, retaining the last CPU record across edits. */
export function mountAltairProgramExplorer(root: HTMLElement): void {
  let lesson: ReturnType<typeof createAltairProgram>;
  const step = root.querySelector<HTMLButtonElement>("[data-panel-step]")!;
  const next = root.querySelector<HTMLElement>("[data-panel-next]")!;
  const last = root.querySelector<HTMLElement>("[data-panel-executed]")!;
  const trace = root.querySelector<HTMLElement>("[data-panel-trace]")!;
  const hint = root.querySelector<HTMLElement>("[data-panel-entry-hint]")!;
  const body = root.querySelector<HTMLElement>("[data-panel-entry-bytes]")!;
  const rows = altairProgramBytes.map((expected, offset) => {
    const row = document.createElement("tr");
    const address = altairProgramStart + offset;
    const heading = document.createElement("th");
    heading.scope = "row";
    heading.textContent = hex(address, 4);
    row.append(heading);
    const cells = Array.from({ length: 3 }, () => document.createElement("td"));
    cells[0]!.textContent = hex(expected, 2);
    row.append(...cells);
    body.append(row);
    return { row, address, expected, value: cells[1]!, check: cells[2]! };
  });

  function render(): void {
    const state = lesson.snapshot();
    for (const [name, value] of [["a", state.a], ["pc", hex(state.pc, 4)], ["source", lesson.ram.read(3)], ["result", lesson.ram.read(4)]] as const) {
      root.querySelector<HTMLElement>(`[data-panel-cpu-${name}]`)!.textContent = String(value);
    }
    for (const { row, address, expected, value, check } of rows) {
      const actual = lesson.ram.read(address);
      value.textContent = hex(actual, 2);
      check.textContent = actual === expected ? "Matches" : address === altairOperandAddress ? "Custom operand" : "Change";
      if (address === state.pc) row.setAttribute("aria-current", "location");
      else row.removeAttribute("aria-current");
    }
    const entry = rows.find(row => row.address === state.pc);
    const following = rows.find(row => row.address === state.pc + 1);
    const reference = (row: typeof rows[number]) => `${hex(row.address, 4)}: ${hex(row.expected, 2)} = ${row.expected.toString(2).padStart(8, "0")}`;
    hint.textContent = entry
      ? `DEPOSIT at ${reference(entry)}. ` + (following ? `DEPOSIT NEXT at ${reference(following)}.` : "This is the last byte. EXAMINE 0100 to check or execute the program.")
      : "To enter or revisit the program, raise only switch 8 (address 0100) and press EXAMINE.";
    const problem = lesson.stepProblem();
    step.disabled = problem !== undefined;
    const instruction = lesson.instructions.find(instruction => instruction.address === state.pc);
    const message = problem ?? `Next at ${hex(state.pc, 4)}: ${instruction!.explanation(address => lesson.ram.read(address))}. Press Step one instruction.`;
    if (next.textContent !== message) next.textContent = message;
  }

  const panel = mountAltairExplorer(root, {
    createPanel() {
      lesson = createAltairProgram();
      last.textContent = "No instruction has run. Enter the program using the switches and memory controls.";
      trace.textContent = "Step an instruction to see its fetched bytes and memory accesses.";
      return lesson.panel;
    },
    onChange: render,
    initialMessage: "No memory operation yet. The program area is empty; address 3 holds 41 and address 4 holds 0.",
  });
  step.addEventListener("click", () => {
    if (lesson.stepProblem()) return;
    const instruction = lesson.instructions.find(instruction => instruction.address === lesson.snapshot().pc)!;
    const previousDestination = lesson.ram.read(4);
    const record = lesson.step();
    if (record.outcome !== "executed") throw new Error("The Altair lesson expected an ordinary instruction.");
    last.textContent = instruction.describe(record, previousDestination);
    trace.textContent = format8080Trace(record, instruction.mnemonic(address => lesson.ram.read(address)));
    panel.refresh();
    if (step.disabled) next.focus();
  });
}
