import type { ArrayField, ChoiceField, NamedChoiceField, GroupField, StateFields, UnsignedField } from "../state.ts";

// Unsigned bit vectors, including double-word intermediates and the 8008's narrow selectors.
export type Width = 3 | 8 | 14 | 16 | 32;
export const isWidth = (bits: number): bits is Width => bits === 3 || bits === 8 || bits === 14 || bits === 16 || bits === 32;
export type ValueType = Width | "flag";
export interface Register { readonly kind: "register"; readonly cpu: string; readonly field: string; readonly width: Width; readonly bank?: string }
export interface FlagGroup { readonly kind: "flag-group"; readonly cpu: string; readonly bank?: string }
export interface RegisterArray { readonly kind: "register-array"; readonly cpu: string; readonly field: string; readonly width: Width; readonly length: number; readonly bank?: string }
export interface Flag { readonly kind: "flag"; readonly cpu: string; readonly field: string; readonly bank?: string }
export interface Latch { readonly kind: "latch"; readonly cpu: string; readonly field: string; readonly bank?: string }
export interface Choice<Value extends string | number = string | number> { readonly kind: "choice"; readonly cpu: string; readonly field: string; readonly values: readonly Value[]; readonly bank?: string }
export interface CpuDeclaration {
  readonly name: string;
  readonly state: StateFields;
  /** A chapter execution contract supplies an IRQ-deferral destination at retirement. */
  readonly irqDeferral?: true;
  /** Segmented boundaries supply deferral, software delivery reporting, and TEST/ESC effects. */
  readonly segmentedBoundary?: true;
  /** Word boundaries supply 32-bit logical addresses, staged EAs, and device-reset effects. */
  readonly wordBoundary?: true;
  /** The execution boundary delivers RETI notification after successful retirement. */
  readonly retiNotification?: true;
}

export interface ArithmeticOperands {
  readonly left: NumberExpression;
  readonly right: NumberExpression;
  readonly incoming?: FlagExpression;
}

/** Expressions use captured values only; reading live state requires a statement. */
export type NumberExpression =
  | { readonly kind: "select"; readonly condition: FlagExpression; readonly yes: NumberExpression; readonly no: NumberExpression }
  | { readonly kind: "value"; readonly name: string }
  | { readonly kind: "literal"; readonly width: Width; readonly value: number }
  | { readonly kind: "pack"; readonly width: Width; readonly bits: readonly FlagExpression[] }
  | { readonly kind: "bits"; readonly value: NumberExpression; readonly high: number; readonly low: number }
  | { readonly kind: "with-bits"; readonly value: NumberExpression; readonly high: number; readonly low: number; readonly replacement: NumberExpression }
  | { readonly kind: "high-byte" | "low-byte"; readonly value: NumberExpression }
  | ({ readonly kind: "subtract" | "add-wrap" } & ArithmeticOperands)
  | { readonly kind: "concat" | "bit-and" | "bit-or" | "bit-xor"; readonly left: NumberExpression; readonly right: NumberExpression }
  | { readonly kind: "multiply"; readonly left: NumberExpression; readonly right: NumberExpression; readonly signed?: boolean }
  | { readonly kind: "shift-left" | "shift-right"; readonly value: NumberExpression; readonly incoming: FlagExpression }
  | { readonly kind: "shift-bits"; readonly value: NumberExpression; readonly direction: "left" | "right"; readonly count: number }
  | { readonly kind: "extend" | "sign-extend" | "truncate"; readonly value: NumberExpression; readonly width: Width };
export type FlagExpression =
  | { readonly kind: "flag-value"; readonly name: string }
  | { readonly kind: "flag-literal"; readonly value: boolean }
  | { readonly kind: "not"; readonly value: FlagExpression }
  | { readonly kind: "xor" | "and" | "or"; readonly left: FlagExpression; readonly right: FlagExpression }
  | { readonly kind: "negative" | "low-bit" | "zero" | "even-parity"; readonly value: NumberExpression }
  | { readonly kind: "bit"; readonly value: NumberExpression; readonly position: number }
  | { readonly kind: "equal"; readonly left: NumberExpression; readonly right: NumberExpression }
  | { readonly kind: "less-than"; readonly left: NumberExpression; readonly right: NumberExpression; readonly signed: boolean }
  | ({ readonly kind: "borrow" | "half-borrow" | "subtract-overflow" | "carry" | "half-carry" | "add-overflow" } & ArithmeticOperands);
