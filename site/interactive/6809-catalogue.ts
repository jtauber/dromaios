import type { InstructionShape } from "./instruction-shape.js";

export type Operand6809 = "none" | "byte" | "word" | "direct" | "extended" | "indexed" | "relative" | "transfer" | "mask";
export interface Instruction6809 {
  readonly name: string;
  readonly operand: Operand6809;
  readonly explanation: string;
  /** A fixed shape, or shape IDs selected by the first operand byte. */
  readonly shape: number | readonly number[];
}
export interface Catalogue6809 {
  readonly prefixes: readonly number[];
  readonly instructions: Readonly<Partial<Record<number, Instruction6809>>>;
  readonly shapes: readonly InstructionShape[];
  readonly indexedRegisters: readonly string[];
  readonly transferRegisters: readonly string[];
}
