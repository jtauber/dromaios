import { opcodeFamily } from "./opcodes.ts";
import { dataRegisters68000 as data, operand68000, selectors68000 as codes } from "./68000-operands.ts";
import type { Operand68000, OperandSize68000 } from "./68000-operands.ts";

export type LogicOperation68000 = "AND" | "OR" | "EOR" | "CLR" | "NOT" | "TST";
export type LogicOperand68000 = { readonly kind: "register"; readonly name: typeof data[number] }
  | Exclude<Operand68000, { kind: "register" }>;

function dataOperand(size: OperandSize68000, mode: number, code: number, access: "source" | "destination"): LogicOperand68000 | undefined {
  if (mode === 0) return { kind: "register", name: data[code]! };
  const operand = operand68000(size, mode, code, access);
  return operand?.kind === "register" ? undefined : operand;
}

const sizes = [8, 16, 32, undefined] as const;
const bodyKey = (operation: LogicOperation68000, size: OperandSize68000, source: Operand68000 | undefined, destination: Operand68000) =>
  `${operation}_${size}_${source?.name ?? "none"}_${destination.name}`;

export const logicForms68000 = [
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
    if (!size || m === 1 || (direction === "memory" && m === 0)) return undefined;
    const ea = dataOperand(size, m, e, direction === "source" ? "source" : "destination");
    if (!ea) return undefined;
    const register = { kind: "register", name: data[r]! } as const;
    const destination = direction === "source" ? register : ea;
    if (destination.kind === "immediate") return undefined;
    return { operation, size, destination, ...(direction === "source"
      ? { source: ea, sourceMode: m, sourceCode: e, destinationMode: 0, destinationCode: r }
      : { source: register, sourceMode: 0, sourceCode: r, destinationMode: m, destinationCode: e }) };
  }).flatMap(([opcode, form]) => form ? [{ opcode, ...form, body: bodyKey(operation, form.size, form.source, form.destination) }] : [])),
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
  ] as const).flatMap(({ pattern, operation, immediate }) => opcodeFamily(pattern, { s: sizes, m: codes, r: codes }, ({ s: size, m, r }) => {
    if (!size || m === 1) return undefined;
    const destination = dataOperand(size, m, r, "destination");
    if (!destination || destination.kind === "immediate") return undefined;
    const source = immediate ? { kind: "immediate", name: "immediate" } as const : undefined;
    return { operation, size, source, destination, sourceMode: immediate ? 7 : 0, sourceCode: immediate ? 4 : 0, destinationMode: m, destinationCode: r };
  }).flatMap(([opcode, form]) => form ? [{ opcode, ...form, body: bodyKey(operation, form.size, form.source, form.destination) }] : [])),
];
