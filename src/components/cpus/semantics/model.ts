import type { GroupField, StateFields, UnsignedField } from "../state.ts";

// The first experiment covers byte/word operations on the three 16-bit address spaces.
export type Width = 8 | 16;
export type ValueType = Width | "flag";
export interface Register { readonly kind: "register"; readonly cpu: string; readonly field: string; readonly width: Width }
export interface Flag { readonly kind: "flag"; readonly cpu: string; readonly field: string }
export interface CpuDeclaration { readonly name: string; readonly state: StateFields }

/** Expressions use captured values only; reading live state requires a statement. */
export type NumberExpression =
  | { readonly kind: "value"; readonly name: string }
  | { readonly kind: "literal"; readonly width: Width; readonly value: number }
  | { readonly kind: "subtract" | "add-wrap" | "concat"; readonly left: NumberExpression; readonly right: NumberExpression }
  | { readonly kind: "shift-left" | "shift-right"; readonly value: NumberExpression; readonly incoming: FlagExpression }
  | { readonly kind: "extend"; readonly value: NumberExpression; readonly width: Width };
export type FlagExpression =
  | { readonly kind: "flag-value"; readonly name: string }
  | { readonly kind: "flag-literal"; readonly value: boolean }
  | { readonly kind: "not"; readonly value: FlagExpression }
  | { readonly kind: "xor"; readonly left: FlagExpression; readonly right: FlagExpression }
  | { readonly kind: "negative" | "low-bit" | "zero" | "even-parity"; readonly value: NumberExpression }
  | { readonly kind: "borrow" | "half-borrow" | "subtract-overflow"; readonly left: NumberExpression; readonly right: NumberExpression };

export interface FlagPolicy {
  readonly name: string;
  readonly parameters: Readonly<Record<string, Width>>;
  readonly updates: readonly { readonly flag: Flag; readonly value: FlagExpression }[];
  readonly unlisted: "preserve";
}
export interface ValueSource {
  readonly name: string;
  readonly width: Width;
  readonly steps: readonly Statement[];
  readonly result: NumberExpression;
}
export interface SourceDefinitions {
  readonly cpu: CpuDeclaration;
  readonly groups: Readonly<Record<string, Readonly<Record<string, ValueSource>>>>;
}
export type Statement =
  | { readonly kind: "capture"; readonly name: string; readonly value: NumberExpression }
  | { readonly kind: "read-register"; readonly name: string; readonly register: Register }
  | { readonly kind: "read-flag"; readonly name: string; readonly flag: Flag }
  | { readonly kind: "fetch-byte"; readonly name: string }
  | { readonly kind: "read-memory"; readonly name: string; readonly address: NumberExpression }
  | { readonly kind: "read-source"; readonly name: string; readonly source: ValueSource }
  | { readonly kind: "write-register"; readonly register: Register; readonly value: NumberExpression }
  | { readonly kind: "write-memory"; readonly address: NumberExpression; readonly value: NumberExpression }
  | { readonly kind: "update-flags"; readonly policy: FlagPolicy; readonly arguments: Readonly<Record<string, NumberExpression>> };
export interface InstructionDefinition {
  readonly name: string;
  readonly cpu: CpuDeclaration;
  readonly explanation: string;
  /** Captured numeric inputs supplied by the caller, in declaration order, before the body runs. */
  readonly inputs?: Readonly<Record<string, Width>>;
  readonly steps: readonly Statement[];
}

type UnsignedNames<Fields> = { [Key in keyof Fields]: Fields[Key] extends UnsignedField ? Key : never }[keyof Fields] & string;
type FlagNames<Fields> = { [Key in keyof Fields]: Fields[Key] extends { kind: "flag" } ? Key : never }[keyof Fields] & string;

