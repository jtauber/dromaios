import { create8080RegisterLesson } from "../../src/machines/generated/8080/register-lesson.js";
import { create8080AddOneLesson } from "../../src/machines/generated/8080/add-one-lesson.js";
import { mountMemoryEditor } from "./memory-editor.js";
import { mountProgramView } from "./program-view.js";
import type { FetchedInstruction } from "../../src/components/cpus/execution-records.js";

/** The buttons advance a fixed program; only the CPU writes its accumulator. */
export function mountRegisterExplorer(lesson: HTMLElement, root: HTMLElement): void {
  const addsOne = lesson.dataset.registerExplorer === "add-one";
  const createMachine = addsOne ? create8080AddOneLesson : create8080RegisterLesson;
  let machine = createMachine();
  // These descriptions label the fixed program; the CPU executes its bytes.
  const instructions = [
    {
      address: 0x100, action: "read", mnemonic: "LDA 0003H", explanation: "Read address 3 into A",
      prompt: "First, read address 3 into A. Predict which values will change.",
    },
    ...(addsOne ? [{
      address: 0x103, action: "add", mnemonic: "ADI 1", explanation: "Add one to A",
      prompt: "Now add one to A. Will either memory location change?",
    }] : []),
    {
      address: addsOne ? 0x105 : 0x103, action: "write", mnemonic: "STA 0004H", explanation: "Write A to address 4",
      prompt: addsOne ? "The calculation changed A. Write its result to address 4."
        : "A has its own copy. You can change the byte at address 3 before writing A to address 4.",
    },
  ].map(instruction => ({ ...instruction, button: lesson.querySelector<HTMLButtonElement>(`[data-register-${instruction.action}]`) }));
  const stepButton = lesson.querySelector<HTMLButtonElement>("[data-program-step]");
  const programRoot = lesson.querySelector<HTMLElement>("[data-program-view]");
  const program = programRoot && mountProgramView(programRoot, instructions, machine.endAddress, address => machine.ram.read(address));
  let lastFetched: FetchedInstruction | null = null;
  const restart = lesson.querySelector<HTMLButtonElement>("[data-register-restart]")!;
  const next = lesson.querySelector<HTMLElement>("[data-register-next]")!;
  const last = lesson.querySelector<HTMLElement>("[data-register-last]")!;
  const trace = lesson.querySelector<HTMLElement>("[data-register-trace]")!;
  const memoryLabel = lesson.querySelector<HTMLElement>("[data-memory-label]")!;
  const carry = lesson.querySelector<HTMLElement>("[data-register-carry]");
  const calculation = lesson.querySelector<HTMLElement>("[data-register-calculation]");
  const editor = mountMemoryEditor(lesson, root, () => machine.ram, { size: 8, address: 3, onEdit: render });

  function hex(value: number, digits: number): string { return value.toString(16).toUpperCase().padStart(digits, "0"); }

  function render(): void {
    const state = machine.cpu.snapshot();
    lesson.querySelector<HTMLElement>("[data-register-value]")!.textContent = String(state.a);
    const binary = state.a.toString(2).padStart(8, "0");
    lesson.querySelector<HTMLElement>("[data-register-binary]")!.textContent = `${binary.slice(0, 4)} ${binary.slice(4)}`;
    lesson.querySelector<HTMLElement>("[data-register-hex]")!.textContent = hex(state.a, 2);
    for (const pc of lesson.querySelectorAll<HTMLElement>("[data-register-pc]")) pc.textContent = hex(state.pc, 4);
    if (carry) {
      carry.textContent = state.flags.cy ? "1" : "0";
      carry.toggleAttribute("data-set", state.flags.cy);
    }
    memoryLabel.textContent = `Change the byte at address ${editor.address}`;
    const current = instructions.find(instruction => instruction.address === state.pc);
    for (const instruction of instructions) {
      if (instruction.button) instruction.button.disabled = !editor.valid || instruction !== current;
    }
    if (stepButton) stepButton.disabled = !editor.valid || !current;
    program?.render(state.pc, lastFetched);
    next.textContent = !editor.valid ? "Finish entering a valid byte, or select another address, before continuing."
      : state.pc === machine.endAddress ? "The program is complete. Edit memory to explore the independent values, or start again."
      : stepButton ? `Next at ${hex(state.pc, 4)}: ${current!.explanation}. Press Step one instruction.`
      : current!.prompt;
  }

  function step(instruction: typeof instructions[number]): void {
    if (!editor.valid || machine.cpu.snapshot().pc !== instruction.address) return;
    const previousDestination = machine.ram.read(4);
    const record = machine.cpu.step();
    if (record.outcome !== "executed") throw new Error("The register lesson expected an ordinary instruction.");
    lastFetched = record.instruction;
    last.textContent = instruction.action === "read"
      ? `Read ${record.after.a} from address 3 into A, replacing ${record.before.a}. Reading left memory unchanged.`
      : instruction.action === "add"
      ? `Added one to ${record.before.a}. A now holds ${record.after.a}; carry is ${Number(record.after.flags.cy)}. Memory is unchanged.`
      : `Wrote ${record.after.a} from A to address 4, replacing ${previousDestination}. A kept its value.`;
    if (instruction.action === "add" && calculation) {
      const sum = record.before.a + 1; // Explain the full sum; A and CY come from the CPU record.
      calculation.textContent = `${record.before.a} + 1 = ${sum}. ` + (record.after.flags.cy
        ? `The sum needs nine bits. A keeps the rightmost eight: ${record.after.a}. The carry flag records the extra bit: 1.`
        : `The sum fits in eight bits. A holds ${record.after.a}, and the carry flag is 0.`);
    }
    const flags = ["s", "z", "ac", "p", "cy"] as const;
    const flagTrace = `Flags: ${flags.map(flag => `${flag.toUpperCase()} ${Number(record.before.flags[flag])} → ${Number(record.after.flags[flag])}`).join(", ")}`;
    trace.textContent = [
      `${hex(record.instruction.address, 4)}: ${record.instruction.bytes.map(byte => hex(byte, 2)).join(" ")}  ${instruction.mnemonic}`,
      `A: ${record.before.a} → ${record.after.a} (decimal)`,
      `PC: ${hex(record.before.pc, 4)} → ${hex(record.after.pc, 4)} (hexadecimal)`,
      flagTrace, "", "Memory accesses (hexadecimal):",
      ...record.accesses.flatMap(access => access.kind === "read" || access.kind === "write"
        ? [`${access.kind === "read" ? "Read " : "Write"} ${hex(access.address, 4)}: ${hex(access.value, 2)}`] : []),
    ].join("\n");
    editor.refresh();
    render();
    // Keep keyboard progression on an enabled control after its predecessor becomes disabled.
    const following = instructions.find(next => next.address === record.after.pc);
    const control = stepButton && !stepButton.disabled ? stepButton : following?.button ?? restart;
    control.focus();
  }

  for (const instruction of instructions) instruction.button?.addEventListener("click", () => { step(instruction); });
  stepButton?.addEventListener("click", () => {
    const current = instructions.find(instruction => instruction.address === machine.cpu.snapshot().pc);
    if (current) step(current);
  });
  restart.addEventListener("click", () => {
    machine = createMachine();
    lastFetched = null;
    editor.select(3);
    last.textContent = "No instruction has run. A starts at 0.";
    trace.textContent = "No instruction has run.";
    if (calculation) calculation.textContent = "No addition has run. Read a byte into A, then add one.";
    render();
    (stepButton ?? instructions[0]!.button)!.focus();
  });
  render();
  lesson.querySelector<HTMLFieldSetElement>("[data-register-controls]")!.disabled = false;
}
