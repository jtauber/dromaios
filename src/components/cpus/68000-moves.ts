import { opcodeFamily } from "./opcodes.ts";
import { operand68000, selectors68000 as codes } from "./68000-operands.ts";
import type { Operand68000, OperandSize68000 } from "./68000-operands.ts";

const moveBodyKey = (size: OperandSize68000, source: Operand68000, destination: Operand68000): string => `${size}_${source.name}_${destination.name}`;

// 00 zz ddd mmm sss rrr: size zz=01 byte, 10 long, 11 word.
// Destination ddd/mmm precedes source sss/rrr. An destinations select MOVEA.
// Register-only slots already have numeric definitions; retain every other legal pair.
export const operandMoveForms68000 = ([
  { pattern: "00 01 ddd mmm sss rrr", size: 8 },
  { pattern: "00 10 ddd mmm sss rrr", size: 32 },
  { pattern: "00 11 ddd mmm sss rrr", size: 16 },
] as const).flatMap(({ pattern, size }) => opcodeFamily(pattern, { d: codes, m: codes, s: codes, r: codes }, ({ d, m, s, r }) => {
  const source = operand68000(size, s, r, "source"), destination = operand68000(size, m, d, "destination");
  return !source || !destination || destination.kind === "immediate" || (source.kind === "register" && destination.kind === "register") ? undefined
    : { size, source, destination, sourceMode: s, sourceCode: r, destinationMode: m, destinationCode: d };
}).flatMap(([opcode, form]) => form ? [{ opcode, ...form, body: moveBodyKey(size, form.source, form.destination) }] : []));
