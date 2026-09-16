import { Cpu68000 } from "../../components/cpus/68000.ts";
import { ByteOutput } from "../../components/devices/byte-output.ts";
import { MemoryMap } from "../../components/memory/memory-map.ts";
import { Ram } from "../../components/memory/ram.ts";
import { Rom } from "../../components/memory/rom.ts";

/** Allocate a ROM-backed output machine; CPU reset and execution remain explicit. */
export function create68000OutputExample(onWrite: (value: number) => void): {
  cpu: Cpu68000; memory: MemoryMap; rom: Rom; ram: Ram; output: ByteOutput;
} {
  const image = new Uint8Array(0x400);
  image.set([
    0x00, 0x01, 0x10, 0x00, // Initial SSP: 011000, just above RAM.
    0x00, 0x00, 0x01, 0x00, // Initial PC: 000100, in ROM.
    0x00, 0x00, 0x02, 0x00, // Vector 2: 000200, a stopping fault handler.
  ]);
  image.set([
    0x4e, 0x70,                         // 0100: RESET — clear the device, preserving CPU state and RAM.
    0x41, 0xf9, 0x00, 0x00, 0x01, 0x80, // 0102: LEA (000180).L,A0 — message in ROM.
    0x43, 0xf9, 0x00, 0x02, 0x00, 0x00, // 0108: LEA (020000).L,A1 — output register.
    0x70, 0x05,                         // 010E: MOVEQ #5,D0 — six iterations of DBF.
    0x12, 0x98,                         // 0110: MOVE.B (A0)+,(A1)
    0x51, 0xc8, 0xff, 0xfc,             // 0112: DBF D0,0110
    0x4e, 0x72, 0x27, 0x00,             // 0116: STOP #2700
  ], 0x100);
  image.set([0x48, 0x45, 0x4c, 0x4c, 0x4f, 0x0a], 0x180); // HELLO\n
  image.set([0x4e, 0x72, 0x27, 0x00], 0x200); // Stop after an unexpected bus error.
  const rom = new Rom(image);
  const ram = new Ram(0x1000);
  const output = new ByteOutput(onWrite);
  const memory = new MemoryMap(0x1000000, [
    { start: 0, memory: rom }, { start: 0x10000, memory: ram }, { start: 0x20000, memory: output },
  ]);
  const cpu = new Cpu68000(memory, {
    d0: 0, d1: 0, d2: 0, d3: 0, d4: 0, d5: 0, d6: 0, d7: 0,
    a0: 0, a1: 0, a2: 0, a3: 0, a4: 0, a5: 0, a6: 0, usp: 0, ssp: 0, pc: 0,
    ir: 0, interruptMask: 0, halted: false, faulted: false, tracePending: false,
    entry: { kind: "none", vector: 0 },
    flags: { x: false, n: false, z: false, v: false, c: false, t: false, s: false },
  }, { resetDevices: () => output.reset() });
  return { cpu, memory, rom, ram, output };
}
