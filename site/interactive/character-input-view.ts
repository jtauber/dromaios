import { asciiCharacterByte } from "./ascii.js";
import { renderInputStatus } from "./byte-input-view.js";
import type { ByteInputViewOptions } from "./byte-input-view.js";
import { describeCharacterByte } from "./terminal-lesson.js";

/** Preparing text is a host edit; only an explicit send offers a byte to the input device. */
export function mountCharacterInput(root: HTMLElement, { snapshot, offer, onChange }: ByteInputViewOptions) {
  const field = root.querySelector<HTMLTextAreaElement>("[data-character-input]")!;
  const initial = field.value;
  const send = root.querySelector<HTMLButtonElement>("[data-input-send]")!;
  const lineFeed = root.querySelector<HTMLButtonElement>("[data-send-line-feed]")!;
  const prepared = root.querySelector<HTMLElement>("[data-input-prepared]")!;

  function refresh(running: boolean): void {
    const value = asciiCharacterByte(field.value);
    const state = snapshot();
    field.setAttribute("aria-invalid", String(value === undefined));
    const message = value === undefined
      ? "Enter exactly one ASCII letter, digit, punctuation mark, or space. This draft cannot be sent."
      : `Prepared: ${describeCharacterByte(value)}. Not sent by typing.`;
    if (prepared.textContent !== message) prepared.textContent = message;
    send.disabled = value === undefined || state.pendingByte !== null;
    lineFeed.disabled = state.pendingByte !== null;
    renderInputStatus(root, state, running, describeCharacterByte);
  }

  function sendByte(value: number | undefined): void {
    if (value !== undefined && offer(value)) {
      field.focus(); // Remain able to prepare another character while this one waits in the device.
      field.select();
    }
    onChange();
  }

  field.addEventListener("input", onChange);
  field.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.isComposing) {
      event.preventDefault();
      sendByte(asciiCharacterByte(field.value));
    }
  });
  send.addEventListener("click", () => { sendByte(asciiCharacterByte(field.value)); });
  lineFeed.addEventListener("click", () => { sendByte(10); });
  field.disabled = false;
  return { refresh, reset() { field.value = initial; } };
}
