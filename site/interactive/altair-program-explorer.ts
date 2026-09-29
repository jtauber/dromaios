import { mountAltairExplorer } from "./altair-explorer.js";
import { createAltairProgram } from "./altair-program.js";
import { createExecutionController } from "./execution-controller.js";
import { format8080Trace } from "./instruction-trace.js";
import { hex } from "./register-programs.js";
import { renderByteOutput } from "./byte-output-view.js";
import { mountByteInput } from "./byte-input-view.js";
import { mountCharacterInput } from "./character-input-view.js";
import { createTerminalLesson } from "./terminal-lesson.js";
import { renderTerminalOutput } from "./terminal-output-view.js";
import { renderRamWindow } from "./ram-window-view.js";

/** Execute the panel's known program, retaining captured instructions across memory edits. */
export function mountAltairProgramExplorer(root: HTMLElement): void {
  const mode = root.dataset.altairExplorer;
  const terminalProgram = mode === "terminal" ? "polling"
    : mode === "reply" || mode === "message" || mode === "terminated-message" || mode === "buffer" || mode === "subroutine" || mode === "nested-call" || mode === "save-registers" ? mode : undefined;
  const name = terminalProgram ?? (mode === "running" ? "countdown"
    : mode === "output" || mode === "input" || mode === "polling" ? mode : "entry");
  const preloaded = name !== "entry";
  let lesson: ReturnType<typeof createAltairProgram> | ReturnType<typeof createTerminalLesson>;
  let panel: ReturnType<typeof mountAltairExplorer> | undefined;
  let inputView: ReturnType<typeof mountByteInput> | undefined;
  const step = root.querySelector<HTMLButtonElement>("[data-panel-step]")!;
  const run = root.querySelector<HTMLButtonElement>("[data-panel-run]");
  const paced = run !== null;
  const stop = root.querySelector<HTMLButtonElement>("[data-panel-stop]");
  const pace = root.querySelector<HTMLSelectElement>("[data-panel-pace]");
  const next = root.querySelector<HTMLElement>("[data-panel-next]")!;
  const last = root.querySelector<HTMLElement>("[data-panel-executed]")!;
  const trace = root.querySelector<HTMLElement>("[data-panel-trace]")!;
  const hint = root.querySelector<HTMLElement>("[data-panel-entry-hint]")!;
  const history = root.querySelector<HTMLOListElement>("[data-panel-history]");
  const output = root.querySelector<HTMLElement>("[data-byte-output]");
  const input = root.querySelector<HTMLElement>("[data-byte-input]");
  const terminalOutput = root.querySelector<HTMLElement>("[data-terminal-output]");
  const ramWindows = root.querySelectorAll<HTMLElement>("[data-ram-window]");
  const rows: { row: HTMLTableRowElement; address: number; expected: number; value: HTMLTableCellElement; check: HTMLTableCellElement }[] = [];

  const execution = createExecutionController({
    canStep: () => lesson.stepProblem() === undefined,
    step() {
      const instruction = lesson.instructions.find(instruction => instruction.address === lesson.snapshot().pc)!;
      const previousDestination = lesson.ram.read(4);
      const record = lesson.step();
      return {
        record,
        description: instruction.describe(record, previousDestination),
        trace: format8080Trace(record, instruction.mnemonic(address => lesson.ram.read(address))),
      };
    },
    schedule(callback, delay) {
      const timer = setTimeout(callback, delay);
      return () => { clearTimeout(timer); };
    },
    onChange: () => { panel?.refresh(); },
  });

  function render(): void {
    const state = lesson.snapshot();
    for (const [name, value] of [["a", state.a], ["pc", hex(state.pc, 4)], ["b", state.b],
      ["hl", hex(state.hl, 4)], ["sp", hex(state.sp, 4)], ["halted", state.halted ? "yes" : "no"]] as const) {
      const readout = root.querySelector<HTMLElement>(`[data-panel-cpu-${name}]`);
      if (readout) readout.textContent = String(value);
    }
    for (const window of ramWindows) {
      renderRamWindow(window, lesson.ram, window.dataset.pointerName === "SP" ? state.sp : state.hl, execution.running);
    }
    for (const readout of root.querySelectorAll<HTMLElement>("[data-panel-ram]")) {
      readout.textContent = String(lesson.ram.read(Number(readout.dataset.panelRam)));
    }
    if (output) renderByteOutput(output, lesson.outputSnapshot()!, execution.running);
    if (terminalOutput && "terminalSnapshot" in lesson) {
      renderTerminalOutput(terminalOutput, lesson.terminalSnapshot(), lesson.outputSnapshot()!, execution.running);
    }
    inputView?.refresh(execution.running);
    const flag = root.querySelector<HTMLElement>("[data-panel-cpu-z]");
    if (flag) flag.textContent = String(Number(state.flags.z));
    for (const { row, address, expected, value, check } of rows) {
      const actual = lesson.ram.read(address);
      value.textContent = hex(actual, 2);
      check.textContent = actual === expected ? "Matches" : address === lesson.editableOperand ? "Custom operand" : "Change";
      if (address === state.pc) row.setAttribute("aria-current", "location");
      else row.removeAttribute("aria-current");
    }
    const entry = rows.find(row => row.address === state.pc);
    const following = rows.find(row => row.address === state.pc + 1);
    const reference = (row: typeof rows[number]) => `${hex(row.address, 4)}: ${hex(row.expected, 2)} = ${row.expected.toString(2).padStart(8, "0")}`;
    const start = hex(lesson.startAddress, 4);
    hint.textContent = execution.running ? "Running: STOP before examining or depositing memory. Moving switches still only prepares a value."
      : entry ? `DEPOSIT at ${reference(entry)}. ` + (following ? `DEPOSIT NEXT at ${reference(following)}.` : `This is the last byte. EXAMINE ${start} to check or execute the program.`)
      : `To revisit the program, set the switches to address ${start} and press EXAMINE.`;
    const problem = lesson.stepProblem();
    const blocked = problem !== undefined || execution.error !== undefined;
    step.disabled = execution.running || blocked;
    if (run && stop) {
      run.disabled = execution.running || blocked;
      stop.disabled = !execution.running;
    }
    const instruction = lesson.instructions.find(instruction => instruction.address === state.pc);
    const upcoming = instruction ? `Next at ${hex(state.pc, 4)}: ${instruction.explanation(address => lesson.ram.read(address))}.` : "";
    const message = execution.error !== undefined ? `Stopped after an execution error: ${execution.error} Start this lesson again to restore its initial state.`
      : execution.running ? `Running. ${upcoming} STOP preserves the state between instructions.`
      : problem ?? `${paced ? "Stopped. " : ""}${upcoming} ${paced ? "RUN continues from here, or step one instruction." : "Press Step one instruction."}`;
    // Running updates remain visible, but do not continually interrupt a screen reader.
    next.setAttribute("aria-live", execution.running ? "off" : "polite");
    if (next.textContent !== message) next.textContent = message;
    if (!execution.running && document.activeElement === stop && !document.hidden) next.focus();
    const captured = execution.records.at(-1);
    last.parentElement!.setAttribute("aria-live", execution.running ? "off" : "polite");
    const description = captured?.description ?? (preloaded ? "No instruction has run." : "No instruction has run. Enter the program using the switches and memory controls.");
    if (last.textContent !== description) last.textContent = description;
    trace.textContent = captured?.trace ?? "Step an instruction to see its fetched bytes, memory accesses, and any port transfers.";
    if (history) {
      root.querySelector<HTMLElement>("[data-panel-step-count]")!.textContent = `${execution.steps} instructions executed. Showing the most recent ${execution.records.length} (up to 12).`;
      history.replaceChildren(...execution.records.map(({ record, description }, index) => {
        const item = document.createElement("li");
        item.value = execution.steps - execution.records.length + index + 1;
        item.textContent = `${hex(record.before.pc, 4)} → ${hex(record.after.pc, 4)}: ${description}`;
        return item;
      }));
    }
  }

  panel = mountAltairExplorer(root, {
    createPanel() {
      execution.reset();
      lesson = terminalProgram ? createTerminalLesson(terminalProgram) : createAltairProgram(name);
      inputView?.reset();
      return lesson.panel;
    },
    canAccessMemory: () => !execution.running,
    onChange: render,
    initialMessage: {
      entry: "No memory operation yet. The program area is empty; address 3 holds 41 and address 4 holds 0.",
      countdown: "No memory operation yet. The countdown is loaded; PC is 0100, address 3 holds 3, and address 4 holds 0.",
      output: "No memory operation yet. The output program is loaded; PC is 0100, address 3 holds 41, and address 1 holds 0. No byte has been sent to the device.",
      polling: "No memory operation yet. The polling program is loaded; PC is 0100 and address 1 holds 0. Both devices start empty.",
      reply: "No memory operation yet. The reply program is loaded; PC is 0100 and address 1 holds 0. Both devices start empty.",
      message: "No memory operation yet. The program is loaded at 0000 and the six message bytes at 0100. No byte has been sent to the display.",
      "terminated-message": "No memory operation yet. The program is loaded at 0000; HELLO, line feed, and a zero terminator begin at 0100. No byte has been sent to the display.",
      buffer: "No memory operation yet. The program is loaded at 0000 and the nine buffer bytes at 0100 are zero. Both devices start empty.",
      "save-registers": "No memory operation yet. The program is loaded at 0000 and the message at 0100. The caller will set SP and HL before calling the printing routine.",
      "nested-call": "No memory operation yet. The program is loaded at 0000 and the message at 0100. The four stack bytes start at zero; the first instruction will initialize SP.",
      subroutine: "No memory operation yet. The program is loaded at 0000 and the message at 0100. SP and the stack bytes are zero; the first instruction will initialize SP.",
      input: "No memory operation yet. The input program is loaded; PC is 0100 and address 1 holds 0. Both devices start empty.",
    }[name],
  });
  if (input) inputView = (terminalProgram ? mountCharacterInput : mountByteInput)(input, {
    snapshot: () => lesson.inputSnapshot()!,
    offer: value => lesson.offerInput(value),
    onChange: () => { panel!.refresh(); },
  });
  const body = root.querySelector<HTMLElement>("[data-panel-entry-bytes]")!;
  for (const [offset, expected] of lesson!.bytes.entries()) {
    const row = document.createElement("tr");
    const address = lesson!.startAddress + offset;
    const heading = document.createElement("th");
    heading.scope = "row";
    heading.textContent = hex(address, 4);
    const reference = document.createElement("td");
    reference.textContent = hex(expected, 2);
    const value = document.createElement("td");
    const check = document.createElement("td");
    row.append(heading, reference, value, check);
    body.append(row);
    rows.push({ row, address, expected, value, check });
  }
  panel.refresh();
  step.addEventListener("click", () => {
    execution.step();
    if (step.disabled) next.focus();
  });
  run?.addEventListener("click", () => {
    execution.run();
    if (execution.running) stop!.focus();
  });
  stop?.addEventListener("click", () => {
    execution.stop();
    if (run!.disabled) next.focus();
    else run!.focus();
  });
  pace?.addEventListener("change", () => { execution.setDelay(Number(pace.value)); });
  // Returning to a hidden or cached page must never silently resume execution.
  document.addEventListener("visibilitychange", () => { if (document.hidden) execution.stop(); });
  window.addEventListener("pagehide", () => { execution.stop(); });
}
