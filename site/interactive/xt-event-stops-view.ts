import { createEventStopList } from "./event-stop-list.js";
import { decodeXtEventStops, describeXtEvent, xtEventStopKey, xtInterruptSources } from "./xt-event-stops.js";
import type { XtEventCondition, XtEventStop } from "./xt-event-stops.js";
import { dosReportsErrors, type DosServices } from "./xt-dos-services.js";
import { parseMemoryAddress } from "./memory-window.js";

/** Event preferences belong to the debugger, not the machine checkpoint or trace recorder. */
export function createXtEventStopsView(root: HTMLElement, options: {
  readonly values: () => readonly XtEventStop[];
  readonly set: (values: readonly XtEventStop[]) => void;
  readonly changed: () => void;
  readonly dos: DosServices;
}) {
  const at = <T extends HTMLElement>(name: string) => root.querySelector<T>(`[data-event-${name}]`)!;
  const form = at<HTMLFormElement>("form"), kind = at<HTMLSelectElement>("kind"), source = at<HTMLSelectElement>("source");
  const port = at<HTMLInputElement>("port"), value = at<HTMLInputElement>("value"), vector = at<HTMLInputElement>("vector");
  const address = at<HTMLInputElement>("address"), filename = at<HTMLInputElement>("dos-filename");
  const phase = at<HTMLSelectElement>("dos-phase"), service = at<HTMLSelectElement>("dos-service");
  const status = at("status");
  for (const name of xtInterruptSources) source.add(new Option(name.toUpperCase(), name));
  function services(): void {
    const selected = service.value;
    service.replaceChildren(new Option("Any described service", ""), ...options.dos.services.filter(entry =>
      phase.value === "call" || (phase.value === "error" ? dosReportsErrors(entry) : entry.result.kind !== "terminate"))
      .map(entry => new Option(`AH=${entry.function} · ${entry.name}`, entry.function)));
    service.value = [...service.options].some(option => option.value === selected) ? selected : "";
  }
  phase.onchange = services; services();
  const { add } = createEventStopList<XtEventCondition>(root, {
    ...options, storageKey: "dromaios:debugger:xt:events:1", key: xtEventStopKey, describe: describeXtEvent, decode: decodeXtEventStops,
  });
  function fields(): void {
    const isPort = kind.value === "input" || kind.value === "output";
    at("dma-fields").hidden = kind.value !== "dma"; address.disabled = kind.value !== "dma";
    at("port-fields").hidden = !isPort; port.disabled = value.disabled = !isPort;
    at("interrupt-fields").hidden = kind.value !== "interrupt"; source.disabled = vector.disabled = kind.value !== "interrupt";
    at("dos-fields").hidden = kind.value !== "dos"; phase.disabled = service.disabled = filename.disabled = kind.value !== "dos";
  }
  kind.onchange = fields;
  form.onsubmit = event => {
    event.preventDefault();
    try {
      if (kind.value === "iret") add({ kind: "iret" });
      else if (kind.value === "dos") add({ kind: "dos", phase: phase.value as "call" | "return" | "error",
        ...(service.value && { function: parseInt(service.value, 16) }), ...(filename.value && { filename: filename.value }) });
      else if (kind.value === "dma") add({ kind: "dma", ...(address.value.trim() && { address: parseMemoryAddress(address.value, 0xfffff) }) });
      else if (kind.value === "interrupt") add({ kind: "interrupt",
        ...(source.value && { source: xtInterruptSources.find(name => name === source.value)! }),
        ...(vector.value.trim() && { vector: parseMemoryAddress(vector.value, 0xff) }) });
      else add({ kind: kind.value as "input" | "output", port: parseMemoryAddress(port.value, 0xffff),
        ...(value.value.trim() && { value: parseMemoryAddress(value.value, 0xff) }) });
    } catch (cause) { status.textContent = (cause as Error).message; }
  };
  fields();
  return { add };
}
