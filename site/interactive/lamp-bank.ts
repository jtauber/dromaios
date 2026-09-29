/** Render a stored value; null means no byte has arrived, rather than a stored zero. */
export function renderLamps(bank: HTMLElement, value: number | null): void {
  for (const lamp of bank.querySelectorAll<HTMLElement>("[data-lamp-bit]")) {
    const on = value !== null && (value & (1 << Number(lamp.dataset.lampBit))) !== 0;
    lamp.toggleAttribute("data-on", on);
    lamp.querySelector<HTMLElement>("[data-lamp-value]")!.textContent = value === null ? "–" : on ? "1" : "0";
  }
}
