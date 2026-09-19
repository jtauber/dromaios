import { opcodeFamily } from "./opcodes.ts";
import { aluForms68000 } from "./68000-alu.ts";
import { dataRegisters68000 as data, operand68000, operandSizes68000 as sizes, selectors68000 as codes } from "./68000-operands.ts";
import type { Operand68000 } from "./68000-operands.ts";

export type ArithmeticOperation68000 = "ADD" | "SUB" | "CMP" | "ADDX" | "SUBX" | "NEG" | "NEGX";
export type ArithmeticSource68000 = Operand68000 | { readonly kind: "quick"; readonly name: "quick" };

export const arithmeticForms68000 = aluForms68000([
  // oooo rrr d ss mmm eee: ss=00 byte, 01 word, 10 long; rrr selects Dn.
  // d=0 reads EA into Dn (An allowed for word/long); d=1 modifies alterable memory.
  ...([
    { pattern: "1001 rrr 0 ss mmm eee", operation: "SUB", toMemory: false },
    { pattern: "1001 rrr 1 ss mmm eee", operation: "SUB", toMemory: true },
    { pattern: "1011 rrr 0 ss mmm eee", operation: "CMP", toMemory: false },
    { pattern: "1101 rrr 0 ss mmm eee", operation: "ADD", toMemory: false },
    { pattern: "1101 rrr 1 ss mmm eee", operation: "ADD", toMemory: true },
  ] as const).flatMap(({ pattern, operation, toMemory }) => opcodeFamily(pattern, { r: codes, s: sizes, m: codes, e: codes }, ({ r, s: size, m, e }) => {
    if (toMemory && m < 2) return undefined;
    return { operation, size, ...(toMemory
      ? { source: [0, r], destination: [m, e] } as const
      : { source: [m, e], destination: [0, r] } as const) };
  })),
  // oooo rrr s11 mmm eee: s=0 word source, 1 long; rrr selects An.
  // ADDA/SUBA/CMPA allow every source EA; word sources are sign-extended to 32 bits.
  ...([
    { pattern: "1001 rrr s11 mmm eee", operation: "SUB" },
    { pattern: "1011 rrr s11 mmm eee", operation: "CMP" },
    { pattern: "1101 rrr s11 mmm eee", operation: "ADD" },
  ] as const).flatMap(({ pattern, operation }) => opcodeFamily(pattern, { r: codes, s: [16, 32] as const, m: codes, e: codes }, ({ r, s: size, m, e }) =>
    ({ operation, size, source: [m, e], destination: [1, r] } as const))),
  // Immediate: 0000 ooo 0 ss mmm rrr; ooo=010 SUBI / 011 ADDI / 110 CMPI.
  // Unary: 0100 0n00 ss mmm rrr; n=0 NEGX / 1 NEG. Only data-alterable EAs.
  ...([
    { pattern: "0000 010 0 ss mmm rrr", operation: "SUB", immediate: true },
    { pattern: "0000 011 0 ss mmm rrr", operation: "ADD", immediate: true },
    { pattern: "0000 110 0 ss mmm rrr", operation: "CMP", immediate: true },
    { pattern: "0100 0000 ss mmm rrr", operation: "NEGX", immediate: false },
    { pattern: "0100 0100 ss mmm rrr", operation: "NEG", immediate: false },
  ] as const).flatMap(({ pattern, operation, immediate }) => opcodeFamily(pattern, { s: sizes, m: codes, r: codes }, ({ s: size, m, r }) =>
    m === 1 ? undefined : { operation, size, source: immediate ? [7, 4] as const : undefined, destination: [m, r] } as const)),
  // 0101 qqq d ss mmm rrr: d=0 ADDQ / 1 SUBQ; qqq=000 means 8, otherwise 1..7.
  // Keep qqq as a decoded parameter. Word/long An destinations operate on all 32 bits.
  ...opcodeFamily("0101 qqq d ss mmm rrr", { q: codes, d: ["ADD", "SUB"] as const, s: sizes, m: codes, r: codes }, ({ q, d: operation, s: size, m, r }) =>
    ({ operation, size, source: [0, q, { kind: "quick", name: "quick" }], destination: [m, r] } as const)),
  // oooo ddd 1 ss 00 m rrr: ADDX/SUBX use m=0 Dn,Dn / m=1 -(An),-(An).
  // CMPM fixes m=1 for (An)+,(An)+; source addressing precedes destination addressing.
  ...([
    { pattern: "1001 ddd 1 ss 00 m rrr", operation: "SUBX", modes: [0, 4] },
    { pattern: "1101 ddd 1 ss 00 m rrr", operation: "ADDX", modes: [0, 4] },
    { pattern: "1011 ddd 1 ss 00 m rrr", operation: "CMP", modes: [undefined, 3] },
  ] as const).flatMap(({ pattern, operation, modes }) => opcodeFamily(pattern,
    { d: codes, s: sizes, m: modes, r: codes }, ({ d, s: size, m: mode, r }) => {
      return mode === undefined ? undefined : { operation, size, source: [mode, r], destination: [mode, d] } as const;
    })),
]);

