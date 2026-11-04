import type { Cpu6502StepRecord } from "../../src/components/cpus/generated/6502-cpu.js";
import type { Apple2MemoryChange } from "./apple2-inspection.js";
import type { createApple2Session } from "./apple2-session.js";

type Machine = ReturnType<typeof createApple2Session>["machine"];
type Sector = { readonly track: number; readonly sector: number; readonly buffer: number };
export type DosRead = Sector & { readonly number: number; readonly bytes: readonly number[] };
export type LoadObservation = Sector | { readonly jumpFrom: number; readonly indirect: number; readonly target: number }
  | { readonly dosCommand: string }
  | { readonly bank: "bank1" | "bank2"; readonly address: number; readonly value: number }
  | { readonly kind: "read" | "write"; readonly address: number; readonly value?: number };

// The selected System Master installs JMP $B7B5 at RWTS ($03D9). Its wrapper
// calls the driver, restores the flags and returns via CLC/RTS or SEC/RTS.
const entry = 0xb7b5, wrapper = [0x08, 0x78, 0x20, 0x00, 0xbd, 0xb0, 0x03, 0x28, 0x18, 0x60, 0x28, 0x38, 0x60];
export function hasDos33Rwts({ ram }: Machine): boolean {
  return ram.read(0x03d9) === 0x4c && ram.read(0x03da) === 0xb5 && ram.read(0x03db) === 0xb7
    && wrapper.every((byte, i) => ram.read(entry + i) === byte);
}

/** Observe DOS's completed reads into main RAM without touching the Disk II switches. */
export function createDos33ReadTrace() {
  let pending: (Sector & { stack: number; caller: number }) | undefined;
  let latest: DosRead | undefined, last: Cpu6502StepRecord | undefined, sequence = 0;
  let lastRam: Machine["ram"] | undefined, lastWrites: readonly Apple2MemoryChange[] | undefined;
  const reads: DosRead[] = [];
  return {
    get reads(): readonly DosRead[] { return reads; },
    clear(): void { reads.length = 0; sequence = 0; },
    interrupt(): void { pending = latest = last = lastRam = lastWrites = undefined; },
    observe(machine: Machine, record: Cpu6502StepRecord, writes?: readonly Apple2MemoryChange[]): void {
      latest = undefined; last = record; lastRam = machine.ram; lastWrites = writes;
      const { pc, sp } = record.before, { ram } = machine;
      if (pc === entry) {
        pending = undefined;
        if (!machine.disk.inspectMedium() || !hasDos33Rwts(machine)) return;
        const io = record.before.a * 256 + record.before.y;
        if (io + 12 >= 0xc000 || ram.read(io) !== 1 || ram.read(io + 1) !== 0x60
          || ram.read(io + 2) !== 1 || ram.read(io + 12) !== 1) return;
        const track = ram.read(io + 4), sector = ram.read(io + 5), buffer = ram.read(io + 8) + 256 * ram.read(io + 9);
        if (track >= 35 || sector >= 16 || buffer + 256 > 0xc000) return;
        const stacked = (offset: number) => ram.read(0x100 + ((sp + offset) & 0xff));
        pending = { track, sector, buffer, stack: sp, caller: (stacked(1) + 256 * stacked(2) + 1) & 0xffff };
      } else if (pending && (pc === 0xb7be || pc === 0xb7c1)) {
        const { track, sector, buffer, stack, caller } = pending;
        pending = undefined;
        if (pc !== 0xb7be || record.instruction.bytes[0] !== 0x60 || record.after.flags.c
          || sp !== stack || record.after.pc !== caller) return;
        latest = { track, sector, buffer, number: ++sequence, bytes: Array.from({ length: 256 }, (_, i) => ram.read(buffer + i)) };
        reads.push(latest);
        if (reads.length > 64) reads.shift();
      }
    },
    /** A stop describes the boundary just reached, even when several reads share one return PC. */
    matches(expect: LoadObservation): boolean {
      if ("track" in expect) return latest?.track === expect.track && latest.sector === expect.sector && latest.buffer === expect.buffer;
      if ("bank" in expect) return lastWrites?.some(w => w.region === expect.bank && w.address === expect.address && w.after === expect.value) ?? false;
      if ("dosCommand" in expect) {
        // The System Master leaves the high-bit Ctrl-D command and its CR in the input buffer.
        const command = "\x04" + expect.dosCommand + "\r";
        if (!lastRam) return false;
        for (let i = 0; i < command.length; i++) {
          if (lastRam.read(0x0200 + i) !== (command.charCodeAt(i) | 0x80)) return false;
        }
        return true;
      }
      if ("jumpFrom" in expect) {
        if (last?.before.pc !== expect.jumpFrom || last.after.pc !== expect.target) return false;
        const [opcode, low, high] = last.instruction.bytes;
        return opcode === 0x6c && low === (expect.indirect & 0xff) && high === (expect.indirect >>> 8);
      }
      return last?.accesses.some(a => a.kind === expect.kind && a.address === expect.address
        && (expect.value === undefined || a.value === expect.value)) ?? false;
    },
  };
}
