import type { createApple2Session } from "./apple2-session.js";
import type { Cpu6502StepRecord } from "../../src/components/cpus/generated/6502-cpu.js";
import { apple2MemoryHighlights, apple2StorageReader } from "./apple2-inspection.js";
import type { Apple2MemoryChange } from "./apple2-inspection.js";
import { createApple2ZeroPage } from "./apple2-zero-view.js";
import { createApple2Watches } from "./apple2-watch-view.js";
import type { InstructionCatalogue, MemoryLabel } from "./apple2-explorer.js";
import { createApple2InstructionView } from "./apple2-instruction-view.js";
import { preview6502 } from "./apple2-instruction-preview.js";
import type { Apple2InstructionPreview } from "./apple2-instruction-preview.js";
import { createApple2MemoryScrollView } from "./apple2-memory-scroll-view.js";
import { createApple2StackView } from "./apple2-stack-view.js";
import { createApple2MemoryPosition } from "./apple2-memory-position.js";
import type { Apple2MemoryMode } from "./apple2-memory-position.js";
import { createInspectorChoices } from "./inspector-controls.js";
import { createApple2Registers } from "./apple2-register-view.js";
import type { Editable6502Register } from "./apple2-register-edit.js";
import { hex, parseApple2Address } from "./apple2-explorer.js";

type Machine = ReturnType<typeof createApple2Session>["machine"];

/** Both views observe the same machine. Only the laboratory includes memory instruments. */
export function createApple2Inspection(root: HTMLElement, shouldUpdate: (id: string) => boolean, onMemoryPosition: () => void, edit: (register: Editable6502Register, text: string) => void, showPanel: (id: string) => void) {
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
  let latest: Cpu6502StepRecord | undefined, editable = false;
  let memoryChanges: readonly Apple2MemoryChange[] = [];
  const { labels, instructions } = JSON.parse(element("rom-catalogue")!.textContent!) as { labels: readonly MemoryLabel[]; instructions: InstructionCatalogue };
  let preview: Apple2InstructionPreview | undefined;
  function nextInstruction(): Apple2InstructionPreview {
    return preview ??= preview6502(machine!.cpu.snapshot(), apple2StorageReader(machine!), instructions);
  }
  const browse = (value: number) => { browseMemory(value); showPanel("memory"); onMemoryPosition(); };
  const instruction = createApple2InstructionView(root, browse);
  const zeroView = createApple2ZeroPage(zero, labels, browse), stackView = createApple2StackView(stack, element("stack-page"));
  const watches = createApple2Watches(root, labels, browse);
  const memoryView = createApple2MemoryScrollView(memory, value => {
    position.browse(value); displayedStart = value; follow.select("fixed");
    if (document.activeElement !== address) address!.value = hex(value);
    positionStatus!.textContent = `Fixed address · $${hex(value)}`; onMemoryPosition();
  });
  const memoryControls = document.createElement("span"); memoryControls.className = "lab-inspector-controls";
  if (form && memoryView) memoryControls.append(form, follow.element, memoryView.control);
  const registers = createApple2Registers(cpuView, root.matches("[data-laboratory]") ? edit : undefined);
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
    view.render(apple2StorageReader(machine), start, apple2MemoryHighlights(machine, memoryChanges), nextInstruction().memory);
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
    registers.refresh(cpu, latest, editable, shouldUpdate("registers"));
    if (instruction && shouldUpdate("instruction")) instruction(nextInstruction());
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
      if (shouldUpdate("zero")) zeroView?.render(read, changes, machine.firmware.loaded, nextInstruction().memory);
      if (shouldUpdate("memory")) renderMemoryWindow();
      if (shouldUpdate("watches")) watches?.refresh(machine, read, machine.firmware.loaded, !machine.language.ramRead());
      if (shouldUpdate("stack")) {
        stackView?.render(read, cpu.sp, changes, nextInstruction().memory);
        stackStatus!.textContent = `SP $${hex(cpu.sp, 2)} · push $01${hex(cpu.sp, 2)} · pull $01${hex((cpu.sp + 1) & 0xff, 2)}`;
      }
    }
  }
  function browseMemory(value: number): void {
    position.browse(value); follow.select("fixed");
    address!.setCustomValidity(""); address!.value = hex(value); renderMemoryWindow();
  }
  return {
    controls: (id: string): HTMLElement | undefined => id === "memory" && memoryView ? memoryControls
      : id === "zero" ? zeroView?.control : id === "stack" ? stackView?.control : undefined,
    get memoryAddress() { return displayedStart; },
    browseMemory,
    observe(selected: Machine, writes: readonly Apple2MemoryChange[]): void {
      if (memory) position.observe(selected, writes);
      zeroView?.observe(writes);
    },
    refresh(selected: Machine | undefined, record?: Cpu6502StepRecord, changes: readonly Apple2MemoryChange[] = [], canEdit = false): void {
      if (record === undefined) { position.reset(); zeroView?.reset(); }
      machine = selected; editable = canEdit; latest = record; memoryChanges = changes; preview = undefined; render();
    },
  };
}
