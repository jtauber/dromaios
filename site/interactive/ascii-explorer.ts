import { interpretAscii } from "./ascii.js";
import { mountByteExplorer } from "./byte-explorer.js";

/** Add a character interpretation to the existing byte editor's single value. */
export function mountAsciiExplorer(lesson: HTMLElement, root: HTMLElement): void {
  const examples = [...lesson.querySelectorAll<HTMLButtonElement>("[data-ascii-value]")];
  const glyph = lesson.querySelector<HTMLElement>("[data-ascii-glyph]")!;
  const name = lesson.querySelector<HTMLElement>("[data-ascii-name]")!;
  const explanation = lesson.querySelector<HTMLElement>("[data-ascii-explanation]")!;
  const draft = lesson.querySelector<HTMLElement>("[data-ascii-draft]")!;
  const byte = mountByteExplorer(root, render);

  function render(): void {
    const value = byte.value;
    const ascii = interpretAscii(value);
    let symbol: string, title: string, description: string;
    switch (ascii.kind) {
      case "graphic":
        symbol = ascii.character;
        title = "A printed character";
        description = `ASCII assigns decimal ${value} to the character “${symbol}”. The bits have not changed; this is another way to interpret them.`;
        break;
      case "space":
        symbol = "SP";
        title = "Space";
        description = "ASCII assigns decimal 32 to a space. It leaves a gap in text, but still occupies one byte. SP is a label here, not two stored letters.";
        break;
      case "control":
        symbol = ascii.abbreviation;
        title = ascii.name;
        description = `Decimal ${value} is a non-printing ASCII control code. ${symbol} is its label, not a sequence of stored letters. This explorer does not perform its action.`;
        break;
      case "delete":
        symbol = "DEL";
        title = "Delete";
        description = "ASCII assigns decimal 127 to Delete. It has no printed shape. DEL is a label here; selecting it does not delete anything.";
        break;
      case "outside":
        symbol = "—";
        title = "Outside ASCII";
        description = `Decimal ${value} is a valid byte, but ASCII only assigns values 0–127. Interpreting this byte as text needs another encoding.`;
        break;
    }
    glyph.dataset.kind = ascii.kind;
    glyph.textContent = symbol;
    name.textContent = title;
    if (explanation.textContent !== description) explanation.textContent = description;
    draft.hidden = byte.valid;
    draft.textContent = byte.valid ? "" : `The number being edited is invalid. This readout still describes the last valid byte, ${value}.`;
    for (const button of examples) button.setAttribute("aria-pressed", String(Number(button.dataset.asciiValue) === value));
  }

  for (const button of examples) button.addEventListener("click", () => {
    byte.setValue(Number(button.dataset.asciiValue));
    render();
  });
  render();
  lesson.querySelector<HTMLFieldSetElement>("[data-ascii-examples]")!.disabled = false;
}
