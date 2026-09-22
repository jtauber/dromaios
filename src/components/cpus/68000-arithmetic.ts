import { opcodeFamily } from "./opcodes.ts";
import { dataRegisters68000 as data, operand68000, selectors68000 as codes } from "./68000-operands.ts";

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
