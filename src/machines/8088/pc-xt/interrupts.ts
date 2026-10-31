import type { Cpu8088 } from "../../../components/cpus/generated/8088-cpu.ts";
import type { XtIo } from "./io.ts";

/** One untimed CPU boundary; IF, STI/MOV SS shadows, and traps remain CPU decisions. */
export function stepXtCpu(machine: { readonly cpu: Cpu8088; readonly io: XtIo }) {
  if (machine.io.irq) {
    const record = machine.cpu.interrupt("intr", () => machine.io.acknowledge());
    if (record.outcome !== "ignored") return record;
  }
  return machine.cpu.step();
}

/** Grant at most one refresh, then a CPU boundary; an idle halt visits the next PIT pulse. */
export function stepTimedXtCpu({ cpu, io }: { readonly cpu: Cpu8088; readonly io: XtIo }) {
  const refresh = io.serviceRefresh();
  const offered = io.irq ? cpu.interruptTimed("intr", () => io.acknowledge()) : undefined;
  const record = offered && offered.outcome !== "ignored" ? offered : cpu.stepTimed();
  const oscillatorTicks = record.clocks === 0 ? 12 - io.oscillatorTicks % 12 : record.clocks * 3;
  io.advanceOscillatorTicks(oscillatorTicks);
  return { record, refresh, oscillatorTicks: oscillatorTicks + (refresh?.oscillatorTicks ?? 0) };
}
