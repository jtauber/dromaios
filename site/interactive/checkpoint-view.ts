/** The Session panel manages named saves. The laboratory owns the running machine. */
export function createCheckpointView<State>(panel: HTMLElement, store: {
  names(): string[];
  save(name: string, state: State): Promise<void>;
  restore(name: string): Promise<State>;
  remove(name: string): void;
}, actions: {
  comparison?: { show(name: string, saved: State): void; clear(): void };
  capture(): State;
  restore(state: State): void;
  refresh(): void;
}) {
  const find = <T extends HTMLElement>(name: string) => panel.querySelector<T>(`[data-${name}]`)!;
  const form = find<HTMLFormElement>("checkpoint-form"), name = find<HTMLInputElement>("checkpoint-name");
  const choice = find<HTMLSelectElement>("checkpoint-choice"), status = find("saved");
  const save = find<HTMLButtonElement>("save"), restore = find<HTMLButtonElement>("restore"), remove = find<HTMLButtonElement>("remove");
  const compare = panel.querySelector<HTMLButtonElement>("[data-checkpoint-compare]");
  let busy = false;

  function list(selected = choice.value): void {
    const names = store.names(), previous = choice.value;
    choice.replaceChildren(...names.map(name => new Option(name, name)));
    if (!names.length) choice.add(new Option("No saved checkpoints", ""));
    else if (names.includes(selected)) choice.value = selected;
    if (choice.value !== previous) actions.comparison?.clear();
  }

  async function action(verb: string, perform: () => Promise<string>): Promise<void> {
    if (busy) return;
    actions.comparison?.clear();
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
      return `Restored “${label}”. Execution is paused.`;
    });
  };
  const comparison = actions.comparison;
  if (compare && comparison) {
    compare.onclick = () => {
      const label = choice.value;
      void action("Comparing", async () => {
        const state = await store.restore(label);
        if (label !== choice.value) return "The checkpoint selection changed.";
        comparison.show(label, state);
        return "";
      });
    };
    choice.onchange = () => { comparison.clear(); status.textContent = ""; };
  }
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
      if (compare) compare.disabled = restore.disabled;
      remove.disabled = !allowDelete || choice.disabled;
    },
  };
}
