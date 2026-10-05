import type { createApple2Session } from "./apple2-session.js";
import { createApple2RunTarget, formatApple2Trace, hex, parseApple2Address, romRoutine } from "./apple2-explorer.js";
import type { Apple2TraceEntry, InstructionCatalogue, AddressLabel, MemoryLabel, RomRegion } from "./apple2-explorer.js";
import { createApple2Disassembly } from "./apple2-disassembly-view.js";
import { createApple2History } from "./apple2-history-view.js";
import { createApple2RomReference } from "./apple2-rom-reference-view.js";

type Machine = ReturnType<typeof createApple2Session>["machine"];

export function createApple2Explorer(root: HTMLElement, machine: () => Machine | undefined, run: () => void, shouldUpdate: (id: string) => boolean, navigation: {
  readonly memoryAddress: () => number;
  readonly browseMemory: (address: number) => void;
  readonly showPanel: (id: string) => void;
}) {
  const element = <T extends HTMLElement>(name: string) => root.querySelector<T>(`[data-${name}]`)!;
  const catalogue = JSON.parse(element("rom-catalogue").textContent!) as {
    readonly instructions: InstructionCatalogue; readonly routines: readonly AddressLabel[];
    readonly labels: readonly MemoryLabel[]; readonly regions: readonly RomRegion[];
  };
  const optional = <T extends HTMLElement>(name: string) => root.querySelector<T>(`[data-${name}]`);
  const details = optional("rom-explorer"), current = optional("rom-current"), trace = optional("machine-trace");
  const routine = element<HTMLSelectElement>("rom-routine"), toRoutine = element<HTMLButtonElement>("rom-run-routine");
  const address = optional<HTMLInputElement>("rom-address"), toAddress = optional<HTMLButtonElement>("rom-run-address");
  const step = optional<HTMLButtonElement>("rom-step"), resume = optional<HTMLButtonElement>("rom-continue");
  const pause = optional<HTMLButtonElement>("rom-pause");
  const target = createApple2RunTarget();
  const disassembly = createApple2Disassembly(root, catalogue, address => { target.arm(address, false); run(); }, address => {
    reference?.select(address); navigation.showPanel("rom");
  }, { address: navigation.memoryAddress, browse: navigation.browseMemory, show: () => navigation.showPanel("memory") });
  const reference = createApple2RomReference(root, catalogue, (tool, address) => {
    if (tool === "code") disassembly?.browse(address);
    else navigation.browseMemory(address);
    navigation.showPanel(tool);
  });
  const history = createApple2History(root, catalogue);
  const stopMessages = root.querySelectorAll<HTMLElement>("[data-rom-stop-status], [data-disassembly-stop-status]");
  function showStopStatus(value: string, running = false): void {
    for (const message of stopMessages) {
      message.setAttribute("aria-live", running ? "off" : "polite");
      if (message.textContent !== value) message.textContent = value;
    }
  }
  step?.addEventListener("click", () => element<HTMLButtonElement>("machine-step").click());
  resume?.addEventListener("click", () => element<HTMLButtonElement>("machine-run").click());
  pause?.addEventListener("click", () => element<HTMLButtonElement>("machine-pause").click());
  function start(value: string, romOnly: boolean): void {
    try { target.arm(parseApple2Address(value), romOnly); }
    catch (error) { showStopStatus((error as Error).message); return; }
    run();
  }
  toRoutine.addEventListener("click", () => start(routine.value, true));
  toAddress?.addEventListener("click", () => start(address!.value, false));
  address?.addEventListener("keydown", event => {
    if (event.key === "Enter" && toAddress && !toAddress.disabled) { event.preventDefault(); start(address.value, false); }
  });
  return {
    controls: (id: string) => id === "code" ? disassembly?.controls : undefined,
    cancel(): void { target.cancel(); showStopStatus(""); },
    pauseBeforeStep(): boolean {
      if (!target.active) return false;
      const selected = machine()!;
      return target.pauseBeforeStep(selected.cpu.snapshot().pc, !selected.language.ramRead());
    },
    refresh(records: readonly Apple2TraceEntry[], available: boolean, running: boolean): void {
      for (const control of [routine, address, toRoutine, toAddress, step, resume]) {
        if (control) control.disabled = !available || running;
      }
      if (pause) pause.disabled = !running;
      showStopStatus(target.status, running);
      const selected = machine();
      disassembly?.refresh(selected, records, available, running, shouldUpdate("code"));
      history?.refresh(records, shouldUpdate("trace"));
      if (selected) reference?.refresh({ pc: selected.cpu.snapshot().pc, memory: navigation.memoryAddress(),
        installed: selected.firmware.loaded, mapped: !selected.language.ramRead() }, shouldUpdate("rom"));
      if (!current || !trace) return;
      if (details instanceof HTMLDetailsElement && !details.open) return;
      if (selected === undefined) { current.textContent = "Choose a ROM to begin."; trace.textContent = ""; return; }
      const { pc } = selected.cpu.snapshot(), mapped = !selected.language.ramRead();
      const label = romRoutine(pc, mapped && selected.firmware.loaded, catalogue.routines);
      if (!selected.firmware.loaded) {
        current.textContent = `PC $${hex(pc)} · initial state; firmware not installed`;
        trace.textContent = "No instructions recorded yet. Install firmware to boot.";
        return;
      }
      current.textContent = `Next PC $${hex(pc)}${pc >= 0xd000 ? mapped ? " · ROM" : " · Language Card RAM" : ""}`
        + (label ? `\n${label.name}` : "");
      trace.textContent = records.length
        ? records.map(record => formatApple2Trace(record, catalogue.instructions, catalogue.routines)).reverse().join("\n\n")
        : "No instructions recorded yet. Step to begin.";
    },
  };
}
