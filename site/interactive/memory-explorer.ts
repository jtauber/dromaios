import { createLessonsEightByteMemory } from "../../src/machines/generated/lessons/eight-byte-memory.js";
import { mountByteExplorer } from "./byte-explorer.js";

/** Select a RAM address; the byte explorer edits the contents at that address. */
export function mountMemoryExplorer(lesson: HTMLElement, root: HTMLElement): void {
  let { ram } = createLessonsEightByteMemory();
  let address = 0;
  const cells = lesson.querySelector<HTMLElement>("[data-memory-cells]")!;
  const status = lesson.querySelector<HTMLElement>("[data-memory-status]")!;
  const task = lesson.querySelector<HTMLElement>("[data-memory-task]")!;
  const heading = root.querySelector<HTMLElement>("[data-byte-heading]")!;
  const byte = mountByteExplorer(root, () => {
    if (!byte.valid) return;
    ram.write(address, byte.value);
    render();
  });
  const buttons = Array.from({ length: ram.size }, (_, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "memory-cell";
    const label = document.createElement("span");
    label.textContent = `Address ${index}`;
    const value = document.createElement("strong");
    button.append(label, value);
    button.addEventListener("click", () => {
      address = index;
      byte.setValue(ram.read(address));
      render();
    });
    cells.append(button);
    return { button, value };
  });

  function render(): void {
    buttons.forEach(({ button, value }, index) => {
      value.textContent = String(ram.read(index));
      button.setAttribute("aria-pressed", String(index === address));
      button.setAttribute("aria-label", `Address ${index}, contains ${ram.read(index)}`);
    });
    heading.textContent = `Byte at address ${address}`;
    root.setAttribute("aria-label", `Edit the byte at address ${address}`);
    status.textContent = `Address ${address} contains ${ram.read(address)}.`;
    task.textContent = ram.read(3) === 200
      ? "Address 3 now holds 200. Visit another address, then come back. Is it still there?"
      : "Put 200 at address 3. Select its location, then change the decimal value in the byte explorer.";
  }

  lesson.querySelector<HTMLButtonElement>("[data-memory-restart]")!.addEventListener("click", () => {
    ({ ram } = createLessonsEightByteMemory());
    address = 0;
    byte.setValue(ram.read(address));
    render();
  });
  byte.setValue(ram.read(address));
  render();
  lesson.querySelector<HTMLFieldSetElement>("[data-memory-controls]")!.disabled = false;
}
