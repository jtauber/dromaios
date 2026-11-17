import type { DosRequest, DosServices, createXtDosCalls } from "./xt-dos-services.js";
import { dosCallLines } from "./xt-dos-explanation.js";
import { memoryAddressText } from "./memory-link.js";

export function createXtDosServicesView(panel: HTMLElement, catalogue: DosServices, calls: ReturnType<typeof createXtDosCalls>,
  browse: (address: number) => void, changed: () => void) {
  const at = <T extends HTMLElement>(name: string) => panel.querySelector<T>(`[data-dos-${name}]`)!;
  const next = at("next"), choice = at<HTMLSelectElement>("call"), detail = at("detail");
  let selected: number | undefined, revision = -1;
  function showObserved(): void {
    const call = selected === undefined ? calls.entries().at(-1) : calls.entries().find(call => call.id === selected);
    detail.replaceChildren(memoryAddressText(call ? `Observed DOS call · INT 21h/AH=${call.service.function} · ${call.service.name}\n`
      + dosCallLines(call, catalogue, call).join("\n") : "No observed DOS calls.", browse, 5));
  }
  choice.onchange = () => { selected = choice.value ? Number(choice.value) : undefined; showObserved(); };
  at<HTMLButtonElement>("clear").onclick = () => { calls.reset(); selected = undefined; changed(); };
  return (request?: DosRequest): void => {
    next.hidden = !request;
    next.replaceChildren(...(request ? [memoryAddressText(`Next DOS call · INT 21h/AH=${request.service.function} · ${request.service.name}\n`
      + dosCallLines(request, catalogue).join("\n"), browse, 5)] : []));
    if (revision !== calls.revision) {
      revision = calls.revision;
      const entries = calls.entries();
      if (!entries.some(call => call.id === selected)) selected = undefined;
      choice.replaceChildren(new Option("Latest observed call", ""), ...[...entries].reverse().map(call => new Option(
        `#${call.id} · AH=${call.service.function} ${call.service.name} · ${call.state === "no-return" ? "no return expected" : call.state}`, String(call.id))));
      choice.value = selected === undefined ? "" : String(selected); choice.disabled = !entries.length;
      showObserved();
    }
  };
}
