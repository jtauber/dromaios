import { Cpu68000 } from "../../components/cpus/68000.ts";
import { MemoryMap } from "../../components/memory/memory-map.ts";
import { Ram } from "../../components/memory/ram.ts";
import { Rom } from "../../components/memory/rom.ts";

/** Allocate a ROM-boot machine without resetting or executing it. Call cpu.reset() to boot. */
export function create68000RomBootExample(): { cpu: Cpu68000; memory: MemoryMap; rom: Rom; ram: Ram } {
  const image = new Uint8Array(0x400);
  image.set([
    0x00, 0x01, 0x10, 0x00, // Initial SSP: 011000, just above RAM.
    0x00, 0x00, 0x01, 0x00, // Initial PC: 000100, in ROM.
    0x00, 0x00, 0x02, 0x00, // Vector 2: 000200, the bus-error handler.
  ]);
  image.set([
    0x20, 0x3c, 0x12, 0x34, 0x56, 0x78, // 0100: MOVE.L #12345678,D0
    0x23, 0xc0, 0x00, 0x01, 0x00, 0x00, // 0106: MOVE.L D0,(010000).L
    0x22, 0x39, 0x00, 0x02, 0x00, 0x00, // 010C: MOVE.L (020000).L,D1 — unmapped.
    0x23, 0xc0, 0x00, 0x01, 0x00, 0x04, // 0112: MOVE.L D0,(010004).L — resumed.
    0x4e, 0x72, 0x27, 0x00,             // 0118: STOP #2700
  ], 0x100);
  image.set([
    0x24, 0x2f, 0x00, 0x02,             // 0200: MOVE.L 2(A7),D2 — fault address.
    0x23, 0xc2, 0x00, 0x01, 0x00, 0x08, // 0204: MOVE.L D2,(010008).L
    0x72, 0x01,                         // 020A: MOVEQ #1,D1 — handled marker.
    0x50, 0x8f,                         // 020C: ADDQ.L #8,A7 — discard extra frame bytes.
    0x4e, 0x73,                         // 020E: RTE — resume at the saved fetch cursor.
  ], 0x200);
  const rom = new Rom(image);
  const ram = new Ram(0x1000);
  const memory = new MemoryMap(0x1000000, [{ start: 0, memory: rom }, { start: 0x10000, memory: ram }]);
  const cpu = new Cpu68000(memory, {
    d0: 0, d1: 0, d2: 0, d3: 0, d4: 0, d5: 0, d6: 0, d7: 0,
    a0: 0, a1: 0, a2: 0, a3: 0, a4: 0, a5: 0, a6: 0, usp: 0, ssp: 0, pc: 0,
    ir: 0, interruptMask: 0, halted: false, faulted: false, tracePending: false,
    entry: { kind: "none", vector: 0 },
    flags: { x: false, n: false, z: false, v: false, c: false, t: false, s: false },
  });
  return { cpu, memory, rom, ram };
}
