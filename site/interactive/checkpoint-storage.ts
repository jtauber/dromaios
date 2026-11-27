import { namedStateStorage, type StateStorage } from "./named-state-storage.js";

/** Keep the previous single-slot save in place and store each new name independently. */
export function namedCheckpoints<State>(storage: () => StateStorage, key: string,
  encode: (state: State) => Promise<string>, decode: (text: string) => Promise<State>) {
  const entries = namedStateStorage(storage, key + ":named:", { key, name: "Previous checkpoint" });
  return {
    names: entries.names,
    remove: entries.remove,
    async restore(name: string): Promise<State> {
      return decode(entries.read(name));
    },
    async save(name: string, state: State): Promise<void> {
      const text = await encode(state);
      const write = () => entries.save(name, text);
      // Two open laboratories can finish compressing a save with the same name together.
      if (globalThis.navigator?.locks) await navigator.locks.request(key, write);
      else write();
    },
  };
}

const prefix = "gzip:";

/** Compress the existing portable checkpoint; media and machine validation still belong to its codec. */
export async function compressCheckpoint(text: string): Promise<string> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return prefix + btoa(binary);
}

/** Older plain JSON saves remain readable. Bound decompression before accepting browser-owned data. */
export async function expandCheckpoint(text: string, maximum: number): Promise<string> {
  if (!text.startsWith(prefix)) return text;
  if (text.length > maximum) throw new Error("Stored checkpoint is too large.");
  const bytes = Uint8Array.from(atob(text.slice(prefix.length)), char => char.charCodeAt(0));
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")).getReader();
  const decoder = new TextDecoder();
  let decoded = "", size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maximum) throw new Error("Expanded checkpoint is too large.");
      decoded += decoder.decode(value, { stream: true });
    }
    return decoded + decoder.decode();
  } finally { await reader.cancel(); reader.releaseLock(); }
}
