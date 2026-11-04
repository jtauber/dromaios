import type { Cpu6502StepRecord } from "../../src/components/cpus/generated/6502-cpu.js";
import type { Apple2MemoryChange } from "./apple2-inspection.js";
import type { createApple2Session } from "./apple2-session.js";

type Machine = ReturnType<typeof createApple2Session>["machine"];
type Sector = { readonly track: number; readonly sector: number; readonly buffer: number };
export type DosRead = Sector & { readonly number: number; readonly bytes: readonly number[] };
type Jump = {
  readonly jumpFrom: number;
  readonly indirect?: number;
  readonly target: number;
  readonly slotRead?: { readonly sectorId: number; readonly buffer: number };
};
export type LoadObservation = Sector | Jump
  | { readonly requestAt: number; readonly read: Sector; readonly call?: { readonly source: number; readonly target: number } }
  | { readonly firstSector: number; readonly bootSectors: number; readonly ramAt: number; readonly afterInstruction: number }
  | { readonly dosCommand: string }
  | { readonly catalogueName: string; readonly address: number; readonly value: number }
  | { readonly textCell: readonly [number, number]; readonly page: number; readonly before: number; readonly after: number }
  | { readonly loresPixel: readonly [number, number]; readonly page: number; readonly before: number; readonly after: number }
  | { readonly bank: "bank1" | "bank2"; readonly address: number; readonly value: number }
  | { readonly kind: "read" | "write"; readonly address: number; readonly value?: number };

// The System Master uses the same RWTS wrapper during boot and after DOS is installed.
// Only the high byte of the driver's address changes. Both return via CLC/RTS or SEC/RTS.
const bootEntry = 0x37b5, installedEntry = 0xb7b5;
const wrapper = (driverPage: number) => [0x08, 0x78, 0x20, 0x00, driverPage, 0xb0, 0x03, 0x28, 0x18, 0x60, 0x28, 0x38, 0x60];
const bootWrapper = wrapper(0x3d), installedWrapper = wrapper(0xbd);
export function hasDos33Rwts({ ram }: Machine): boolean {
  return ram.read(0x03d9) === 0x4c && ram.read(0x03da) === 0xb5 && ram.read(0x03db) === 0xb7
    && installedWrapper.every((byte, i) => ram.read(installedEntry + i) === byte);
}

function readRequest(machine: Machine, entry: number, io: number): Sector | undefined {
  const { ram } = machine;
  if (!machine.disk.inspectMedium()) return;
  if (entry === bootEntry) {
    if (io !== 0x37e8 || !bootWrapper.every((byte, i) => ram.read(entry + i) === byte)) return;
  } else if ((entry !== installedEntry && entry !== 0x03d9) || !hasDos33Rwts(machine)) return;
  if (io + 12 >= 0xc000 || ram.read(io) !== 1 || ram.read(io + 1) !== 0x60
    || ram.read(io + 2) !== 1 || ram.read(io + 12) !== 1) return;
  const track = ram.read(io + 4), sector = ram.read(io + 5), buffer = ram.read(io + 8) + 256 * ram.read(io + 9);
  if (track < 35 && sector < 16 && buffer + 256 <= 0xc000) return { track, sector, buffer };
}

function sameRead(actual: Sector | undefined, expected: Sector): boolean {
  return actual?.track === expected.track && actual.sector === expected.sector && actual.buffer === expected.buffer;
}

