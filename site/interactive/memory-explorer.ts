import { createLessonsEightByteMemory } from "../../src/machines/generated/lessons/eight-byte-memory.js";
import { mountMemoryEditor } from "./memory-editor.js";

/** Practice addresses and contents using a component-only machine. */
export function mountMemoryExplorer(lesson: HTMLElement, root: HTMLElement): void {
  let { ram } = createLessonsEightByteMemory();
  const task = lesson.querySelector<HTMLElement>("[data-memory-task]")!;
  const editor = mountMemoryEditor(lesson, root, () => ram, { size: ram.size, onEdit: render });

  function render(): void {
    task.textContent = ram.read(3) === 200
      ? "Address 3 now holds 200. Visit another address, then come back. Is it still there?"
      : "Put 200 at address 3. Select its location, then change the decimal value in the byte explorer.";
  }

  lesson.querySelector<HTMLButtonElement>("[data-memory-restart]")!.addEventListener("click", () => {
    ({ ram } = createLessonsEightByteMemory());
    editor.select(0);
    render();
  });
  render();
}
