import type { Cpu6809Snapshot } from "../../src/components/cpus/generated/6809-cpu.js";
import type { Decoded6809 } from "./6809-disassembly.js";
import { hex6809 as hex } from "./6809-disassembly.js";

/** Explain address formation in Motorola notation; execution and validity remain the CPU's responsibility. */
export function explain6809Address(state: Cpu6809Snapshot, decoded: Decoded6809, read: (address: number) => number | undefined): string[] {
  if (!decoded.complete) return [];
  const bytes = decoded.bytes.slice(decoded.opcodeBytes) as readonly number[], byte = bytes[0]!;
  const signed = (value: number, bits: number) => value < 2 ** (bits - 1) ? value : value - 2 ** bits;
  const word = () => bytes[1]! * 256 + bytes[2]!;
  switch (decoded.info?.operand) {
    case "direct": return [`DP($${hex(state.dp, 2)}):$${hex(byte, 2)} → $${hex(state.dp * 256 + byte)}.`];
    case "extended": return [`Address $${hex(byte * 256 + bytes[1]!)} (high byte first).`];
    case "relative": return [`Next PC $${hex((state.pc + decoded.bytes.length) & 0xffff)} + signed displacement → $${hex(decoded.target!)}.`];
    case "indexed": {
      const register = (["x", "y", "u", "s"] as const)[byte >> 5 & 3]!, base = state[register];
      let address = base, description = `${register.toUpperCase()}($${hex(base)})`, offset = 0;
      if (byte < 128) offset = signed(byte & 31, 5);
      else switch (byte & 15) {
        case 0: case 1: description += ` then advance ${register.toUpperCase()} by ${(byte & 15) + 1}`; break;
        case 2: case 3: offset = -(byte & 15) + 1; description = `Predecrement ${description} by ${-offset}`; break;
        case 4: break;
        case 5: case 6: { const name = byte & 1 ? "b" : "a"; offset = signed(state[name], 8); description += ` + signed ${name.toUpperCase()}($${hex(state[name], 2)})`; break; }
        case 8: offset = signed(bytes[1]!, 8); break;
        case 9: offset = signed(word(), 16); break;
        case 11: offset = signed(state.d, 16); description += ` + signed D($${hex(state.d)})`; break;
        case 12: case 13:
          address = (state.pc + decoded.bytes.length) & 0xffff; description = `Post-fetch PC($${hex(address)})`;
          offset = (byte & 15) === 12 ? signed(bytes[1]!, 8) : signed(word(), 16); break;
        case 15: address = word(); description = `Extended pointer $${hex(address)}`; break;
      }
      address = (address + offset) & 0xffff;
      const lines = [`${description}${offset ? ` (offset ${offset})` : ""} → $${hex(address)}.`];
      if (byte >= 128 && (byte & 16)) {
        const next = (address + 1) & 0xffff, high = read(address), low = read(next);
        lines.push(high === undefined || low === undefined ? `Pointer at $${hex(address)}: unavailable storage.`
          : `Pointer $${hex(address)}/$${hex(next)} → $${hex(high * 256 + low)} (high byte first).`);
      }
      return lines;
    }
    default: return [];
  }
}
