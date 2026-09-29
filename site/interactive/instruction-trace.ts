import { hex } from "./register-programs.js";
import type { CompletedInstruction } from "./register-programs.js";

/** Describe the captured execution; later panel or memory edits cannot rewrite it. */
export function format8080Trace(record: CompletedInstruction, mnemonic: string): string {
  const flags = ["s", "z", "ac", "p", "cy"] as const;
  return [
    `${hex(record.instruction.address, 4)}: ${record.instruction.bytes.map(byte => hex(byte, 2)).join(" ")}  ${mnemonic}`,
    `A: ${record.before.a} → ${record.after.a} (decimal)`,
    ...(record.before.b !== record.after.b ? [`B: ${record.before.b} → ${record.after.b} (decimal)`] : []),
    ...(record.before.hl !== record.after.hl ? [`HL: ${hex(record.before.hl, 4)} → ${hex(record.after.hl, 4)} (hexadecimal)`] : []),
    ...(record.before.sp !== record.after.sp ? [`SP: ${hex(record.before.sp, 4)} → ${hex(record.after.sp, 4)} (hexadecimal)`] : []),
    `PC: ${hex(record.before.pc, 4)} → ${hex(record.after.pc, 4)} (hexadecimal)`,
    ...(record.after.halted ? ["CPU: halted"] : []),
    `Flags: ${flags.map(flag => `${flag.toUpperCase()} ${Number(record.before.flags[flag])} → ${Number(record.after.flags[flag])}`).join(", ")}`,
    "", "Memory and port accesses (hexadecimal):",
    ...record.accesses.map(access => "address" in access
      ? `${access.kind === "read" ? "Read " : "Write"} ${hex(access.address, 4)}: ${hex(access.value, 2)}`
      : `${access.kind === "input" ? "Input from" : "Output to"} port ${hex(access.port, 2)}: ${hex(access.value, 2)}`),
  ].join("\n");
}
