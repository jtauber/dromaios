import type { StackFlow } from "./instruction-debugger.js";

/** Compact presentation data; no compiler or semantic execution in the browser. */
export type InstructionControlFlow = "sequential" | "conditional" | "unconditional";
export type FlagCondition = { readonly kind: "flag"; readonly name: string }
  | { readonly kind: "not"; readonly value: FlagCondition }
  | { readonly kind: "and" | "or" | "xor"; readonly left: FlagCondition; readonly right: FlagCondition };
export interface InstructionShape {
  readonly length: number;
  readonly supported: boolean;
  readonly controlFlow: InstructionControlFlow;
  readonly condition?: FlagCondition;
  readonly stack?: { readonly flow: StackFlow; readonly register: string };
  readonly replacedStacks?: readonly string[];
}

export function testFlagCondition(condition: FlagCondition, flags: Readonly<Record<string, boolean>>): boolean {
  switch (condition.kind) {
    case "flag": return flags[condition.name]!;
    case "not": return !testFlagCondition(condition.value, flags);
    case "and": return testFlagCondition(condition.left, flags) && testFlagCondition(condition.right, flags);
    case "or": return testFlagCondition(condition.left, flags) || testFlagCondition(condition.right, flags);
    case "xor": return testFlagCondition(condition.left, flags) !== testFlagCondition(condition.right, flags);
  }
}
export function describeFlagCondition(condition: FlagCondition): string {
  if (condition.kind === "flag") return `${condition.name.toUpperCase()} = 1`;
  if (condition.kind === "not") return condition.value.kind === "flag"
    ? `${condition.value.name.toUpperCase()} = 0` : `NOT (${describeFlagCondition(condition.value)})`;
  return `(${describeFlagCondition(condition.left)}) ${condition.kind.toUpperCase()} (${describeFlagCondition(condition.right)})`;
}
