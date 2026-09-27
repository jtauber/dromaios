import type { Ram } from "../../src/components/memory/ram.js";
import { mountByteExplorer } from "./byte-explorer.js";

/** Edit a visible range of real RAM; selecting an address only reads its byte. */
export function mountMemoryEditor(
  lesson: HTMLElement, root: HTMLElement, memory: () => Ram,
  { size, address: initialAddress = 0, onEdit = () => {} }: { size: number; address?: number; onEdit?: () => void },
) {
  let address = initialAddress;
  const cells = lesson.querySelector<HTMLElement>("[data-memory-cells]")!;
  const status = lesson.querySelector<HTMLElement>("[data-memory-status]")!;
  const heading = root.querySelector<HTMLElement>("[data-byte-heading]")!;
  const byte = mountByteExplorer(root, () => {
    if (byte.valid) {
      memory().write(address, byte.value);
      render();
    }
    onEdit();
  });
  const buttons = Array.from({ length: size }, (_, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "memory-cell";
    const label = document.createElement("span");
    label.textContent = `Address ${index}`;
    const value = document.createElement("strong");
    button.append(label, value);
    button.addEventListener("click", () => {
      select(index);
      onEdit();
    });
    cells.append(button);
    return { button, value };
  });

  function render(): void {
    const ram = memory();
    buttons.forEach(({ button, value }, index) => {
      const stored = ram.read(index);
      value.textContent = String(stored);
      button.setAttribute("aria-pressed", String(index === address));
      button.setAttribute("aria-label", `Address ${index}, contains ${stored}`);
    });
    heading.textContent = `Byte at address ${address}`;
    root.setAttribute("aria-label", `Edit the byte at address ${address}`);
    status.textContent = `Address ${address} contains ${ram.read(address)}.`;
  }

  function refresh(): void {
    byte.setValue(memory().read(address));
    render();
  }

  function select(next: number): void {
    if (!Number.isInteger(next) || next < 0 || next >= size) throw new RangeError("Select a visible memory address.");
    address = next;
    refresh();
  }

  select(initialAddress);
  lesson.querySelector<HTMLFieldSetElement>("[data-memory-controls]")!.disabled = false;
  return { get address() { return address; }, get valid() { return byte.valid; }, refresh, select };
}
