import { createInstructionDebugger } from "./instruction-debugger.js";
import type { DebugLocation } from "./instruction-debugger.js";
import { createApple2CallStack } from "./apple2-call-stack-view.js";
import { apple2Watchpoint, describeApple2Watchpoint } from "./apple2-watchpoints.js";
import type { MemoryWatch } from "./apple2-watches.js";
import type { Apple2MemoryChange } from "./apple2-inspection.js";
import { apple2DebugLocation, apple2DebugStep } from "./apple2-debugger.js";
import { apple2StorageReader } from "./apple2-inspection.js";
import { createApple2Breakpoints } from "./apple2-breakpoint-view.js";
import type { Cpu6502StepRecord } from "../../src/components/cpus/generated/6502-cpu.js";
import type { createApple2Session } from "./apple2-session.js";
import { formatApple2Trace, hex, parseApple2Address, romRoutine } from "./apple2-explorer.js";
import type { Apple2TraceEntry, InstructionCatalogue, AddressLabel, MemoryLabel, RomRegion } from "./apple2-explorer.js";
import { createApple2Disassembly } from "./apple2-disassembly-view.js";
import { createApple2History } from "./apple2-history-view.js";
import { createApple2RomReference } from "./apple2-rom-reference-view.js";
import { createApple2DeviceHistoryView } from "./apple2-device-history-view.js";
import type { Apple2HardwareCatalogue } from "./apple2-hardware.js";

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
    readonly hardware: Apple2HardwareCatalogue;
  };
  const optional = <T extends HTMLElement>(name: string) => root.querySelector<T>(`[data-${name}]`);
  const details = optional("rom-explorer"), current = optional("rom-current"), trace = optional("machine-trace");
  const routine = element<HTMLSelectElement>("rom-routine"), toRoutine = element<HTMLButtonElement>("rom-run-routine");
  const address = optional<HTMLInputElement>("rom-address"), toAddress = optional<HTMLButtonElement>("rom-run-address");
  const step = optional<HTMLButtonElement>("rom-step"), resume = optional<HTMLButtonElement>("rom-continue");
  const pause = optional<HTMLButtonElement>("rom-pause");
  const debuggerState = createInstructionDebugger();
  const location = () => apple2DebugLocation(machine()!);
  const breakpoints = createApple2Breakpoints(root, debuggerState, () => disassembly?.refreshBreakpoints());
  const disassembly = createApple2Disassembly(root, catalogue, address => { debuggerState.runTo(location(), address); run(); }, address => {
    reference?.select(address); navigation.showPanel("rom");
  }, { address: navigation.memoryAddress, browse: navigation.browseMemory, show: () => navigation.showPanel("memory") }, breakpoints);
  const reference = createApple2RomReference(root, catalogue, (tool, address) => {
    if (tool === "code") disassembly?.browse(address);
    else navigation.browseMemory(address);
    navigation.showPanel(tool);
  });
  const history = createApple2History(root, catalogue);
  const devices = createApple2DeviceHistoryView(root, catalogue.hardware, catalogue.instructions, target => {
    if (apple2DebugLocation(machine()!, target.address).space !== target.space) {
      return `Cannot browse $${hex(target.address)}: its observed ${target.space} mapping is no longer visible.`;
    }
    disassembly?.browse(target.address); navigation.showPanel("code");
  }, address => { navigation.browseMemory(address); navigation.showPanel("memory"); });
  const calls = createApple2CallStack(root, catalogue.routines, address => {
    disassembly?.browse(address); navigation.showPanel("code");
  });
  const stopMessages = root.querySelectorAll<HTMLElement>("[data-rom-stop-status], [data-disassembly-stop-status], [data-debugger-status]");
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
    try { debuggerState.runTo(location(), parseApple2Address(value), romOnly ? "rom" : undefined); }
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
    get canStepOut() { return debuggerState.canStepOut; },
    reset(): void { debuggerState.reset(); devices?.reset(); },
    run(): void { debuggerState.run(location()); },
    step(): void { debuggerState.step(location()); },
    over(): void {
      const selected = machine()!, opcode = apple2StorageReader(selected)(selected.cpu.snapshot().pc);
      debuggerState.over(location(), opcode === undefined ? undefined : catalogue.instructions[opcode]?.stackFlow);
    },
    out(): void { debuggerState.out(location()); },
    pause(detail?: string): void { debuggerState.pause(location(), detail); },
    fail(detail: string): void { debuggerState.fail(location(), detail); },
    observe(record: Cpu6502StepRecord, before: DebugLocation, watches: readonly MemoryWatch[], changes: readonly Apple2MemoryChange[]): void {
      devices?.observe(record, before);
      debuggerState.observe(apple2DebugStep(record, before, location(), catalogue.instructions));
      const hit = apple2Watchpoint(watches, record, catalogue.instructions, changes);
      if (hit) debuggerState.watchpoint(location(), describeApple2Watchpoint(hit, record.instruction.address));
    },
    pauseBeforeStep(): boolean { return debuggerState.beforeStep(location()); },
    refresh(records: readonly Apple2TraceEntry[], available: boolean, running: boolean): void {
      for (const control of [routine, address, toRoutine, toAddress, step, resume]) {
        if (control) control.disabled = !available || running;
      }
      if (pause) pause.disabled = !running;
      const stopped = debuggerState.stop;
      const reasons = { breakpoint: "Breakpoint", watchpoint: "Watchpoint", step: "Step complete", over: "Step over complete", out: "Step out complete",
        target: "Run-to address reached", limit: "Instruction limit reached; destination not reached", pause: "Paused",
        error: "Execution error", "tracking-lost": "Caller tracking lost" };
      showStopStatus(stopped ? `${reasons[stopped.kind]} at $${hex(stopped.location.address)}${stopped.location.space === "rom" ? " in ROM" : ""}.${stopped.detail ? ` ${stopped.detail}` : ""}`
        : running && debuggerState.request ? `Running · ${debuggerState.request === "target" ? "to address" : `step ${debuggerState.request}`}…` : "", running);
      const selected = machine();
      if (selected && shouldUpdate("activity")) devices?.refresh(selected.disk.inspect().installed);
      if (selected && shouldUpdate("calls")) calls?.refresh(debuggerState.frames, debuggerState.trackingNote, address => apple2DebugLocation(selected, address));
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
