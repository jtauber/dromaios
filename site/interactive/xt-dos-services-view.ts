import { dosReportsErrors, type DosCall, type DosRequest, type DosServices, type createXtDosCalls } from "./xt-dos-services.js";
import type { XtDosCondition } from "./xt-event-stops.js";
import { dosCallLines, dosOffsetText } from "./xt-dos-explanation.js";
import { memoryAddressText } from "./memory-link.js";
import type { createXtDosFileLinks, DosFileLink } from "./xt-dos-file-links.js";

export function createXtDosServicesView(panel: HTMLElement, catalogue: DosServices, calls: ReturnType<typeof createXtDosCalls>,
  browse: (address: number) => void, changed: () => void, addStop: (condition: XtDosCondition) => void,
  fileLinks: ReturnType<typeof createXtDosFileLinks>, browseFile: (link: DosFileLink) => void) {
  const at = <T extends HTMLElement>(name: string) => panel.querySelector<T>(`[data-dos-${name}]`)!;
  const next = at("next"), choice = at<HTMLSelectElement>("call"), detail = at("detail");
  const filenameOnly = at<HTMLInputElement>("filename-only");
  let selected: number | undefined, revision = -1;
  let previousHit: DosCall | undefined;
  function showObserved(): void {
    const call = selected === undefined ? calls.entries().at(-1) : calls.entries().find(call => call.id === selected);
    const link = call && fileLinks.get(call), files = at<HTMLButtonElement>("files");
    files.disabled = !link; files.onclick = () => { if (link) browseFile(link); };
    detail.replaceChildren(memoryAddressText(call ? `Observed DOS call · INT 21h/AH=${call.service.function} · ${call.service.name}\n`
      + dosCallLines(call, catalogue, call).join("\n") : "No observed DOS calls.", browse, 5));
    filenameOnly.disabled = call?.filename === undefined;
    at("filename-scope").textContent = call?.filename === undefined ? "Only this filename (unknown)" : `Only ${JSON.stringify(call.filename)}`;
    for (const phase of ["call", "return", "error"] as const) {
      const button = at<HTMLButtonElement>("stop-" + phase);
      button.disabled = !call || phase === "return" && call.service.result.kind === "terminate"
        || phase === "error" && !dosReportsErrors(call.service);
      button.onclick = () => { if (call) addStop({ kind: "dos", phase, function: parseInt(call.service.function, 16),
        ...(filenameOnly.checked && call.filename !== undefined && { filename: call.filename }) }); };
    }
  }
  choice.onchange = () => { selected = choice.value ? Number(choice.value) : undefined; showObserved(); };
  at<HTMLButtonElement>("clear").onclick = () => { calls.reset(); selected = undefined; changed(); };
  return (request?: DosRequest, hit?: DosCall): void => {
    if (hit && hit !== previousHit) { selected = hit.id; revision = -1; }
    previousHit = hit;
    at("handles").textContent = "Known handles · " + (calls.handles().map(entry => `${entry.handle} → ${JSON.stringify(entry.filename)}${entry.position === undefined ? "" : " @ " + dosOffsetText(entry.position)}`).join(" · ") || "none observed");
    next.hidden = !request;
    next.replaceChildren(...(request ? [memoryAddressText(`Next DOS call · INT 21h/AH=${request.service.function} · ${request.service.name}\n`
      + dosCallLines(request, catalogue).join("\n"), browse, 5)] : []));
    if (revision !== calls.revision) {
      revision = calls.revision;
      const entries = calls.entries();
      if (!entries.some(call => call.id === selected)) selected = undefined;
      choice.replaceChildren(new Option("Latest observed call", ""), ...[...entries].reverse().map(call => new Option(
        `#${call.id} · AH=${call.service.function} ${call.service.name}${call.filename === undefined ? "" : " · " + call.filename} · ${call.state === "no-return" ? "no return expected" : call.state}`, String(call.id))));
      choice.value = selected === undefined ? "" : String(selected); choice.disabled = !entries.length;
      showObserved();
    }
  };
}
