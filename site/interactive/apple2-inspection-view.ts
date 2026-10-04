import type { createApple2Session } from "./apple2-session.js";
import type { Cpu6502Snapshot, Cpu6502StepRecord } from "../../src/components/cpus/generated/6502-cpu.js";
import { apple2MemoryHighlights, apple2StorageReader } from "./apple2-inspection.js";
import type { Apple2MemoryChange } from "./apple2-inspection.js";
import { createApple2MemoryView } from "./apple2-memory-view.js";
import { createApple2MemoryScrollView } from "./apple2-memory-scroll-view.js";
import { createApple2StackView } from "./apple2-stack-view.js";
import { createApple2MemoryPosition } from "./apple2-memory-position.js";
import type { Apple2MemoryMode } from "./apple2-memory-position.js";
import { createInspectorChoices } from "./inspector-controls.js";
import { hex, parseApple2Address } from "./apple2-explorer.js";

type Machine = ReturnType<typeof createApple2Session>["machine"];

/** Both views observe the same machine. Only the laboratory includes memory instruments. */
export function createApple2Inspection(root: HTMLElement, shouldUpdate: (id: string) => boolean, onMemoryPosition: () => void) {
  const element = (name: string) => root.querySelector<HTMLElement>(`[data-${name}]`);
  const cpuView = element("machine-inspect")!, system = element("system-inspect")!;
  const diskView = element("disk-inspect"), zero = element("zero-page"), stack = element("stack-view");
  const memory = element("memory-view"), stackStatus = element("stack-status");
  const form = root.querySelector<HTMLFormElement>("[data-memory-form]");
  const address = root.querySelector<HTMLInputElement>("[data-memory-address]");
  const positionStatus = element("memory-position"), position = createApple2MemoryPosition();
  const follow = createInspectorChoices<Apple2MemoryMode>("Memory position", [
    { value: "fixed", label: "FIX", title: "Fixed address" },
    { value: "pc", label: "PC", title: "Follow PC" },
    { value: "changes", label: "CHG", title: "Follow changes" },
  ], position.mode, mode => {
    position.mode = mode; address!.setCustomValidity(""); renderMemoryWindow(); onMemoryPosition();
  });
  let displayedStart = 0x400;
  let machine: Machine | undefined;
  let latest: Cpu6502StepRecord | undefined;
  let memoryChanges: readonly Apple2MemoryChange[] = [];
  const zeroView = createApple2MemoryView(zero, 256), stackView = createApple2StackView(stack, element("stack-page"));
  const memoryView = createApple2MemoryScrollView(memory, value => {
    position.browse(value); displayedStart = value; follow.select("fixed");
    if (document.activeElement !== address) address!.value = hex(value);
    positionStatus!.textContent = `Fixed address · $${hex(value)}`; onMemoryPosition();
  });
  const memoryControls = document.createElement("span"); memoryControls.className = "lab-inspector-controls";
  if (form && memoryView) memoryControls.append(form, follow.element, memoryView.control);
  const updateValues: ((state: Cpu6502Snapshot) => void)[] = [];
  const registers = document.createElement("span"), flags = document.createElement("span");
  registers.className = "apple2-registers"; flags.className = "apple2-flags";
  cpuView.replaceChildren(registers, "\n", flags);
  function addValue(name: string, read: (state: Cpu6502Snapshot) => number, width: number, flagName?: string): void {
    const field = document.createElement("span"), label = document.createElement("span");
    const value = document.createElement("span"), change = document.createElement("span");
    field.className = "apple2-cpu-value"; field.dataset.cpuValue = name;
    label.className = "apple2-cpu-label"; label.textContent = name.toUpperCase();
    value.className = "apple2-cpu-number";
    change.className = "visually-hidden";
    field.append(label, flagName ? "" : " ", value, change);
    if (flagName) { field.classList.add("apple2-cpu-flag"); field.setAttribute("role", "img"); }
    (flagName ? flags : registers).append(field, "  ");
    updateValues.push(state => {
      const label = name.toUpperCase(), current = hex(read(state), width);
      const changed = latest !== undefined && read(latest.before) !== read(latest.after);
      const previous = latest === undefined ? current : hex(read(latest.before), width);
      value.textContent = `${flagName ? "=" : "$"}${current}`;
      field.classList.toggle("is-changed", changed);
      field.title = changed ? `${label} changed ${previous} → ${current} in the last instruction` : "";
      if (flagName) {
        const set = read(state) !== 0;
        field.classList.toggle("is-set", set);
        field.title = `${flagName} (${label}): ${set ? "set" : "clear"} (${current})` + (changed ? `. ${field.title}` : "");
        field.setAttribute("aria-label", field.title);
      }
      change.textContent = changed ? ` (changed from ${previous})` : "";
    });
  }
  for (const row of [["a", "x", "y"], ["pc", "sp"]] as const) {
    for (const name of row) addValue(name, state => state[name], name === "pc" ? 4 : 2);
    registers.append("\n");
  }
  for (const [flag, name] of [["n", "Negative"], ["v", "Overflow"], ["d", "Decimal"],
    ["i", "IRQ disable"], ["z", "Zero"], ["c", "Carry"]] as const) addValue(flag, state => +state.flags[flag], 1, name);
  form?.addEventListener("submit", event => {
    event.preventDefault();
    try { position.browse(parseApple2Address(address!.value)); follow.select("fixed"); }
    catch (error) { address!.setCustomValidity((error as Error).message); address!.reportValidity(); return; }
    renderMemoryWindow(); onMemoryPosition();
  });
  address?.addEventListener("input", () => address.setCustomValidity(""));
  function renderMemoryWindow(): void {
    if (!memory || !machine) return;
    const view = memoryView!;
    const { start, target } = position.refresh(machine, machine.cpu.snapshot().pc, view.rowWidth, view.visibleBytes, view.visibleStart);
    displayedStart = start;
    view.render(apple2StorageReader(machine), start, apple2MemoryHighlights(machine, memoryChanges));
    if (document.activeElement !== address) address!.value = hex(start);
    const mode = position.mode === "fixed" ? "Fixed address" : position.mode === "pc" ? "Following PC" : "Following changed RAM";
    positionStatus!.textContent = `${mode} · $${hex(start)}`
      + (position.mode === "changes" && target === undefined ? " · waiting for a visible RAM change" : "");
  }
  function render(): void {
    for (const control of memoryControls.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button")) control.disabled = machine === undefined;
    if (machine === undefined) return;
    const details = cpuView.closest("details");
    if (details !== null && !details.open) return;
    const cpu = machine.cpu.snapshot();
    if (shouldUpdate("registers")) for (const update of updateValues) update(cpu);
    if (shouldUpdate("system") || shouldUpdate("disk")) {
      const drive = machine.disk.inspect(), on = (value: boolean) => value ? "on" : "off";
      const disk = `Disk II ${drive.installed ? "installed" : "absent"}\nMedia ${drive.loaded ? "loaded · protected" : "absent"}\nDrive ${drive.drive} · motor ${on(drive.motor)}\nTrack ${drive.halfTrack / 2} · byte ${drive.position}\nPhase ${drive.phase} · Q6 ${+drive.q6} · Q7 ${+drive.q7}\nLatch $${hex(drive.latch, 2)}`;
      if (shouldUpdate("system")) {
        const key = machine.keyboard.snapshot(), language = machine.language.snapshot(), video = machine.video.snapshot();
        system.textContent = `KEYBOARD\nKey $${hex(key.key, 2)} · strobe ${key.strobe ? "set" : "clear"}\n\nDISPLAY\nText ${on(video.text)} · mixed ${on(video.mixed)}\nHi-res ${on(video.hires)} · page ${video.page2 ? 2 : 1}\n\nLANGUAGE CARD\nRAM read ${on(language.ram_read)}\nRAM write ${on(language.ram_write)}\nBank ${language.bank2 ? 2 : 1} · prewrite ${on(language.prewrite)}\n\n${disk}`;
      }
      if (diskView && shouldUpdate("disk")) diskView.textContent = disk;
    }
    if (memory) {
      const read = apple2StorageReader(machine), changes = apple2MemoryHighlights(machine, memoryChanges);
      if (shouldUpdate("zero")) zeroView?.render(read, 0, changes);
      if (shouldUpdate("memory")) renderMemoryWindow();
      if (shouldUpdate("stack")) {
        stackView?.render(read, cpu.sp, changes);
        stackStatus!.textContent = `SP $${hex(cpu.sp, 2)} · push $01${hex(cpu.sp, 2)} · pull $01${hex((cpu.sp + 1) & 0xff, 2)}`;
      }
    }
  }
  return {
    controls: (id: string): HTMLElement | undefined => id === "memory" && memoryView ? memoryControls
      : id === "zero" ? zeroView?.control : id === "stack" ? stackView?.control : undefined,
    get memoryAddress() { return displayedStart; },
    browseMemory(value: number): void {
      position.browse(value); follow.select("fixed");
      address!.setCustomValidity(""); address!.value = hex(value); renderMemoryWindow();
    },
    observe(selected: Machine, writes: readonly Apple2MemoryChange[]): void {
      if (memory) position.observe(selected, writes);
    },
    refresh(selected: Machine | undefined, record?: Cpu6502StepRecord, changes: readonly Apple2MemoryChange[] = []): void {
      if (record === undefined) position.reset();
      machine = selected; latest = record; memoryChanges = changes; render();
    },
  };
}
