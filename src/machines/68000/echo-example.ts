import { Cpu68000 } from "../../components/cpus/68000.ts";
import type { Cpu68000ResetRecord } from "../../components/cpus/68000.ts";
import { ByteInput } from "../../components/devices/byte-input.ts";
import { ByteOutput } from "../../components/devices/byte-output.ts";
import { MemoryMap } from "../../components/memory/memory-map.ts";
import { Ram } from "../../components/memory/ram.ts";
import { Rom } from "../../components/memory/rom.ts";

/** Allocate a ROM-backed echo machine. Reset explicitly before offering input and running. */
export function create68000EchoExample(onWrite: (value: number) => void): {
  cpu: Cpu68000; memory: MemoryMap; rom: Rom; ram: Ram; input: ByteInput; output: ByteOutput;
  reset: () => Cpu68000ResetRecord;
} {
  const image = new Uint8Array(0x400);
  image.set([
    0x00, 0x01, 0x10, 0x00, // Initial SSP: 011000, just above RAM.
    0x00, 0x00, 0x01, 0x00, // Initial PC: 000100, in ROM.
    0x00, 0x00, 0x02, 0x00, // Vector 2: 000200, a stopping fault handler.
  ]);
  image.set([
    0x41, 0xf9, 0x00, 0x03, 0x00, 0x00, // 0100: LEA (030000).L,A0 — input status/data.
    0x43, 0xf9, 0x00, 0x02, 0x00, 0x00, // 0106: LEA (020000).L,A1 — output.
    0x4a, 0x10,                         // 010C: TST.B (A0) — input ready?
    0x67, 0xfc,                         // 010E: BEQ 010C — poll while empty.
    0x10, 0x28, 0x00, 0x01,             // 0110: MOVE.B 1(A0),D0 — consume the byte.
    0x12, 0x80,                         // 0114: MOVE.B D0,(A1) — echo it.
    0x0c, 0x00, 0x00, 0x0a,             // 0116: CMPI.B #0A,D0
    0x66, 0xf0,                         // 011A: BNE 010C
    0x4e, 0x72, 0x27, 0x00,             // 011C: STOP #2700
  ], 0x100);
  image.set([0x4e, 0x72, 0x27, 0], 0x200);
  const rom = new Rom(image), ram = new Ram(0x1000);
  const input = new ByteInput(), output = new ByteOutput(onWrite);
  const memory = new MemoryMap(0x1000000, [
    { start: 0, memory: rom }, { start: 0x10000, memory: ram },
    { start: 0x20000, memory: output }, { start: 0x30000, memory: input },
  ]);
  const resetDevices = (): void => { input.reset(); output.reset(); };
  const cpu = new Cpu68000(memory, {
    d0: 0, d1: 0, d2: 0, d3: 0, d4: 0, d5: 0, d6: 0, d7: 0,
    a0: 0, a1: 0, a2: 0, a3: 0, a4: 0, a5: 0, a6: 0, usp: 0, ssp: 0, pc: 0,
    ir: 0, interruptMask: 0, halted: false, faulted: false, tracePending: false,
    entry: { kind: "none", vector: 0 },
    flags: { x: false, n: false, z: false, v: false, c: false, t: false, s: false },
  }, { resetDevices });
  const reset = (): Cpu68000ResetRecord => {
    const record = cpu.reset(); // Boot the CPU before clearing the device latches.
    resetDevices();
    return record;
  };
  return { cpu, memory, rom, ram, input, output, reset };
}
