/** Link representations of one unsigned byte without attaching CPU semantics. */
export function mountByteExplorer(root: HTMLElement, onEdit: () => void = () => {}) {
  const controls = root.querySelector<HTMLFieldSetElement>("fieldset")!;
  const bits = [...root.querySelectorAll<HTMLButtonElement>("[data-weight]")];
  const fields = [...root.querySelectorAll<HTMLInputElement>("[data-radix]")];
  const sum = root.querySelector<HTMLElement>("[data-sum]")!;
  const error = root.querySelector<HTMLElement>("[data-error]")!;
  const instruction = root.querySelector<HTMLElement>("[data-instruction]")!;
  const nibbles = [...root.querySelectorAll<HTMLElement>("[data-nibble]")];
  let value = Number(fields.find(field => field.dataset.radix === "10")!.value);

  function formatValue(radix: number): string {
    return value.toString(radix).toUpperCase().padStart(radix === 2 ? 8 : radix === 16 ? 2 : 1, "0");
  }

  function render(editing?: HTMLInputElement): void {
    const selected: number[] = [];
    for (const bit of bits) {
      const weight = Number(bit.dataset.weight), on = (value & weight) !== 0;
      bit.textContent = on ? "1" : "0";
      bit.setAttribute("aria-pressed", String(on));
      if (on) selected.push(weight);
    }
    for (const field of fields) {
      field.removeAttribute("aria-invalid");
      if (field === editing) continue;
      field.value = formatValue(Number(field.dataset.radix));
    }
    const hex = formatValue(16);
    nibbles.forEach((nibble, index) => { nibble.textContent = hex[index]!; });
    sum.textContent = selected.length ? `${selected.join(" + ")} = ${value}` : "No bits are on: 0";
    error.textContent = "";
  }

  for (const bit of bits) {
    bit.addEventListener("click", () => {
      value ^= Number(bit.dataset.weight);
      render();
      onEdit();
    });
  }
  for (const field of fields) {
    const radix = Number(field.dataset.radix);
    const digits = radix === 2 ? /^[01]{1,8}$/ : radix === 16 ? /^[0-9a-f]{1,2}$/i : /^\d{1,3}$/;
    const hint = radix === 2 ? "Use one to eight binary digits (0 or 1)."
      : radix === 16 ? "Use one or two hexadecimal digits (0–9 or A–F), without a prefix."
      : "Use a whole decimal number from 0 to 255.";
    field.addEventListener("input", () => {
      const text = field.value.trim();
      const next = Number.parseInt(text, radix);
      if (!digits.test(text) || next > 255) {
        render(field);
        field.setAttribute("aria-invalid", "true");
        error.textContent = `${hint} The byte has not changed.`;
        onEdit();
        return;
      }
      value = next;
      render(field); // Keep the caret and partial, valid spelling while typing.
      onEdit();
    });
    field.addEventListener("blur", () => {
      // Normalize this field only: moving focus must not discard another field's invalid draft.
      if (!field.hasAttribute("aria-invalid")) field.value = formatValue(radix);
    });
  }
  root.querySelector<HTMLButtonElement>("[data-reset]")!.addEventListener("click", () => {
    value = 0;
    render();
    onEdit();
  });
  render();
  instruction.textContent = "Select a bit to turn it on or off, or edit a number below.";
  controls.disabled = false;
  return {
    get value() { return value; },
    get valid() { return fields.every(field => !field.hasAttribute("aria-invalid")); },
    // Programmatic updates refresh the display without reporting a learner's edit.
    setValue(next: number): void {
      if (!Number.isInteger(next) || next < 0 || next > 255) throw new RangeError("A byte must be an integer from 0 to 255.");
      value = next;
      render();
    },
  };
}

/** Keep the last addition separate from the editable byte it produced. */
function mountByteIncrement(lesson: HTMLElement, root: HTMLElement): void {
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

for (const root of document.querySelectorAll<HTMLElement>("[data-byte-explorer]")) {
  const lesson = root.closest<HTMLElement>("[data-byte-increment]");
  if (lesson) mountByteIncrement(lesson, root);
  else mountByteExplorer(root);
}
