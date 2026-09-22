import type { Ram } from "../memory/ram.ts";
import { checkUnsigned } from "../validation.ts";
import type { StateTransition } from "./execution-records.ts";
import type { InterruptAcknowledge } from "./interrupt-instruction.ts";
import { recordMemory } from "./memory-access.ts";
import type { ByteMemory, MemoryAccess } from "./memory-access.ts";

export type VectorOfferAccess = MemoryAccess | InterruptAcknowledge;
export type VectorOfferRecord<S, Source extends string, Reason extends string> = StateTransition<S, VectorOfferAccess> & {
  readonly source: Source;
  readonly instruction: null;
} & ({ readonly outcome: "accepted"; readonly vector: number } | { readonly outcome: "ignored"; readonly reason: Reason });

export interface VectorOffer<Reason extends string> {
  readonly decline: () => Reason | undefined;
  readonly accept: () => void;
  /** A fixed vector needs no external acknowledgement. */
  readonly vector: number | "acknowledge";
  readonly enter: (vector: number, memory: ByteMemory) => void;
}

/** Gate first, validate the accepted callback, apply acceptance, then obtain and enter the vector. */
export function vectorOffers<S, Source extends string, Reason extends string>(cpu: string, ram: Ram, snapshot: () => S,
  entries: Readonly<Record<Source, VectorOffer<Reason>>>) {
  return (source: Source, acknowledge?: () => number): VectorOfferRecord<S, Source, Reason> => {
    if (typeof source !== "string" || !Object.hasOwn(entries, source)) throw new TypeError(`${cpu} interrupt source must be ${Object.keys(entries).join(" or ")}.`);
    const entry = entries[source], before = snapshot(), reason = entry.decline();
    if (reason !== undefined) return { before, after: snapshot(), source, instruction: null, accesses: [], outcome: "ignored", reason };
    if (entry.vector === "acknowledge" && typeof acknowledge !== "function") throw new TypeError(`${source.toUpperCase()} requires an acknowledge callback.`);
    entry.accept();
    const accesses: VectorOfferAccess[] = [], memory = recordMemory(ram, access => { accesses.push(access); });
    let vector: number;
    if (entry.vector === "acknowledge") {
      vector = acknowledge!();
      checkUnsigned("Interrupt vector", vector, 0xff);
      accesses.push({ kind: "acknowledge", value: vector });
    } else vector = entry.vector;
    entry.enter(vector, memory);
    return { before, after: snapshot(), source, instruction: null, accesses, outcome: "accepted", vector };
  };
}
