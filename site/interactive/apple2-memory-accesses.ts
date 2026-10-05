import type { Cpu6502MemoryAccess } from "../../src/components/cpus/generated/6502-cpu.js";

export const memoryAccessRoles = ["fetch", "read", "write"] as const;
export type MemoryAccessRole = typeof memoryAccessRoles[number];
export type UpcomingMemoryAccesses = ReadonlyMap<number, readonly MemoryAccessRole[]>;

/** Classify the preview's observed bus requests using the chapter's access order. */
export function upcomingMemoryAccesses(accesses: readonly Cpu6502MemoryAccess[], order: readonly MemoryAccessRole[] = [], blocked?: number): UpcomingMemoryAccesses {
  const result = new Map<number, MemoryAccessRole[]>();
  function add(address: number, role: MemoryAccessRole): void {
    const roles = result.get(address) ?? [];
    if (!roles.includes(role)) roles.push(role);
    result.set(address, roles);
  }
  accesses.forEach((access, index) => add(access.address, order[index] ?? (index === 0 ? "fetch" : access.kind)));
  if (blocked !== undefined) add(blocked, order[accesses.length] ?? (accesses.length === 0 ? "fetch" : "read"));
  return result;
}

/** Keep occupied entries and expose pending pushes or wrapped pulls outside them. */
export function apple2StackAddresses(sp: number, upcoming: UpcomingMemoryAccesses): readonly number[] {
  const pending = [...upcoming].filter(([address, roles]) => address >= 0x100 && address <= 0x100 + sp
    && roles.some(role => role !== "fetch")).map(([address]) => address);
  return [...pending, ...Array.from({ length: 0xff - sp }, (_, offset) => 0x101 + sp + offset)];
}
