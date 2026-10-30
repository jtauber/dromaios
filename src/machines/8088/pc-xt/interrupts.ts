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
