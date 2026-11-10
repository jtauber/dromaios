import { CocoKeyboard } from "../../src/machines/6809/coco/keyboard.js";
import type { CocoPias } from "../../src/machines/6809/coco/pias.js";
import { checkMachineSnapshot } from "../../src/machines/snapshot.js";
import { checkUnsigned } from "../../src/components/validation.js";
import type { CocoChord } from "./coco-input.js";

const queueLimit = 1024;

/** A host typing convention: hold and release each chord for at least 50 ms of machine time. */
export function cocoKeyboardPhaseClocks(hertz: number): number {
  if (!Number.isFinite(hertz) || hertz <= 0 || hertz > Number.MAX_SAFE_INTEGER) {
    throw new RangeError("Keyboard delivery requires a positive CPU clock frequency.");
  }
  return Math.ceil(hertz / 20);
}
export interface CocoKeyboardTransportState {
  readonly input: readonly CocoChord[];
  readonly pressed: boolean;
  readonly remainingClocks: number;
}

function checkChord(keys: CocoChord): void {
  if (!Array.isArray(keys) || keys.length < 1 || keys.length > 2 || new Set(keys).size !== keys.length) {
    throw new Error("A keyboard chord requires one or two distinct CoCo keys.");
  }
  const keyboard = new CocoKeyboard();
  for (const key of keys) keyboard.setKey(key, true);
}

/** Deliver complete press/release phases even when host key events arrive between CPU batches. */
export function createCocoKeyboardTransport(pias: CocoPias, hertz: number, state?: CocoKeyboardTransportState) {
  const phaseClocks = cocoKeyboardPhaseClocks(hertz);
  if (state !== undefined) {
    checkMachineSnapshot(state, ["input", "pressed", "remainingClocks"]);
    if (!Array.isArray(state.input) || state.input.length > queueLimit || typeof state.pressed !== "boolean"
      || state.pressed && !state.input.length) throw new Error("Invalid saved keyboard transport.");
    for (const chord of state.input) checkChord(chord);
    checkUnsigned("Remaining keyboard clocks", state.remainingClocks, phaseClocks);
  }
  const expected = new CocoKeyboard();
  if (state?.pressed) for (const key of state.input[0]!) expected.setKey(key, true);
  const rows = pias.snapshot().keyboard.rows;
  if (expected.snapshot().rows.some((row, i) => row !== rows[i])) throw new Error("Saved keyboard switches do not match the host transport.");
  let input = state?.input.map(keys => [...keys]) ?? [], pressed = state?.pressed ?? false, remainingClocks = state?.remainingClocks ?? 0;
  return {
    get pending() { return input.length; },
    get settled() { return input.length === 0 && remainingClocks === 0; },
    send(keys: readonly CocoChord[]): void {
      if (input.length + keys.length > queueLimit) throw new Error("Keyboard queue is full. Let the CoCo catch up.");
      for (const chord of keys) checkChord(chord);
      input.push(...keys.map(chord => [...chord]));
    },
    beforeStep(): void {
      if (remainingClocks !== 0) return;
      if (pressed) {
        pias.releaseKeys(); pressed = false; input.shift(); remainingClocks = phaseClocks;
      } else if (input.length) {
        for (const key of input[0]!) pias.setKey(key, true);
        pressed = true; remainingClocks = phaseClocks;
      }
    },
    afterStep(clocks: number): void {
      checkUnsigned("Elapsed keyboard clocks", clocks, Number.MAX_SAFE_INTEGER);
      remainingClocks = Math.max(0, remainingClocks - clocks);
    },
    release(): void { pias.releaseKeys(); input = []; pressed = false; remainingClocks = 0; },
    snapshot(): CocoKeyboardTransportState { return { input: input.map(keys => [...keys]), pressed, remainingClocks }; },
  };
}
