import type { Cpu6502StepRecord } from "../../src/components/cpus/generated/6502-cpu.js";
import type { createApple2Session } from "./apple2-session.js";
import type { DebugLocation, DebugStep } from "./instruction-debugger.js";
import type { InstructionCatalogue } from "./apple2-explorer.js";

type Machine = ReturnType<typeof createApple2Session>["machine"];

/** Mapping is observed directly; checking a breakpoint never reads the guest bus. */
export function apple2DebugLocation(machine: Machine): DebugLocation {
  const { pc: address } = machine.cpu.snapshot(), language = machine.language.snapshot();
  const space = address < 0xc000 ? "ram" : address < 0xd000 ? "device"
    : !language.ram_read ? "rom" : address >= 0xe000 ? "lc-upper" : language.bank2 ? "lc-bank2" : "lc-bank1";
  return { address, space };
}

/** Completed records supply all call tracking; never decode arbitrary stack bytes as callers. */
export function apple2DebugStep(record: Cpu6502StepRecord, after: DebugLocation, catalogue: InstructionCatalogue): DebugStep {
  const info = catalogue[record.instruction.bytes[0]!];
  return {
    after, stackBefore: record.before.sp, stackAfter: record.after.sp, flow: info?.stackFlow,
    returnAddress: (record.instruction.address + (info?.length ?? 1)) & 0xffff,
    resetsStack: !!info?.writes?.registers.includes("sp") && !info.stackFlow
      && !info.accesses?.some(access => access !== "fetch"),
  };
}
