import { opcodeFamily } from "./opcodes.ts";

export type MoveSize = 8 | 16 | 32;
export type MoveRegister = `d${0 | 1 | 2 | 3 | 4 | 5 | 6 | 7}` | `a${0 | 1 | 2 | 3 | 4 | 5 | 6 | 7}`;
export type MoveOperand =
  | { readonly kind: "register"; readonly name: MoveRegister }
  | { readonly kind: "memory"; readonly name: "memory" | "program" }
  | { readonly kind: "immediate"; readonly name: "immediate" };

const data = ["d0", "d1", "d2", "d3", "d4", "d5", "d6", "d7"] as const;
const address = ["a0", "a1", "a2", "a3", "a4", "a5", "a6", "a7"] as const;
const codes = [0, 1, 2, 3, 4, 5, 6, 7] as const;

function operand(size: MoveSize, mode: number, code: number, destination: boolean): MoveOperand | undefined {
  if (mode === 0) return { kind: "register", name: data[code]! };
  if (mode === 1) return size === 8 ? undefined : { kind: "register", name: address[code]! };
  if (mode < 7 || code < 2) return { kind: "memory", name: "memory" };
  if (destination || code > 4) return undefined;
  return code === 4 ? { kind: "immediate", name: "immediate" } : { kind: "memory", name: "program" };
}

const moveBodyKey = (size: MoveSize, source: MoveOperand, destination: MoveOperand): string => `${size}_${source.name}_${destination.name}`;

// 00 zz ddd mmm sss rrr: size zz=01 byte, 10 long, 11 word.
// Destination ddd/mmm precedes source sss/rrr. An destinations select MOVEA.
// Register-only slots already have numeric definitions; retain every other legal pair.
export const operandMoveForms68000 = ([
  { pattern: "00 01 ddd mmm sss rrr", size: 8 },
  { pattern: "00 10 ddd mmm sss rrr", size: 32 },
  { pattern: "00 11 ddd mmm sss rrr", size: 16 },
] as const).flatMap(({ pattern, size }) => opcodeFamily(pattern, { d: codes, m: codes, s: codes, r: codes }, ({ d, m, s, r }) => {
  const source = operand(size, s, r, false), destination = operand(size, m, d, true);
  return !source || !destination || destination.kind === "immediate" || (source.kind === "register" && destination.kind === "register") ? undefined
    : { size, source, destination, sourceMode: s, sourceCode: r, destinationMode: m, destinationCode: d };
}).flatMap(([opcode, form]) => form ? [{ opcode, ...form, body: moveBodyKey(size, form.source, form.destination) }] : []));
