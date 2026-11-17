import { dosReportsErrors, type DosCall, type DosRequest, type DosServices, type createXtDosCalls } from "./xt-dos-services.js";
import type { XtDosCondition } from "./xt-event-stops.js";
import { dosCallLines } from "./xt-dos-explanation.js";
import { memoryAddressText } from "./memory-link.js";

export function createXtDosServicesView(panel: HTMLElement, catalogue: DosServices, calls: ReturnType<typeof createXtDosCalls>,
  browse: (address: number) => void, changed: () => void, addStop: (condition: XtDosCondition) => void) {
  const at = <T extends HTMLElement>(name: string) => panel.querySelector<T>(`[data-dos-${name}]`)!;
  const next = at("next"), choice = at<HTMLSelectElement>("call"), detail = at("detail");
  let selected: number | undefined, revision = -1;
  let previousHit: DosCall | undefined;
  function showObserved(): void {
    const call = selected === undefined ? calls.entries().at(-1) : calls.entries().find(call => call.id === selected);
    detail.replaceChildren(memoryAddressText(call ? `Observed DOS call · INT 21h/AH=${call.service.function} · ${call.service.name}\n`
      + dosCallLines(call, catalogue, call).join("\n") : "No observed DOS calls.", browse, 5));
    for (const phase of ["call", "return", "error"] as const) {
      const button = at<HTMLButtonElement>("stop-" + phase);
      button.disabled = !call || phase === "return" && call.service.result.kind === "terminate"
        || phase === "error" && !dosReportsErrors(call.service);
      button.onclick = () => { if (call) addStop({ kind: "dos", phase, function: parseInt(call.service.function, 16) }); };
    }
  }
  choice.onchange = () => { selected = choice.value ? Number(choice.value) : undefined; showObserved(); };
  at<HTMLButtonElement>("clear").onclick = () => { calls.reset(); selected = undefined; changed(); };
  return (request?: DosRequest, hit?: DosCall): void => {
    if (hit && hit !== previousHit) { selected = hit.id; revision = -1; }
    previousHit = hit;
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
