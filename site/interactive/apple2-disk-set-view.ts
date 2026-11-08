import type { Dos33Disk } from "../../src/components/devices/dos33-disk.js";
import { Apple2DiskSet } from "./apple2-disk-set.js";
import type { Apple2DiskEntry } from "./apple2-disk-set.js";

/** Selection and controls for retained media; the page coordinates changes to the machine. */
export function createApple2DiskSetView(root: HTMLElement, actions: {
  insert(entry: Apple2DiskEntry): void;
  copy(entry: Apple2DiskEntry): void;
  export(entry: Apple2DiskEntry): void;
  remove(entry: Apple2DiskEntry): void;
}) {
  const panel = root.querySelector<HTMLElement>("[data-disk-set]");
  if (!panel) return undefined;
  const element = <T extends HTMLElement>(name: string) => panel.querySelector<T>(`[data-disk-set-${name}]`)!;
  const choice = element<HTMLSelectElement>("choice"), add = element<HTMLButtonElement>("add");
  const file = element<HTMLInputElement>("file");
  const insert = element<HTMLButtonElement>("insert"), copy = element<HTMLButtonElement>("copy");
  const exportDisk = element<HTMLButtonElement>("export"), remove = element<HTMLButtonElement>("remove");
  let selected: Dos33Disk | undefined;
  let previous: readonly Apple2DiskEntry[] | undefined, previousMounted: Dos33Disk | null = null;
  let state: { set: Apple2DiskSet; mounted: Dos33Disk | null; selecting: boolean; canInsert: boolean; motor: boolean };
  function controls(): void {
    const entry = state.set.entries.find(entry => entry.disk === selected), inDrive = entry?.disk === state.mounted;
    choice.disabled = state.selecting || !state.set.entries.length;
    add.disabled = file.disabled = state.selecting || state.set.entries.length === Apple2DiskSet.limit;
    insert.disabled = state.selecting || !state.canInsert || !entry;
    copy.disabled = exportDisk.disabled = state.selecting || !entry || inDrive && state.motor;
    remove.disabled = state.selecting || !entry || inDrive;
  }
  add.addEventListener("click", () => file.click());
  choice.addEventListener("change", () => { selected = state.set.entries[Number(choice.value)]?.disk; controls(); });
  for (const [button, perform] of [[insert, actions.insert], [copy, actions.copy], [exportDisk, actions.export], [remove, actions.remove]] as const) {
    button.addEventListener("click", () => {
      const entry = state.set.entries.find(entry => entry.disk === selected);
      if (entry && !button.disabled) perform(entry);
    });
  }
  return {
    file,
    select(disk: Dos33Disk): void { selected = disk; },
    refresh(next: typeof state): void {
      state = next;
      const entries = state.set.entries;
      if (!entries.some(entry => entry.disk === selected)) selected = state.mounted ?? entries[0]?.disk;
      if (entries !== previous || state.mounted !== previousMounted) {
        choice.replaceChildren(...entries.map(({ name, disk }, index) => new Option(
          `${index + 1}. ${name} · ${disk.writable ? "writable" : "read-only"}${disk === state.mounted ? " · in drive" : ""}`, String(index))));
        element("count").textContent = `${entries.length}/${Apple2DiskSet.limit}`;
        previous = entries; previousMounted = state.mounted;
      }
      choice.value = String(entries.findIndex(entry => entry.disk === selected));
      controls();
    },
  };
}
