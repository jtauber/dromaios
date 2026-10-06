import { createApple2DeviceHistory } from "./apple2-device-history.js";
import type { DebugLocation } from "./instruction-debugger.js";
import type { InstructionCatalogue } from "./apple2-explorer.js";
import { disassemble6502, hex } from "./apple2-explorer.js";
import { apple2ComponentNames, apple2DeviceAccess } from "./apple2-hardware.js";
import type { Apple2HardwareCatalogue } from "./apple2-hardware.js";
import { memoryLink } from "./memory-link.js";

export function createApple2DeviceHistoryView(root: HTMLElement, hardware: Apple2HardwareCatalogue, instructions: InstructionCatalogue,
  browseCode: (location: DebugLocation) => string | undefined, browseMemory: (address: number) => void) {
  const panel = root.querySelector<HTMLElement>("[data-device-activity]");
  if (!panel) return undefined;
  const output = panel.querySelector<HTMLElement>("[data-device-events]")!, status = panel.querySelector<HTMLElement>("[data-device-status]")!;
  const filter = panel.querySelector<HTMLSelectElement>("[data-device-filter]")!;
  const history = createApple2DeviceHistory(instructions);
  let diskInstalled = false;
  function refresh(): void {
    output.replaceChildren();
    const entries = history.entries(); let shown = 0;
    for (const entry of entries) {
      const device = apple2DeviceAccess(hardware, entry.address, entry.kind)!;
      if (filter.value !== "all" && filter.value !== device.device) continue;
      shown++;
      const row = document.createElement("div"), title = document.createElement("div"), detail = document.createElement("div");
      const code = document.createElement("button"), description = document.createElement("a");
      row.className = "lab-device-event"; title.className = "lab-device-transfer"; detail.className = "lab-hint";
      code.type = "button"; code.className = "lab-memory-link"; code.textContent = `$${hex(entry.caller.address)}`;
      const assembly = disassemble6502(entry.caller.address, entry.bytes, instructions);
      code.title = `Browse ${assembly} at $${hex(entry.caller.address)} · observed ${entry.caller.space}`;
      code.setAttribute("aria-label", code.title); code.addEventListener("click", () => {
        const notice = browseCode(entry.caller);
        if (notice) status.textContent = notice;
      });
      const direction = entry.role === "fetch" ? "FETCH" : entry.kind === "read" ? "READ" : "WRITE";
      title.append(code, `  ${direction} `, memoryLink(entry.address, browseMemory), ` = $${hex(entry.value, 2)}`,
        ...(entry.count > 1 ? [`  ×${entry.count.toLocaleString()}`] : []));
      description.textContent = device.device === "disk" && !diskInstalled ? "Disk II absent; transfer unanswered" : device.description;
      description.href = `${panel!.dataset.repository}/blob/main/${device.source}`;
      description.target = "_blank"; description.rel = "noopener";
      detail.append(`#${entry.first}${entry.last !== entry.first ? `–${entry.last}` : ""} · ${assembly} · ${apple2ComponentNames[device.device] ?? "Unmapped"}`, document.createElement("br"), description);
      row.append(title, detail); output.append(row);
    }
    status.textContent = `${history.accesses.toLocaleString()} accesses · ${shown} / ${entries.length} groups shown`
      + (history.discarded ? ` · ${history.discarded.toLocaleString()} older accesses discarded` : "");
    if (!shown) output.textContent = entries.length ? "No accesses match this device." : "No device accesses recorded. Step or Run to begin.";
  }
  filter.addEventListener("change", refresh);
  panel.querySelector<HTMLButtonElement>("[data-device-clear]")!.addEventListener("click", () => { history.clear(); refresh(); });
  return {
    observe: history.observe,
    reset(): void { history.reset(); },
    refresh(installed: boolean): void { diskInstalled = installed; refresh(); },
  };
}
