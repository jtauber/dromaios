import { array, boolean, defineState, flag, group, unsigned } from "../../state.ts";
import type { StateField, StateFields } from "../../state.ts";
import type { CpuDeclaration, Flag, Latch, Register, RegisterArray } from "../model.ts";
import type { ChapterTokens } from "./document.ts";
import { width } from "./expressions.ts";

export type StateSymbol = Register | RegisterArray | Flag | Latch;

/** The same declaration syntax names stored fields in complete and partial chapters. */
export function stateSymbol(tokens: ChapterTokens, kind: string, name: string, cpu: string): StateSymbol {
  if (name !== name.toUpperCase()) tokens.fail("Register, flag, array, and latch names must be uppercase.");
  let symbol: StateSymbol;
  if (kind === "register" || kind === "array") {
    tokens.expect(":"); const bits = width(tokens);
    let length = 0;
    if (kind === "array") {
      tokens.expect("["); length = tokens.number(); tokens.expect("]");
      tokens.checked(() => array(length, unsigned(bits)));
    }
    const field = tokens.take("=") ? tokens.word() : name.toLowerCase();
    symbol = kind === "register" ? { kind, cpu, field, width: bits }
      : { kind: "register-array", cpu, field, width: bits, length };
  } else {
    if (kind !== "flag" && kind !== "latch") tokens.fail("State blocks contain only registers, flags, arrays, and latches.");
    symbol = { kind, cpu, field: tokens.take("=") ? tokens.word() : name.toLowerCase() };
  }
  tokens.end();
  return symbol;
}

/** Partial chapters refer to an external schema instead of changing its storage. */
export function checkStateSymbol(tokens: ChapterTokens, name: string, symbol: StateSymbol, cpu: CpuDeclaration): void {
  const stored = cpu.state[symbol.field];
  switch (symbol.kind) {
    case "register":
      if (stored?.kind !== "unsigned" || stored.bits !== symbol.width) tokens.fail(`Register ${name} does not match the CPU state schema.`);
      break;
    case "register-array":
      if (stored?.kind !== "array" || stored.element.bits !== symbol.width || stored.length !== symbol.length) tokens.fail(`Array ${name} does not match the CPU state schema.`);
      break;
    case "flag":
      if (cpu.state.flags?.kind !== "group" || cpu.state.flags.fields[symbol.field]?.kind !== "flag") tokens.fail(`Unknown CPU flag ${name}.`);
      break;
    case "latch":
      if (stored?.kind !== "boolean") tokens.fail(`Latch ${name} does not match the CPU state schema.`);
  }
}

/** Build immutable storage in declaration order, with architectural flags in their own group. */
export function chapterState(declarations: readonly { symbol: StateSymbol; tokens: ChapterTokens }[]): StateFields {
  const fields = new Map<string, StateField>(), flags = new Map<string, StateField>();
  for (const { symbol, tokens } of declarations) {
    const { kind, field } = symbol;
    if (kind === "flag") {
      if (flags.size === 0 && fields.has("flags")) tokens.fail("Stored field flags conflicts with the flag group.");
      if (flags.has(field)) tokens.fail(`Duplicate stored flag ${field}.`);
      flags.set(field, flag); fields.set("flags", group(Object.fromEntries(flags)));
    } else {
      if (fields.has(field)) tokens.fail(`Duplicate stored field ${field}.`);
      fields.set(field, kind === "register" ? unsigned(symbol.width)
        : kind === "register-array" ? array(symbol.length, unsigned(symbol.width)) : boolean);
    }
  }
  return defineState(Object.fromEntries(fields));
}

/** Emit a small schema module that does not import the chapter's expanded instruction data. */
export function generateChapterState(state: StateFields): string {
  const helpers = new Set(["defineState"]);
  const call = (name: string, ...args: string[]) => { helpers.add(name); return `${name}(${args.join(", ")})`; };
  function field(value: StateField): string {
    switch (value.kind) {
      case "unsigned": return call("unsigned", String(value.bits));
      case "array": return call("array", String(value.length), field(value.element));
      case "group": return call("group", fields(value.fields));
      case "choice": return call("choices", ...value.values.map(String));
      case "named-choice": return call("namedChoices", ...value.values.map(value => JSON.stringify(value)));
      case "boolean": case "flag": helpers.add(value.kind); return value.kind;
    }
  }
  function fields(state: StateFields): string {
    return `{ ${Object.entries(state).map(([name, value]) => `${JSON.stringify(name)}: ${field(value)}`).join(", ")} }`;
  }
  const body = Object.entries(state).map(([name, value]) => `  ${JSON.stringify(name)}: ${field(value)},`).join("\n");
  return `// Generated from a literate CPU chapter. Do not edit.
import { ${[...helpers].join(", ")} } from "../../../state.ts";
import type { StateValues } from "../../../state.ts";

export const state = defineState({
${body}
});
export type StoredState = StateValues<typeof state>;
`;
}
