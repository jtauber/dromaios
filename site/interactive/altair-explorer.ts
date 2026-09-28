import { createLessonsAltairMemory } from "../../src/machines/generated/lessons/altair-memory.js";
import { createAltairMemoryPanel } from "./altair-panel.js";

interface AltairExplorerOptions {
  readonly createPanel?: () => ReturnType<typeof createAltairMemoryPanel>;
  readonly onChange?: () => void;
  readonly initialMessage?: string;
  readonly canAccessMemory?: () => boolean;
}

/** Present switches, selected address, and RAM contents as separate states. */
export function mountAltairExplorer(root: HTMLElement, {
  createPanel = () => createAltairMemoryPanel(createLessonsAltairMemory().ram),
  onChange = () => {},
  initialMessage = "No memory operation yet. This lesson starts at address 0 with empty RAM and all switches down.",
  canAccessMemory = () => true,
}: AltairExplorerOptions = {}) {
  let panel = createPanel();
  const switches = [...root.querySelectorAll<HTMLButtonElement>("[data-panel-switch]")];
  const guides = root.querySelector<HTMLInputElement>("[data-panel-guides]")!;
  const preview = root.querySelector<HTMLElement>("[data-panel-preview]")!;
  const last = root.querySelector<HTMLElement>("[data-panel-last]")!;
  const formatNumber = (value: number, digits: number) => `${value} decimal · ${value.toString(16).toUpperCase().padStart(digits, "0")} hex`;

  function render(): void {
    for (const button of switches) {
      const on = (panel.switches & (1 << Number(button.dataset.panelSwitch))) !== 0;
      button.setAttribute("aria-pressed", String(on));
      button.querySelector<HTMLElement>("[data-switch-value]")!.textContent = on ? "1" : "0";
    }
    for (const [name, value, digits] of [["address", panel.address, 4], ["data", panel.data, 2]] as const) {
      const bank = root.querySelector<HTMLElement>(`[data-panel-${name}]`)!;
      bank.setAttribute("aria-label", `${name === "address" ? "Address" : "Data"} lights: ${formatNumber(value, digits)}`);
      for (const lamp of bank.querySelectorAll<HTMLElement>("[data-lamp-bit]")) {
        const on = (value & (1 << Number(lamp.dataset.lampBit))) !== 0;
        lamp.toggleAttribute("data-on", on);
        lamp.querySelector<HTMLElement>("[data-lamp-value]")!.textContent = on ? "1" : "0";
      }
      root.querySelector<HTMLElement>(`[data-panel-${name}-number]`)!.textContent = formatNumber(value, digits);
    }
    const byte = panel.switches & 0xff;
    root.querySelector<HTMLElement>("[data-panel-switch-address]")!.textContent = formatNumber(panel.switches, 4);
    root.querySelector<HTMLElement>("[data-panel-switch-data]")!.textContent = formatNumber(byte, 2);
    preview.setAttribute("aria-live", canAccessMemory() ? "polite" : "off");
    preview.textContent = canAccessMemory()
      ? `EXAMINE would select address ${panel.switches}. DEPOSIT would write ${byte} to the selected address, ${panel.address}.`
      : "Running. STOP before examining or depositing memory; switch positions do not change execution.";
    for (const help of root.querySelectorAll<HTMLElement>("[data-panel-number-guide]")) help.hidden = !guides.checked;
    for (const button of root.querySelectorAll<HTMLButtonElement>("[data-panel-action]")) button.disabled = !canAccessMemory();
    onChange();
  }

  for (const button of switches) button.addEventListener("click", () => {
    panel.toggleSwitch(Number(button.dataset.panelSwitch));
    render();
  });
  for (const action of ["examine", "examineNext", "deposit", "depositNext"] as const) {
    root.querySelector<HTMLButtonElement>(`[data-panel-action="${action}"]`)!.addEventListener("click", () => {
      if (!canAccessMemory()) return;
      const previousAddress = panel.address;
      panel[action]();
      const transition = action.endsWith("Next") ? `Moved from address ${previousAddress} to ${panel.address}. ` : "";
      last.textContent = transition + (action.startsWith("deposit")
        ? `Wrote ${panel.data} to address ${panel.address}. The data lights show the stored byte. The switches kept their positions.`
        : `Read ${panel.data} from address ${panel.address}. Memory and the switches are unchanged.`);
      render();
    });
  }
  guides.addEventListener("change", render);
  root.querySelector<HTMLButtonElement>("[data-panel-restart]")!.addEventListener("click", () => {
    panel = createPanel();
    last.textContent = initialMessage;
    render();
  });
  last.textContent = initialMessage;
  render();
  root.querySelector<HTMLFieldSetElement>("[data-panel-controls]")!.disabled = false;
  return { refresh: render };
}