export type Expression = NumberExpression | FlagExpression;
export interface IterationValue { readonly type: ValueType; readonly initial: Expression; readonly next: Expression }

/** Project captured words onto a physical byte bus; logical offset progression precedes projection. */
export interface AddressProjection {
  readonly kind: "address-projection";
  readonly base: NumberExpression;
  readonly offset: NumberExpression;
  readonly baseShift: number;
  readonly addressBits: number;
}
export type AddressExpression = NumberExpression | AddressProjection;

export interface FlagPolicy {
  readonly name: string;
  readonly parameters: Readonly<Record<string, ValueType>>;
  readonly updates: readonly { readonly flag: Flag; readonly value: FlagExpression }[];
  readonly unlisted: "preserve";
}
export interface ValueSource {
  readonly name: string;
  readonly inputs?: Readonly<Record<string, ValueType>>;
  readonly type: ValueType;
  readonly steps: readonly Statement[];
  readonly result: Expression;
}
/** Disjoint masked byte cases with effects in their own lexical scope. */
export interface DispatchCase {
  readonly mask: number;
  readonly value: number;
  readonly steps: readonly Statement[];
}
export interface MatchCase extends DispatchCase {
  readonly result: Expression;
}
export interface SourceDefinitions {
  readonly cpu: CpuDeclaration;
  readonly groups: Readonly<Record<string, Readonly<Record<string, ValueSource>>>>;
}
/** Captured ESC operands; physical projection and the dummy read remain explicit in the definition. */
export interface EscapeRequest {
  readonly opcode: NumberExpression;
  readonly modRM: NumberExpression;
  readonly memory?: { readonly segment: NumberExpression; readonly offset: NumberExpression; readonly address: AddressExpression; readonly value: NumberExpression };
}
export interface ValueBranch { readonly steps: readonly Statement[]; readonly result: Expression }
export type Statement =
  | { readonly kind: "choose"; readonly name: string; readonly condition: FlagExpression; readonly type: ValueType; readonly yes: ValueBranch; readonly no: ValueBranch }
  | { readonly kind: "dispatch"; readonly selector: NumberExpression; readonly cases: readonly DispatchCase[] }
  | { readonly kind: "match"; readonly name: string; readonly selector: NumberExpression; readonly type: ValueType; readonly cases: readonly MatchCase[] }
  | { readonly kind: "perform"; readonly action: Action; readonly arguments: Readonly<Record<string, Expression>> }
  | { readonly kind: "when"; readonly condition: FlagExpression; readonly steps: readonly Statement[] }
  | { readonly kind: "iterate"; readonly name: string; readonly count: NumberExpression; readonly initial: NumberExpression; readonly steps: readonly Statement[]; readonly result: NumberExpression }
  | { readonly kind: "iterate-together"; readonly count: NumberExpression; readonly values: Readonly<Record<string, IterationValue>>; readonly steps: readonly Statement[] }
  | { readonly kind: "reject"; readonly reason: string }
  | { readonly kind: "divide"; readonly quotient: string; readonly remainder: string; readonly dividend: NumberExpression; readonly divisor: NumberExpression; readonly signed: boolean; readonly onError: string; readonly overflow?: string }
  | { readonly kind: "capture"; readonly name: string; readonly value: Expression; readonly type?: ValueType }
  | { readonly kind: "read-register"; readonly name: string; readonly register: Register }
  | { readonly kind: "read-pending-register"; readonly name: string; readonly register: Register }
  | { readonly kind: "stage-register"; readonly register: Register; readonly value: NumberExpression }
  | { readonly kind: "read-element"; readonly name: string; readonly array: RegisterArray; readonly index: NumberExpression }
  | { readonly kind: "read-flag"; readonly name: string; readonly flag: Flag }
  | { readonly kind: "test-choice"; readonly name: string; readonly choice: Choice; readonly value: string | number }
  | { readonly kind: "read-latch"; readonly name: string; readonly latch: Latch }
  | { readonly kind: "exchange-flags"; readonly left: FlagGroup; readonly right: FlagGroup }
  | { readonly kind: "fetch-byte"; readonly name: string }
  | { readonly kind: "fetch-word"; readonly name: string }
  | { readonly kind: "read-next-address"; readonly name: string }
  | { readonly kind: "select-target"; readonly address: NumberExpression }
  | { readonly kind: "resolve-address"; readonly name: string; readonly size: 8 | 16 | 32; readonly mode: NumberExpression; readonly code: NumberExpression }
  | { readonly kind: "commit-address-updates" }
  | { readonly kind: "alignment-fault"; readonly operation: "read" | "write" | "fetch"; readonly address: NumberExpression; readonly space: "data" | "program" }
  | { readonly kind: "read-program-memory"; readonly name: string; readonly address: NumberExpression }
  | { readonly kind: "read-port"; readonly name: string; readonly port: NumberExpression }
  | { readonly kind: "read-memory"; readonly name: string; readonly address: AddressExpression }
  | { readonly kind: "read-source"; readonly name: string; readonly source: ValueSource; readonly arguments?: Readonly<Record<string, Expression>> }
  | { readonly kind: "write-register"; readonly register: Register; readonly value: NumberExpression }
  | { readonly kind: "write-element"; readonly array: RegisterArray; readonly index: NumberExpression; readonly value: NumberExpression }
  | { readonly kind: "fill-array"; readonly array: RegisterArray; readonly value: NumberExpression }
  | { readonly kind: "defer-interrupt"; readonly scope: "irq" | "intr" | "all" }
  | { readonly kind: "notify-reti" }
  | { readonly kind: "reset-devices" }
  | { readonly kind: "report-interrupt"; readonly vector: NumberExpression }
  | { readonly kind: "read-test"; readonly name: string }
  | ({ readonly kind: "send-escape" } & EscapeRequest)
  | { readonly kind: "write-choice"; readonly choice: Choice; readonly value: string | number }
  | { readonly kind: "write-latch"; readonly latch: Latch; readonly value: boolean | FlagExpression }
  | { readonly kind: "write-port"; readonly port: NumberExpression; readonly value: NumberExpression }
  | { readonly kind: "write-memory"; readonly address: AddressExpression; readonly value: NumberExpression }
  | { readonly kind: "update-flags" | "replace-flags"; readonly policy: FlagPolicy; readonly arguments: Readonly<Record<string, Expression>> };
