export type OperandSize68000 = 8 | 16 | 32;
export type OperandRegister68000 = `d${0 | 1 | 2 | 3 | 4 | 5 | 6 | 7}` | `a${0 | 1 | 2 | 3 | 4 | 5 | 6 | 7}`;
export type Operand68000 =
  | { readonly kind: "register"; readonly name: OperandRegister68000 }
  | { readonly kind: "memory"; readonly name: "memory" | "program" }
  | { readonly kind: "immediate"; readonly name: "immediate" };

export const dataRegisters68000 = ["d0", "d1", "d2", "d3", "d4", "d5", "d6", "d7"] as const;
export const addressRegisters68000 = ["a0", "a1", "a2", "a3", "a4", "a5", "a6", "a7"] as const;
export const selectors68000 = [0, 1, 2, 3, 4, 5, 6, 7] as const;
export const operandSizes68000 = [8, 16, 32, undefined] as const;

/** Classify an encoded EA; instruction families impose their narrower legal sets. */
export function operand68000(size: OperandSize68000, mode: number, code: number, access: "source" | "destination"): Operand68000 | undefined {
  if (mode === 0) return { kind: "register", name: dataRegisters68000[code]! };
  if (mode === 1) return size === 8 ? undefined : { kind: "register", name: addressRegisters68000[code]! };
  if (mode < 7 || code < 2) return { kind: "memory", name: "memory" };
  if (access === "destination" || code > 4) return undefined;
  return code === 4 ? { kind: "immediate", name: "immediate" } : { kind: "memory", name: "program" };
}
