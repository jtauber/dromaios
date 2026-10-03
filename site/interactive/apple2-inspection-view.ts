import type { createApple2Session } from "./apple2-session.js";
import type { Cpu6502Snapshot, Cpu6502StepRecord } from "../../src/components/cpus/generated/6502-cpu.js";
import { apple2MemoryAddresses, apple2MemoryHighlights, apple2StorageReader } from "./apple2-inspection.js";
import type { Apple2MemoryChange } from "./apple2-inspection.js";
import { hex, parseApple2Address } from "./apple2-explorer.js";

type Machine = ReturnType<typeof createApple2Session>["machine"];

/** Stable byte cells keep the three memory panels consistent, including overlapping windows. */
function createMemoryView(container: HTMLElement | null, length: number) {
  let start: number | undefined;
  let cells: { address: number; field: HTMLSpanElement; value: Text; description: HTMLSpanElement }[] = [];
  return (read: (address: number) => number | undefined, address: number, changes: ReadonlyMap<number, Apple2MemoryChange>): void => {
    if (!container) return;
    if (start !== address) {
      start = address;
      container.replaceChildren();
      cells = apple2MemoryAddresses(start, length).map((address, offset) => {
        if (offset % 8 === 0) container.append(`${offset ? "\n" : ""}${hex(address)} `);
        const field = document.createElement("span"), value = document.createTextNode("");
        const description = document.createElement("span");
        field.className = "apple2-memory-byte"; field.dataset.memoryByte = hex(address);
        description.className = "visually-hidden";
        field.append(value, description); container.append(" ", field);
        return { address, field, value, description };
      });
    }
    for (const { address, field, value, description } of cells) {
      const byte = read(address), change = changes.get(address);
      const current = byte === undefined ? "--" : hex(byte, 2);
      const changed = change !== undefined && byte === change.after;
      value.textContent = current;
      field.classList.toggle("is-changed", changed);
      field.title = changed ? `$${hex(address)} changed ${hex(change.before, 2)} → ${current} in the last instruction` : "";
      description.textContent = changed ? ` (changed from ${hex(change.before, 2)})` : "";
    }
  };
}

/** Both views observe the same machine. Only the laboratory includes memory instruments. */
export function createApple2Inspection(root: HTMLElement) {
  const element = (name: string) => root.querySelector<HTMLElement>(`[data-${name}]`);
  const cpuView = element("machine-inspect")!, system = element("system-inspect")!;
  const diskView = element("disk-inspect"), zero = element("zero-page"), stack = element("stack-view");
  const memory = element("memory-view"), stackStatus = element("stack-status");
  const form = root.querySelector<HTMLFormElement>("[data-memory-form]");
  const address = root.querySelector<HTMLInputElement>("[data-memory-address]");
  let start = 0x400, machine: Machine | undefined;
  let latest: Cpu6502StepRecord | undefined;
  let memoryChanges: readonly Apple2MemoryChange[] = [];
  const renderZero = createMemoryView(zero, 256), renderStack = createMemoryView(stack, 256);
  const renderMemory = createMemoryView(memory, 128);
  const updateValues: ((state: Cpu6502Snapshot) => void)[] = [];
  cpuView.replaceChildren();
  function addValue(name: string, read: (state: Cpu6502Snapshot) => number, width: number, separator: string): void {
    const field = document.createElement("span"), value = document.createElement("span"), change = document.createElement("span");
    field.className = "apple2-cpu-value"; field.dataset.cpuValue = name;
    change.className = "visually-hidden";
    field.append(value, change); cpuView.append(field, "  ");
    updateValues.push(state => {
      const label = name.toUpperCase(), current = hex(read(state), width);
      const changed = latest !== undefined && read(latest.before) !== read(latest.after);
      const previous = latest === undefined ? current : hex(read(latest.before), width);
      value.textContent = `${label}${separator}${current}`;
      field.classList.toggle("is-changed", changed);
      field.title = changed ? `${label} changed ${previous} → ${current} in the last instruction` : "";
      change.textContent = changed ? ` (changed from ${previous})` : "";
    });
  }
  for (const row of [["pc", "sp"], ["a", "x", "y"]] as const) {
    for (const name of row) addValue(name, state => state[name], name === "pc" ? 4 : 2, " ");
    cpuView.append("\n");
  }
  for (const flag of ["n", "v", "d", "i", "z", "c"] as const) addValue(flag, state => +state.flags[flag], 1, "=");
  form?.addEventListener("submit", event => {
    event.preventDefault();
    try { start = parseApple2Address(address!.value); }
    catch (error) { address!.setCustomValidity((error as Error).message); address!.reportValidity(); return; }
    render();
  });
  address?.addEventListener("input", () => address.setCustomValidity(""));
  function render(): void {
    for (const control of form?.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button") ?? []) control.disabled = machine === undefined;
    if (machine === undefined) return;
    const details = cpuView.closest("details");
    if (details !== null && !details.open) return;
    const cpu = machine.cpu.snapshot(), key = machine.keyboard.snapshot(), drive = machine.disk.inspect();
    const language = machine.language.snapshot(), video = machine.video.snapshot();
    for (const update of updateValues) update(cpu);
    const on = (value: boolean) => value ? "on" : "off";
    const disk = `Disk II ${drive.installed ? "installed" : "absent"}\nMedia ${drive.loaded ? "loaded · protected" : "absent"}\nDrive ${drive.drive} · motor ${on(drive.motor)}\nTrack ${drive.halfTrack / 2} · byte ${drive.position}\nPhase ${drive.phase} · Q6 ${+drive.q6} · Q7 ${+drive.q7}\nLatch $${hex(drive.latch, 2)}`;
    system.textContent = `KEYBOARD\nKey $${hex(key.key, 2)} · strobe ${key.strobe ? "set" : "clear"}\n\nDISPLAY\nText ${on(video.text)} · mixed ${on(video.mixed)}\nHi-res ${on(video.hires)} · page ${video.page2 ? 2 : 1}\n\nLANGUAGE CARD\nRAM read ${on(language.ram_read)}\nRAM write ${on(language.ram_write)}\nBank ${language.bank2 ? 2 : 1} · prewrite ${on(language.prewrite)}\n\n${disk}`;
    if (diskView) diskView.textContent = disk;
    if (memory) {
      const read = apple2StorageReader(machine), changes = apple2MemoryHighlights(machine, memoryChanges);
      renderZero(read, 0, changes);
      renderMemory(read, start, changes);
      renderStack(read, 0x100, changes);
      stackStatus!.textContent = `SP $${hex(cpu.sp, 2)} · next push $01${hex(cpu.sp, 2)} · next pull $01${hex((cpu.sp + 1) & 0xff, 2)}`;
    }
  }
  return {
    refresh(selected: Machine | undefined, record?: Cpu6502StepRecord, changes: readonly Apple2MemoryChange[] = []): void {
      machine = selected; latest = record; memoryChanges = changes; render();
    },
  };
}
