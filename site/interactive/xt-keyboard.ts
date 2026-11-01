import { xtOscillatorHz } from "../../src/machines/8088/pc-xt/clock.js";
import { checkMachineSnapshot } from "../../src/machines/snapshot.js";

// IBM 83-key make codes in scan order, followed by modern host aliases.
const codes = new Map<string, number>();
const characters = new Map<string, { code: number; shift: boolean }>();
function row(first: number, names: string, plain = "", shifted = "") {
  names.split(" ").forEach((name, i) => {
    const code = first + i;
    codes.set(name, code);
    if (plain[i]) characters.set(plain[i]!, { code, shift: false });
    if (shifted[i]) characters.set(shifted[i]!, { code, shift: true });
  });
}
row(0x01, "Escape");
row(0x02, "Digit1 Digit2 Digit3 Digit4 Digit5 Digit6 Digit7 Digit8 Digit9 Digit0 Minus Equal", "1234567890-=", "!@#$%^&*()_+");
row(0x0e, "Backspace Tab", "\b\t");
row(0x10, "KeyQ KeyW KeyE KeyR KeyT KeyY KeyU KeyI KeyO KeyP BracketLeft BracketRight", "qwertyuiop[]", "QWERTYUIOP{}");
row(0x1c, "Enter ControlLeft", "\n");
row(0x1e, "KeyA KeyS KeyD KeyF KeyG KeyH KeyJ KeyK KeyL Semicolon Quote Backquote", "asdfghjkl;'\x60", 'ASDFGHJKL:"~');
row(0x2a, "ShiftLeft");
row(0x2b, "Backslash KeyZ KeyX KeyC KeyV KeyB KeyN KeyM Comma Period Slash", "\\zxcvbnm,./", "|ZXCVBNM<>?");
row(0x36, "ShiftRight NumpadMultiply AltLeft Space CapsLock");
characters.set(" ", { code: 0x39, shift: false });
row(0x3b, "F1 F2 F3 F4 F5 F6 F7 F8 F9 F10 NumLock ScrollLock");
row(0x47, "Numpad7 Numpad8 Numpad9 NumpadSubtract Numpad4 Numpad5 Numpad6 NumpadAdd Numpad1 Numpad2 Numpad3 Numpad0 NumpadDecimal");
for (const [key, original] of Object.entries({ ControlRight: "ControlLeft", AltRight: "AltLeft", NumpadEnter: "Enter",
  Home: "Numpad7", ArrowUp: "Numpad8", PageUp: "Numpad9",
  ArrowLeft: "Numpad4", ArrowRight: "Numpad6", End: "Numpad1", ArrowDown: "Numpad2", PageDown: "Numpad3",
  Insert: "Numpad0", Delete: "NumpadDecimal" })) codes.set(key, codes.get(original)!);

const makeCodes = new Set(codes.values());
const isScanByte = (byte: number) => Number.isInteger(byte) && byte >= 0 && byte <= 255 && makeCodes.has(byte & 0x7f);

export interface XtKeyboardState {
  readonly bytes: readonly number[];
  readonly held: readonly string[];
  readonly paste: string;
  readonly delay: number;
}

const capacity = 512, pasteLimit = 4096;
// Host paste rate, in emulated time. Leave the BIOS and BASIC time to drain typeahead and scroll.
const characterInterval = Math.ceil(xtOscillatorHz / 25);
const lineInterval = characterInterval * 6;
const validPaste = (text: string) => text.length <= pasteLimit && [...text].every(key => characters.has(key));
export const xtKeySupported = (key: string) => codes.has(key);

export class XtKeyboard {
  #bytes: number[] = [];
  #held = new Set<string>();
  #paste = "";
  #delay = 0;

  constructor(state?: XtKeyboardState) {
    if (state === undefined) return;
    checkMachineSnapshot(state, ["bytes", "held", "paste", "delay"]);
    if (!Array.isArray(state.bytes) || !Array.isArray(state.held) || state.bytes.length + state.held.length > capacity
      || !state.bytes.every(isScanByte)
      || !state.held.every(key => codes.has(key)) || new Set(state.held).size !== state.held.length
      || typeof state.paste !== "string" || !validPaste(state.paste)
      || !Number.isInteger(state.delay) || state.delay < 0 || state.delay > lineInterval) throw new Error("Invalid XT keyboard checkpoint.");
    this.#bytes = [...state.bytes]; this.#held = new Set(state.held); this.#paste = state.paste; this.#delay = state.delay;
  }
  snapshot(): XtKeyboardState { return { bytes: [...this.#bytes], held: [...this.#held], paste: this.#paste, delay: this.#delay }; }
  get queuedBytes() { return this.#bytes.length; }
  get pasteRemaining() { return this.#paste.length; }

  #heldCode(code: number): boolean {
    for (const key of this.#held) if (codes.get(key) === code) return true;
    return false;
  }
  down(key: string): void {
    const make = codes.get(key);
    if (make === undefined || this.#held.has(key)) return;
    // Reserve room for key-up even when a paused machine has a full queue.
    if (this.#bytes.length + this.#held.size + 2 > capacity) throw new Error("Keyboard queue full. Run the XT to continue.");
    if (!this.#heldCode(make)) this.#bytes.push(make);
    this.#held.add(key);
  }
  up(key: string): void {
    if (!this.#held.delete(key)) return;
    const make = codes.get(key)!;
    if (!this.#heldCode(make)) this.#bytes.push(make | 0x80);
  }
  releaseHeld(): void { for (const key of this.#held) this.up(key); }
  chord(keys: readonly string[]): void {
    if (this.#bytes.length + this.#held.size + keys.length * 2 > capacity) throw new Error("Keyboard queue full.");
    this.releaseHeld(); this.#paste = ""; this.#delay = 0;
    for (const key of keys) this.down(key);
    for (const key of [...keys].reverse()) this.up(key);
  }
  paste(text: string): void {
    const input = text.replace(/\r\n?/g, "\n");
    if (!validPaste(this.#paste + input)) throw new Error("Paste up to 4,096 US keyboard characters, including tabs and line breaks.");
    this.releaseHeld(); this.#paste += input;
  }

  beforeStep(offer: (byte: number) => boolean, capsLock: () => boolean): void {
    if (!this.#bytes.length && this.#paste && !this.#held.size && !this.#delay) {
      const key = this.#paste[0]!, { code, shift } = characters.get(key)!;
      const shifted = /[a-z]/i.test(key) && capsLock() ? !shift : shift;
      this.#bytes = shifted ? [0x2a, code, code | 0x80, 0xaa] : [code, code | 0x80];
      this.#paste = this.#paste.slice(1);
      this.#delay = key === "\n" ? lineInterval : characterInterval;
    }
    if (this.#bytes.length && offer(this.#bytes[0]!)) this.#bytes.shift();
  }
  afterStep(ticks: number, selfTesting: boolean): void {
    if (selfTesting) {
      this.#bytes.length = 0;
      this.#held.clear();
      this.#paste = "";
      this.#delay = 0;
    } else this.#delay = Math.max(0, this.#delay - ticks);
  }
}
