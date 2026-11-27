import { xtSavedCheckpoints } from "./xt-checkpoint-storage.js";
import type { XtSessionState } from "./xt-session.js";

/** The Session panel manages named saves. The laboratory owns the running machine. */
export function createXtCheckpointView(panel: HTMLElement, ega: boolean, actions: {
  capture(): XtSessionState;
  restore(state: XtSessionState): void;
  refresh(): void;
}) {
  const find = <T extends HTMLElement>(name: string) => panel.querySelector<T>(`[data-${name}]`)!;
  const form = find<HTMLFormElement>("checkpoint-form"), name = find<HTMLInputElement>("checkpoint-name");
  const choice = find<HTMLSelectElement>("checkpoint-choice"), status = find("saved");
  const save = find<HTMLButtonElement>("save"), restore = find<HTMLButtonElement>("restore"), remove = find<HTMLButtonElement>("remove");
  const store = xtSavedCheckpoints(() => localStorage, ega);
  let busy = false;

  function list(selected = choice.value): void {
    const names = store.names();
    choice.replaceChildren(...names.map(name => new Option(name, name)));
    if (!names.length) choice.add(new Option("No saved checkpoints", ""));
    else if (names.includes(selected)) choice.value = selected;
  }

  async function action(verb: string, perform: () => Promise<string>): Promise<void> {
    if (busy) return;
    busy = true; status.textContent = verb + "…"; actions.refresh();
    try { status.textContent = await perform(); }
    catch (cause) { status.textContent = cause instanceof Error ? cause.message : String(cause); }
    finally { busy = false; actions.refresh(); }
  }

  form.onsubmit = event => {
    event.preventDefault();
    if (save.disabled) return;
    const label = name.value.trim();
    void action("Saving", async () => {
      await store.save(label, actions.capture()); list(label); name.value = "";
      return `Saved “${label}” in this browser.`;
    });
  };
  restore.onclick = () => {
    const label = choice.value;
    void action("Restoring", async () => {
      actions.restore(await store.restore(label));
      return `Restored “${label}”. The XT is paused.`;
    });
  };
  remove.onclick = () => {
    const label = choice.value;
    void action("Deleting", async () => {
      store.remove(label); list();
      return `Deleted “${label}”.`;
    });
  };

  function readList(): void {
    try { list(); }
    catch { status.textContent = "Browser checkpoint storage is unavailable."; }
  }
  window.addEventListener("storage", event => {
    if (event.storageArea === localStorage) { readList(); actions.refresh(); }
  });
  readList();
  name.oninput = () => { save.disabled = name.disabled || !name.value.trim(); };
  return {
    get busy() { return busy; },
    refresh(paused: boolean, allowDelete: boolean): void {
      name.disabled = !paused || busy;
      save.disabled = name.disabled || !name.value.trim();
      choice.disabled = busy || !choice.value;
      restore.disabled = !paused || choice.disabled;
      remove.disabled = !allowDelete || choice.disabled;
    },
  };
}
