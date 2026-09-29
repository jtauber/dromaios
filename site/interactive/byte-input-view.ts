import type { ByteInputSnapshot } from "../../src/components/devices/byte-input.js";
import { hex } from "./register-programs.js";

export interface ByteInputViewOptions {
  readonly snapshot: () => ByteInputSnapshot;
  readonly offer: (value: number) => boolean;
  readonly onChange: () => void;
}

/** Both input views inspect the latch; displaying readiness must never consume its byte. */
export function renderInputStatus(root: HTMLElement, { pendingByte }: ByteInputSnapshot, running: boolean,
  describe: (value: number) => string): void {
  const status = root.querySelector<HTMLElement>("[data-input-status]")!;
  const readiness = root.querySelector<HTMLElement>("[data-input-readiness]");
  if (readiness) readiness.textContent = pendingByte === null ? "0 · empty" : "1 · ready";
  status.setAttribute("aria-live", running ? "off" : "polite");
  const message = pendingByte === null ? "Device empty. No byte waiting."
    : `Waiting: ${describe(pendingByte)}. IN 01H has not read it yet.`;
  if (status.textContent !== message) status.textContent = message;
}

/** Keep the prepared switch value separate from the device's one pending byte. */
export function mountByteInput(root: HTMLElement, { snapshot, offer, onChange }: ByteInputViewOptions) {
  let prepared = 42;
  const switches = [...root.querySelectorAll<HTMLButtonElement>("[data-input-switch]")];
  const send = root.querySelector<HTMLButtonElement>("[data-input-send]")!;
  const status = root.querySelector<HTMLElement>("[data-input-status]")!;
  const number = (value: number) => `${value} decimal · ${hex(value, 2)} hex · ${value.toString(2).padStart(8, "0")} binary`;

  function refresh(running: boolean): void {
    for (const button of switches) {
      const on = (prepared & (1 << Number(button.dataset.inputSwitch))) !== 0;
      button.setAttribute("aria-pressed", String(on));
      button.querySelector<HTMLElement>("[data-switch-value]")!.textContent = on ? "1" : "0";
    }
    root.querySelector<HTMLElement>("[data-input-prepared]")!.textContent = number(prepared);
    const state = snapshot();
    send.disabled = state.pendingByte !== null;
    renderInputStatus(root, state, running, number);
  }

  for (const button of switches) button.addEventListener("click", () => {
    prepared ^= 1 << Number(button.dataset.inputSwitch);
    onChange();
  });
  send.addEventListener("click", () => {
    offer(prepared); // A full device rejects another byte, even if the handler is invoked directly.
    onChange();
    if (send.disabled) status.focus();
  });
  return {
    refresh,
    reset() { prepared = 42; },
  };
}
