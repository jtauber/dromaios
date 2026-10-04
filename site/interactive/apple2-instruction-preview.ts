import { Cpu6502 } from "../../src/components/cpus/generated/6502-cpu.js";
import type { Cpu6502Snapshot, Cpu6502StepRecord, Cpu6502MemoryAccess } from "../../src/components/cpus/generated/6502-cpu.js";
import { disassemble6502, hex } from "./apple2-explorer.js";
import type { InstructionCatalogue } from "./apple2-explorer.js";

/** Run one copied CPU against storage observations and private writes, never the guest bus. */
export function preview6502(state: Cpu6502Snapshot, read: (address: number) => number | undefined, instructions: InstructionCatalogue) {
  const accesses: Cpu6502MemoryAccess[] = [], writes = new Map<number, number>();
  const unavailable = Symbol("unavailable storage");
  let blocked: number | undefined, record: Cpu6502StepRecord | undefined;
  const cpu = new Cpu6502({ size: 0x10000,
    read(address) {
      const value = writes.get(address) ?? read(address);
      if (value === undefined) { blocked = address; throw unavailable; }
      accesses.push({ kind: "read", address, value }); return value;
    },
    write(address, value) {
      accesses.push({ kind: "write", address, value });
      // Normal RAM can be read again during this instruction (including overwritten operands).
      // Mapped writes are reported as bus requests, not assumed to change ROM or device state.
      if (address < 0xc000) writes.set(address, value);
    },
  }, state);
  try { record = cpu.step(); }
  catch (error) { if (error !== unavailable) throw error; }
  const opcode = read(state.pc), info = opcode === undefined ? undefined : instructions[opcode];
  const bytes = record?.instruction.bytes ?? Array.from({ length: info?.length ?? 1 }, (_, offset) => read((state.pc + offset) & 0xffff));
  const assembly = disassemble6502(state.pc, bytes, instructions), effects: string[] = [];
  if (blocked !== undefined) effects.push(`Read $${hex(blocked)}: device or unavailable storage.`, "Result cannot be previewed without executing.");
  else if (record?.outcome !== "executed") effects.push("Unsupported instruction.");
  else {
    for (const name of ["a", "x", "y", "sp"] as const) {
      if (state[name] !== record.after[name]) effects.push(`${name.toUpperCase()}  $${hex(state[name], 2)} → $${hex(record.after[name], 2)}`);
    }
    const flags = (["n", "v", "d", "i", "z", "c"] as const).filter(flag => state.flags[flag] !== record!.after.flags[flag]);
    if (flags.length) effects.push(flags.map(flag => `${flag.toUpperCase()} ${+state.flags[flag]} → ${+record!.after.flags[flag]}`).join("   "));
    for (const access of accesses) if (access.kind === "write") effects.push(`Write $${hex(access.address)} ← $${hex(access.value, 2)}`);
    if (!effects.length) effects.push("Registers and flags unchanged.");
    effects.push(`PC → $${hex(record.after.pc)}`);
  }
  return { assembly, effects, accesses, record, blocked };
}
