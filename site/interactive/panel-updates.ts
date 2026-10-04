/** Inspector refresh preferences. The docking workspace only hosts the returned controls. */
export function createPanelUpdates(root: HTMLElement, refresh: (id: string) => void) {
  const panels = [...root.querySelectorAll<HTMLElement>("[data-panel-live]")];
  const live = new Map(panels.map(panel => [panel.dataset.workspacePanel!, panel.dataset.panelLive === "true"]));
  const controls = new Map<string, HTMLButtonElement>();
  const storageKey = "dromaios:inspectors:apple2:live";
  try {
    const saved: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? "null");
    if (saved && typeof saved === "object") {
      for (const [id, value] of Object.entries(saved)) if (live.has(id) && typeof value === "boolean") live.set(id, value);
    }
  } catch { /* Defaults work when storage is unavailable or malformed. */ }
  for (const panel of panels) {
    const id = panel.dataset.workspacePanel!, button = document.createElement("button");
    button.type = "button"; button.className = "lab-live-toggle";
    button.setAttribute("aria-label", `Live updates for ${panel.dataset.panelTitle}`);
    function label(): void {
      button.setAttribute("aria-pressed", String(live.get(id)));
      button.title = `Live updates ${live.get(id) ? "on" : "off"}. Pause and Step always refresh this inspector.`;
    }
    button.addEventListener("click", () => {
      live.set(id, !live.get(id)); label(); refresh(id);
      try { window.localStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(live))); }
      catch { /* The preference still lasts for this visit. */ }
    });
    label(); controls.set(id, button);
  }
  return {
    controls: (id: string): HTMLElement | undefined => controls.get(id),
    shouldUpdate: (id: string, running: boolean): boolean => !running || live.get(id) !== false,
  };
}