export interface Action {
  readonly name: string;
  /** Captured inputs supplied by the caller, in declaration order, before the body runs. */
  readonly inputs?: Readonly<Record<string, ValueType>>;
  readonly steps: readonly Statement[];
}
export interface InstructionDefinition extends Action {
  readonly cpu: CpuDeclaration;
  readonly explanation: string;
}

type UnsignedNames<Fields> = { [Key in keyof Fields]: Fields[Key] extends UnsignedField ? Key : never }[keyof Fields] & string;
type ArrayNames<Fields> = { [Key in keyof Fields]: Fields[Key] extends ArrayField ? Key : never }[keyof Fields] & string;
type FlagNames<Fields> = { [Key in keyof Fields]: Fields[Key] extends { kind: "flag" } ? Key : never }[keyof Fields] & string;
type LatchNames<Fields> = { [Key in keyof Fields]: Fields[Key] extends { kind: "boolean" } ? Key : never }[keyof Fields] & string;
type ChoiceNames<Fields> = { [Key in keyof Fields]: Fields[Key] extends ChoiceField | NamedChoiceField ? Key : never }[keyof Fields] & string;
type BankNames<Fields> = { [Key in keyof Fields]: Fields[Key] extends GroupField<StateFields & { flags: GroupField }> ? Key : never }[keyof Fields] & string;

/** A bank names stored registers and its complete flag object; it does not create another CPU. */
function bankSymbols<const Fields extends StateFields>(name: string, state: Fields, bank?: string) {
  const location = bank === undefined ? {} : { bank };
  return {
    flags: { kind: "flag-group", cpu: name, ...location } satisfies FlagGroup,
    register(field: UnsignedNames<Fields>): Register {
      const description = state[field];
      if (description?.kind !== "unsigned" || !isWidth(description.bits)) {
        throw new Error(`${name}.${bank === undefined ? "" : bank + "."}${field}: expected a stored register with a supported width.`);
      }
      return { kind: "register", cpu: name, field, width: description.bits, ...location };
    },
  };
}

