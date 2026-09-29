import type { ByteInputSnapshot } from "../../src/components/devices/byte-input.js";
import { hex } from "./register-programs.js";

interface ByteInputViewOptions {
  readonly snapshot: () => ByteInputSnapshot;
  readonly offer: (value: number) => boolean;
  readonly onChange: () => void;
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
    const { pendingByte } = snapshot(); // Looking must not consume input.
    send.disabled = pendingByte !== null;
    status.setAttribute("aria-live", running ? "off" : "polite");
    const message = pendingByte === null ? "Device empty. No byte waiting."
      : `Waiting: ${number(pendingByte)}. IN has not read it yet.`;
    if (status.textContent !== message) status.textContent = message;
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
