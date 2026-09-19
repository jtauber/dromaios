import type { OpcodeEntry } from "./opcodes.ts";
import { operand68000 } from "./68000-operands.ts";
import type { OperandSize68000 } from "./68000-operands.ts";

/** Classify mode/register pairs and name their shared bodies; families retain narrower encoding rules. */
export function aluForms68000<Operation extends string, Source extends { readonly name: string } = never>(entries: readonly OpcodeEntry<{
  readonly operation: Operation;
  readonly size: OperandSize68000 | undefined;
  /** Omitted for unary operations; an explicit operand gives quick values their own identity. */
  readonly source?: readonly [mode: number, code: number, operand?: Source];
  readonly destination: readonly [mode: number, code: number];
} | undefined>[]) {
  return entries.flatMap(([opcode, form]) => {
    if (!form?.size) return [];
    const { operation, size, source: from, destination: to } = form;
    const source = from && (from[2] ?? operand68000(size, from[0], from[1], "source"));
    const destination = operand68000(size, to[0], to[1], "destination");
    if ((from && !source) || !destination || destination.kind === "immediate") return [];
    return [{ opcode, operation, size, source, destination,
      sourceMode: from?.[0] ?? 0, sourceCode: from?.[1] ?? 0, destinationMode: to[0], destinationCode: to[1],
      body: `${operation}_${size}_${source?.name ?? "none"}_${destination.name}`,
    }];
  });
}
