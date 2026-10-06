import { hex } from "./apple2-explorer.js";

/** The inspection host handles this action, independently of memory rendering. */
export function memoryWatchButton(address: number): HTMLButtonElement {
  const button = document.createElement("button"); button.type = "button";
  button.dataset.watchAddress = hex(address);
  button.className = "lab-watch-byte";
  button.title = `Watch $${hex(address)}`; button.setAttribute("aria-label", button.title);
  return button;
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
