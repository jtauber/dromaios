import type { createApple2Session } from "./apple2-session.js";
import { createApple2RunTarget, formatApple2Instruction, formatApple2Trace, hex, parseApple2Address, romRoutine } from "./apple2-explorer.js";
import type { Apple2TraceEntry, InstructionCatalogue, RomRoutine } from "./apple2-explorer.js";
import { createApple2Disassembly } from "./apple2-disassembly-view.js";

type Machine = ReturnType<typeof createApple2Session>["machine"];

export function createApple2Explorer(root: HTMLElement, machine: () => Machine | undefined, run: () => void) {
  const element = <T extends HTMLElement>(name: string) => root.querySelector<T>(`[data-${name}]`)!;
  const catalogue = JSON.parse(element("rom-catalogue").textContent!) as {
    readonly instructions: InstructionCatalogue; readonly routines: readonly RomRoutine[];
  };
  const details = element("rom-explorer"), current = element("rom-current");
  const routine = element<HTMLSelectElement>("rom-routine"), address = element<HTMLInputElement>("rom-address");
  const toRoutine = element<HTMLButtonElement>("rom-run-routine"), toAddress = element<HTMLButtonElement>("rom-run-address");
  const message = element("rom-stop-status"), trace = element("machine-trace");
  const step = element<HTMLButtonElement>("rom-step"), resume = element<HTMLButtonElement>("rom-continue");
  const pause = element<HTMLButtonElement>("rom-pause");
  const detail = root.querySelector<HTMLElement>("[data-instruction-detail]");
  const compact = trace.hasAttribute("data-trace-compact");
  const target = createApple2RunTarget();
  const disassembly = createApple2Disassembly(root, catalogue, address => { target.arm(address, false); run(); });
  const stopMessages = root.querySelectorAll<HTMLElement>("[data-rom-stop-status], [data-disassembly-stop-status]");
  function showStopStatus(value: string, running = false): void {
    for (const message of stopMessages) {
      message.setAttribute("aria-live", running ? "off" : "polite");
      if (message.textContent !== value) message.textContent = value;
    }
  }
  step.addEventListener("click", () => element<HTMLButtonElement>("machine-step").click());
  resume.addEventListener("click", () => element<HTMLButtonElement>("machine-run").click());
  pause.addEventListener("click", () => element<HTMLButtonElement>("machine-pause").click());
  function start(value: string, romOnly: boolean): void {
    try { target.arm(parseApple2Address(value), romOnly); }
    catch (error) { message.textContent = (error as Error).message; return; }
    run();
  }
  toRoutine.addEventListener("click", () => start(routine.value, true));
  toAddress.addEventListener("click", () => start(address.value, false));
  address.addEventListener("keydown", event => {
    if (event.key === "Enter" && !toAddress.disabled) { event.preventDefault(); start(address.value, false); }
  });
  return {
    cancel(): void { target.cancel(); showStopStatus(""); },
    pauseBeforeStep(): boolean {
      if (!target.active) return false;
      const selected = machine()!;
      return target.pauseBeforeStep(selected.cpu.snapshot().pc, !selected.language.ramRead());
    },
    refresh(records: readonly Apple2TraceEntry[], available: boolean, running: boolean): void {
      routine.disabled = address.disabled = toRoutine.disabled = toAddress.disabled = !available || running;
      step.disabled = resume.disabled = !available || running;
      pause.disabled = !running;
      showStopStatus(target.status, running);
      const selected = machine();
      disassembly?.refresh(selected, records, available, running);
      if (details instanceof HTMLDetailsElement && !details.open) return;
      if (selected === undefined) { current.textContent = "Choose a ROM to begin."; trace.textContent = ""; return; }
      const { pc } = selected.cpu.snapshot(), mapped = !selected.language.ramRead();
      const label = romRoutine(pc, mapped && selected.firmware.loaded, catalogue.routines);
      if (!selected.firmware.loaded) {
        current.textContent = `PC $${hex(pc)} · initial state; firmware not installed`;
        trace.textContent = "No instructions recorded yet. Install firmware to boot.";
        if (detail) detail.textContent = "No instruction has executed. The CPU has not been reset.";
        return;
      }
      current.textContent = `Next PC $${hex(pc)}${pc >= 0xd000 ? mapped ? " · ROM" : " · Language Card RAM" : ""}`
        + (label ? `\n${label.name}` : "");
      trace.textContent = records.length ? records.map(record => compact ? formatApple2Instruction(record, catalogue.instructions)
        : formatApple2Trace(record, catalogue.instructions, catalogue.routines)).reverse().join(compact ? "\n" : "\n\n")
        : "No instructions recorded yet. Step to begin.";
      if (detail) detail.textContent = records.length
        ? formatApple2Trace(records.at(-1)!, catalogue.instructions, catalogue.routines)
        : "No instructions recorded yet. Step to begin.";
    },
  };
}
