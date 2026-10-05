import { hex } from "./apple2-explorer.js";
import type { Editable6502Register } from "./apple2-register-edit.js";

/** Enter applies, Escape or leaving the field cancels. No mutation occurs while typing. */
export function registerEditor(button: HTMLButtonElement, register: Editable6502Register,
  current: () => number, apply: (value: string) => void) {
  let input: HTMLInputElement | undefined;
  const cancel = () => {
    const previous = input; input = undefined;
    // Removing the focused field can synchronously blur it; detach before removing it.
    previous?.removeEventListener("blur", cancel); previous?.remove(); button.hidden = false;
  };
  button.addEventListener("click", () => {
    if (button.disabled || input) return;
    input = document.createElement("input"); input.className = "lab-register-edit";
    input.value = hex(current(), register === "pc" ? 4 : 2);
    input.maxLength = register === "pc" ? 5 : 3;
    input.setAttribute("aria-label", `Edit ${register.toUpperCase()} (hex)`);
    input.spellcheck = false; input.autocomplete = "off";
    button.hidden = true; button.after(input); input.focus(); input.select();
    input.addEventListener("input", () => input?.setCustomValidity(""));
    input.addEventListener("blur", cancel);
    input.addEventListener("keydown", event => {
      if (event.key !== "Enter" && event.key !== "Escape") return;
      event.preventDefault(); event.stopPropagation();
      if (event.key === "Enter") {
        try { apply(input!.value); }
        catch (error) { input?.setCustomValidity((error as Error).message); input?.reportValidity(); return; }
      }
      cancel(); button.focus();
    });
  });
  return { enable(enabled: boolean): void { button.disabled = !enabled; if (!enabled) cancel(); } };
}
