import type { Ram } from "../../src/components/memory/ram.js";
import type { ExternalRom } from "../../src/machines/rom-image.js";
import { applesoftSourceAt } from "./apple2-applesoft.js";
import type { ApplesoftListing, ApplesoftSourcePosition } from "./apple2-applesoft.js";

type Memory = Pick<Ram, "read" | "size">;
interface SavedPosition {
  readonly line: number;
  readonly pointer: number;
  readonly source?: ApplesoftSourcePosition;
}
interface ErrorState {
  readonly enabled: boolean;
  readonly handler: SavedPosition & { readonly target?: number; readonly destination?: ApplesoftSourcePosition };
  readonly saved?: SavedPosition & { readonly code: number; readonly stack: number };
}

/** Error codes are byte offsets into the ROM's message table, not sequential ordinals. */
export function applesoftErrorName(firmware: Pick<ExternalRom, "read">, code: number): string | undefined {
  const start = 0x0260 + code;
  if (start < 0x0260 || start >= 0x0350) return;
  if (code !== 0) {
    const previous = firmware.read(start - 1);
    if (previous === "bus-error" || !(previous & 0x80)) return;
  }
  let text = "";
  for (let at = start; at < 0x0350; at++) {
    const byte = firmware.read(at);
    if (byte === "bus-error") return;
    text += String.fromCharCode(byte & 0x7f);
    if (byte & 0x80) return text;
  }
  return;
}

/** ERRPOS precedes a line header or the statement after a colon; it is not the faulting token. */
function restartSource(ram: Memory, listing: ApplesoftListing, line: number, pointer: number): ApplesoftSourcePosition | undefined {
  const index = listing.lines.findIndex(item => item.number === line), stored = listing.lines[index];
  if (!stored || pointer >= ram.size) return;
  const start = index === 0 ? (ram.read(0x67) | ram.read(0x68) << 8) - 1 : listing.lines[index - 1]!.terminator;
  if (pointer === start) return { line, index: 0, statement: stored.statements[0]! };
  if (ram.read(pointer) !== 0x3a) return;
  let address = pointer + 1;
  while (address < stored.terminator && ram.read(address) === 0x20) address++;
  const slot = stored.statements.findIndex(statement => statement.colonBefore && statement.address === address);
  if (slot >= 0) return { line, index: slot, statement: stored.statements[slot]! };
  return;
}

/** Sample saved RAM state. The ROM retains error bytes after RESUME and does not mark their age. */
export function applesoftErrorState(ram: Memory, listing: ApplesoftListing): ErrorState {
  const word = (at: number) => ram.read(at) | ram.read(at + 1) << 8;
  const enabled = !!(ram.read(0xd8) & 0x80), pointer = word(0xf4), line = word(0xf6);
  const source = enabled && !listing.message ? applesoftSourceAt(listing, line, pointer) : undefined;
  const parts = source?.statement.parts.filter(part => part.tokenAddress !== undefined || part.text.trim());
  const [onerr, go, number] = parts ?? [];
  // TXTPSV points immediately after GOTO. Keep unrecognized or edited source as raw state.
  const installed = onerr?.text === "ONERR" && onerr.tokenAddress === source?.statement.address
    && go?.text === "GOTO" && go.tokenAddress === pointer - 1;
  const target = installed && parts?.length === 3 && number && number.tokenAddress === undefined && /^\s*\d+\s*$/.test(number.text)
    && Number(number.text) < 64000 ? Number(number.text) : undefined;
  const destination = target === undefined ? undefined : listing.lines.find(item => item.number === target)?.statements[0];
  const savedLine = word(0xda), savedPointer = word(0xdc), code = ram.read(0xde), stack = ram.read(0xdf);
  return {
    enabled,
    handler: { line, pointer, source: installed ? source : undefined, target,
      destination: destination && { line: target!, index: 0, statement: destination } },
    saved: savedLine || savedPointer || code || stack ? { line: savedLine, pointer: savedPointer, code, stack,
      source: enabled && !listing.message ? restartSource(ram, listing, savedLine, savedPointer) : undefined } : undefined,
  };
}
