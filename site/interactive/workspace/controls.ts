import type { PanelPosition, Workspace } from "./dock.js";

/** Mouse-free layout controls use the same workspace operations as dragging. */
export function mountWorkspaceControls(root: HTMLElement, workspace: Workspace, status: HTMLElement): void {
  function button(label: string, action: () => void) {
    const element = document.createElement("button");
    element.type = "button"; element.textContent = label; element.addEventListener("click", action);
    return element;
  }
  function disclosure(title: string) {
    const element = document.createElement("details"), summary = document.createElement("summary");
    summary.textContent = title; element.append(summary); root.append(element); return element;
  }
  const panels = disclosure("Panels"), list = document.createElement("div");
  list.className = "workspace-panel-list"; panels.append(list);
  const checks = workspace.panels.map(panel => {
    const label = document.createElement("label"), input = document.createElement("input");
    input.type = "checkbox"; input.checked = workspace.isOpen(panel.id);
    label.append(input, panel.title); list.append(label);
    input.addEventListener("change", () => input.checked ? workspace.show(panel.id) : workspace.hide(panel.id));
    return { id: panel.id, input };
  });
  const arrange = disclosure("Arrange panels"), form = document.createElement("form");
  arrange.append(form);
  function select(labelText: string, values: readonly (readonly [string, string])[]) {
    const label = document.createElement("label"), element = document.createElement("select");
    for (const [value, text] of values) element.add(new Option(text, value));
    label.append(labelText, element); form.append(label); return element;
  }
  const items = workspace.panels.map(panel => [panel.id, panel.title] as const);
  const selected = select("Panel", items);
  const position = select("Placement", [["tab", "As a tab with"], ["left", "Left of"], ["right", "Right of"],
    ["above", "Above"], ["below", "Below"]]);
  const target = select("Destination panel", items);
  function update(): void {
    for (const { id, input } of checks) input.checked = workspace.isOpen(id);
    for (const option of target.options) option.disabled = option.value === selected.value || !workspace.isOpen(option.value);
    if (target.selectedOptions[0]?.disabled) target.value = [...target.options].find(option => !option.disabled)?.value ?? "";
  }
  selected.addEventListener("change", update); position.addEventListener("change", update);
  const move = document.createElement("button"); move.type = "submit"; move.textContent = "Move panel"; form.append(move);
  form.addEventListener("submit", event => {
    event.preventDefault();
    try {
      workspace.move(selected.value, position.value as PanelPosition, target.value);
      status.textContent = `${selected.selectedOptions[0]!.textContent} moved.`;
    } catch (error) { status.textContent = (error as Error).message; }
  });
  root.append(button("Reset layout", () => workspace.reset()));
  const help = document.createElement("span"); help.className = "workspace-hint";
  help.textContent = "Drag headers to rearrange panels. Drag dividers to resize. Use the arrows to collapse or expand.";
  root.append(help, status);
  workspace.subscribe(update); update();
}
