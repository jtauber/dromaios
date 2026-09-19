import { opcodeFamily } from "./opcodes.ts";
import { aluForms68000 } from "./68000-alu.ts";
import { operandSizes68000 as sizes, selectors68000 as codes } from "./68000-operands.ts";

export type LogicOperation68000 = "AND" | "OR" | "EOR" | "CLR" | "NOT" | "TST";

export const logicForms68000 = aluForms68000([
  // oooo rrr d ss mmm eee: rrr selects Dn; ss=00 byte, 01 word, 10 long.
  // d=0 reads a data EA into Dn; d=1 reads/modifies/writes EA using Dn.
  // AND/OR destinations must be memory; EOR also permits Dn. No An operands.
  ...([
    { pattern: "1000 rrr 0 ss mmm eee", operation: "OR", direction: "source" },
    { pattern: "1000 rrr 1 ss mmm eee", operation: "OR", direction: "memory" },
    { pattern: "1011 rrr 1 ss mmm eee", operation: "EOR", direction: "destination" },
    { pattern: "1100 rrr 0 ss mmm eee", operation: "AND", direction: "source" },
    { pattern: "1100 rrr 1 ss mmm eee", operation: "AND", direction: "memory" },
  ] as const).flatMap(({ pattern, operation, direction }) => opcodeFamily(pattern, { r: codes, s: sizes, m: codes, e: codes }, ({ r, s: size, m, e }) => {
    if (m === 1 || (direction === "memory" && m === 0)) return undefined;
    return { operation, size, ...(direction === "source"
      ? { source: [m, e], destination: [0, r] } as const
      : { source: [0, r], destination: [m, e] } as const) };
  })),
  // Immediate: 0000 ooo 0 ss mmm rrr, ooo=000 ORI / 001 ANDI / 101 EORI.
  // Unary: 0100 oooo ss mmm rrr, oooo=0010 CLR / 0110 NOT / 1010 TST.
  // All use data-alterable EAs, including TST on the original 68000.
  // ss=11 and EA=111100 status forms belong to separate instruction families.
  ...([
    { pattern: "0000 000 0 ss mmm rrr", operation: "OR", immediate: true },
    { pattern: "0000 001 0 ss mmm rrr", operation: "AND", immediate: true },
    { pattern: "0000 101 0 ss mmm rrr", operation: "EOR", immediate: true },
    { pattern: "0100 0010 ss mmm rrr", operation: "CLR", immediate: false },
    { pattern: "0100 0110 ss mmm rrr", operation: "NOT", immediate: false },
    { pattern: "0100 1010 ss mmm rrr", operation: "TST", immediate: false },
  ] as const).flatMap(({ pattern, operation, immediate }) => opcodeFamily(pattern, { s: sizes, m: codes, r: codes }, ({ s: size, m, r }) =>
    m === 1 ? undefined : { operation, size, source: immediate ? [7, 4] as const : undefined, destination: [m, r] } as const)),
]);
