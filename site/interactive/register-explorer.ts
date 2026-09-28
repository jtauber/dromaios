import { registerProgram, hex, readAddress } from "./register-programs.js";
import { createProgramHistory } from "./program-history.js";
import { mountMemoryEditor } from "./memory-editor.js";
import { mountProgramView } from "./program-view.js";
import { format8080Trace } from "./instruction-trace.js";
import type { FetchedInstruction } from "../../src/components/cpus/execution-records.js";

/** Step a known lesson program; only the CPU writes its accumulator. */
export function mountRegisterExplorer(lesson: HTMLElement, root: HTMLElement): void {
  const definition = registerProgram(lesson.dataset.registerExplorer);
  const { createMachine, instructions, operandAddress, jumpOperand } = definition;
  let machine = createMachine();
  const initialPC = machine.cpu.snapshot().pc;
  const read = (address: number) => machine.ram.read(address);
  const newHistory = () => createProgramHistory(initialPC, instructions.map(instruction => instruction.address));
  let history = newHistory();
  const buttonFor = (instruction: typeof instructions[number]) =>
    lesson.querySelector<HTMLButtonElement>(`[data-register-${instruction.action}]`);
  const stepButton = lesson.querySelector<HTMLButtonElement>("[data-program-step]");
  const programRoot = lesson.querySelector<HTMLElement>("[data-program-view]");
  const program = programRoot && mountProgramView(programRoot, instructions, machine.endAddress, read);
  let lastFetched: FetchedInstruction | null = null;
  const restart = lesson.querySelector<HTMLButtonElement>("[data-register-restart]")!;
  const next = lesson.querySelector<HTMLElement>("[data-register-next]")!;
  const last = lesson.querySelector<HTMLElement>("[data-register-last]")!;
  const trace = lesson.querySelector<HTMLElement>("[data-register-trace]")!;
  const memoryLabel = lesson.querySelector<HTMLElement>("[data-memory-label]")!;
  const flag = lesson.querySelector<HTMLElement>("[data-register-flag]");
  const calculation = lesson.querySelector<HTMLElement>("[data-register-calculation]");
  const operand = lesson.querySelector<HTMLInputElement>("[data-program-operand]");
  const operandError = lesson.querySelector<HTMLElement>("[data-operand-error]");
  const operandStatus = lesson.querySelector<HTMLElement>("[data-operand-status]");
  const destination = lesson.querySelector<HTMLSelectElement>("[data-jump-destination]");
  const jumpStatus = lesson.querySelector<HTMLElement>("[data-jump-status]");
  const editor = mountMemoryEditor(lesson, root, () => machine.ram, { size: 8, address: 3, onEdit: render });

  function valid(): boolean { return editor.valid && !operand?.hasAttribute("aria-invalid"); }

  function render(): void {
    const state = machine.cpu.snapshot();
    lesson.querySelector<HTMLElement>("[data-register-value]")!.textContent = String(state.a);
    const binary = state.a.toString(2).padStart(8, "0");
    lesson.querySelector<HTMLElement>("[data-register-binary]")!.textContent = `${binary.slice(0, 4)} ${binary.slice(4)}`;
    lesson.querySelector<HTMLElement>("[data-register-hex]")!.textContent = hex(state.a, 2);
    for (const pc of lesson.querySelectorAll<HTMLElement>("[data-register-pc]")) pc.textContent = hex(state.pc, 4);
    if (flag) {
      const value = state.flags[definition.flag ?? "cy"];
      flag.textContent = value ? "1" : "0";
      flag.toggleAttribute("data-set", value);
    }
    memoryLabel.textContent = `Change the byte at address ${editor.address}`;
    const current = instructions.find(instruction => instruction.address === state.pc);
    for (const instruction of instructions) {
      const button = buttonFor(instruction);
      if (button) button.disabled = !valid() || instruction !== current;
    }
    if (stepButton) stepButton.disabled = !valid() || !current;
    if (operand && operandStatus) {
      operand.disabled = state.pc !== initialPC;
      const value = read(operandAddress!);
      operandStatus.textContent = `Address ${hex(operandAddress!, 4)} contains ${hex(value, 2)} in hexadecimal (${value} in decimal). `
        + (operand.disabled ? "Start again to edit the program." : "Your edit changes memory immediately; no instruction runs.");
    }
    if (destination && jumpStatus) {
      destination.disabled = state.pc !== initialPC;
      jumpStatus.textContent = `The jump's destination is ${hex(readAddress(read, jumpOperand!.address), 4)}. `
        + (destination.disabled ? "Start again to choose another path." : "Choosing a destination edits the program in RAM; it does not run it.");
    }
    program?.render(state.pc, lastFetched, definition.showHistory ? history : undefined);
    next.textContent = operand?.hasAttribute("aria-invalid") ? "Enter a whole number from 0 to 255 for the program byte before continuing."
      : !editor.valid ? "Finish entering a valid byte, or select another address, before continuing."
      : state.pc === machine.endAddress ? "The program is complete. Edit memory to explore the independent values, or start again."
      : stepButton ? `Next at ${hex(state.pc, 4)}: ${current!.explanation(read)}. Press Step one instruction.`
      : current!.prompt;
  }

  function step(instruction: typeof instructions[number]): void {
    if (!valid() || machine.cpu.snapshot().pc !== instruction.address) return;
    const previousDestination = machine.ram.read(4);
    const record = machine.cpu.step();
    if (record.outcome !== "executed") throw new Error("The register lesson expected an ordinary instruction.");
    lastFetched = record.instruction;
    history.record(record.instruction, record.after.pc);
    last.textContent = instruction.describe(record, previousDestination);
    if (instruction.action === "add" && calculation) {
      const added = record.instruction.bytes[1]!;
      const sum = record.before.a + added; // Explain the full sum; A and CY come from the CPU record.
      calculation.textContent = `${record.before.a} + ${added} = ${sum}. ` + (record.after.flags.cy
        ? `The sum needs nine bits. A keeps the rightmost eight: ${record.after.a}. The carry flag records the extra bit: 1.`
        : `The sum fits in eight bits. A holds ${record.after.a}, and the carry flag is 0.`);
    }
    trace.textContent = format8080Trace(record, instruction.mnemonic(read));
    editor.refresh();
    render();
    // Keep keyboard progression on an enabled control after its predecessor becomes disabled.
    const following = instructions.find(next => next.address === record.after.pc);
    const control = stepButton && !stepButton.disabled ? stepButton : (following && buttonFor(following)) ?? restart;
    control.focus();
  }

  for (const instruction of instructions) buttonFor(instruction)?.addEventListener("click", () => { step(instruction); });
  operand?.addEventListener("input", () => {
    if (machine.cpu.snapshot().pc !== initialPC) return;
    const text = operand.value.trim();
    const value = Number(text);
    if (!/^\d{1,3}$/.test(text) || value > 255) {
      operand.setAttribute("aria-invalid", "true");
      operandError!.textContent = "Use a whole decimal number from 0 to 255. The program byte has not changed.";
    } else {
      operand.removeAttribute("aria-invalid");
      operandError!.textContent = "";
      machine.ram.write(operandAddress!, value);
    }
    render();
  });
  destination?.addEventListener("change", () => {
    if (machine.cpu.snapshot().pc !== initialPC) return;
    const address = Number.parseInt(destination.value, 16);
    if (!jumpOperand!.destinations.includes(address)) return;
    machine.ram.write(jumpOperand!.address, address & 0xff);
    machine.ram.write(jumpOperand!.address + 1, address >>> 8);
    render();
  });
  stepButton?.addEventListener("click", () => {
    const current = instructions.find(instruction => instruction.address === machine.cpu.snapshot().pc);
    if (current) step(current);
  });
  restart.addEventListener("click", () => {
    machine = createMachine();
    lastFetched = null;
    history = newHistory();
    if (operand) {
      operand.value = String(read(operandAddress!));
      operand.removeAttribute("aria-invalid");
      operandError!.textContent = "";
    }
    if (destination) destination.value = hex(readAddress(read, jumpOperand!.address), 4);
    editor.select(3);
    last.textContent = "No instruction has run. A starts at 0.";
    trace.textContent = "No instruction has run.";
    if (calculation) calculation.textContent = "No addition has run. Read a byte into A, then add one.";
    render();
    (stepButton ?? buttonFor(instructions[0]!))!.focus();
  });
  render();
  lesson.querySelector<HTMLFieldSetElement>("[data-register-controls]")!.disabled = false;
}
