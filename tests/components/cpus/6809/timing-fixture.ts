import { Cpu6809 } from "../../../../src/components/cpus/generated/6809-cpu.js";
import type { Cpu6809Flags, Cpu6809State } from "../../../../src/components/cpus/generated/6809-cpu.js";
import { ObservedRam } from "../../../helpers/observed-ram.js";

export const flags = (): Cpu6809Flags => ({ e: false, f: false, h: false, i: false, n: false, z: false, v: false, c: false });

export function fixture(code: readonly number[], changes: Partial<Cpu6809State> = {}) {
  const state: Cpu6809State = { a: 1, b: 2, dp: 0x30, x: 0x4000, y: 0x5000, s: 0x8000, u: 0x9000,
    pc: 0x200, flags: flags(), waitMode: "none", nmiArmed: true, ...changes };
  const ram = new ObservedRam();
  code.forEach((byte, index) => ram.write((state.pc + index) & 0xffff, byte));
  ram.accesses.length = 0;
  return { ram, cpu: new Cpu6809(ram, state) };
}

// Independent Motorola Appendix C/D tables. Indexed means ,X; stacks select no
// registers; RTI restores E=0; long branches are untaken. CWAI's 20-clock minimum
// is split into 16 here and 4 on delivery, with intervening waiting owned by the machine.
// https://www.maddes.net/m6809pm/appendix_c.htm
export const baseClocks = [
  [6, 0, 0, 6, 6, 0, 6, 6, 6, 6, 6, 0, 6, 6, 3, 6],
  [0, 0, 2, 4, 0, 0, 5, 9, 0, 2, 3, 0, 3, 2, 8, 6],
  [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3],
  [4, 4, 4, 4, 5, 5, 5, 5, 0, 5, 3, 6, 16, 11, 0, 19],
  [2, 0, 0, 2, 2, 0, 2, 2, 2, 2, 2, 0, 2, 2, 0, 2],
  [2, 0, 0, 2, 2, 0, 2, 2, 2, 2, 2, 0, 2, 2, 0, 2],
  [6, 0, 0, 6, 6, 0, 6, 6, 6, 6, 6, 0, 6, 6, 3, 6],
  [7, 0, 0, 7, 7, 0, 7, 7, 7, 7, 7, 0, 7, 7, 4, 7],
  [2, 2, 2, 4, 2, 2, 2, 0, 2, 2, 2, 2, 4, 7, 3, 0],
  [4, 4, 4, 6, 4, 4, 4, 4, 4, 4, 4, 4, 6, 7, 5, 5],
  [4, 4, 4, 6, 4, 4, 4, 4, 4, 4, 4, 4, 6, 7, 5, 5],
  [5, 5, 5, 7, 5, 5, 5, 5, 5, 5, 5, 5, 7, 8, 6, 6],
  [2, 2, 2, 4, 2, 2, 2, 0, 2, 2, 2, 2, 3, 0, 3, 0],
  [4, 4, 4, 6, 4, 4, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5],
  [4, 4, 4, 6, 4, 4, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5],
  [5, 5, 5, 7, 5, 5, 5, 5, 5, 5, 5, 5, 6, 6, 6, 6],
].flat();

export const pageClocks: Readonly<Record<number, Readonly<Record<number, number>>>> = {
  0x10: {
    0x21: 5, 0x22: 5, 0x23: 5, 0x24: 5, 0x25: 5, 0x26: 5, 0x27: 5, 0x28: 5,
    0x29: 5, 0x2a: 5, 0x2b: 5, 0x2c: 5, 0x2d: 5, 0x2e: 5, 0x2f: 5, 0x3f: 20,
    0x83: 5, 0x8c: 5, 0x8e: 4, 0x93: 7, 0x9c: 7, 0x9e: 6, 0x9f: 6,
    0xa3: 7, 0xac: 7, 0xae: 6, 0xaf: 6, 0xb3: 8, 0xbc: 8, 0xbe: 7, 0xbf: 7,
    0xce: 4, 0xde: 6, 0xdf: 6, 0xee: 6, 0xef: 6, 0xfe: 7, 0xff: 7,
  },
  0x11: { 0x3f: 20, 0x83: 5, 0x8c: 5, 0x93: 7, 0x9c: 7, 0xa3: 7, 0xac: 7, 0xb3: 8, 0xbc: 8 },
};

export function isIndexed(opcode: number): boolean {
  return (opcode >= 0x30 && opcode <= 0x33) || (opcode >= 0x60 && opcode <= 0x6f)
    || (opcode >= 0xa0 && opcode <= 0xaf) || (opcode >= 0xe0 && opcode <= 0xef);
}

export function branchTaken(opcode: number, { c, z, n, v }: Cpu6809Flags): boolean {
  // Condition pairs from the manual, independent of the chapter's Boolean expressions.
  const conditions = [true, false, !c && !z, c || z, !c, c, !z, z,
    !v, v, !n, n, n === v, n !== v, !z && n === v, z || n !== v];
  return conditions[opcode & 0xf]!;
}
