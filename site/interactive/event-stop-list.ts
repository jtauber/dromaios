/** History actions and event forms edit the same browser-owned debugger preferences. */
export function createEventStopList<Condition extends object>(root: HTMLElement, options: {
  readonly storageKey: string;
  readonly key: (condition: Condition) => string;
  readonly describe: (condition: Condition) => string;
  readonly values: () => readonly (Condition & { readonly enabled: boolean })[];
  readonly set: (points: readonly (Condition & { readonly enabled: boolean })[]) => void;
  readonly decode: (saved: string | null) => readonly (Condition & { readonly enabled: boolean })[];
  readonly changed?: () => void;
}) {
  const count = root.querySelector<HTMLElement>("[data-event-count]")!;
  const status = root.querySelector<HTMLElement>("[data-event-status]")!;
  const output = root.querySelector<HTMLElement>("[data-event-rows]")!;
  try { options.set(options.decode(localStorage.getItem(options.storageKey))); }
  catch { status.textContent = "Browser storage is unavailable; these stops work for this visit."; }
  function render(): void {
    output.replaceChildren();
    const points = options.values();
    count.textContent = ` (${points.filter(point => point.enabled).length}/${points.length})`;
    for (const point of points) {
      const row = document.createElement("div"), label = document.createElement("label"), enabled = document.createElement("input"), remove = document.createElement("button");
      const name = options.describe(point);
      row.className = "lab-breakpoint-row"; enabled.type = "checkbox"; enabled.checked = point.enabled;
      enabled.setAttribute("aria-label", `Enable event stop ${name}`);
      enabled.onchange = () => save(points.map(item => item === point ? { ...point, enabled: enabled.checked } : item));
      label.append(enabled, name); remove.type = "button"; remove.textContent = "×";
      remove.setAttribute("aria-label", `Remove event stop ${name}`);
      remove.onclick = () => save(points.filter(item => item !== point));
      row.append(label, remove); output.append(row);
    }
    if (!points.length) output.textContent = "No event stops.";
  }
  function save(points: readonly (Condition & { readonly enabled: boolean })[]): void {
    options.set(points);
    try { localStorage.setItem(options.storageKey, JSON.stringify(options.values())); status.textContent = ""; }
    catch { status.textContent = "These stops work for this visit, but could not be saved."; }
    render(); options.changed?.();
  }
  function add(condition: Condition): void {
    const points = options.values(), existing = points.find(point => options.key(point) === options.key(condition));
    save(existing ? points.map(point => point === existing ? { ...point, enabled: true } : point)
      : [...points, { ...condition, enabled: true }]);
  }
  render();
  return { add };
}
