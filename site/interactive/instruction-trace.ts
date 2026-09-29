import { hex } from "./register-programs.js";
import type { ExecutedStep } from "./register-programs.js";

/** Describe the captured execution; later panel or memory edits cannot rewrite it. */
export function format8080Trace(record: ExecutedStep, mnemonic: string): string {
  const flags = ["s", "z", "ac", "p", "cy"] as const;
  return [
    `${hex(record.instruction.address, 4)}: ${record.instruction.bytes.map(byte => hex(byte, 2)).join(" ")}  ${mnemonic}`,
    `A: ${record.before.a} → ${record.after.a} (decimal)`,
    `PC: ${hex(record.before.pc, 4)} → ${hex(record.after.pc, 4)} (hexadecimal)`,
    `Flags: ${flags.map(flag => `${flag.toUpperCase()} ${Number(record.before.flags[flag])} → ${Number(record.after.flags[flag])}`).join(", ")}`,
    "", "Memory and port accesses (hexadecimal):",
    ...record.accesses.map(access => "address" in access
      ? `${access.kind === "read" ? "Read " : "Write"} ${hex(access.address, 4)}: ${hex(access.value, 2)}`
      : `${access.kind === "input" ? "Input from" : "Output to"} port ${hex(access.port, 2)}: ${hex(access.value, 2)}`),
  ].join("\n");
}
