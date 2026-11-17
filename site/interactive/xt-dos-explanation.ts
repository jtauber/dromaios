import type { DosBuffer, DosCall, DosRequest, DosServices } from "./xt-dos-services.js";
import { dosReportsErrors } from "./xt-dos-services.js";
import { logical8088, physical8088, xtHex as hex } from "./8088-disassembly.js";

function sampleText(bytes: readonly number[]): string {
  return '"' + bytes.map(byte => byte === 13 ? "\\r" : byte === 10 ? "\\n" : byte === 9 ? "\\t"
    : byte === 34 || byte === 92 ? "\\" + String.fromCharCode(byte)
    : byte >= 32 && byte < 127 ? String.fromCharCode(byte) : "\\x" + hex(byte, 2)).join("") + '"';
}
function bufferLines(value: DosBuffer): string[] {
  return [sampleText(value.bytes), ...(value.end === "complete" ? [] : [value.end === "limit"
    ? "Sample limited to 256 bytes; a string delimiter may be beyond the sample." : "Sample stopped at unavailable storage."])];
}
export function dosCallLines(request: DosRequest, catalogue: DosServices, observed?: DosCall): readonly string[] {
  const { service, buffer, returnTo } = request;
  const lines = [service.description, `Caller ${logical8088(request.caller.cs, request.caller.ip)}`,
    ...request.arguments.map(arg => `${arg.register}=${hex(arg.value, arg.register === "AL" ? 2 : 4)} · ${arg.label} (${arg.value})`)];
  if (buffer) {
    lines.push(`${service.buffer!.label} · DS:DX ${logical8088(buffer.segment, buffer.offset)} → physical $${hex(physical8088(buffer.segment, buffer.offset), 5)}`);
    if (buffer.length !== undefined) lines.push(`${buffer.length} bytes requested.`);
    if (service.buffer!.direction === "input") lines.push(...bufferLines(buffer));
  }
  lines.push(service.result.description);
  const result = observed?.result;
  if (!observed) lines.push("Preview only; the service has not run.");
  else if (observed.state === "no-return") lines.push("Termination requested; no return to this caller is expected. This is not confirmation of completion.");
  else if (observed.state === "untracked") lines.push("No return observed before termination or the pending-call limit cleared tracking.");
  else if (!result) lines.push(`Awaiting return to ${logical8088(returnTo.cs, returnTo.ip)} with SS:SP ${logical8088(returnTo.ss, returnTo.sp)}.`);
  else {
    lines.push(`Observed return to ${logical8088(returnTo.cs, returnTo.ip)} · AX=${hex(result.ax, 4)} · CF=${+result.carry}.`);
    const kind = service.result.kind;
    if (dosReportsErrors(service) && result.carry) {
      lines.push(`Error ${hex(result.ax, 4)} · ${catalogue.errors[hex(result.ax, 4)] ?? "Unlisted DOS error"}. No successful buffer result is claimed.`);
    } else if (kind === "handle") lines.push(`Handle ${result.ax} (${hex(result.ax, 4)}).`);
    else if (kind === "count") {
      const requested = buffer!.length!;
      lines.push(`${result.ax} of ${requested} requested bytes ${service.buffer!.direction === "output" ? "read" : "written"}.`);
      if (result.ax > requested) lines.push("AX exceeds requested CX; the captured sample is capped to CX.");
      if (result.buffer) lines.push(...bufferLines(result.buffer));
    } else if (kind === "status") lines.push("Succeeded.");
    else if (kind === "exit-status") lines.push(`Termination method AH=${hex(result.ax >>> 8, 2)} · exit status AL=${hex(result.ax & 255, 2)} (${result.ax & 255}).`);
  }
  return lines;
}

