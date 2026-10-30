import type { Catalogue6809 } from "./6809-catalogue.js";
import type { Boundary6809 } from "./6809-instruction-preview.js";
import { decode6809 } from "./6809-disassembly.js";
import type { createInstructionDebugger, DebugLocation } from "./instruction-debugger.js";

/** Fetched bytes select chapter-derived effects. Observations never reread code, stack memory, or devices. */
export function create6809DebugObserver(policy: ReturnType<typeof createInstructionDebugger>, catalogue: Catalogue6809) {
  let waitingStack: number | undefined;
  return {
    reset(): void { waitingStack = undefined; },
    observe(record: Boundary6809, before: DebugLocation, after: DebugLocation): void {
      const instruction = record.instruction;
      const decoded = instruction && decode6809(address => instruction.bytes[(address - instruction.address) & 0xffff], instruction.address, catalogue);
      if (record.outcome === "unsupported" || instruction && !decoded?.complete) {
        waitingStack = undefined; policy.fail(after, "Instruction effects are unavailable; caller tracking stopped."); return;
      }
      const entered = record.outcome === "accepted";
      const stack = entered ? { flow: "interrupt" as const, register: "s" } : decoded?.shape?.stack;
      if (entered && record.before.waitMode === "cwai" && waitingStack === undefined) {
        policy.observeBoundary(); policy.loseTracking(after, "The waiting interrupt frame was not observed; its caller is unknown."); return;
      }
      if (instruction && record.after.waitMode === "cwai") waitingStack = record.before.s;
      const register = stack?.register === "u" ? "u" : "s";
      // Addressing can adjust S before a call. Its return restores S just before the PC push,
      // rather than necessarily the value at the start of the instruction.
      const stacked = stack?.flow === "call" || stack?.flow === "interrupt";
      const writes = stacked ? record.accesses.filter(access => access.kind === "write").length : 0;
      const stackBefore = entered && record.before.waitMode === "cwai" ? waitingStack!
        : stacked ? (record.after[register] + writes) & 0xffff : record.before[register];
      policy.observe({ before, after, stackRegister: register, stackBefore, stackAfter: record.after[register], flow: stack?.flow,
        returnAddress: instruction ? (instruction.address + instruction.bytes.length) & 0xffff : record.before.pc,
        resetsStack: decoded?.shape?.replacedStacks?.includes("s") ?? false });
      if (entered) waitingStack = undefined;
    },
  };
}
