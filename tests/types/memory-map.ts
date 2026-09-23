import { MemoryMap } from "../../src/components/memory/memory-map.js";
import type { MemoryRegion } from "../../src/components/memory/memory-map.js";
import type { MemoryConnection } from "../../src/components/memory/connection.js";
import { Ram } from "../../src/components/memory/ram.js";
import { Rom } from "../../src/components/memory/rom.js";
import { Cpu68000 } from "../../src/components/cpus/generated/68000-cpu.js";
import { create68000RomBootExample } from "../../src/machines/generated/68000/rom-boot-example.js";

// Compiled, never called: RAM, ROM, and maps share the connection without erasing concrete types.
export function checkMemoryMap(): void {
  const ram = new Ram(256), rom = new Rom([0x12, 0x34] as const);
  const regions = [{ start: 0, memory: rom }, { start: 0x100, memory: ram }] as const satisfies readonly MemoryRegion[];
  const memory: MemoryConnection = new MemoryMap(0x1000000, regions);
  const byte: number | "bus-error" = memory.read(0);
  const written: void | "bus-error" = memory.write(0, 0);
  // @ts-expect-error Map size is readonly.
  memory.size = 0;
  // @ts-expect-error The connection may report a failed read.
  const successfulByte: number = memory.read(0);
  // @ts-expect-error Every region supplies a complete memory connection.
  new MemoryMap(256, [{ start: 0, memory: { read: () => 0 } }]);
  const machine: { cpu: Cpu68000; memory: MemoryMap; rom: Rom; ram: Ram } = create68000RomBootExample();
}
