/** Tab navigation belongs to the laboratory furniture, not to a particular machine. */
export function mountLaboratoryTabs(root: HTMLElement): void {
  for (const group of root.querySelectorAll<HTMLElement>("[data-lab-tabs]")) {
    const tabs = [...group.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    function select(selected: HTMLButtonElement): void {
      for (const tab of tabs) {
        const active = tab === selected;
        tab.setAttribute("aria-selected", String(active));
        tab.tabIndex = active ? 0 : -1;
        group.querySelector<HTMLElement>(`#${tab.getAttribute("aria-controls")}`)!.hidden = !active;
      }
    }
    for (const [index, tab] of tabs.entries()) {
      tab.addEventListener("click", () => select(tab));
      tab.addEventListener("keydown", event => {
        const next = event.key === "ArrowRight" ? (index + 1) % tabs.length
          : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length
          : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : undefined;
        if (next === undefined) return;
        event.preventDefault(); select(tabs[next]!); tabs[next]!.focus();
      });
    }
  }
}
