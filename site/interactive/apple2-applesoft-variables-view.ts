import { applesoftArrayElement, applesoftArrays, applesoftMemoryLayout, applesoftVariables } from "./apple2-applesoft.js";
import type { ApplesoftArray, ApplesoftVariable } from "./apple2-applesoft.js";
import { hex } from "./apple2-explorer.js";
import type { createApple2Session } from "./apple2-session.js";
import { memoryLink } from "./memory-link.js";
import { captureMemory } from "./memory-window.js";
import { createApplesoftMemoryView } from "./apple2-applesoft-memory-view.js";

type Machine = ReturnType<typeof createApple2Session>["machine"];
type Browse = (address: number) => void;
type VariableRam = Pick<Machine["ram"], "read" | "size">;

function link(name: string, address: number, label: string, browse: Browse): HTMLButtonElement {
  const button = memoryLink(address, browse, name);
  button.setAttribute("aria-label", `${label} at $${hex(address)} in Memory`);
  return button;
}

function variableRows(table: HTMLTableElement, browse: Browse) {
  const body = table.tBodies[0]!;
  let displayed: string | undefined;
  return (entries: readonly ApplesoftVariable[]): void => {
    const key = JSON.stringify(entries);
    if (displayed === key) return;
    displayed = key;
    body.replaceChildren();
    for (const entry of entries) {
      const row = body.insertRow();
      row.insertCell().append(link(entry.name, entry.address, entry.name, browse));
      row.insertCell().textContent = entry.type;
      const value = row.insertCell();
      if (entry.contentsAddress === undefined) value.textContent = entry.value;
      else value.append(link(entry.value, entry.contentsAddress, `${entry.name} characters`, browse));
    }
  };
}

function arrayView(initial: ApplesoftArray, tableTemplate: HTMLTableElement, browse: Browse) {
  const details = document.createElement("details"), summary = document.createElement("summary");
  const table = tableTemplate.cloneNode(false) as HTMLTableElement;
  table.append(tableTemplate.tHead!.cloneNode(true)); table.createTBody(); table.hidden = false;
  const rows = variableRows(table, browse);
  const controls = document.createElement("div"), range = document.createElement("span");
  const previous = document.createElement("button"), next = document.createElement("button");
  controls.className = "basic-controls";
  previous.type = next.type = "button"; previous.textContent = "Previous"; next.textContent = "Next";
  controls.append(previous, range, next); details.append(summary, table, controls);
  const pageSize = 32;
  let array = initial, ram: VariableRam, first = 0;
  function draw(): void {
    if (!details.open) return;
    const end = Math.min(first + pageSize, array.count);
    rows(Array.from({ length: end - first }, (_, i) => applesoftArrayElement(ram, array, first + i)));
    controls.hidden = array.count <= pageSize;
    range.textContent = `${first + 1}–${end} of ${array.count}`;
    previous.disabled = first === 0; next.disabled = end === array.count;
  }
  previous.addEventListener("click", () => { first -= pageSize; draw(); });
  next.addEventListener("click", () => { first += pageSize; draw(); });
  details.addEventListener("toggle", draw);
  return { details, refresh(current: ApplesoftArray, sample: VariableRam): void {
    array = current; ram = sample;
    first = Math.min(first, Math.floor((array.count - 1) / pageSize) * pageSize);
    const bounds = array.dimensions.map(size => size - 1).join(",");
    const title = `${array.name}(${bounds}) · ${array.type} · ${array.count} ${array.count === 1 ? "element" : "elements"}`;
    if (summary.textContent !== title) summary.textContent = title;
    draw();
  } };
}

export function createApplesoftVariablesView(root: HTMLElement, browse: Browse) {
  const panel = root.querySelector<HTMLElement>('[data-workspace-panel="variables"]');
  if (!panel) return;
  const status = panel.querySelector<HTMLElement>("[data-variables-status]")!;
  const table = panel.querySelector<HTMLTableElement>(".lab-applesoft-variables")!, rows = variableRows(table, browse);
  const memory = createApplesoftMemoryView(panel, browse);
  const container = panel.querySelector<HTMLElement>("[data-applesoft-arrays]")!;
  const views = new Map<string, ReturnType<typeof arrayView>>();
  return (machine: Machine): void => {
    if (panel.hidden) return;
    const unavailable = !machine.firmware.loaded ? "Load the Apple II Plus ROM to inspect Applesoft variables."
      : machine.language.ramRead() ? "Language Card RAM is mapped in place of the Applesoft ROM." : undefined;
    const scalars = unavailable ? { variables: [], message: unavailable } : applesoftVariables(machine.ram);
    const { arrays, message } = unavailable ? { arrays: [] } : applesoftArrays(machine.ram);
    memory(unavailable ? undefined : applesoftMemoryLayout(machine.ram));
    rows(scalars.variables);
    table.hidden = scalars.variables.length === 0;
    status.textContent = scalars.message ?? message ?? (table.hidden && !arrays.length ? "No variables." : "");
    status.hidden = !status.textContent;
    const names = new Set(arrays.map(array => array.name));
    for (const [name, view] of views) {
      if (!names.has(name)) { view.details.remove(); views.delete(name); }
    }
    if (!arrays.length) return;
    // Opening an array or turning a page also works with Live off. Both use the displayed RAM sample.
    const image = captureMemory(at => machine.ram.read(at), machine.ram.size);
    const sample = { size: image.length, read: (at: number) => image[at]! };
    arrays.forEach((array, index) => {
      const view = views.get(array.name) ?? arrayView(array, table, browse);
      views.set(array.name, view);
      const position = container.children.item(index);
      if (position !== view.details) container.insertBefore(view.details, position);
      view.refresh(array, sample);
    });
  };
}
