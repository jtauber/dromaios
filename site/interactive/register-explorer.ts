import { create8080RegisterLesson } from "../../src/machines/generated/8080/register-lesson.js";
import { mountMemoryEditor } from "./memory-editor.js";

/** The buttons advance a fixed program; only the CPU writes its accumulator. */
export function mountRegisterExplorer(lesson: HTMLElement, root: HTMLElement): void {
  let machine = create8080RegisterLesson();
  const read = lesson.querySelector<HTMLButtonElement>("[data-register-read]")!;
  const write = lesson.querySelector<HTMLButtonElement>("[data-register-write]")!;
  const next = lesson.querySelector<HTMLElement>("[data-register-next]")!;
  const last = lesson.querySelector<HTMLElement>("[data-register-last]")!;
  const trace = lesson.querySelector<HTMLElement>("[data-register-trace]")!;
  const memoryLabel = lesson.querySelector<HTMLElement>("[data-memory-label]")!;
  const editor = mountMemoryEditor(lesson, root, () => machine.ram, { size: 8, address: 3, onEdit: render });
  const loadAddress = machine.cpu.snapshot().pc;
  const storeAddress = loadAddress + 3;

  function hex(value: number, digits: number): string { return value.toString(16).toUpperCase().padStart(digits, "0"); }

  function render(): void {
    const state = machine.cpu.snapshot();
    lesson.querySelector<HTMLElement>("[data-register-value]")!.textContent = String(state.a);
    const binary = state.a.toString(2).padStart(8, "0");
    lesson.querySelector<HTMLElement>("[data-register-binary]")!.textContent = `${binary.slice(0, 4)} ${binary.slice(4)}`;
    lesson.querySelector<HTMLElement>("[data-register-hex]")!.textContent = hex(state.a, 2);
    lesson.querySelector<HTMLElement>("[data-register-pc]")!.textContent = hex(state.pc, 4);
    memoryLabel.textContent = `Change the byte at address ${editor.address}`;
    read.disabled = !editor.valid || state.pc !== loadAddress;
    write.disabled = !editor.valid || state.pc !== storeAddress;
    next.textContent = !editor.valid ? "Finish entering a valid byte, or select another address, before continuing."
      : state.pc === loadAddress ? "First, read address 3 into A. Predict which values will change."
      : state.pc === storeAddress ? "A has its own copy. You can change the byte at address 3 before writing A to address 4."
      : "Both instructions are complete. Edit memory to explore the independent copies, or start again.";
  }

  function step(address: number, instruction: string): void {
    if (!editor.valid || machine.cpu.snapshot().pc !== address) return;
    const previousDestination = machine.ram.read(4);
    const record = machine.cpu.step();
    if (record.outcome !== "executed") throw new Error("The register lesson expected a load or store instruction.");
    last.textContent = address === loadAddress
      ? `Read ${record.after.a} from address 3 into A, replacing ${record.before.a}. Reading left memory unchanged.`
      : `Wrote ${record.after.a} from A to address 4, replacing ${previousDestination}. A kept its value.`;
    trace.textContent = [
      `${hex(record.instruction.address, 4)}: ${record.instruction.bytes.map(byte => hex(byte, 2)).join(" ")}  ${instruction}`,
      `A: ${record.before.a} → ${record.after.a} (decimal)`,
      `PC: ${hex(record.before.pc, 4)} → ${hex(record.after.pc, 4)} (hexadecimal)`,
      "Flags: unchanged", "", "Memory accesses (hexadecimal):",
      ...record.accesses.flatMap(access => access.kind === "read" || access.kind === "write"
        ? [`${access.kind === "read" ? "Read " : "Write"} ${hex(access.address, 4)}: ${hex(access.value, 2)}`] : []),
    ].join("\n");
    editor.refresh();
    render();
    // Keep keyboard progression on an enabled control after its predecessor becomes disabled.
    if (address === loadAddress) write.focus();
    else lesson.querySelector<HTMLButtonElement>("[data-register-restart]")!.focus();
  }

  read.addEventListener("click", () => { step(loadAddress, "LDA 0003H"); });
  write.addEventListener("click", () => { step(storeAddress, "STA 0004H"); });
  lesson.querySelector<HTMLButtonElement>("[data-register-restart]")!.addEventListener("click", () => {
    machine = create8080RegisterLesson();
    editor.select(3);
    last.textContent = "No instruction has run. A starts at 0.";
    trace.textContent = "No instruction has run.";
    render();
    read.focus();
  });
  render();
  lesson.querySelector<HTMLFieldSetElement>("[data-register-controls]")!.disabled = false;
}
