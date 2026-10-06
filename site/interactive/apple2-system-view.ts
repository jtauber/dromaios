import type { Cpu6502StepRecord } from "../../src/components/cpus/generated/6502-cpu.js";
import { apple2HardwareState, apple2MemoryMap } from "./apple2-hardware.js";
import type { Apple2HardwareCatalogue } from "./apple2-hardware.js";
import { hex } from "./apple2-explorer.js";
import { memoryLink } from "./memory-link.js";

type Machine = Parameters<typeof apple2HardwareState>[0];

/** The concrete Apple II readout is separate from docking and from guest execution. */
export function createApple2SystemView(root: HTMLElement, catalogue: Apple2HardwareCatalogue, browse: (address: number) => void) {
  const panel = root.querySelector<HTMLElement>("[data-hardware-inspect]");
  if (!panel) return undefined;
  const map = panel.querySelector<HTMLElement>("[data-hardware-map]")!;
  const fields = new Map([...panel.querySelectorAll<HTMLElement>("[data-hardware-field]")].map(field => [field.dataset.hardwareField!, field]));
  const routes = catalogue.regions.map(region => {
    const row = document.createElement("tr"), address = document.createElement("td"), read = document.createElement("td"), write = document.createElement("td");
    address.append(memoryLink(region.start, browse, `${hex(region.start)}–${hex(region.start + region.size - 1)}`));
    row.append(address, read, write); map.append(row);
    fields.set(`read-${region.start}`, read); fields.set(`write-${region.start}`, write);
    return region.start;
  });
  let identity: Machine | undefined, sample: Cpu6502StepRecord | undefined;
  let previous = new Map<string, string>();
  return {
    refresh(machine: Machine, record: Cpu6502StepRecord | undefined): void {
      const state = apple2HardwareState(machine), { keyboard, video, language, disk } = state;
      const rows = apple2MemoryMap(catalogue, state), on = (value: boolean) => value ? "Set" : "Clear";
      const character = keyboard.key >= 0x20 && keyboard.key <= 0x7e ? ` '${String.fromCharCode(keyboard.key)}'` : "";
      const values: Record<string, string> = {
        key: `$${hex(keyboard.key, 2)}${character}`, strobe: on(keyboard.strobe),
        text: video.text ? "Text" : "Graphics", mixed: video.mixed ? "Bottom 4 text rows" : "Full screen", page: video.page2 ? "2" : "1",
        hires: video.hires ? "High resolution" : "Low resolution", bank: language.bank2 ? "2" : "1",
        ramRead: language.ram_read ? "RAM" : "ROM", ramWrite: language.ram_write ? "Enabled" : "Protected", prewrite: on(language.prewrite),
        firmware: state.firmware ? "Installed" : "Absent", disk: disk.installed ? "Installed" : "Absent",
      };
      rows.forEach((row, index) => { values[`read-${routes[index]}`] = row.read; values[`write-${routes[index]}`] = row.write; });
      const fresh = identity !== machine;
      for (const [name, field] of fields) {
        const value = values[name]!, before = previous.get(name);
        if (fresh || sample !== record || value !== before) {
          const changed = !fresh && before !== undefined && before !== value;
          field.classList.toggle("is-changed", changed);
          field.title = changed ? `Previously ${before}; changed since the last displayed sample` : "";
        }
        field.textContent = value;
      }
      identity = machine; sample = record; previous = new Map(Object.entries(values));
    },
  };
}
