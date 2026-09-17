import type { GroupField, StateFields, UnsignedField } from "../state.ts";

// The experiment covers byte/word operations and addresses represented as 16-bit values.
export type Width = 8 | 16;
export type ValueType = Width | "flag";
export interface Register { readonly kind: "register"; readonly cpu: string; readonly field: string; readonly width: Width }
export interface Flag { readonly kind: "flag"; readonly cpu: string; readonly field: string }
export interface Latch { readonly kind: "latch"; readonly cpu: string; readonly field: string }
export interface CpuDeclaration { readonly name: string; readonly state: StateFields }

interface ArithmeticOperands {
  readonly left: NumberExpression;
  readonly right: NumberExpression;
  readonly incoming?: FlagExpression;
}

/** Expressions use captured values only; reading live state requires a statement. */
export type NumberExpression =
  | { readonly kind: "value"; readonly name: string }
  | { readonly kind: "literal"; readonly width: Width; readonly value: number }
  | { readonly kind: "high-byte" | "low-byte"; readonly value: NumberExpression }
  | ({ readonly kind: "subtract" | "add-wrap" } & ArithmeticOperands)
  | { readonly kind: "concat" | "bit-and" | "bit-or" | "bit-xor"; readonly left: NumberExpression; readonly right: NumberExpression }
  | { readonly kind: "shift-left" | "shift-right"; readonly value: NumberExpression; readonly incoming: FlagExpression }
  | { readonly kind: "extend"; readonly value: NumberExpression; readonly width: Width };
export type FlagExpression =
  | { readonly kind: "flag-value"; readonly name: string }
  | { readonly kind: "flag-literal"; readonly value: boolean }
  | { readonly kind: "not"; readonly value: FlagExpression }
  | { readonly kind: "xor"; readonly left: FlagExpression; readonly right: FlagExpression }
  | { readonly kind: "negative" | "low-bit" | "zero" | "even-parity"; readonly value: NumberExpression }
  | ({ readonly kind: "borrow" | "half-borrow" | "subtract-overflow" | "carry" | "half-carry" | "add-overflow" } & ArithmeticOperands);
export type Expression = NumberExpression | FlagExpression;

export interface FlagPolicy {
  readonly name: string;
  readonly parameters: Readonly<Record<string, ValueType>>;
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
  | { readonly kind: "write-latch"; readonly latch: Latch; readonly value: boolean }
  | { readonly kind: "write-memory"; readonly address: NumberExpression; readonly value: NumberExpression }
  | { readonly kind: "update-flags"; readonly policy: FlagPolicy; readonly arguments: Readonly<Record<string, Expression>> };
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
type LatchNames<Fields> = { [Key in keyof Fields]: Fields[Key] extends { kind: "boolean" } ? Key : never }[keyof Fields] & string;

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
    latch(field: LatchNames<Fields>): Latch {
      if (state[field]?.kind !== "boolean") throw new Error(`${name}.${field}: expected a stored control latch.`);
      return { kind: "latch", cpu: name, field };
    },
  };
}

// Typed constructors keep authored formulas legible; their results contain only data.
function arithmetic<Kind extends NumberExpression["kind"] | FlagExpression["kind"]>(kind: Kind,
  left: NumberExpression, right: NumberExpression, incoming?: FlagExpression): { readonly kind: Kind } & ArithmeticOperands {
  return { kind, left, right, ...(incoming === undefined ? {} : { incoming }) };
}
export const value = (name: string): NumberExpression => ({ kind: "value", name });
export const literal = (width: Width, value: number): NumberExpression => ({ kind: "literal", width, value });
export const subtract = (left: NumberExpression, right: NumberExpression, incoming?: FlagExpression): NumberExpression => arithmetic("subtract", left, right, incoming);
export const addWrap = (left: NumberExpression, right: NumberExpression, incoming?: FlagExpression): NumberExpression => arithmetic("add-wrap", left, right, incoming);
export const bitAnd = (left: NumberExpression, right: NumberExpression): NumberExpression => ({ kind: "bit-and", left, right });
export const bitOr = (left: NumberExpression, right: NumberExpression): NumberExpression => ({ kind: "bit-or", left, right });
export const bitXor = (left: NumberExpression, right: NumberExpression): NumberExpression => ({ kind: "bit-xor", left, right });
export const concat = (high: NumberExpression, low: NumberExpression): NumberExpression => ({ kind: "concat", left: high, right: low });
export const highByte = (value: NumberExpression): NumberExpression => ({ kind: "high-byte", value });
export const lowByte = (value: NumberExpression): NumberExpression => ({ kind: "low-byte", value });
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
export const borrow = (left: NumberExpression, right: NumberExpression, incoming?: FlagExpression): FlagExpression => arithmetic("borrow", left, right, incoming);
export const halfBorrow = (left: NumberExpression, right: NumberExpression, incoming?: FlagExpression): FlagExpression => arithmetic("half-borrow", left, right, incoming);
export const overflow = (left: NumberExpression, right: NumberExpression, incoming?: FlagExpression): FlagExpression => arithmetic("subtract-overflow", left, right, incoming);

export const carry = (left: NumberExpression, right: NumberExpression, incoming?: FlagExpression): FlagExpression => arithmetic("carry", left, right, incoming);
export const halfCarry = (left: NumberExpression, right: NumberExpression, incoming?: FlagExpression): FlagExpression => arithmetic("half-carry", left, right, incoming);
export const addOverflow = (left: NumberExpression, right: NumberExpression, incoming?: FlagExpression): FlagExpression => arithmetic("add-overflow", left, right, incoming);

// Statement constructors describe effects; they never perform them. Array order is execution order.
export const capture = (name: string, value: NumberExpression): Statement => ({ kind: "capture", name, value });
export const fetchByte = (name: string): Statement => ({ kind: "fetch-byte", name });
export const readRegister = (name: string, register: Register): Statement => ({ kind: "read-register", name, register });
export const readFlag = (name: string, flag: Flag): Statement => ({ kind: "read-flag", name, flag });
export const readMemory = (name: string, address: NumberExpression): Statement => ({ kind: "read-memory", name, address });
export const readSource = (name: string, source: ValueSource): Statement => ({ kind: "read-source", name, source });
export const writeRegister = (register: Register, value: NumberExpression): Statement => ({ kind: "write-register", register, value });
export const writeLatch = (latch: Latch, value: boolean): Statement => ({ kind: "write-latch", latch, value });
export const writeMemory = (address: NumberExpression, value: NumberExpression): Statement => ({ kind: "write-memory", address, value });
export const updateFlags = (policy: FlagPolicy, args: Readonly<Record<string, Expression>>): Statement => ({ kind: "update-flags", policy, arguments: args });
