import type { Cpu8008, Cpu8008StepRecord } from "../../src/components/cpus/generated/8008-cpu.js";
import type { Cpu8080, Cpu8080StepRecord } from "../../src/components/cpus/generated/8080-cpu.js";
import type { Cpu6502, Cpu6502StepRecord } from "../../src/components/cpus/6502.js";
import type { Cpu6800, Cpu6800StepRecord } from "../../src/components/cpus/6800.js";
import type { Cpu6809, Cpu6809StepRecord } from "../../src/components/cpus/6809.js";
import type { CpuZ80, CpuZ80StepRecord } from "../../src/components/cpus/z80.js";
import { runCpu } from "../../src/runtime/run-cpu.js";
import type { CpuRunOptions, CpuRunResult } from "../../src/runtime/run-cpu.js";

// Compiled by npm test; never called. Preserve inference and each CPU's record union.
export function checkRecordTypes(intel: Cpu8080, mos: Cpu6502, motorola: Cpu6809, zilog: CpuZ80): void {
  const zilogRun = runCpu(zilog, { maxSteps: 4 });
  const zilogResult: CpuRunResult<CpuZ80StepRecord> = zilogRun;
  if (zilogRun.records[0]) {
    const pv: boolean = zilogRun.records[0].after.alternate.flags.pv;
    // @ts-expect-error The Z80 retains its own flag names.
    zilogRun.records[0].after.flags.cy;
    // @ts-expect-error Nested snapshots stay readonly through the runner.
    zilogRun.records[0].after.alternate.a = 0;
  }
  const intelRun = runCpu(intel, { maxSteps: 5 });
  const intelResult: CpuRunResult<Cpu8080StepRecord> = intelRun;
  const intelRecord = intelRun.records[0];
  if (intelRecord) {
    const hl: number = intelRecord.after.hl;
    if (intelRecord.outcome === "unsupported") {
      const reason: "opcode" = intelRecord.reason;
    }
    if (intelRecord.outcome === "halted") {
      // @ts-expect-error A halted instruction may be null.
      intelRecord.instruction.bytes;
    }
    // @ts-expect-error Register snapshots stay readonly through the runner.
    intelRecord.after.hl = 0;
    // @ts-expect-error Public nested flags stay readonly.
    intelRecord.after.flags.cy = false;
    // @ts-expect-error The record array is readonly.
    intelRun.records.push(intelRecord);
  }
  // @ts-expect-error Run results cannot replace their record array.
  intelRun.records = [];
  // @ts-expect-error Run results are readonly.
  intelRun.stopReason = "completed";

  const mosRun = runCpu(mos, { maxSteps: 5, endAddress: 0x0208 });
  const mosResult: CpuRunResult<Cpu6502StepRecord> = mosRun;
  const mosRecord = mosRun.records[0];
  if (mosRecord) {
    const bytes: readonly number[] = mosRecord.instruction.bytes;
    // @ts-expect-error The 6502 record does not acquire an 8080 register view.
    mosRecord.after.hl;
    // @ts-expect-error Instruction bytes remain readonly.
    mosRecord.instruction.bytes.push(0);
    if (mosRecord.outcome === "unsupported") {
      const reason: "opcode" = mosRecord.reason;
    } else {
      // @ts-expect-error Executed records do not acquire an unsupported reason.
      mosRecord.reason;
    }
  }

  const motorolaRun = runCpu(motorola, { maxSteps: 5, endAddress: 0x0207 });
  const motorolaResult: CpuRunResult<Cpu6809StepRecord> = motorolaRun;
  if (motorolaRun.records[0]) {
    const d: number = motorolaRun.records[0].after.d;
    const u: number = motorolaRun.records[0].after.u;
    // @ts-expect-error The 6809 has no 6502 SP field.
    motorolaRun.records[0].after.sp;
  }
}

export function checkWaitingCpu(cpu: Cpu6800): void {
  const result = runCpu(cpu, { maxSteps: 1 });
  const concrete: CpuRunResult<Cpu6800StepRecord> = result;
  const record = result.records[0];
  if (record?.outcome === "waiting") {
    const waiting: boolean = record.after.waiting;
    // @ts-expect-error An already waiting step has no fetched instruction.
    record.instruction.bytes;
    // @ts-expect-error Waiting state stays readonly through the runner.
    record.after.waiting = false;
  }
}

export function checkSelectedCpu(cpu: Cpu8008 | Cpu8080 | Cpu6502 | Cpu6800 | Cpu6809 | CpuZ80): void {
  const records: readonly (Cpu8008StepRecord | Cpu8080StepRecord | Cpu6502StepRecord | Cpu6800StepRecord | Cpu6809StepRecord | CpuZ80StepRecord)[] =
    runCpu(cpu, { maxSteps: 5 }).records;
}

export function checkOptions(options: CpuRunOptions): void {
  // @ts-expect-error The caller's configuration is readonly.
  options.maxSteps = 3;
  // @ts-expect-error The caller's completion address is readonly.
  options.endAddress = 4;
  const cpu = { snapshot: () => ({ pc: 0 }), step: () => ({ outcome: "executed", detail: 42 } as const) };
  const result = runCpu(cpu, { maxSteps: 1 });
  if (result.records[0]) {
    const detail: 42 = result.records[0].detail;
  }
  // @ts-expect-error A step budget is required.
  runCpu(cpu, {});
  // @ts-expect-error The runner requires a numeric PC for completion checks.
  runCpu({ ...cpu, snapshot: () => ({ pc: "0000" }) }, { maxSteps: 1 });
  // @ts-expect-error Step outcomes must follow the supported execution contract.
  runCpu({ ...cpu, step: () => ({ outcome: "complete" }) }, { maxSteps: 1 });
}
