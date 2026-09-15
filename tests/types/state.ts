import { array, boolean, choices, namedChoices, copyState, defineState, flag, group, readState, unsigned } from "../../src/components/cpus/state.js";
import type { StateDescription, StateValues } from "../../src/components/cpus/state.js";

interface State {
  a: number;
  flags: { c: boolean };
  slots: readonly [number, number];
  mode: 0 | 2 | 5;
  halted: boolean;
}

const description = defineState({
  a: unsigned(8), flags: group({ c: flag }), slots: array(2, unsigned(14)),
  mode: choices(0, 2, 5), halted: boolean,
} satisfies StateDescription<State>);

// Compiled, never called: descriptions retain field kinds, literal choices, and fixed tuple lengths.
export function checkStateDescriptions(source: State): void {
  const read: StateValues<typeof description> = readState(description, source);
  const publicState: State = read;
  const copy = copyState(description, source);
  const mode: 0 | 2 | 5 = copy.mode;
  const flags: { c: boolean } = copy.flags;
  const slots: [number, number] = copy.slots;
  copy.slots[0] = 123;
  // @ts-expect-error Tuples retain their fixed length.
  copy.slots[2];
  // @ts-expect-error Copies retain the permitted-value union.
  copy.mode = 1;
  // @ts-expect-error Derived fields are not supplied by a stored-state description.
  copy.pc;
  // @ts-expect-error Known-valid copies require the described source fields.
  copyState(description, { a: 1 });
  // @ts-expect-error A copied source must retain its literal choices.
  copyState(description, { ...source, mode: 1 });
  // @ts-expect-error Published field maps are readonly.
  description.a = unsigned(16);
  // @ts-expect-error Nested field maps are readonly.
  description.flags.fields.c = boolean;
  // @ts-expect-error Choice arrays are readonly.
  description.mode.values.push(2);
}

// @ts-expect-error All stored fields must be described.
const missing: StateDescription<State> = { a: unsigned(8) };
// @ts-expect-error Numeric registers cannot use Boolean fields.
const wrongRegister: StateDescription<{ a: number }> = { a: flag };
// @ts-expect-error Boolean flags cannot use integer fields.
const wrongFlag: StateDescription<{ c: boolean }> = { c: unsigned(1) };
// @ts-expect-error Nested state must include all of its fields.
const missingFlag: StateDescription<{ flags: { c: boolean } }> = { flags: group({}) };
// @ts-expect-error Fixed arrays must match the public tuple length.
const wrongLength: StateDescription<State> = { ...description, slots: array(3, unsigned(14)) };
// @ts-expect-error Restricted numeric state must use explicit choices.
const lostChoices: StateDescription<State> = { ...description, mode: unsigned(3) };
// @ts-expect-error Described choices cannot include values outside the public union.
const wrongChoices: StateDescription<State> = { ...description, mode: choices(0, 1, 2) };
// @ts-expect-error Extra stored fields do not belong in a description.
const extra: StateDescription<State> = { ...description, pc: unsigned(16) };
// @ts-expect-error A choice field must have at least one value.
choices();

const named = defineState({ mode: namedChoices("none", "sync", "cwai") } satisfies StateDescription<{ mode: "none" | "sync" | "cwai" }>);
export function checkNamedChoices(): void {
  const copy = readState(named, { mode: "sync" });
  const mode: "none" | "sync" | "cwai" = copy.mode;
  // @ts-expect-error Named modes retain their literal union.
  copy.mode = "waiting";
  // @ts-expect-error Named modes do not become numeric selectors.
  copy.mode = 0;
  // @ts-expect-error Published choices cannot be replaced.
  named.mode.values[0] = mode;
  // @ts-expect-error A named choice field must be nonempty.
  namedChoices();
  // @ts-expect-error Named choices cannot include values outside the public union.
  const invalid: StateDescription<{ mode: "none" | "sync" }> = { mode: namedChoices("none", "other") };
}
