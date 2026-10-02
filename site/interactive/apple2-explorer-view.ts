import type { createApple2Session } from "./apple2-session.js";
import { createApple2RunTarget, formatApple2Trace, hex, romRoutine } from "./apple2-explorer.js";
import type { Apple2TraceEntry, InstructionNames, RomRoutine } from "./apple2-explorer.js";

type Machine = ReturnType<typeof createApple2Session>["machine"];

export function createApple2Explorer(root: HTMLElement, machine: () => Machine | undefined, run: () => void) {
  const element = <T extends HTMLElement>(name: string) => root.querySelector<T>(`[data-${name}]`)!;
  const catalogue = JSON.parse(element("rom-catalogue").textContent!) as {
    readonly instructions: InstructionNames; readonly routines: readonly RomRoutine[];
  };
  const details = element<HTMLDetailsElement>("rom-explorer"), current = element("rom-current");
  const routine = element<HTMLSelectElement>("rom-routine"), address = element<HTMLInputElement>("rom-address");
  const toRoutine = element<HTMLButtonElement>("rom-run-routine"), toAddress = element<HTMLButtonElement>("rom-run-address");
  const message = element("rom-stop-status"), trace = element("machine-trace");
  const step = element<HTMLButtonElement>("rom-step"), resume = element<HTMLButtonElement>("rom-continue");
  const pause = element<HTMLButtonElement>("rom-pause");
  const target = createApple2RunTarget();
  step.addEventListener("click", () => element<HTMLButtonElement>("machine-step").click());
  resume.addEventListener("click", () => element<HTMLButtonElement>("machine-run").click());
  pause.addEventListener("click", () => element<HTMLButtonElement>("machine-pause").click());
  function start(value: string, romOnly: boolean): void {
    if (!/^\$?[\da-f]{1,4}$/i.test(value.trim())) {
      message.textContent = "Use a hexadecimal address from 0000 to FFFF.";
      return;
    }
    target.arm(parseInt(value.trim().replace(/^\$/, ""), 16), romOnly);
    run();
  }
  toRoutine.addEventListener("click", () => start(routine.value, true));
  toAddress.addEventListener("click", () => start(address.value, false));
  address.addEventListener("keydown", event => {
    if (event.key === "Enter" && !toAddress.disabled) { event.preventDefault(); start(address.value, false); }
  });
  return {
    cancel(): void { target.cancel(); message.textContent = ""; },
    pauseBeforeStep(): boolean {
      if (!target.active) return false;
      const selected = machine()!;
      return target.pauseBeforeStep(selected.cpu.snapshot().pc, !selected.language.ramRead());
    },
    refresh(records: readonly Apple2TraceEntry[], available: boolean, running: boolean): void {
      routine.disabled = address.disabled = toRoutine.disabled = toAddress.disabled = !available || running;
      step.disabled = resume.disabled = !available || running;
      pause.disabled = !running;
      message.textContent = target.status;
      if (!details.open) return;
      const selected = machine();
      if (selected === undefined) { current.textContent = "Choose a ROM to begin."; trace.textContent = ""; return; }
      const { pc } = selected.cpu.snapshot(), mapped = !selected.language.ramRead();
      const label = romRoutine(pc, mapped, catalogue.routines);
      current.textContent = `Next PC $${hex(pc)}${pc >= 0xd000 ? mapped ? " · ROM" : " · Language Card RAM" : ""}`
        + (label ? `\n${label.name}` : "");
      trace.textContent = records.length ? records.map(record => formatApple2Trace(record, catalogue.instructions, catalogue.routines)).reverse().join("\n\n")
        : "No instructions recorded yet. Step to begin.";
    },
  };
}
