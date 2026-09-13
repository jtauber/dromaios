import { checkUnsigned } from "../components/validation.js";

interface StepResult {
  readonly outcome: "executed" | "halted" | "unsupported";
}

interface RunnableCpu<Step extends StepResult> {
  snapshot(): { readonly pc: number };
  step(): Step;
}

export interface CpuRunOptions {
  /** Maximum step calls, including unsupported and already halted attempts. */
  readonly maxSteps: number;
  /** Stop before stepping at this address; independent of CPU halt state. */
  readonly endAddress?: number;
}

export interface CpuRunResult<Step> {
  readonly records: readonly Step[];
  readonly stopReason: "completed" | "halted" | "unsupported" | "step-limit";
}

// Infer from the CPU so a selection of CPU types keeps the union of their records.
/** Run synchronously from current CPU state, retaining its original step records. */
export function runCpu<Cpu extends RunnableCpu<StepResult>>(
  cpu: Cpu,
  options: CpuRunOptions,
): CpuRunResult<ReturnType<Cpu["step"]>>;
export function runCpu<Step extends StepResult>(
  cpu: RunnableCpu<Step>,
  { maxSteps, endAddress }: CpuRunOptions,
): CpuRunResult<Step> {
  checkUnsigned("maxSteps", maxSteps, Number.MAX_SAFE_INTEGER);
  if (endAddress !== undefined) {
    checkUnsigned("endAddress", endAddress, Number.MAX_SAFE_INTEGER);
  }

  const records: Step[] = [];
  while (true) {
    // Completion wins over the limit, including on entry with a zero budget.
    if (endAddress !== undefined && cpu.snapshot().pc === endAddress) {
      return { records, stopReason: "completed" };
    }
    if (records.length === maxSteps) {
      return { records, stopReason: "step-limit" };
    }

    const record = cpu.step();
    records.push(record);
    // Keep a terminal CPU result even when that step also reaches the endpoint.
    if (record.outcome !== "executed") {
      return { records, stopReason: record.outcome };
    }
  }
}
