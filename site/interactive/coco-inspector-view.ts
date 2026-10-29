import type { Coco } from "../../src/machines/6809/coco/runtime.js";
import { cocoHex, readCocoStorage } from "./coco-inspection.js";
import { createMemoryInspector } from "./memory-inspector.js";
import { create6809MemoryView } from "./6809-memory-view.js";

/** CoCo-specific observation tools; docking and machine execution remain outside this module. */
export function createCocoInspectors(root: HTMLElement, memoryMoved: () => void, browse: (address: number) => void) {
  const at = (name: string) => root.querySelector<HTMLElement>(`[data-${name}]`)!;
  type Update = (machine: Coco) => void;
  const updates: Record<string, Update[]> = { registers: [], sam: [], pias: [] };
  const resetters: (() => void)[] = [];
  function number(container: HTMLElement, name: string, panel: string, read: (machine: Coco) => string, flag = false) {
    const field = document.createElement("span"), label = document.createElement("span"), value = document.createElement("span");
    field.className = `lab-cpu-value${flag ? " lab-cpu-flag" : ""}`;
    label.className = "lab-cpu-label"; label.textContent = name;
    value.className = "lab-cpu-number"; field.append(label, value); container.append(field);
    let previous: string | undefined;
    resetters.push(() => { previous = undefined; });
    updates[panel]!.push(machine => {
      const current = read(machine), changed = previous !== undefined && current !== previous;
      field.classList.toggle("is-changed", changed); field.classList.toggle("is-set", flag && current === "1");
      field.title = `${name}: ${current}` + (changed ? ` (was ${previous})` : "");
      if (flag) field.setAttribute("aria-label", field.title);
      value.textContent = current; previous = current;
    });
  }
  for (const key of ["a", "b", "d", "x", "y", "dp", "s", "u", "pc"] as const) {
    number(at("coco-registers"), key.toUpperCase(), "registers", machine =>
      `$${cocoHex(machine.cpu.snapshot()[key], ["a", "b", "dp"].includes(key) ? 2 : 4)}`);
  }
  for (const key of ["e", "f", "h", "i", "n", "z", "v", "c"] as const) {
    number(at("coco-flags"), key.toUpperCase(), "registers", machine => String(+machine.cpu.snapshot().flags[key]), true);
  }
  for (const [label, read] of [
    ["Control", (m: Coco) => `$${cocoHex(m.sam.snapshot().control)}`],
    ["Screen", (m: Coco) => `$${cocoHex(m.sam.displayStart())}`],
    ["V", (m: Coco) => m.sam.videoMode().toString(2).padStart(3, "0")],
    ["M", (m: Coco) => m.sam.memoryMode().toString(2).padStart(2, "0")],
    ["R", (m: Coco) => m.sam.clockMode().toString(2).padStart(2, "0")],
    ["P1", (m: Coco) => String(+m.sam.page())],
    ["TY", (m: Coco) => String(+!m.sam.normalMap())],
    ["VDG pins", (m: Coco) => `$${cocoHex(m.pias.videoPins, 2)}`],
  ] as const) number(at("coco-sam"), label, "sam", read);

  type Pia = ReturnType<Coco["pias"]["snapshot"]>["pia0"];
  const piaFields: readonly (readonly [string, (pia: Pia) => string])[] = [
    ...(["ora", "orb", "ddra", "ddrb", "cra", "crb", "input_a", "input_b"] as const)
      .map(key => [key.replace("input_", "Input ").toUpperCase(), (pia: Pia) => cocoHex(pia[key], 2)] as const),
    ["CA1 / CB1", pia => `${+pia.ca1} / ${+pia.cb1}`],
    ["IRQ A1/A2", pia => `${+pia.irqa1} / ${+pia.irqa2}`],
    ["IRQ B1/B2", pia => `${+pia.irqb1} / ${+pia.irqb2}`],
  ];
  for (const [name, read] of piaFields) {
    const row = document.createElement("tr"), label = document.createElement("th"); label.scope = "row"; label.textContent = name; row.append(label);
    for (const key of ["pia0", "pia1"] as const) {
      const cell = document.createElement("td"); row.append(cell);
      number(cell, "", "pias", machine => read(machine.pias.snapshot()[key]));
    }
    at("coco-pias").append(row);
  }
  updates.pias!.push(machine => { at("coco-interrupts").textContent = `IRQ ${+machine.pias.irq} · FIRQ ${+machine.pias.firq}`; });
  const memory = createMemoryInspector(at("coco-memory"), "dromaios:inspectors:coco:memory", memoryMoved);
  const pointerViews = ([["direct-page", "dp"], ["stack-s", "s"], ["stack-u", "u"]] as const)
    .map(([id, register]) => ({ id, view: create6809MemoryView(at(`coco-${id}`), register, browse) }));
  return {
    memory,
    controls: (id: string): HTMLElement | undefined => id === "memory" ? memory.controls : pointerViews.find(tool => tool.id === id)?.view.controls,
    reset(): void { resetters.forEach(reset => reset()); memory.reset(); pointerViews.forEach(tool => tool.view.reset()); },
    refresh(machine: Coco, shouldUpdate: (id: string) => boolean): void {
      for (const [panel, methods] of Object.entries(updates)) if (shouldUpdate(panel)) methods.forEach(update => update(machine));
      if (shouldUpdate("memory")) memory.refresh(address => readCocoStorage(machine, address), machine.cpu.snapshot().pc);
      for (const { id, view } of pointerViews) if (shouldUpdate(id)) view.refresh(address => readCocoStorage(machine, address), machine.cpu.snapshot());
    },
  };
}
