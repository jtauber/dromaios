import type { Cpu6502Snapshot, Cpu6502MemoryAccess } from "../../src/components/cpus/generated/6502-cpu.js";
import type { InstructionCatalogue } from "./apple2-explorer.js";
import { hex } from "./apple2-explorer.js";

/** Explain observed addresses using chapter notation and its declared bus order, not new guest reads. */
export function explain6502Address(state: Cpu6502Snapshot, info: InstructionCatalogue[number],
  bytes: readonly (number | undefined)[], accesses: readonly Cpu6502MemoryAccess[], blocked?: number) {
  const data = accesses.filter((_, index) => info?.accesses?.[index] === "read" || info?.accesses?.[index] === "write");
  const last = data.at(-1), lines: string[] = [];
  const mode = info?.name.slice(info.name.indexOf(" ") + 1), low = bytes[1], high = bytes[2];
  const word = low === undefined || high === undefined ? undefined : low | high << 8;
  const target = blocked ?? last?.address;
  const address = (value: number) => `$${hex(value)}`;
  const byte = (value: number) => `$${hex(value, 2)}`;
  if (mode === "#byte" && low !== undefined) lines.push(`Operand: ${byte(low)}`);
  else if (mode === "relative" && low !== undefined) {
    const displacement = low < 128 ? low : low - 256;
    lines.push(`Offset: ${displacement >= 0 ? "+" : ""}${displacement} bytes from ${address((state.pc + 2) & 0xffff)}.`);
  } else if (mode === "(zero page,X)" || mode === "(zero page),Y" || mode === "indirect") {
    const pointer = data[0], upper = data[1];
    if (pointer && low !== undefined && mode === "(zero page,X)") {
      lines.push(`${byte(low)} + X(${byte(state.x)}) → pointer ${address(pointer.address)} (zero page).`);
    }
    if (pointer && upper) {
      const base = pointer.value | upper.value << 8;
      lines.push(`Pointer ${address(pointer.address)}/${address(upper.address)} → ${address(base)} (low byte first).`);
      if (mode === "(zero page),Y" && target !== undefined) lines.push(`${address(base)} + Y(${byte(state.y)}) → ${address(target)}.`);
    }
  } else if ((mode?.startsWith("zero page") || mode?.startsWith("absolute")) && target !== undefined && low !== undefined) {
    const indexed = mode.endsWith(",X") ? "x" : mode.endsWith(",Y") ? "y" : undefined;
    if (indexed && (mode.startsWith("zero page") || word !== undefined)) {
      lines.push(`${mode.startsWith("zero page") ? byte(low) : address(word!)} + ${indexed.toUpperCase()}(${byte(state[indexed])}) → ${address(target)}${mode.startsWith("zero page") ? " (zero page)" : ""}.`);
    }
  }
  for (const access of data) lines.push(`${access.kind === "read" ? "Read" : "Write"} ${address(access.address)} ${access.kind === "read" ? "→" : "←"} ${byte(access.value)}`);
  return { lines, data };
}