/** Resolve symbols against CPU-owned schemas, without constructing a CPU or observing state. */
export function cpuSymbols<const Fields extends StateFields & { flags: GroupField }>(name: string, state: Fields) {
  return {
    declaration: { name, state } satisfies CpuDeclaration,
    register(field: UnsignedNames<Fields>): Register {
      const description = state[field];
      if (description?.kind !== "unsigned" || (description.bits !== 8 && description.bits !== 16)) {
        throw new Error(`${name}.${field}: this experiment requires an 8- or 16-bit stored register.`);
      }
      return { kind: "register", cpu: name, field, width: description.bits };
    },
    flag(field: FlagNames<Fields["flags"]["fields"]>): Flag {
      if (state.flags.fields[field]?.kind !== "flag") throw new Error(`${name}.${field}: expected a stored flag.`);
      return { kind: "flag", cpu: name, field };
    },
  };
}

// Typed constructors keep authored formulas legible; their results contain only data.
export const value = (name: string): NumberExpression => ({ kind: "value", name });
export const literal = (width: Width, value: number): NumberExpression => ({ kind: "literal", width, value });
export const subtract = (left: NumberExpression, right: NumberExpression): NumberExpression => ({ kind: "subtract", left, right });
export const addWrap = (left: NumberExpression, right: NumberExpression): NumberExpression => ({ kind: "add-wrap", left, right });
export const concat = (high: NumberExpression, low: NumberExpression): NumberExpression => ({ kind: "concat", left: high, right: low });
export const extend = (value: NumberExpression, width: Width): NumberExpression => ({ kind: "extend", value, width });
export const shiftLeft = (value: NumberExpression, incoming: FlagExpression): NumberExpression => ({ kind: "shift-left", value, incoming });
export const shiftRight = (value: NumberExpression, incoming: FlagExpression): NumberExpression => ({ kind: "shift-right", value, incoming });
export const flagValue = (name: string): FlagExpression => ({ kind: "flag-value", name });
export const flagLiteral = (value: boolean): FlagExpression => ({ kind: "flag-literal", value });
export const negative = (value: NumberExpression): FlagExpression => ({ kind: "negative", value });
export const lowBit = (value: NumberExpression): FlagExpression => ({ kind: "low-bit", value });
export const zero = (value: NumberExpression): FlagExpression => ({ kind: "zero", value });
export const evenParity = (value: NumberExpression): FlagExpression => ({ kind: "even-parity", value });
export const not = (value: FlagExpression): FlagExpression => ({ kind: "not", value });
export const xor = (left: FlagExpression, right: FlagExpression): FlagExpression => ({ kind: "xor", left, right });
export const borrow = (left: NumberExpression, right: NumberExpression): FlagExpression => ({ kind: "borrow", left, right });
export const halfBorrow = (left: NumberExpression, right: NumberExpression): FlagExpression => ({ kind: "half-borrow", left, right });
export const overflow = (left: NumberExpression, right: NumberExpression): FlagExpression => ({ kind: "subtract-overflow", left, right });

// Statement constructors describe effects; they never perform them. Array order is execution order.
export const capture = (name: string, value: NumberExpression): Statement => ({ kind: "capture", name, value });
export const fetchByte = (name: string): Statement => ({ kind: "fetch-byte", name });
export const readRegister = (name: string, register: Register): Statement => ({ kind: "read-register", name, register });
export const readFlag = (name: string, flag: Flag): Statement => ({ kind: "read-flag", name, flag });
export const readMemory = (name: string, address: NumberExpression): Statement => ({ kind: "read-memory", name, address });
export const readSource = (name: string, source: ValueSource): Statement => ({ kind: "read-source", name, source });
export const writeRegister = (register: Register, value: NumberExpression): Statement => ({ kind: "write-register", register, value });
export const writeMemory = (address: NumberExpression, value: NumberExpression): Statement => ({ kind: "write-memory", address, value });
export const updateFlags = (policy: FlagPolicy, args: Readonly<Record<string, NumberExpression>>): Statement => ({ kind: "update-flags", policy, arguments: args });
