import { applesoftVariables } from "./apple2-applesoft.js";
import { hex } from "./apple2-explorer.js";
import type { createApple2Session } from "./apple2-session.js";
import { memoryLink } from "./memory-link.js";

type Machine = ReturnType<typeof createApple2Session>["machine"];

export function createApplesoftVariablesView(root: HTMLElement, browse: (address: number) => void) {
  const panel = root.querySelector<HTMLElement>('[data-workspace-panel="variables"]');
  if (!panel) return;
  const status = panel.querySelector<HTMLElement>("[data-variables-status]")!;
  const table = panel.querySelector<HTMLTableElement>("table")!, body = table.tBodies[0]!;
  let displayed: string | undefined;
  function link(name: string, address: number, label: string): HTMLButtonElement {
    const button = memoryLink(address, browse, name);
    button.setAttribute("aria-label", `${label} at $${hex(address)} in Memory`);
    return button;
  }
  return (machine: Machine): void => {
    if (panel.hidden) return;
    const result = !machine.firmware.loaded ? { variables: [], message: "Load the Apple II Plus ROM to inspect Applesoft variables." }
      : machine.language.ramRead() ? { variables: [], message: "Language Card RAM is mapped in place of the Applesoft ROM." }
      : applesoftVariables(machine.ram);
    const key = JSON.stringify(result);
    if (key === displayed) return;
    displayed = key;
    body.replaceChildren();
    for (const variable of result.variables) {
      const row = body.insertRow();
      row.insertCell().append(link(variable.name, variable.address, variable.name));
      row.insertCell().textContent = variable.type;
      const value = row.insertCell();
      if (variable.contentsAddress === undefined) value.textContent = variable.value;
      else value.append(link(variable.value, variable.contentsAddress, `${variable.name} characters`));
    }
    table.hidden = result.variables.length === 0;
    status.hidden = !table.hidden;
    status.textContent = result.message ?? (table.hidden ? "No scalar variables." : "");
  };
}
