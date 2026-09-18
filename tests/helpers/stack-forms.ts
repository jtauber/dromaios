import { wordState } from "./intel-words.js";

export type StackCpu = "6502" | "6800" | "6809" | "8080" | "z80";
export interface StackForm {
  readonly bytes: readonly number[];
  readonly operation: "push" | "pop" | "call" | "return";
  readonly fields?: readonly ("a" | "b" | "c" | "d" | "e" | "h" | "l" | "ix" | "iy")[];
  readonly condition?: number;
  readonly relative?: 8 | 16;
  readonly target?: number;
}
// Native encodings and register mappings are independent of production inventories.
const intel: readonly StackForm[] = [
  ...([[0xc5, 0xc1, ["b", "c"]], [0xd5, 0xd1, ["d", "e"]], [0xe5, 0xe1, ["h", "l"]]] as const)
    .flatMap(([push, pop, fields]): StackForm[] => [{ bytes: [push], operation: "push", fields }, { bytes: [pop], operation: "pop", fields }]),
  ...[0xc4, 0xcc, 0xd4, 0xdc, 0xe4, 0xec, 0xf4, 0xfc].map((opcode, condition): StackForm => ({ bytes: [opcode, 0x56, 0x34], operation: "call", condition })),
  { bytes: [0xcd, 0x56, 0x34], operation: "call" },
  ...[0xc0, 0xc8, 0xd0, 0xd8, 0xe0, 0xe8, 0xf0, 0xf8].map((opcode, condition): StackForm => ({ bytes: [opcode], operation: "return", condition })),
  { bytes: [0xc9], operation: "return" },
  ...[0xc7, 0xcf, 0xd7, 0xdf, 0xe7, 0xef, 0xf7, 0xff].map((opcode, vector): StackForm => ({ bytes: [opcode], operation: "call", target: vector * 8 })),
];
export const stackForms: Readonly<Record<StackCpu, readonly StackForm[]>> = {
  "6502": [
    { bytes: [0x48], operation: "push", fields: ["a"] }, { bytes: [0x68], operation: "pop", fields: ["a"] },
    { bytes: [0x20, 0x56, 0x34], operation: "call" }, { bytes: [0x60], operation: "return" },
  ],
  "6800": [
    { bytes: [0x36], operation: "push", fields: ["a"] }, { bytes: [0x37], operation: "push", fields: ["b"] },
    { bytes: [0x32], operation: "pop", fields: ["a"] }, { bytes: [0x33], operation: "pop", fields: ["b"] },
    { bytes: [0x8d, 0x80], operation: "call", relative: 8 },
    { bytes: [0xad, 0xff], operation: "call", target: 0xfe }, // FFFF + unsigned FF
    { bytes: [0xbd, 0x34, 0x56], operation: "call" }, { bytes: [0x39], operation: "return" },
  ],
  "6809": [
    { bytes: [0x8d, 0x80], operation: "call", relative: 8 }, { bytes: [0x17, 0x80, 0], operation: "call", relative: 16 },
    { bytes: [0x9d, 0xfe], operation: "call", target: 0xabfe },
    { bytes: [0xad, 0x84], operation: "call", target: 0xffff }, // ,X
    { bytes: [0xbd, 0x34, 0x56], operation: "call" }, { bytes: [0x39], operation: "return" },
  ],
  "8080": intel,
  z80: [...intel, ...([[0xdd, "ix"], [0xfd, "iy"]] as const).flatMap(([prefix, field]): StackForm[] => [
    { bytes: [prefix, 0xe5], operation: "push", fields: [field] }, { bytes: [prefix, 0xe1], operation: "pop", fields: [field] },
  ])],
};

export function stackState(cpu: StackCpu, mask: number, pc: number, sp: number, external = false) {
  return { ...wordState(), a: 0x81, pc, sp, s: sp, u: 0x7654, x: cpu === "6502" ? 0xff : 0xffff, y: 0x12, dp: 0xab,
    waiting: false, waitMode: "none" as const, nmiArmed: false, r: 0xff, im: 0 as const, iff1: true, iff2: true,
    interruptDeferred: !external, nmiDeferred: true, halted: external,
    flags: { ...wordState().flags, z: Boolean(mask & 1), c: Boolean(mask & 2), cy: Boolean(mask & 2),
      p: Boolean(mask & 4), pv: Boolean(mask & 4), v: Boolean(mask & 4), s: Boolean(mask & 8), n: Boolean(mask & 8),
      i: true, d: true, e: true, f: true },
  };
}
