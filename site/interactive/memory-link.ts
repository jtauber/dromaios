import { hex } from "./apple2-explorer.js";

/** The inspection host handles this action, independently of memory rendering. */
export function memoryWatchButton(address: number, bytes?: 1 | 2): HTMLButtonElement {
  const button = document.createElement("button"); button.type = "button";
  button.dataset.watchAddress = hex(address);
  if (bytes !== undefined) button.dataset.watchBytes = String(bytes);
  button.className = "lab-watch-byte";
  button.title = `Watch $${hex(address)}${bytes === 2 ? `–${hex(address + 1)} as a word` : ""}`; button.setAttribute("aria-label", button.title);
  return button;
}

/** Follow the displayed word, including in a held inspector; never re-read its source or target. */
export function memoryPointerButton(browse: (address: number) => void) {
  const button = document.createElement("button"); button.type = "button"; button.className = "lab-memory-link";
  let address: number | undefined;
  button.addEventListener("click", () => { if (address !== undefined) browse(address); });
  return {
    button,
    refresh(value: number | undefined): void {
      address = value; button.disabled = value === undefined;
      button.textContent = value === undefined ? "—" : `$${hex(value)}`;
      button.title = value === undefined ? "Unavailable word; no guest read is performed."
        : `View value $${hex(value)} as an address in Memory`;
      button.setAttribute("aria-label", button.title);
    },
  };
}

/** Navigation belongs to the host; a link never reads or executes guest memory. */
export function memoryLink(address: number, browse: (address: number) => void, text = `$${hex(address)}`): HTMLButtonElement {
  const button = document.createElement("button"); button.type = "button";
  button.className = "lab-memory-link"; button.textContent = text;
  button.title = `View $${hex(address)} in Memory`;
  button.setAttribute("aria-label", button.title);
  button.addEventListener("click", () => browse(address));
  return button;
}

/** Four-digit addresses in an observed access or PC result are navigable; byte values stay plain. */
export function memoryAddressText(text: string, browse: (address: number) => void): DocumentFragment {
  const fragment = document.createDocumentFragment(); let start = 0;
  for (const match of text.matchAll(/\$([0-9A-F]{4})\b/g)) {
    fragment.append(text.slice(start, match.index), memoryLink(parseInt(match[1]!, 16), browse));
    start = match.index + match[0].length;
  }
  fragment.append(text.slice(start)); return fragment;
}
