import type { CocoKey } from "../../src/machines/6809/coco/keyboard.js";
import { terminalInput } from "./serial-terminal.js";

export type CocoChord = readonly CocoKey[];
const shifted: Readonly<Record<string, CocoKey>> = {
  "!": "1", '"': "2", "#": "3", "$": "4", "%": "5", "&": "6", "'": "7", "(": "8", ")": "9",
  "*": ":", "+": ";", "<": ",", "=": "-", ">": ".", "?": "/",
};

function characterKey(character: string): CocoChord {
  if (character === "\r") return ["Enter"];
  if (character === " ") return ["Space"];
  const key = character.toUpperCase(), shift = shifted[key];
  if (shift) return ["Shift", shift];
  if (/^[@A-Z0-9:;,./-]$/.test(key)) return [key as CocoKey];
  throw new Error(`The CoCo keyboard cannot type “${character}”.`);
}

/** Translate host text into physical chords; neither BASIC tokens nor RAM are written. */
export function cocoTextInput(text: string): readonly CocoChord[] {
  return terminalInput(text).map(byte => characterKey(String.fromCharCode(byte)));
}

export function cocoScreenKey(event: {
  readonly key: string; readonly ctrlKey: boolean; readonly metaKey: boolean;
  readonly altKey: boolean; readonly isComposing: boolean;
}): CocoChord | undefined {
  if (event.metaKey || event.altKey || event.isComposing) return undefined;
  if (event.ctrlKey) return event.key.toLowerCase() === "c" ? ["Break"] : undefined;
  if (event.key === "Enter") return ["Enter"];
  if (event.key === "Escape") return ["Break"];
  if (event.key === "Home") return ["Clear"];
  if (event.key === "Backspace") return ["ArrowLeft"];
  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return [event.key as CocoKey];
  return /^[\x20-\x7e]$/.test(event.key) ? characterKey(event.key) : undefined;
}
