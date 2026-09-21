import type { Ram } from "../memory/ram.ts";
import type { decodedExecution } from "./decoded-execution.ts";
import { readWordBE, readWordLE } from "./binary.ts";
import type { StateTransition } from "./execution-records.ts";
import { recordInterruptInstruction } from "./interrupt-instruction.ts";
import type { InterruptAcknowledge, InterruptInstruction } from "./interrupt-instruction.ts";
import { recordMemory } from "./memory-access.ts";
import type { ByteMemory, MemoryAccess } from "./memory-access.ts";
import { recordPorts } from "./port-access.ts";
import type { BytePorts, PortAccess } from "./port-access.ts";

type Delivery = { readonly kind: "supplied" } | { readonly kind: "entry"; readonly enter: (memory: ByteMemory) => void };
type Entry = {
  readonly decline?: () => string | undefined;
  readonly accept: () => void;
} & ({ readonly acknowledge: false; readonly enter: (memory: ByteMemory) => void }
  | { readonly acknowledge: true; readonly select: (byte: number) => Delivery });
type Access = MemoryAccess | PortAccess | InterruptAcknowledge;
type SourceOf<Entries> = keyof Entries & string;
type SuppliedSource<Entries> = { [Source in SourceOf<Entries>]: Entries[Source] extends { acknowledge: true } ? Source : never }[SourceOf<Entries>];
type Declined<Entries> = { [Source in SourceOf<Entries>]: Entries[Source] extends { decline: () => infer Reason }
  ? { readonly source: Source; readonly outcome: "ignored"; readonly reason: Exclude<Reason, undefined>; readonly instruction: null }
  : never }[SourceOf<Entries>];
export type EntryInterrupt<Snapshot, Entries> = StateTransition<Snapshot, Access> & (
  | Declined<Entries>
  | { readonly source: SourceOf<Entries>; readonly outcome: "accepted"; readonly instruction: null }
  | ({ readonly source: SuppliedSource<Entries>; readonly instruction: InterruptInstruction } & (
    { readonly outcome: "executed" | "halted" } | { readonly outcome: "unsupported"; readonly reason: "opcode" }))
);

/** Named, gated requests can enter a vector or acknowledge and select supplied-instruction delivery. */
export function interruptEntries<Snapshot, const Entries extends Readonly<Record<string, Entry>>>(cpu: string, ram: Ram,
  ports: BytePorts | undefined, snapshot: () => Snapshot, boundary: ReturnType<typeof decodedExecution<Snapshot>>,
  entries: Entries, stopped: () => boolean, word: "little" | "big") {
  const readWord = word === "little" ? readWordLE : readWordBE;
  const interrupt = (source: SourceOf<Entries>, acknowledge?: () => number) => boundary.atBoundary(() => {
    if (typeof source !== "string" || !Object.hasOwn(entries, source)) {
      throw new RangeError(`${cpu} interrupt source must be ${Object.keys(entries).join(" or ")}.`);
    }
    const entry = entries[source]!;
    if (entry.acknowledge && typeof acknowledge !== "function") throw new TypeError(`${cpu} ${source.toUpperCase()} requires an acknowledgement callback.`);
    const before = snapshot(), reason = entry.decline?.();
    if (reason !== undefined) return { before, after: snapshot(), source, outcome: "ignored" as const, reason, instruction: null, accesses: [] };
    const accesses: Access[] = [], record = (access: Access): void => { accesses.push(access); };
    const memory = recordMemory(ram, record);
    entry.accept();
    if (!entry.acknowledge) entry.enter(memory);
    else {
      const supplied = recordInterruptInstruction(acknowledge!, record), opcode = supplied.fetchByte();
      const delivery = entry.select(opcode);
      if (delivery.kind === "entry") delivery.enter(memory);
      else {
        const { handler } = boundary.decode(opcode, (opcodeFetch = true) => {
          // The acceptance action owns the first fetch effect; later M1 effects precede acknowledgement.
          if (opcodeFetch) boundary.opcodeFetched(1);
          return supplied.fetchByte();
        });
        if (handler) boundary.execute(handler, { ...memory, ...recordPorts(ports, record),
          fetchByte: supplied.fetchByte, fetchWord: () => readWord(supplied.fetchByte) });
        const transition = { before, after: snapshot(), source, instruction: supplied.instruction, accesses };
        return handler ? { ...transition, outcome: stopped() ? "halted" as const : "executed" as const }
          : { ...transition, outcome: "unsupported" as const, reason: "opcode" as const };
      }
    }
    return { before, after: snapshot(), source, instruction: null, accesses, outcome: "accepted" as const };
  });
  // Selecting entries[source] preserves the source/reason/delivery correlation described by this mapped type.
  return interrupt as (source: SourceOf<Entries>, acknowledge?: () => number) => EntryInterrupt<Snapshot, Entries>;
}
