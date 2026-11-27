import { decodeXtCheckpoint, encodeXtCheckpoint, xtCheckpointKey } from "./xt-checkpoint.js";
import type { XtSessionState } from "./xt-session.js";
import type { StateStorage } from "./named-state-storage.js";
import { compressCheckpoint, expandCheckpoint, namedCheckpoints } from "./checkpoint-storage.js";

export function xtSavedCheckpoints(storage: () => StateStorage, ega: boolean) {
  const key = ega ? xtCheckpointKey + ":ega" : xtCheckpointKey;
  return namedCheckpoints(storage, key, encodeStoredXtCheckpoint, text => decodeStoredXtCheckpoint(text, ega));
}

export function encodeStoredXtCheckpoint(state: XtSessionState): Promise<string> {
  return compressCheckpoint(encodeXtCheckpoint(state));
}

export async function decodeStoredXtCheckpoint(text: string, ega = false): Promise<XtSessionState> {
  return decodeXtCheckpoint(await expandCheckpoint(text, 2_000_000), ega);
}
