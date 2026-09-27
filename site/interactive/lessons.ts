import { mountByteExplorer } from "./byte-explorer.js";
import { mountByteIncrement } from "./byte-increment.js";
import { mountMemoryExplorer } from "./memory-explorer.js";

for (const root of document.querySelectorAll<HTMLElement>("[data-byte-explorer]")) {
  const memory = root.closest<HTMLElement>("[data-memory-explorer]");
  const addition = root.closest<HTMLElement>("[data-byte-increment]");
  if (memory) mountMemoryExplorer(memory, root);
  else if (addition) mountByteIncrement(addition, root);
  else mountByteExplorer(root);
}
