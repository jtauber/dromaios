import { apple2SavedStates } from "./apple2-saved-state.js";
import type { Apple2SavedState } from "./apple2-saved-state.js";
import type { Apple2SessionState } from "./apple2-session.js";
import { compareApple2States } from "./apple2-state-comparison.js";
import { apple2RamRegions } from "./apple2-inspection.js";
import type { Apple2MemoryChange } from "./apple2-inspection.js";
import { hex } from "./apple2-explorer.js";

/** Named browser states and explicit, paused comparisons; no execution or device access belongs here. */
export function createApple2SavedStateView(root: HTMLElement, actions: {
  capture(): Pick<Apple2SavedState, "state" | "diskName" | "flash">;
  restore(saved: Apple2SavedState): Promise<void>;
  compare(saved: Apple2SavedState): Promise<{ saved: Apple2SessionState; current: Apple2SessionState }>;
  memory(change: Apple2MemoryChange): string | undefined;
  registers(): void;
}) {
  const panel = root.querySelector<HTMLElement>("[data-saved-states]");
  if (!panel) return undefined;
  const element = <T extends HTMLElement>(name: string) => panel.querySelector<T>(`[data-state-${name}]`)!;
  const form = element<HTMLFormElement>("form"), name = element<HTMLInputElement>("name");
  const choice = element<HTMLSelectElement>("choice"), save = element<HTMLButtonElement>("save");
  const restore = element<HTMLButtonElement>("restore"), compare = element<HTMLButtonElement>("compare");
  const remove = element<HTMLButtonElement>("delete"), more = element<HTMLButtonElement>("more");
  const status = element("status"), summary = element("summary"), output = element("differences"), details = element("details");
  const store = apple2SavedStates(() => window.localStorage);
  let available = false, busy = false, identity: object | undefined;
  let comparison: ReturnType<typeof compareApple2States> | undefined, shown = 0;
  function controls(): void {
    save.disabled = name.disabled = !available || busy;
    restore.disabled = compare.disabled = !available || busy || !choice.value;
    choice.disabled = remove.disabled = busy || !choice.value;
    more.disabled = busy || !available;
  }
  function invalidate(): void { comparison = undefined; output.replaceChildren(); summary.textContent = ""; more.hidden = true; }
  function describe(): void {
    details.textContent = "";
    if (choice.value) {
      try {
        const saved = store.read(choice.value);
        details.textContent = `Saved ${new Date(saved.savedAt).toLocaleString()} · ${saved.diskName ?? "no disk"}`;
      } catch (cause) { details.textContent = cause instanceof Error ? cause.message : String(cause); }
    }
  }
  function list(selected = choice.value): void {
    const names = store.names();
    choice.replaceChildren(...names.map(name => new Option(name, name)));
    if (names.includes(selected)) choice.value = selected;
    describe(); controls();
  }
  async function action(perform: () => void | Promise<void>): Promise<void> {
    if (busy) return;
    busy = true; controls(); status.textContent = "";
    try { await perform(); }
    catch (cause) { status.textContent = cause instanceof Error ? cause.message : String(cause); }
    finally { busy = false; controls(); }
  }
  form.addEventListener("submit", event => {
    event.preventDefault();
    if (!available) return;
    void action(() => {
      const saved: Apple2SavedState = { version: 1, machine: "apple2-plus", name: name.value.trim(),
        savedAt: new Date().toISOString(), ...actions.capture() };
      store.save(saved); list(saved.name); invalidate(); name.value = "";
      status.textContent = `Saved “${saved.name}” in this browser.`;
    });
  });
  choice.addEventListener("change", () => { invalidate(); describe(); status.textContent = ""; controls(); });
  restore.addEventListener("click", () => {
    if (!available) return;
    void action(async () => {
      const saved = store.read(choice.value);
      await actions.restore(saved); invalidate();
      status.textContent = `Restored “${saved.name}”, paused. Execution histories cleared; layout and stop preferences retained.`;
    });
  });
  remove.addEventListener("click", () => void action(() => {
    const selected = choice.value; store.remove(selected); list(); invalidate();
    status.textContent = `Deleted “${selected}”. The current machine is unchanged.`;
  }));
  function appendMemory(): void {
    if (!comparison) return;
    const end = Math.min(shown + 128, comparison.memory.length);
    for (const change of comparison.memory.slice(shown, end)) {
      const row = document.createElement("div"), link = document.createElement("button");
      link.type = "button"; link.className = "lab-memory-link";
      link.textContent = `${apple2RamRegions.find(region => region.part === change.region)!.label} $${hex(change.address)}`;
      link.title = "View in Memory if this physical bank is currently mapped";
      link.addEventListener("click", () => { status.textContent = actions.memory(change) ?? ""; });
      row.append(link, `  ${hex(change.before, 2)} → ${hex(change.after, 2)}`); output.append(row);
    }
    shown = end; more.hidden = shown === comparison.memory.length;
    more.textContent = `Show more (${shown.toLocaleString()} / ${comparison.memory.length.toLocaleString()} bytes)`;
  }
  compare.addEventListener("click", () => {
    if (!available) return;
    void action(async () => {
      const saved = store.read(choice.value), samples = await actions.compare(saved);
      invalidate(); comparison = compareApple2States(samples.saved, samples.current); shown = 0;
      const { registers, flags, memory, devices, inputChanged } = comparison;
      const counts = ([[registers.length, "register"], [flags.length, "flag"], [memory.length, "RAM byte"], [devices.length, "device field"]] as const)
        .map(([count, label]) => `${count.toLocaleString()} ${label}${count === 1 ? "" : "s"}`).join(", ");
      summary.textContent = `“${saved.name}” → captured current: ${counts}${inputChanged ? ", keyboard queue changed" : ""}.`;
      for (const field of [...registers, ...flags]) {
        const row = document.createElement("div"), button = document.createElement("button");
        button.type = "button"; button.className = "lab-memory-link"; button.textContent = field.name;
        button.title = "Show MOS 6502"; button.addEventListener("click", actions.registers);
        row.append(button, `  ${hex(field.before, field.width)} → ${hex(field.after, field.width)}`); output.append(row);
      }
      for (const field of devices) {
        const row = document.createElement("div"); row.textContent = `${field.name}  ${field.before} → ${field.after}`; output.append(row);
      }
      if (inputChanged) {
        const row = document.createElement("details"), heading = document.createElement("summary"), queue = document.createElement("pre");
        heading.textContent = `Queued input: ${samples.saved.input.length} → ${samples.current.input.length} characters`;
        queue.textContent = [samples.saved.input, samples.current.input].map(bytes => bytes.map(byte => hex(byte, 2)).join(" ") || "empty").join("\n→\n");
        row.append(heading, queue); output.append(row);
      }
      appendMemory(); status.textContent = "Comparison captured. Compare again after stepping to update it.";
    });
  });
  more.addEventListener("click", appendMemory);
  window.addEventListener("storage", () => {
    if (busy) return;
    try { list(); invalidate(); } catch { status.textContent = "Saved states could not be read from browser storage."; }
  });
  try { list(); } catch { status.textContent = "Saved states could not be read from browser storage."; }
  return {
    refresh(machine: object, paused: boolean): void {
      if (identity !== machine) { identity = machine; invalidate(); }
      available = paused; controls();
    },
  };
}
