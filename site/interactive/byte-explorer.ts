/** Link representations of one unsigned byte without attaching CPU semantics. */
export function mountByteExplorer(root: HTMLElement): void {
  const controls = root.querySelector<HTMLFieldSetElement>("fieldset")!;
  const bits = [...root.querySelectorAll<HTMLButtonElement>("[data-weight]")];
  const fields = [...root.querySelectorAll<HTMLInputElement>("[data-radix]")];
  const sum = root.querySelector<HTMLElement>("[data-sum]")!;
  const error = root.querySelector<HTMLElement>("[data-error]")!;
  const instruction = root.querySelector<HTMLElement>("[data-instruction]")!;
  const nibbles = [...root.querySelectorAll<HTMLElement>("[data-nibble]")];
  let value = Number(fields.find(field => field.dataset.radix === "10")!.value);

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
      const radix = Number(field.dataset.radix);
      field.value = value.toString(radix).toUpperCase().padStart(radix === 2 ? 8 : radix === 16 ? 2 : 1, "0");
    }
    const hex = value.toString(16).toUpperCase().padStart(2, "0");
    nibbles.forEach((nibble, index) => { nibble.textContent = hex[index]!; });
    sum.textContent = selected.length ? `${selected.join(" + ")} = ${value}` : "No bits are on: 0";
    error.textContent = "";
  }

  for (const bit of bits) {
    bit.addEventListener("click", () => {
      value ^= Number(bit.dataset.weight);
      render();
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
        return;
      }
      value = next;
      render(field); // Keep the caret and partial, valid spelling while typing.
    });
    field.addEventListener("blur", () => {
      if (!field.hasAttribute("aria-invalid")) render();
    });
  }
  root.querySelector<HTMLButtonElement>("[data-reset]")!.addEventListener("click", () => {
    value = 0;
    render();
  });
  render();
  instruction.textContent = "Select a bit to turn it on or off, or edit a number below.";
  controls.disabled = false;
}

for (const root of document.querySelectorAll<HTMLElement>("[data-byte-explorer]")) mountByteExplorer(root);
