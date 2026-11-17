import type { DosBuffer, DosRequest, DosResult } from "./xt-dos-services.js";
import type { DosHandleTable } from "./xt-dos-handle-table.js";

/** Register roles belong to the chapter; these effects describe observed DOS conventions. */
export type DosHandleContract = { readonly action: "open" }
  | { readonly action: "use" | "close" | "duplicate"; readonly source: "BX" | 1 }
  | { readonly action: "redirect"; readonly source: "BX"; readonly target: "CX" };

export function completeDosFilename(buffer?: DosBuffer): string | undefined {
  if (!buffer || buffer.end !== "complete" || !buffer.bytes.length || buffer.bytes.some(byte => byte < 32 || byte > 126)) return undefined;
  return String.fromCharCode(...buffer.bytes);
}

/** Names belong to observed opens; a guarded job file table identifies their current aliases. */
export function createDosHandles(table: () => DosHandleTable | undefined) {
  const names = new Map<number, string>();
  let current: DosHandleTable | undefined;
  // Local SFT indices are below 80h. FFh is closed; network handles remain unidentified.
  const identity = (handle: number, snapshot = current) => snapshot ?
    (snapshot.entries[handle] !== undefined && snapshot.entries[handle]! < 0x80 ? snapshot.entries[handle] : undefined) : handle;
  function assign(handle: number, filename?: string): void {
    const key = identity(handle);
    if (key === undefined) return;
    if (filename === undefined) names.delete(key);
    else names.set(key, filename);
  }
  function filename(handle: number, snapshot: DosHandleTable | undefined): string | undefined {
    return snapshot?.scope === current?.scope ? names.get(identity(handle, snapshot) ?? -1) : undefined;
  }
  return {
    reset(): void { names.clear(); current = undefined; },
    /** Called at DOS boundaries, not on each CPU instruction or during a preview. */
    refresh(): boolean {
      const next = table(), changed = next?.scope !== current?.scope;
      if (changed) names.clear();
      current = next;
      if (next) {
        const present = new Set(next.entries);
        for (const key of names.keys()) if (!present.has(key)) names.delete(key);
      }
      return changed;
    },
    entries(): readonly { readonly handle: number; readonly filename: string }[] {
      const snapshot = table();
      const handles = snapshot ? snapshot.entries.map((_, index) => index) : [...names.keys()].sort((a, b) => a - b);
      return handles.flatMap(handle => {
        const name = filename(handle, snapshot);
        return name === undefined ? [] : [{ handle, filename: name }];
      });
    },
    capture(request: DosRequest): DosRequest {
      const contract = request.service.handles;
      if (!contract) return request;
      if (contract.action === "open") {
        const name = completeDosFilename(request.buffer);
        return { ...request, ...(name !== undefined && { filename: name }) };
      }
      const handle = contract.source === 1 ? 1 : request.arguments.find(arg => arg.register === contract.source)!.value;
      const name = filename(handle, table());
      const targetHandle = contract.action === "redirect" ? request.arguments.find(arg => arg.register === contract.target)!.value : undefined;
      return { ...request, handle, ...(name !== undefined && { filename: name }), ...(targetHandle !== undefined && { targetHandle }) };
    },
    returned(call: DosRequest, result: DosResult): void {
      const action = call.service.handles?.action;
      if (result.carry) return;
      if (action === "open" || action === "duplicate") assign(result.ax, call.filename);
      else if (action === "redirect") assign(call.targetHandle!, call.filename);
      // The table was refreshed after return: closing one alias must retain the other aliases.
      else if (action === "close" && !current) names.delete(call.handle!);
    },
  };
}
