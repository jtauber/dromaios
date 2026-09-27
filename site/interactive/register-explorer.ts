import { create8080RegisterLesson } from "../../src/machines/generated/8080/register-lesson.js";
import { create8080AddOneLesson } from "../../src/machines/generated/8080/add-one-lesson.js";
import { mountMemoryEditor } from "./memory-editor.js";
import { mountProgramView } from "./program-view.js";
import type { FetchedInstruction } from "../../src/components/cpus/execution-records.js";

/** Step a known load/store program; only the CPU writes its accumulator. */
export function mountRegisterExplorer(lesson: HTMLElement, root: HTMLElement): void {
  const hasAddition = lesson.dataset.registerExplorer === "add-one";
  const createMachine = hasAddition ? create8080AddOneLesson : create8080RegisterLesson;
  let machine = createMachine();
  // The instruction layout is fixed, but the addition's operand can change.
  const instructions = [
    {
      address: 0x100, action: "read", mnemonic: "LDA 0003H", explanation: "Read address 3 into A",
      prompt: "First, read address 3 into A. Predict which values will change.",
    },
    ...(hasAddition ? [{
      address: 0x103, action: "add",
      get mnemonic() { return `ADI ${machine.ram.read(0x104)}`; },
      get explanation() {
        const value = machine.ram.read(0x104);
        return value === 1 ? "Add one to A" : `Add ${value} to A`;
      },
      prompt: "Now add one to A. Will either memory location change?",
    }] : []),
    {
      address: hasAddition ? 0x105 : 0x103, action: "write", mnemonic: "STA 0004H", explanation: "Write A to address 4",
      prompt: hasAddition ? "The calculation changed A. Write its result to address 4."
        : "A has its own copy. You can change the byte at address 3 before writing A to address 4.",
    },
  ];
  const buttonFor = (instruction: typeof instructions[number]) =>
    lesson.querySelector<HTMLButtonElement>(`[data-register-${instruction.action}]`);
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
  const operand = lesson.querySelector<HTMLInputElement>("[data-program-operand]");
  const operandError = lesson.querySelector<HTMLElement>("[data-operand-error]");
  const operandStatus = lesson.querySelector<HTMLElement>("[data-operand-status]");
  const editor = mountMemoryEditor(lesson, root, () => machine.ram, { size: 8, address: 3, onEdit: render });

  function hex(value: number, digits: number): string { return value.toString(16).toUpperCase().padStart(digits, "0"); }
  function valid(): boolean { return editor.valid && !operand?.hasAttribute("aria-invalid"); }

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
      const button = buttonFor(instruction);
      if (button) button.disabled = !valid() || instruction !== current;
    }
    if (stepButton) stepButton.disabled = !valid() || !current;
    if (operand && operandStatus) {
      operand.disabled = state.pc !== 0x100;
      const value = machine.ram.read(0x104);
      operandStatus.textContent = `Address 0104 contains ${hex(value, 2)} in hexadecimal (${value} in decimal). `
        + (operand.disabled ? "Start again to edit the program." : "Your edit changes memory immediately; no instruction runs.");
    }
    program?.render(state.pc, lastFetched);
    next.textContent = operand?.hasAttribute("aria-invalid") ? "Enter a whole number from 0 to 255 for the addition before continuing."
      : !editor.valid ? "Finish entering a valid byte, or select another address, before continuing."
      : state.pc === machine.endAddress ? "The program is complete. Edit memory to explore the independent values, or start again."
      : stepButton ? `Next at ${hex(state.pc, 4)}: ${current!.explanation}. Press Step one instruction.`
      : current!.prompt;
  }

  function step(instruction: typeof instructions[number]): void {
    if (!valid() || machine.cpu.snapshot().pc !== instruction.address) return;
    const previousDestination = machine.ram.read(4);
    const record = machine.cpu.step();
    if (record.outcome !== "executed") throw new Error("The register lesson expected an ordinary instruction.");
    lastFetched = record.instruction;
    const added = record.instruction.bytes[1]!;
    last.textContent = instruction.action === "read"
      ? `Read ${record.after.a} from address 3 into A, replacing ${record.before.a}. Reading left memory unchanged.`
      : instruction.action === "add"
      ? `Added ${added === 1 ? "one" : added} to ${record.before.a}. A now holds ${record.after.a}; carry is ${Number(record.after.flags.cy)}. Memory is unchanged.`
      : `Wrote ${record.after.a} from A to address 4, replacing ${previousDestination}. A kept its value.`;
    if (instruction.action === "add" && calculation) {
      const sum = record.before.a + added; // Explain the full sum; A and CY come from the CPU record.
      calculation.textContent = `${record.before.a} + ${added} = ${sum}. ` + (record.after.flags.cy
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
    const control = stepButton && !stepButton.disabled ? stepButton : (following && buttonFor(following)) ?? restart;
    control.focus();
  }

  for (const instruction of instructions) buttonFor(instruction)?.addEventListener("click", () => { step(instruction); });
  operand?.addEventListener("input", () => {
    if (machine.cpu.snapshot().pc !== 0x100) return;
    const text = operand.value.trim();
    const value = Number(text);
    if (!/^\d{1,3}$/.test(text) || value > 255) {
      operand.setAttribute("aria-invalid", "true");
      operandError!.textContent = "Use a whole decimal number from 0 to 255. The program byte has not changed.";
    } else {
      operand.removeAttribute("aria-invalid");
      operandError!.textContent = "";
      machine.ram.write(0x104, value);
    }
    render();
  });
  stepButton?.addEventListener("click", () => {
    const current = instructions.find(instruction => instruction.address === machine.cpu.snapshot().pc);
    if (current) step(current);
  });
  restart.addEventListener("click", () => {
    machine = createMachine();
    lastFetched = null;
    if (operand) {
      operand.value = String(machine.ram.read(0x104));
      operand.removeAttribute("aria-invalid");
      operandError!.textContent = "";
    }
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
