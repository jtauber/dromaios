import { mountByteExplorer } from "./byte-explorer.js";
import { mountByteIncrement } from "./byte-increment.js";
import { mountMemoryExplorer } from "./memory-explorer.js";

for (const root of document.querySelectorAll<HTMLElement>("[data-byte-explorer]")) {
  const register = root.closest<HTMLElement>("[data-register-explorer]");
  const memory = root.closest<HTMLElement>("[data-memory-explorer]");
  const addition = root.closest<HTMLElement>("[data-byte-increment]");
  if (register) {
    // Keep CPU modules out of the earlier, component-only lessons' loading path.
    const { mountRegisterExplorer } = await import("./register-explorer.js");
    mountRegisterExplorer(register, root);
  } else if (memory) mountMemoryExplorer(memory, root);
  else if (addition) mountByteIncrement(addition, root);
  else mountByteExplorer(root);
}

for (const root of document.querySelectorAll<HTMLElement>("[data-altair-explorer]")) {
  if (root.dataset.altairExplorer !== "memory") {
    const { mountAltairProgramExplorer } = await import("./altair-program-explorer.js");
    mountAltairProgramExplorer(root);
  } else {
    const { mountAltairExplorer } = await import("./altair-explorer.js");
    mountAltairExplorer(root);
  }
}
