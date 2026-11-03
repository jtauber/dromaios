import type { Cpu8088 } from "../../../components/cpus/generated/8088-cpu.ts";
import type { XtIo } from "./io.ts";
import type { ByteMemoryConnection } from "../../../components/memory/connection.ts";
import { checkUnsigned } from "../../../components/validation.ts";

interface ClockedDisplay { advanceOscillatorTicks(ticks: number): void }
interface XtDevices { readonly io: XtIo; readonly cga?: ClockedDisplay; readonly ega?: ClockedDisplay }

export interface XtCpuBoard extends XtDevices {
  readonly cpu: Cpu8088;
  /** The small refresh-only examples have no peripheral DMA bus. */
  readonly memory?: ByteMemoryConnection;
}

function advanceDisplay(display: ClockedDisplay | undefined, ticks: number): void {
  if (!display) return;
  while (ticks > 0) {
    const interval = Math.min(ticks, 255);
    display.advanceOscillatorTicks(interval);
    ticks -= interval;
  }
}

/** Advance the board and its optional display from the same oscillator interval. */
export function advanceXtOscillatorTicks({ io, cga, ega }: XtDevices, ticks: number): void {
  checkUnsigned("XT oscillator interval", ticks, 0xffff_ffff);
  io.advanceOscillatorTicks(ticks);
  advanceDisplay(ega ?? cga, ticks);
}

/** Offer NMI before INTR; recognition delays and traps remain CPU decisions. */
export function stepXtCpu(machine: { readonly cpu: Cpu8088; readonly io: XtIo }) {
  const { cpu, io } = machine;
  return io.runCpuBoundary(intr => {
    if (io.nmiPending) {
      const record = cpu.interrupt("nmi");
      if (record.outcome === "accepted") {
        io.acknowledgeNmi();
        return record;
      }
    }
    if (intr) {
      const record = cpu.interrupt("intr", () => io.acknowledge());
      if (record.outcome !== "ignored") return record;
    }
    return cpu.step();
  });
}

/** Grant at most one DMA transfer, then a CPU boundary; an idle halt visits the next PIT pulse. */
export function stepTimedXtCpu(machine: XtCpuBoard) {
  const { cpu, io, cga, ega } = machine;
  const dma = io.serviceDma(machine.memory);
  if (dma) advanceDisplay(ega ?? cga, dma.oscillatorTicks);
  const record = io.runCpuBoundary(intr => {
    let offered = io.nmiPending ? cpu.interruptTimed("nmi") : undefined;
    if (offered?.outcome === "accepted") io.acknowledgeNmi();
    else if (intr) offered = cpu.interruptTimed("intr", () => io.acknowledge());
    return offered && offered.outcome !== "ignored" ? offered : cpu.stepTimed();
  });
  const oscillatorTicks = record.clocks === 0 ? 12 - io.oscillatorTicks % 12 : record.clocks * 3;
  advanceXtOscillatorTicks(machine, oscillatorTicks);
  const refresh = dma?.channel === 0 ? { address: dma.address, oscillatorTicks: dma.oscillatorTicks } : undefined;
  return { record, dma, refresh, oscillatorTicks: oscillatorTicks + (dma?.oscillatorTicks ?? 0) };
}
