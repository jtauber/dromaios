import { opcodeFamily } from "./opcodes.ts";
import { dataRegisters68000 as data, addressRegisters68000 as address, operand68000, selectors68000 as codes } from "./68000-operands.ts";
import type { Operand68000, OperandSize68000 } from "./68000-operands.ts";

export type ArithmeticOperation68000 = "ADD" | "SUB" | "CMP" | "ADDX" | "SUBX" | "NEG" | "NEGX";
export type ArithmeticSource68000 = Operand68000 | { readonly kind: "quick"; readonly name: "quick" };
const sizes = [8, 16, 32, undefined] as const;
const bodyKey = (operation: ArithmeticOperation68000, size: OperandSize68000, source: ArithmeticSource68000 | undefined, destination: Operand68000) =>
  `${operation}_${size}_${source?.name ?? "none"}_${destination.name}`;

export const arithmeticForms68000 = [
  // oooo rrr d ss mmm eee: ss=00 byte, 01 word, 10 long; rrr selects Dn.
  // d=0 reads EA into Dn (An allowed for word/long); d=1 modifies alterable memory.
  ...([
    { pattern: "1001 rrr 0 ss mmm eee", operation: "SUB", toMemory: false },
    { pattern: "1001 rrr 1 ss mmm eee", operation: "SUB", toMemory: true },
    { pattern: "1011 rrr 0 ss mmm eee", operation: "CMP", toMemory: false },
    { pattern: "1101 rrr 0 ss mmm eee", operation: "ADD", toMemory: false },
    { pattern: "1101 rrr 1 ss mmm eee", operation: "ADD", toMemory: true },
  ] as const).flatMap(({ pattern, operation, toMemory }) => opcodeFamily(pattern, { r: codes, s: sizes, m: codes, e: codes }, ({ r, s: size, m, e }) => {
    if (!size || (toMemory && m < 2)) return undefined;
    const ea = operand68000(size, m, e, toMemory ? "destination" : "source"), register = { kind: "register", name: data[r]! } as const;
    if (!ea) return undefined;
    const destination = toMemory ? ea : register;
    if (destination.kind === "immediate") return undefined;
    return { operation, size, destination, ...(toMemory
      ? { source: register, sourceMode: 0, sourceCode: r, destinationMode: m, destinationCode: e }
      : { source: ea, sourceMode: m, sourceCode: e, destinationMode: 0, destinationCode: r }) };
  })),
  // oooo rrr s11 mmm eee: s=0 word source, 1 long; rrr selects An.
  // ADDA/SUBA/CMPA allow every source EA; word sources are sign-extended to 32 bits.
  ...([
    { pattern: "1001 rrr s11 mmm eee", operation: "SUB" },
    { pattern: "1011 rrr s11 mmm eee", operation: "CMP" },
    { pattern: "1101 rrr s11 mmm eee", operation: "ADD" },
  ] as const).flatMap(({ pattern, operation }) => opcodeFamily(pattern, { r: codes, s: [16, 32] as const, m: codes, e: codes }, ({ r, s: size, m, e }) => {
    const source = operand68000(size, m, e, "source");
    return source ? { operation, size, source, destination: { kind: "register", name: address[r]! } as const,
      sourceMode: m, sourceCode: e, destinationMode: 1, destinationCode: r } : undefined;
  })),
  // Immediate: 0000 ooo 0 ss mmm rrr; ooo=010 SUBI / 011 ADDI / 110 CMPI.
  // Unary: 0100 0n00 ss mmm rrr; n=0 NEGX / 1 NEG. Only data-alterable EAs.
  ...([
    { pattern: "0000 010 0 ss mmm rrr", operation: "SUB", immediate: true },
    { pattern: "0000 011 0 ss mmm rrr", operation: "ADD", immediate: true },
    { pattern: "0000 110 0 ss mmm rrr", operation: "CMP", immediate: true },
    { pattern: "0100 0000 ss mmm rrr", operation: "NEGX", immediate: false },
    { pattern: "0100 0100 ss mmm rrr", operation: "NEG", immediate: false },
  ] as const).flatMap(({ pattern, operation, immediate }) => opcodeFamily(pattern, { s: sizes, m: codes, r: codes }, ({ s: size, m, r }) => {
    if (!size || m === 1) return undefined;
    const destination = operand68000(size, m, r, "destination");
    return destination && destination.kind !== "immediate" ? { operation, size, destination,
      source: immediate ? { kind: "immediate", name: "immediate" } as const : undefined,
      sourceMode: immediate ? 7 : 0, sourceCode: immediate ? 4 : 0, destinationMode: m, destinationCode: r } : undefined;
  })),
  // 0101 qqq d ss mmm rrr: d=0 ADDQ / 1 SUBQ; qqq=000 means 8, otherwise 1..7.
  // Keep qqq as a decoded parameter. Word/long An destinations operate on all 32 bits.
  ...opcodeFamily("0101 qqq d ss mmm rrr", { q: codes, d: ["ADD", "SUB"] as const, s: sizes, m: codes, r: codes }, ({ q, d: operation, s: size, m, r }) => {
    if (!size) return undefined;
    const destination = operand68000(size, m, r, "destination");
    return destination && destination.kind !== "immediate" ? { operation, size, destination, source: { kind: "quick", name: "quick" } as const,
      sourceMode: 0, sourceCode: q, destinationMode: m, destinationCode: r } : undefined;
  }),
  // oooo ddd 1 ss 00 m rrr: ADDX/SUBX use m=0 Dn,Dn / m=1 -(An),-(An).
  // CMPM fixes m=1 for (An)+,(An)+; source addressing precedes destination addressing.
  ...([
    { pattern: "1001 ddd 1 ss 00 m rrr", operation: "SUBX", modes: [0, 4] },
    { pattern: "1101 ddd 1 ss 00 m rrr", operation: "ADDX", modes: [0, 4] },
    { pattern: "1011 ddd 1 ss 00 m rrr", operation: "CMP", modes: [undefined, 3] },
  ] as const).flatMap(({ pattern, operation, modes }) => opcodeFamily(pattern,
    { d: codes, s: sizes, m: modes, r: codes }, ({ d, s: size, m: mode, r }) => {
      if (!size || mode === undefined) return undefined;
      const source = operand68000(size, mode, r, "source"), destination = operand68000(size, mode, d, "destination");
      return source && destination && destination.kind !== "immediate" ? { operation, size, source, destination,
        sourceMode: mode, sourceCode: r, destinationMode: mode, destinationCode: d } : undefined;
    })),
].flatMap(([opcode, form]) => form ? [{ opcode, ...form, body: bodyKey(form.operation, form.size, form.source, form.destination) }] : []);
