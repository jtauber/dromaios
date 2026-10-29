import { CocoKeyboard } from "../../src/machines/6809/coco/keyboard.js";
import type { CocoPias } from "../../src/machines/6809/coco/pias.js";
import { checkMachineSnapshot } from "../../src/machines/snapshot.js";
import { checkUnsigned } from "../../src/components/validation.js";
import type { CocoChord } from "./coco-input.js";

// Host delivery budgets, not CPU cycles or hardware key-repeat timing.
const keySteps = 12_000, queueLimit = 1024;
export interface CocoKeyboardTransportState {
  readonly input: readonly CocoChord[];
  readonly pressed: boolean;
  readonly remaining: number;
}

function checkChord(keys: CocoChord): void {
  if (!Array.isArray(keys) || keys.length < 1 || keys.length > 2 || new Set(keys).size !== keys.length) {
    throw new Error("A keyboard chord requires one or two distinct CoCo keys.");
  }
  const keyboard = new CocoKeyboard();
  for (const key of keys) keyboard.setKey(key, true);
}

/** Deliver complete press/release phases even when host key events arrive between CPU batches. */
export function createCocoKeyboardTransport(pias: CocoPias, state?: CocoKeyboardTransportState) {
  if (state !== undefined) {
    checkMachineSnapshot(state, ["input", "pressed", "remaining"]);
    if (!Array.isArray(state.input) || state.input.length > queueLimit || typeof state.pressed !== "boolean"
      || state.pressed && !state.input.length) throw new Error("Invalid saved keyboard transport.");
    for (const chord of state.input) checkChord(chord);
    checkUnsigned("Remaining keyboard steps", state.remaining, keySteps);
  }
  const expected = new CocoKeyboard();
  if (state?.pressed) for (const key of state.input[0]!) expected.setKey(key, true);
  const rows = pias.snapshot().keyboard.rows;
  if (expected.snapshot().rows.some((row, i) => row !== rows[i])) throw new Error("Saved keyboard switches do not match the host transport.");
  let input = state?.input.map(keys => [...keys]) ?? [], pressed = state?.pressed ?? false, remaining = state?.remaining ?? 0;
  return {
    get pending() { return input.length; },
    get settled() { return input.length === 0 && remaining === 0; },
    send(keys: readonly CocoChord[]): void {
      if (input.length + keys.length > queueLimit) throw new Error("Keyboard queue is full. Let the CoCo catch up.");
      for (const chord of keys) checkChord(chord);
      input.push(...keys.map(chord => [...chord]));
    },
    beforeStep(): void {
      if (remaining !== 0) return;
      if (pressed) {
        pias.releaseKeys(); pressed = false; input.shift(); remaining = keySteps;
      } else if (input.length) {
        for (const key of input[0]!) pias.setKey(key, true);
        pressed = true; remaining = keySteps;
      }
    },
    afterStep(): void { if (remaining > 0) remaining--; },
    release(): void { pias.releaseKeys(); input = []; pressed = false; remaining = 0; },
    snapshot(): CocoKeyboardTransportState { return { input: input.map(keys => [...keys]), pressed, remaining }; },
  };
}