/** Observe DOS's completed reads into main RAM without touching the Disk II switches. */
export function createDos33ReadTrace() {
  let pending: (Sector & { entry: number; stack: number; caller: number }) | undefined;
  let latest: DosRead | undefined, last: Cpu6502StepRecord | undefined, sequence = 0;
  let lastMachine: Machine | undefined, lastWrites: readonly Apple2MemoryChange[] | undefined;
  const reads: DosRead[] = [];
  return {
    get reads(): readonly DosRead[] { return reads; },
    clear(): void { reads.length = 0; sequence = 0; },
    interrupt(): void { pending = latest = last = lastMachine = lastWrites = undefined; },
    observe(machine: Machine, record: Cpu6502StepRecord, writes?: readonly Apple2MemoryChange[]): void {
      latest = undefined; last = record; lastMachine = machine; lastWrites = writes;
      const { pc, sp } = record.before, { ram } = machine;
      if (pc === bootEntry || pc === installedEntry) {
        pending = undefined;
        const request = readRequest(machine, pc, record.before.a * 256 + record.before.y);
        if (!request) return;
        const stacked = (offset: number) => ram.read(0x100 + ((sp + offset) & 0xff));
        const caller = (stacked(1) + 256 * stacked(2) + 1) & 0xffff;
        if (pc === bootEntry && caller !== 0x379c) return;
        pending = { ...request, entry: pc, stack: sp, caller };
      } else if (pending && (pc === pending.entry + 9 || pc === pending.entry + 12)) {
        const { track, sector, buffer, entry, stack, caller } = pending;
        pending = undefined;
        if (pc !== entry + 9 || record.instruction.bytes[0] !== 0x60 || record.after.flags.c
          || sp !== stack || record.after.pc !== caller) return;
        latest = { track, sector, buffer, number: ++sequence, bytes: Array.from({ length: 256 }, (_, i) => ram.read(buffer + i)) };
        reads.push(latest);
        if (reads.length > 64) reads.shift();
      }
    },
    /** A stop describes the boundary just reached, even when several reads share one return PC. */
    matches(expect: LoadObservation): boolean {
      if ("track" in expect) return sameRead(latest, expect);
      if ("requestAt" in expect) {
        const { source, target } = expect.call ?? { source: 0x3799, target: bootEntry };
        if (!lastMachine || last?.before.pc !== source || last.instruction.bytes[0] !== 0x20 || last.after.pc !== target) return false;
        const io = last.after.a * 256 + last.after.y;
        return io === expect.requestAt && sameRead(readRequest(lastMachine, target, io), expect.read);
      }
      if ("bootSectors" in expect) {
        if (!lastMachine || last?.before.pc !== expect.afterInstruction) return false;
        const disk = lastMachine.disk.inspectMedium()?.snapshot();
        if (!disk) return false;
        const offset = expect.firstSector * 256;
        for (let i = 0; i < expect.bootSectors * 256; i++) {
          if (lastMachine.ram.read(expect.ramAt + i) !== disk[offset + i]) return false;
        }
        return true;
      }
      if ("bank" in expect) return lastWrites?.some(w => w.region === expect.bank && w.address === expect.address && w.after === expect.value) ?? false;
      if ("loresPixel" in expect) {
        const [x, y] = expect.loresPixel, video = lastMachine?.video;
        if (!video?.visibleLoresRow(y) || video.snapshot().page2 !== (expect.page === 2)) return false;
        const address = video.loresAddress(y, x);
        return lastWrites?.some(w => w.region === "ram" && w.address === address
          && video.loresColour(w.before, y) === expect.before && video.loresColour(w.after, y) === expect.after) ?? false;
      }
      if ("textCell" in expect) {
        const [row, column] = expect.textCell, video = lastMachine?.video;
        if (!video?.visibleRow(row) || video.snapshot().page2 !== (expect.page === 2)) return false;
        const address = video.textAddress(row, column);
        return lastWrites?.some(w => w.region === "ram" && w.address === address && w.before === expect.before && w.after === expect.after) ?? false;
      }
      if ("catalogueName" in expect) {
        if (!last?.accesses.some(a => a.kind === "read" && a.address === expect.address && a.value === expect.value)) return false;
        // The type byte DOS just read precedes the full, space-padded filename.
        const name = expect.catalogueName.padEnd(30);
        return [...name].every((c, i) => lastMachine!.ram.read(expect.address + 1 + i) === (c.charCodeAt(0) | 0x80));
      }
      if ("dosCommand" in expect) {
        // The System Master leaves the high-bit Ctrl-D command and its CR in the input buffer.
        const command = "\x04" + expect.dosCommand + "\r";
        if (!lastMachine) return false;
        for (let i = 0; i < command.length; i++) {
          if (lastMachine.ram.read(0x0200 + i) !== (command.charCodeAt(i) | 0x80)) return false;
        }
        return true;
      }
      if ("jumpFrom" in expect) {
        if (last?.before.pc !== expect.jumpFrom || last.after.pc !== expect.target) return false;
        if (expect.slotRead) {
          // All ten requests use the same jump. Check the arguments the boot sector left for the card.
          const { ram } = lastMachine!;
          const buffer = ram.read(0x26) + 256 * ram.read(0x27);
          if (buffer !== expect.slotRead.buffer || ram.read(0x3d) !== expect.slotRead.sectorId) return false;
        }
        const [opcode, low, high] = last.instruction.bytes;
        const operand = expect.indirect ?? expect.target;
        return opcode === (expect.indirect === undefined ? 0x4c : 0x6c) && low === (operand & 0xff) && high === (operand >>> 8);
      }
      return last?.accesses.some(a => a.kind === expect.kind && a.address === expect.address
        && (expect.value === undefined || a.value === expect.value)) ?? false;
    },
  };
}
