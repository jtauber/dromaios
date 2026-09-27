import { mountByteExplorer } from "./byte-explorer.js";

/** Keep the last addition separate from the editable byte it produced. */
export function mountByteIncrement(lesson: HTMLElement, root: HTMLElement): void {
  const actions = lesson.querySelector<HTMLFieldSetElement>("[data-addition-actions]")!;
  const add = lesson.querySelector<HTMLButtonElement>("[data-add-one]")!;
  const equation = lesson.querySelector<HTMLElement>("[data-equation]")!;
  const carry = lesson.querySelector<HTMLElement>("[data-carry]")!;
  const stored = lesson.querySelector<HTMLElement>("[data-stored-bits]")!;
  const explanation = lesson.querySelector<HTMLElement>("[data-addition-explanation]")!;
  const byte = mountByteExplorer(root, () => {
    add.disabled = !byte.valid;
    if (byte.valid) clearAddition();
  });

  function clearAddition(): void {
    equation.textContent = "No addition yet.";
    carry.textContent = "—";
    carry.removeAttribute("data-set");
    stored.textContent = "──── ────";
    explanation.textContent = "Choose a byte, then press Add 1. Try it twice from 254.";
  }

  add.addEventListener("click", () => {
    if (!byte.valid) return;
    const before = byte.value, sum = before + 1;
    const result = sum % 256, carryBit = Math.floor(sum / 256);
    byte.setValue(result);
    equation.textContent = `${before} + 1 = ${sum}`;
    carry.textContent = String(carryBit);
    carry.toggleAttribute("data-set", carryBit === 1);
    const binary = result.toString(2).padStart(8, "0");
    stored.textContent = `${binary.slice(0, 4)} ${binary.slice(4)}`;
    explanation.textContent = carryBit
      ? "256 needs a ninth bit. Store the rightmost eight bits: 0. The carry is 1."
      : `The sum fits in eight bits. Store ${result}. The carry is 0.`;
  });
  lesson.querySelector<HTMLButtonElement>("[data-restart]")!.addEventListener("click", () => {
    byte.setValue(254);
    add.disabled = false;
    clearAddition();
  });
  clearAddition();
  actions.disabled = false;
}
