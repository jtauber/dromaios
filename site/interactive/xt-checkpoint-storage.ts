import { decodeXtCheckpoint, encodeXtCheckpoint, xtCheckpointKey } from "./xt-checkpoint.js";
import type { XtSessionState } from "./xt-session.js";
import { namedStateStorage, type StateStorage } from "./named-state-storage.js";

export function xtSavedCheckpoints(storage: () => StateStorage, ega: boolean) {
  const key = ega ? xtCheckpointKey + ":ega" : xtCheckpointKey;
  const entries = namedStateStorage(storage, key + ":named:", { key, name: "Previous checkpoint" });
  return {
    names: entries.names,
    remove: entries.remove,
    async restore(name: string): Promise<XtSessionState> {
      return decodeStoredXtCheckpoint(entries.read(name), ega);
    },
    async save(name: string, state: XtSessionState): Promise<void> {
      const text = await encodeStoredXtCheckpoint(state);
      const write = () => entries.save(name, text);
      // Two open laboratories can finish compressing a save with the same name together.
      if (globalThis.navigator?.locks) await navigator.locks.request(key, write);
      else write();
    },
  };
}

const prefix = "gzip:", maximum = 2_000_000;

/** Compress the existing portable checkpoint; media and machine validation still belong to its codec. */
export async function encodeStoredXtCheckpoint(state: XtSessionState): Promise<string> {
  const stream = new Blob([encodeXtCheckpoint(state)]).stream().pipeThrough(new CompressionStream("gzip"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return prefix + btoa(binary);
}

/** Older plain JSON saves remain readable. Bound decompression before accepting browser-owned data. */
export async function decodeStoredXtCheckpoint(text: string, ega = false): Promise<XtSessionState> {
  if (!text.startsWith(prefix)) return decodeXtCheckpoint(text, ega);
  if (text.length > maximum) throw new Error("Stored XT checkpoint is too large.");
  const bytes = Uint8Array.from(atob(text.slice(prefix.length)), char => char.charCodeAt(0));
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")).getReader();
  const decoder = new TextDecoder();
  let decoded = "", size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maximum) throw new Error("Expanded XT checkpoint is too large.");
      decoded += decoder.decode(value, { stream: true });
    }
    return decodeXtCheckpoint(decoded + decoder.decode(), ega);
  } finally { await reader.cancel(); reader.releaseLock(); }
}
