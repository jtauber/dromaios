/** Small, labelled choices for instrument headers; selecting in code does not fire a user action. */
export function createInspectorChoices<T extends string | number>(label: string,
  choices: readonly { value: T; label: string; title: string }[], initial: T, change: (value: T) => void) {
  const element = document.createElement("span"); element.className = "lab-inspector-choices";
  element.setAttribute("role", "group"); element.setAttribute("aria-label", label);
  let selected = initial;
  const buttons = choices.map(choice => {
    const button = document.createElement("button"); button.type = "button";
    button.textContent = choice.label; button.title = choice.title; button.setAttribute("aria-label", choice.title);
    button.addEventListener("click", () => { if (selected !== choice.value) { select(choice.value); change(choice.value); } });
    element.append(button); return { ...choice, button };
  });
  function select(value: T): void {
    selected = value;
    for (const choice of buttons) choice.button.setAttribute("aria-pressed", String(choice.value === value));
  }
  select(initial);
  return { element, select, get value() { return selected; } };
}