// oooo ddd s11 mmm rrr: oooo=1000 DIV / 1100 MUL; s=0 unsigned, 1 signed.
// CHK fixes 0100 ddd 110 mmm rrr. Every source is EA.W; An direct is excluded.
export const wordArithmeticForms68000 = ([
  { pattern: "1100 ddd 011 mmm rrr", operation: "MULU" },
  { pattern: "1100 ddd 111 mmm rrr", operation: "MULS" },
  { pattern: "1000 ddd 011 mmm rrr", operation: "DIVU" },
  { pattern: "1000 ddd 111 mmm rrr", operation: "DIVS" },
  { pattern: "0100 ddd 110 mmm rrr", operation: "CHK" },
] as const).flatMap(({ pattern, operation }) => opcodeFamily(pattern, { d: codes, m: codes, r: codes }, ({ d, m, r }) => {
  if (m === 1) return undefined;
  const source = operand68000(16, m, r, "source");
  return source ? { operation, source, destination: data[d]!, sourceMode: m, sourceCode: r, destinationMode: 0, destinationCode: d } : undefined;
})).flatMap(([opcode, form]) => form ? [{ opcode, ...form, body: `${form.operation}_${form.source.name}_${form.destination}` }] : []);

// oooo ddd 10000 m rrr: oooo=1000 SBCD / 1100 ABCD; m=0 Dn,Dn, 1 -(An),-(An).
// NBCD fixes 0100 1000 00 mmm rrr and accepts every data-alterable byte operand.
export const decimalForms68000 = [
  ...([
    { pattern: "1000 ddd 10000 m rrr", operation: "SBCD" },
    { pattern: "1100 ddd 10000 m rrr", operation: "ABCD" },
  ] as const).flatMap(({ pattern, operation }) => opcodeFamily(pattern, { d: codes, m: [0, 4] as const, r: codes }, ({ d, m: mode, r }) => ({
    operation, source: operand68000(8, mode, r, "source")!, destination: operand68000(8, mode, d, "destination")!,
    sourceMode: mode, sourceCode: r, destinationMode: mode, destinationCode: d,
  }))),
  ...opcodeFamily("0100 1000 00 mmm rrr", { m: codes, r: codes }, ({ m, r }) => {
    const destination = operand68000(8, m, r, "destination");
    return destination ? { operation: "NBCD", source: undefined, destination, sourceMode: 0, sourceCode: 0, destinationMode: m, destinationCode: r } as const : undefined;
  }),
].flatMap(([opcode, form]) => form ? [{ opcode, ...form, body: `${form.operation}_${form.source?.name ?? "none"}_${form.destination.name}` }] : []);

export type WordArithmeticForm68000 = typeof wordArithmeticForms68000[number];
export type DecimalForm68000 = typeof decimalForms68000[number];