/** Resolve symbols against CPU-owned schemas, without constructing a CPU or observing state. */
export function cpuSymbols<const Fields extends StateFields & { flags: GroupField }>(name: string, state: Fields) {
  return {
    declaration: { name, state } satisfies CpuDeclaration,
    ...bankSymbols(name, state),
    bank<Key extends BankNames<Fields>>(field: Key) {
      const description = state[field];
      if (description?.kind !== "group" || description.fields.flags?.kind !== "group") throw new Error(`${name}.${field}: expected a register bank with flags.`);
      return bankSymbols(name, description.fields as Extract<Fields[Key], GroupField>["fields"], field);
    },
    array(field: ArrayNames<Fields>): RegisterArray {
      const description = state[field];
      if (description?.kind !== "array" || !isWidth(description.element.bits)) {
        throw new Error(`${name}.${field}: expected a stored register array with a supported width.`);
      }
      return { kind: "register-array", cpu: name, field, width: description.element.bits, length: description.length };
    },
    flag(field: FlagNames<Fields["flags"]["fields"]>): Flag {
      if (state.flags.fields[field]?.kind !== "flag") throw new Error(`${name}.${field}: expected a stored flag.`);
      return { kind: "flag", cpu: name, field };
    },
    choice<Key extends ChoiceNames<Fields>>(field: Key): Choice<Extract<Fields[Key], ChoiceField | NamedChoiceField>["values"][number]> {
      const description = state[field];
      if (description?.kind !== "choice" && description?.kind !== "named-choice") throw new Error(`${name}.${field}: expected declared control choices.`);
      return { kind: "choice", cpu: name, field, values: description.values as Extract<Fields[Key], ChoiceField | NamedChoiceField>["values"] };
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
export const select = (condition: FlagExpression, yes: NumberExpression, no: NumberExpression): NumberExpression => ({ kind: "select", condition, yes, no });
export const value = (name: string): NumberExpression => ({ kind: "value", name });
export const literal = (width: Width, value: number): NumberExpression => ({ kind: "literal", width, value });
/** Pack exactly width flags, most significant first, into an unsigned value. */
export const pack = (width: Width, bits: readonly FlagExpression[]): NumberExpression => ({ kind: "pack", width, bits });
/** Extract an inclusive bit range as an unsigned value whose width is high - low + 1. */
export const bits = (value: NumberExpression, high: number, low: number): NumberExpression => ({ kind: "bits", value, high, low });
/** Replace an inclusive bit range, retaining the original width and all surrounding bits. */
export const withBits = (value: NumberExpression, high: number, low: number, replacement: NumberExpression): NumberExpression =>
  ({ kind: "with-bits", value, high, low, replacement });
export const subtract = (left: NumberExpression, right: NumberExpression, incoming?: FlagExpression): NumberExpression => arithmetic("subtract", left, right, incoming);
export const addWrap = (left: NumberExpression, right: NumberExpression, incoming?: FlagExpression): NumberExpression => arithmetic("add-wrap", left, right, incoming);
export const bitAnd = (left: NumberExpression, right: NumberExpression): NumberExpression => ({ kind: "bit-and", left, right });
export const bitOr = (left: NumberExpression, right: NumberExpression): NumberExpression => ({ kind: "bit-or", left, right });
export const bitXor = (left: NumberExpression, right: NumberExpression): NumberExpression => ({ kind: "bit-xor", left, right });
export const concat = (high: NumberExpression, low: NumberExpression): NumberExpression => ({ kind: "concat", left: high, right: low });
export const multiply = (left: NumberExpression, right: NumberExpression, signed?: boolean): NumberExpression =>
  ({ kind: "multiply", left, right, ...(signed === undefined ? {} : { signed }) });
export const highByte = (value: NumberExpression): NumberExpression => ({ kind: "high-byte", value });
export const lowByte = (value: NumberExpression): NumberExpression => ({ kind: "low-byte", value });
export const extend = (value: NumberExpression, width: Width): NumberExpression => ({ kind: "extend", value, width });
export const signExtend = (value: NumberExpression, width: Width): NumberExpression => ({ kind: "sign-extend", value, width });
export const truncate = (value: NumberExpression, width: Width): NumberExpression => ({ kind: "truncate", value, width });
export const shiftLeft = (value: NumberExpression, incoming: FlagExpression): NumberExpression => ({ kind: "shift-left", value, incoming });
export const shiftRight = (value: NumberExpression, incoming: FlagExpression): NumberExpression => ({ kind: "shift-right", value, incoming });
export const shiftBits = (value: NumberExpression, direction: "left" | "right", count: number): NumberExpression => ({ kind: "shift-bits", value, direction, count });
export const flagValue = (name: string): FlagExpression => ({ kind: "flag-value", name });
export const flagLiteral = (value: boolean): FlagExpression => ({ kind: "flag-literal", value });
export const negative = (value: NumberExpression): FlagExpression => ({ kind: "negative", value });
export const lowBit = (value: NumberExpression): FlagExpression => ({ kind: "low-bit", value });
export const bit = (value: NumberExpression, position: number): FlagExpression => ({ kind: "bit", value, position });
export const zero = (value: NumberExpression): FlagExpression => ({ kind: "zero", value });
export const evenParity = (value: NumberExpression): FlagExpression => ({ kind: "even-parity", value });
export const equal = (left: NumberExpression, right: NumberExpression): FlagExpression => ({ kind: "equal", left, right });
export const lessThan = (left: NumberExpression, right: NumberExpression, signed: boolean): FlagExpression => ({ kind: "less-than", left, right, signed });
export const not = (value: FlagExpression): FlagExpression => ({ kind: "not", value });
export const xor = (left: FlagExpression, right: FlagExpression): FlagExpression => ({ kind: "xor", left, right });
export const and = (left: FlagExpression, right: FlagExpression): FlagExpression => ({ kind: "and", left, right });
export const or = (left: FlagExpression, right: FlagExpression): FlagExpression => ({ kind: "or", left, right });
export const borrow = (left: NumberExpression, right: NumberExpression, incoming?: FlagExpression): FlagExpression => arithmetic("borrow", left, right, incoming);
export const halfBorrow = (left: NumberExpression, right: NumberExpression, incoming?: FlagExpression): FlagExpression => arithmetic("half-borrow", left, right, incoming);
export const overflow = (left: NumberExpression, right: NumberExpression, incoming?: FlagExpression): FlagExpression => arithmetic("subtract-overflow", left, right, incoming);

export const carry = (left: NumberExpression, right: NumberExpression, incoming?: FlagExpression): FlagExpression => arithmetic("carry", left, right, incoming);
export const halfCarry = (left: NumberExpression, right: NumberExpression, incoming?: FlagExpression): FlagExpression => arithmetic("half-carry", left, right, incoming);
export const addOverflow = (left: NumberExpression, right: NumberExpression, incoming?: FlagExpression): FlagExpression => arithmetic("add-overflow", left, right, incoming);

export const projectAddress = (base: NumberExpression, offset: NumberExpression, baseShift: number, addressBits: number): AddressProjection =>
  ({ kind: "address-projection", base, offset, baseShift, addressBits });

// Statement constructors describe effects; they never perform them. Array order is execution order.
export const when = (condition: FlagExpression, steps: readonly Statement[]): Statement => ({ kind: "when", condition, steps });
/** Fold a byte count of iterations over an immutable per-iteration value; publish the final value under name. */
export const iterate = (name: string, count: NumberExpression, initial: NumberExpression, steps: readonly Statement[], result: NumberExpression): Statement =>
  ({ kind: "iterate", name, count, initial, steps, result });
/** Carry named numbers/flags through a byte-counted loop; evaluate all next values before updating any. */
export const iterateTogether = (count: NumberExpression, values: Readonly<Record<string, IterationValue>>, steps: readonly Statement[]): Statement =>
  ({ kind: "iterate-together", count, values, steps });
/** End this body with a named outcome; the CPU boundary decides how to deliver it. */
export const reject = (reason: string): Statement => ({ kind: "reject", reason });
/** Divide a double-width dividend by a byte/word. Reject zero; optionally capture overflow instead of rejecting it. */
export const divide = (division: Omit<Extract<Statement, { kind: "divide" }>, "kind">): Statement => ({ kind: "divide", ...division });
export const capture = (name: string, value: Expression, type?: ValueType): Statement => ({ kind: "capture", name, value, ...(type === undefined ? {} : { type }) });
export const fetchByte = (name: string): Statement => ({ kind: "fetch-byte", name });
/** Fetch one complete operand word in the CPU's native order and retain its fetch-commit boundary. */
export const fetchWord = (name: string): Statement => ({ kind: "fetch-word", name });
/** Capture the CPU's sequential fetch cursor, independently of architectural PC or a selected target. */
export const readNextAddress = (name: string): Statement => ({ kind: "read-next-address", name });
/** Select a target for successful retirement; the definition must check its alignment first. */
export const selectTarget = (address: NumberExpression): Statement => ({ kind: "select-target", address });
/** Decode a word-model memory EA now, retaining staged address-register updates for later operands. */
export const resolveAddress = (name: string, size: 8 | 16 | 32, mode: NumberExpression, code: NumberExpression): Statement => ({ kind: "resolve-address", name, size, mode, code });
export const commitAddressUpdates = (): Statement => ({ kind: "commit-address-updates" });
/** Assert the connected device reset signal now; the boundary records successful completion. */
export const resetDevices = (): Statement => ({ kind: "reset-devices" });
/** Return a rejected logical access; test alignment explicitly before this statement. */
export const alignmentFault = (operation: "read" | "write" | "fetch", address: NumberExpression, space: "data" | "program" = operation === "fetch" ? "program" : "data"): Statement => ({ kind: "alignment-fault", operation, address, space });
export const readProgramMemory = (name: string, address: NumberExpression): Statement => ({ kind: "read-program-memory", name, address });
export const readRegister = (name: string, register: Register): Statement => ({ kind: "read-register", name, register });
/** Read an earlier staged value if present, otherwise read this stored register now. */
export const readPendingRegister = (name: string, register: Register): Statement => ({ kind: "read-pending-register", name, register });
/** Capture a pending value without changing stored state; the caller chooses when to commit. */
export const stageRegister = (register: Register, value: NumberExpression): Statement => ({ kind: "stage-register", register, value });
export const readElement = (name: string, array: RegisterArray, index: NumberExpression): Statement => ({ kind: "read-element", name, array, index });
export const readFlag = (name: string, flag: Flag): Statement => ({ kind: "read-flag", name, flag });
export const readLatch = (name: string, latch: Latch): Statement => ({ kind: "read-latch", name, latch });
export const exchangeFlags = (left: FlagGroup, right: FlagGroup): Statement => ({ kind: "exchange-flags", left, right });
export const readMemory = (name: string, address: AddressExpression): Statement => ({ kind: "read-memory", name, address });
export const readSource = (name: string, source: ValueSource, args?: Readonly<Record<string, Expression>>): Statement =>
  ({ kind: "read-source", name, source, ...(args === undefined ? {} : { arguments: args }) });
/** Expand a named operation in its own capture scope; arguments are captured before its effects. */
export const perform = (action: Action, args: Readonly<Record<string, Expression>>): Statement =>
  ({ kind: "perform", action: { name: action.name, ...(action.inputs ? { inputs: action.inputs } : {}), steps: action.steps }, arguments: args });
export const writeRegister = (register: Register, value: NumberExpression): Statement => ({ kind: "write-register", register, value });
export const writeElement = (array: RegisterArray, index: NumberExpression, value: NumberExpression): Statement => ({ kind: "write-element", array, index, value });
export const fillArray = (array: RegisterArray, value: NumberExpression): Statement => ({ kind: "fill-array", array, value });
export const writeLatch = (latch: Latch, value: boolean | FlagExpression): Statement => ({ kind: "write-latch", latch, value });
export const writeMemory = (address: AddressExpression, value: NumberExpression): Statement => ({ kind: "write-memory", address, value });
export const updateFlags = (policy: FlagPolicy, args: Readonly<Record<string, Expression>>): Statement => ({ kind: "update-flags", policy, arguments: args });
export const replaceFlags = (policy: FlagPolicy, args: Readonly<Record<string, Expression>>): Statement => ({ kind: "replace-flags", policy, arguments: args });

/** Request recognition inhibition at successful retirement; the boundary owns its stored latches. */
export const deferInterrupt = (scope: "irq" | "intr" | "all"): Statement => ({ kind: "defer-interrupt", scope });

/** Port space is distinct from RAM: a word address selects one byte transfer. */
export const readPort = (name: string, port: NumberExpression): Statement => ({ kind: "read-port", name, port });
export const writePort = (port: NumberExpression, value: NumberExpression): Statement => ({ kind: "write-port", port, value });

/** Compare a live declared control choice, capturing only the Boolean result. */
export const testChoice = <Value extends string | number>(name: string, choice: Choice<Value>, value: NoInfer<Value>): Statement => ({ kind: "test-choice", name, choice, value });
export const writeChoice = <Value extends string | number>(choice: Choice<Value>, value: NoInfer<Value>): Statement => ({ kind: "write-choice", choice, value });
/** Request the Z80 device notification after successful architectural retirement. */
export const notifyReti = (): Statement => ({ kind: "notify-reti" });

/** External delivery reporting and pin/device effects do not hide CPU state or memory operations. */
export const reportInterrupt = (vector: NumberExpression): Statement => ({ kind: "report-interrupt", vector });
export const readTest = (name: string): Statement => ({ kind: "read-test", name });
export const sendEscape = (request: EscapeRequest): Statement => ({ kind: "send-escape", ...request });
