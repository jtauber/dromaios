import type { DosBuffer, DosCall, DosRequest, DosServices } from "./xt-dos-services.js";
import { dosFileRange, dosReportsErrors } from "./xt-dos-services.js";
import { logical8088, physical8088, xtHex as hex } from "./8088-disassembly.js";

function sampleText(bytes: readonly number[]): string {
  return '"' + bytes.map(byte => byte === 13 ? "\\r" : byte === 10 ? "\\n" : byte === 9 ? "\\t"
    : byte === 34 || byte === 92 ? "\\" + String.fromCharCode(byte)
    : byte >= 32 && byte < 127 ? String.fromCharCode(byte) : "\\x" + hex(byte, 2)).join("") + '"';
}
export const dosOffsetText = (offset: number) => `${hex(offset, 8)}h (${offset})`;
function seekLines(request: DosRequest): string[] {
  const value = (register: string) => request.arguments.find(arg => arg.register === register)!.value;
  const origin = value("AL"), raw = value("CX") * 0x10000 + value("DX");
  const distance = origin === 0 || raw < 0x80000000 ? raw : raw - 0x100000000;
  return origin > 2 ? [`Invalid seek origin ${origin}; DOS decides the error.`]
    : [`Seek from ${["beginning", "current position", "end"][origin]} by ${distance} bytes · CX:DX=${hex(raw, 8)}h.`,
      "The returned DX:AX supplies the new position; seeking beyond EOF does not extend the file."];
}
function bufferLines(value: DosBuffer): string[] {
  return [sampleText(value.bytes), ...(value.end === "complete" ? [] : [value.end === "limit"
    ? "Sample limited to 256 bytes; a string delimiter may be beyond the sample." : "Sample stopped at unavailable storage."])];
}
export function dosCallLines(request: DosRequest, catalogue: DosServices, observed?: DosCall): readonly string[] {
  const { service, buffer, returnTo } = request;
  const lines = [service.description, `Caller ${logical8088(request.caller.cs, request.caller.ip)}`,
    ...request.arguments.map(arg => `${arg.register}=${hex(arg.value, arg.register === "AL" ? 2 : 4)} · ${arg.label} (${arg.value})`)];
  if (service.handles) {
    lines.push(`${request.handle === undefined ? "Requested filename" : "Handle " + request.handle} · ${request.filename === undefined ? "filename unknown" : JSON.stringify(request.filename)}`);
    if (request.handle !== undefined) lines.push(`File position before call · ${request.file ? dosOffsetText(request.file.offset) : "unknown"}.`);
    if (service.handles.action === "seek") lines.push(...seekLines(request));
    if (request.targetHandle !== undefined) lines.push(`Target handle ${request.targetHandle}; its association changes only after a successful return.`);
  }
  if (buffer) {
    lines.push(`${service.buffer!.label} · DS:DX ${logical8088(buffer.segment, buffer.offset)} → physical $${hex(physical8088(buffer.segment, buffer.offset), 5)}`);
    if (buffer.length !== undefined) lines.push(`${buffer.length} bytes requested.`);
    if (service.buffer!.direction === "input") lines.push(...bufferLines(buffer));
  }
  lines.push(service.result.description);
  const result = observed?.result;
  if (!observed) lines.push("Preview only; the service has not run.");
  else if (observed.state === "no-return") lines.push("Termination requested; no return to this caller is expected. This is not confirmation of completion.");
  else if (observed.state === "untracked") lines.push("Return tracking was cleared by a process change or observation limit.");
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
      const range = dosFileRange(request, result);
      if (range) {
        lines.push(range.length ? `File bytes ${hex(range.offset, 8)}h–${hex(range.offset + range.length - 1, 8)}h · ${range.length} bytes.`
          : "No file bytes transferred.");
        if (requested === 0 && service.buffer!.direction === "input") lines.push("Zero-length write sets the file length to its current position.");
      } else lines.push("File byte range unknown; requires matching local file positions and a consistent returned count.");
      if (result.buffer) lines.push(...bufferLines(result.buffer));
    } else if (kind === "position") lines.push(`Returned position DX:AX=${hex(result.dx, 4)}:${hex(result.ax, 4)} · ${dosOffsetText(result.dx * 0x10000 + result.ax)}.`);
    else if (kind === "status") lines.push("Succeeded.");
    else if (kind === "exit-status") lines.push(`Termination method AH=${hex(result.ax >>> 8, 2)} · exit status AL=${hex(result.ax & 255, 2)} (${result.ax & 255}).`);
    if (result.file) lines.push(`File position after call · ${dosOffsetText(result.file.offset)}.`);
  }
  return lines;
}

