import { createInspectorHistory } from "./inspector-history.js";
import type { InspectorLocation, InspectorTool } from "./inspector-history.js";
import { hex } from "./apple2-explorer.js";

/** Navigation changes inspectors, never the machine or its bank mapping. */
export function createInspectorNavigation(root: HTMLElement, current: (tool: InspectorTool) => number,
  show: (location: InspectorLocation) => void) {
  const history = createInspectorHistory(), controls = root.ownerDocument.getElementById(root.dataset.navigationControls ?? "");
  const names = { memory: "Memory", code: "Disassembly", rom: "ROM reference" };
  const buttons = ([-1, 1] as const).map(direction => {
    const button = document.createElement("button"), name = direction === -1 ? "Back" : "Forward";
    button.type = "button"; button.textContent = direction === -1 ? "←" : "→";
    button.setAttribute("aria-label", `${name} in inspector history`);
    button.addEventListener("click", () => {
      const location = history.move(direction);
      if (location) show(location);
      refresh();
    });
    controls?.append(button); return { button, direction, name };
  });
  function refresh(): void {
    for (const { button, direction, name } of buttons) {
      const location = direction === -1 ? history.back : history.forward;
      button.disabled = location === undefined;
      button.title = location ? `${name} to ${names[location.tool]} $${hex(location.address)}` : `${name} in inspector history`;
    }
  }
  refresh();
  return {
    browse(tool: InspectorTool, address: number, from: InspectorTool = tool): void {
      history.visit({ tool: from, address: current(from) }, { tool, address });
      show({ tool, address }); refresh();
    },
  };
}
