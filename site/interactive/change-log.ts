import type { StateFields } from "../../src/components/cpus/state.js";
import type { DebugLocation } from "./instruction-debugger.js";

export interface StorageWrite { readonly address: number; readonly before: number; readonly after: number }
export interface CapturedInstruction { readonly address: number; readonly bytes: readonly number[] }
export interface ChangeBoundary<State> {
  readonly after: State;
  readonly instruction?: CapturedInstruction | null;
  readonly outcome: string;
}
export interface RecordedChange {
  readonly kind: "register" | "flag" | "memory" | "pc";
  readonly target: string;
  readonly before: number;
  readonly after: number;
  readonly width: number;
}
export interface ChangeEntry {
  readonly source: "cpu" | "user";
  readonly sequence: number;
  readonly instruction: CapturedInstruction | undefined;
  readonly caller?: DebugLocation;
  readonly event?: string;
  readonly outcome: string;
  readonly changes: readonly RecordedChange[];
}

/** Prepare names, widths and groups once; per-instruction comparisons only inspect stored values. */
export function createProcessorChanges(fields: StateFields, counters: readonly string[] = ["pc"]) {
  type Field = { name: string; fields: readonly Field[] } | { name: string; change: Pick<RecordedChange, "kind" | "target" | "width"> };
  function describe(fields: StateFields, prefix = ""): Field[] {
    return Object.entries(fields).flatMap(([name, field]): Field[] => {
      if (field.kind === "group") return [{ name, fields: describe(field.fields, name === "flags" ? "" : `${prefix}${name}.`) }];
      if (field.kind !== "unsigned" && field.kind !== "flag") return [];
      return [{ name, change: { kind: field.kind === "flag" ? "flag" : counters.includes(name) ? "pc" : "register",
        target: `${prefix}${name}`.toUpperCase(), width: field.kind === "flag" ? 1 : Math.ceil(field.bits / 4) } }];
    });
  }
  const described = describe(fields);
  return (before: object, after: object): RecordedChange[] => {
    const changes: RecordedChange[] = [];
    function visit(fields: readonly Field[], before: object, after: object): void {
      for (const field of fields) {
        const old = (before as Record<string, unknown>)[field.name], value = (after as Record<string, unknown>)[field.name];
        if ("fields" in field) {
          if (old && value && typeof old === "object" && typeof value === "object") visit(field.fields, old, value);
        } else if (old !== value) changes.push({ ...field.change, before: Number(old), after: Number(value) });
      }
    }
    visit(described, before, after); return changes;
  };
}

/** Bounded boundary history. Physical writes are observed once, independently of recording and display refresh. */
export function createChangeLog<State extends object, Record extends ChangeBoundary<State>, Write extends StorageWrite>(adapter: {
  readonly state: StateFields;
  readonly counters?: readonly string[];
  readonly snapshot: () => State;
  readonly location: (state: State) => DebugLocation;
  readonly event: (record: Record) => string | undefined;
  readonly observeWrites: (listener: (write: Write) => void) => () => void;
  readonly memoryLabel: (write: Write) => string;
}, capacity = 500) {
  if (!Number.isSafeInteger(capacity) || capacity < 1) throw new RangeError("Change log capacity must be a positive integer.");
  const entries: ChangeEntry[] = [];
  const processorChanges = createProcessorChanges(adapter.state, adapter.counters);
  let cursor = 0, sequence = 0, captured = 0, recording = true;
  let writes: Write[] | undefined;
  let latest: { record: Record | undefined; writes: readonly Write[]; changes: readonly Write[] } | undefined;
  const detach = adapter.observeWrites(write => { if (writes) writes.push({ ...write }); });
  const memoryChange = (write: Write): RecordedChange => ({ kind: "memory", target: adapter.memoryLabel(write), before: write.before, after: write.after, width: 2 });
  function append(entry: ChangeEntry): void { entries[cursor] = entry; cursor = (cursor + 1) % capacity; captured++; }
  function clear(): void { entries.length = 0; cursor = sequence = captured = 0; }
  return {
    get capacity() { return capacity; },
    get recording() { return recording; },
    set recording(value: boolean) { recording = value; },
    get captured() { return captured; },
    get discarded() { return Math.max(0, captured - capacity); },
    memoryChanges(record: Record | undefined): readonly Write[] {
      return record !== undefined && latest?.record === record ? latest.changes : [];
    },
    /** Includes unchanged stores; never reconstruct old values by reading the guest bus. */
    memoryWrites(record: Record | undefined): readonly Write[] {
      return record !== undefined && latest?.record === record ? latest.writes : [];
    },
    entries(): readonly ChangeEntry[] {
      return Array.from({ length: entries.length }, (_, index) => entries[(cursor - 1 - index + entries.length) % entries.length]!);
    },
    recordEdit(change: Write): void {
      latest = undefined;
      append({ source: "user", sequence: ++sequence, instruction: undefined, outcome: "edited", changes: [memoryChange(change)] });
    },
    capture(step: () => Record): Record {
      sequence++;
      const before = recording ? adapter.snapshot() : undefined, caller = before && adapter.location(before);
      writes = [];
      let record: Record | undefined;
      try { return record = step(); }
      finally {
        const changes = writes.filter(write => write.before !== write.after);
        latest = { record, writes, changes }; writes = undefined;
        // Retain completed effects even when a host exception prevents a complete record.
        if (before !== undefined) {
          const instruction = record ? record.instruction : { address: caller!.address, bytes: [] };
          append({ source: "cpu", sequence, caller, instruction: instruction ? { address: instruction.address, bytes: [...instruction.bytes] } : undefined,
            event: record && adapter.event(record), outcome: record?.outcome ?? "interrupted",
            changes: [...processorChanges(before, record?.after ?? adapter.snapshot()), ...changes.map(memoryChange)] });
        }
      }
    },
    clear,
    reset(): void { clear(); latest = undefined; },
    dispose(): void { detach(); recording = false; latest = undefined; },
  };
}
