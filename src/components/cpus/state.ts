import { checkUnsigned } from "../validation.ts";

export interface UnsignedField {
  readonly kind: "unsigned";
  readonly bits: number;
  readonly maximum: number;
}

export interface ChoiceField<Values extends readonly number[] = readonly number[]> {
  readonly kind: "choice";
  readonly values: Values;
}

export interface ArrayField<Length extends number = number> {
  readonly kind: "array";
  readonly length: Length;
  readonly element: UnsignedField;
}

export interface GroupField<Fields extends StateFields = StateFields> {
  readonly kind: "group";
  readonly fields: Fields;
}

/** A Boolean architectural flag; text formats may distinguish it from a control latch. */
export const flag = Object.freeze({ kind: "flag" } as const);
/** A Boolean control latch. Its textual spelling belongs to the consuming format. */
export const boolean = Object.freeze({ kind: "boolean" } as const);

export type StateField = UnsignedField | ChoiceField | ArrayField | GroupField | typeof flag | typeof boolean;
export interface StateFields { readonly [name: string]: StateField }

/** Check that a description covers a public state type, including nested fields and tuple lengths. */
export type StateDescription<State> = {
  readonly [Name in keyof State]-?: State[Name] extends readonly number[] ? ArrayField<State[Name]["length"]>
    : [State[Name]] extends [boolean] ? typeof flag | typeof boolean
    : number extends State[Name] ? UnsignedField
    : State[Name] extends number ? ChoiceField<readonly State[Name][]>
    : State[Name] extends object ? GroupField<StateDescription<State[Name]>> : never;
};

type Repeated<Value, Length extends number, Items extends Value[] = []> = number extends Length ? Value[]
  : Items["length"] extends Length ? Items : Repeated<Value, Length, [...Items, Value]>;
type FieldValue<Field extends StateField> = Field extends UnsignedField ? number
  : Field extends ChoiceField ? Field["values"][number]
  : Field extends ArrayField ? Repeated<number, Field["length"]>
  : Field extends GroupField ? StateValues<Field["fields"]> : boolean;

/** Mutable stored values described by the fields; derived register views are absent. */
export type StateValues<Fields extends StateFields> = { -readonly [Name in keyof Fields]: FieldValue<Fields[Name]> };
type ReadonlyState<State> = { readonly [Name in keyof State]: State[Name] extends object ? ReadonlyState<State[Name]> : State[Name] };

/** An unsigned integer of the given width, up to JavaScript's exact integer range. */
export function unsigned(bits: number): UnsignedField {
  if (!Number.isInteger(bits) || bits < 1 || bits > 53) throw new RangeError("State widths must be integers from 1 to 53.");
  return Object.freeze({ kind: "unsigned", bits, maximum: 2 ** bits - 1 });
}

/** A nonempty set of permitted unsigned integer values, retaining its literal union type. */
export function choices<const Values extends readonly [number, ...number[]]>(...values: Values): ChoiceField<Readonly<Values>> {
  if (values.length === 0) throw new RangeError("State choices must not be empty.");
  for (const value of values) checkUnsigned("State choice", value, Number.MAX_SAFE_INTEGER);
  if (new Set(values).size !== values.length) throw new RangeError("State choices must be distinct.");
  // A rest parameter already owns its array; freezing it cannot affect the caller's list.
  return Object.freeze({ kind: "choice", values: Object.freeze(values) });
}

/** A fixed number of unsigned values, such as physical address registers. */
export function array<const Length extends number>(length: Length, element: UnsignedField): ArrayField<Length> {
  if (!Number.isSafeInteger(length) || length < 1) throw new RangeError("State array lengths must be positive safe integers.");
  return Object.freeze({ kind: "array", length, element });
}

/** A named group of stored fields, such as flags or an alternate register bank. */
export function group<const Fields extends StateFields>(fields: Fields): GroupField<Readonly<Fields>> {
  return Object.freeze({ kind: "group", fields: defineState(fields) });
}

/** Own a readonly field map; use the field constructors above for its immutable entries. */
export function defineState<const Fields extends StateFields>(fields: Fields): Readonly<Fields> {
  return Object.freeze({ ...fields });
}

/** Copy and validate external state, reading only declared fields and each declared value once. */
export function readState<Fields extends StateFields>(fields: Fields, value: unknown): StateValues<Fields> {
  return copyFields(fields, value, "", true) as StateValues<Fields>;
}

/** Copy known-valid state for snapshots, detaching groups and arrays without repeating scalar validation. */
export function copyState<Fields extends StateFields>(
  fields: Fields, value: ReadonlyState<StateValues<NoInfer<Fields>>>,
): StateValues<Fields> {
  return copyFields(fields, value, "", false) as StateValues<Fields>;
}

function copyFields(fields: StateFields, value: unknown, path: string, validate: boolean): object {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) {
    throw new TypeError(`${path || "State"} must be an object.`);
  }
  const source = value as Record<string, unknown>;
  return Object.fromEntries(Object.entries(fields).map(([name, field]) => {
    const label = path ? `${path}.${name}` : name;
    return [name, copyValue(field, source[name], label, validate)];
  }));
}

function copyValue(field: StateField, value: unknown, label: string, validate: boolean): unknown {
  switch (field.kind) {
    case "group": return copyFields(field.fields, value, label, validate);
    case "array": {
      if (!Array.isArray(value) || value.length !== field.length) {
        throw new TypeError(`${label} must be an array of exactly ${field.length} values.`);
      }
      // Read physical slots explicitly: holes must not be skipped, nor a custom iterator invoked.
      return Array.from({ length: field.length }, (_, index) =>
        copyValue(field.element, value[index], `${label}[${index}]`, validate));
    }
    case "unsigned":
      if (validate) checkUnsigned(label, value, field.maximum);
      return value;
    case "choice":
      if (validate && (typeof value !== "number" || !field.values.includes(value))) {
        throw new RangeError(`${label} must be one of ${field.values.join(", ")}.`);
      }
      return value;
    case "flag":
    case "boolean":
      if (validate && typeof value !== "boolean") throw new TypeError(`${label} must be a boolean.`);
      return value;
  }
}
