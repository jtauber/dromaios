import { createRomReference } from "./apple2-rom-reference.js";
import { hex } from "./apple2-explorer.js";
import type { RomRegion, AddressLabel, MemoryLabel } from "./apple2-explorer.js";

interface ReferenceState {
  readonly pc: number;
  readonly memory: number;
  readonly installed: boolean;
  readonly mapped: boolean;
}

/** Reference selection and navigation never run code or change the processor's PC. */
export function createApple2RomReference(root: HTMLElement, catalogue: {
  readonly regions: readonly RomRegion[]; readonly routines: readonly AddressLabel[]; readonly labels: readonly MemoryLabel[];
}, navigate: (tool: "code" | "memory", address: number) => void) {
  const panel = root.querySelector<HTMLElement>("[data-rom-reference]");
  if (!panel) return undefined;
  const element = <T extends HTMLElement>(name: string) => panel.querySelector<T>(`[data-reference-${name}]`)!;
  const mode = element<HTMLSelectElement>("mode"), search = element<HTMLInputElement>("search");
  const context = element("context"), heading = element("heading"), description = element("description");
  const count = element("count"), list = element("list");
  const code = element<HTMLButtonElement>("code"), memory = element<HTMLButtonElement>("memory");
  const reference = createRomReference(catalogue.regions, catalogue.routines, catalogue.labels);
  let state: ReferenceState | undefined, selection: number | undefined, displayed: AddressLabel | undefined;
  const buttons = new Map(reference.search("").map(entry => {
    const button = document.createElement("button");
    button.type = "button"; button.textContent = `$${entry.address} · ${entry.name}`; button.title = entry.description;
    button.addEventListener("click", () => select(parseInt(entry.address, 16)));
    list.append(button); return [entry, button] as const;
  }));
  function renderList(): void {
    const matches = new Set(reference.search(search.value));
    for (const [entry, button] of buttons) {
      button.hidden = !matches.has(entry); button.setAttribute("aria-pressed", String(entry === displayed));
    }
    count.textContent = matches.size ? `${matches.size} of ${buttons.size} documented entries`
      : "No matching entries. Try an address, name, or description.";
  }
  function render(): void {
    if (!state) return;
    const browsing = mode.value === "selection";
    const address = browsing ? selection : mode.value === "memory" ? state.memory : state.pc;
    const mapped = state.installed && state.mapped;
    const location = address === undefined ? undefined : reference.locate(address, browsing || mapped);
    displayed = browsing && address !== undefined ? reference.at(address) : location?.entry;
    const label = catalogue.labels.find(label => label === displayed);
    context.textContent = address === undefined ? "Select an entry from the reference."
      : `${browsing ? "Selected" : mode.value === "memory" ? "Memory" : "PC"} $${hex(address)}`
        + (label ? ` · ${label.scope === "hardware" ? "Hardware address" : label.scope === "workspace" ? "ROM workspace in RAM" : "ROM data"}`
          : location ? ` · ${location.region.name}` : "")
        + (!state.installed ? " · ROM not loaded" : !state.mapped ? " · ROM hidden by Language Card RAM" : "");
    heading.textContent = displayed ? `$${displayed.address} · ${displayed.name}` : "No documented entry at this location";
    description.textContent = displayed ? displayed.description
      : !browsing && !mapped ? "Browse the reference to read about the ROM independently of the current mapping."
      : "Select a documented entry below to explore the Monitor ROM.";
    element("offset").textContent = !browsing && location?.offset ? `Nearest documented entry, +$${hex(location.offset)}. This does not establish a routine boundary.` : "";
    code.disabled = memory.disabled = displayed === undefined;
    renderList();
  }
  function select(address: number): void {
    selection = address; mode.value = "selection"; render();
  }
  mode.addEventListener("change", render);
  search.addEventListener("input", renderList);
  code.addEventListener("click", () => { if (displayed) navigate("code", parseInt(displayed.address, 16)); });
  memory.addEventListener("click", () => { if (displayed) navigate("memory", parseInt(displayed.address, 16)); });
  return {
    select,
    refresh(current: ReferenceState, update: boolean): void { state = current; if (update) render(); },
  };
}
