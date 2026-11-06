import type { Apple2DiskII, DiskIITransfer } from "../../src/components/devices/apple2-disk-ii.js";
import type { Cpu6502StepRecord } from "../../src/components/cpus/generated/6502-cpu.js";
import type { DebugLocation } from "./instruction-debugger.js";
import { createDos33StreamInspector } from "./dos33-stream.js";
import type { Dos33ObservedField } from "./dos33-stream.js";

export interface DiskIIByteEvent extends DiskIITransfer {
  readonly number: number;
  readonly caller: DebugLocation;
  readonly instruction: readonly number[];
  readonly outcome: Cpu6502StepRecord["outcome"] | "error";
  readonly field?: Dos33ObservedField;
}

/** Bounded instruction-linked transfers; sector totals last until Clear or a new mount. */
export function createApple2DiskActivity(capacity = 512) {
  if (!Number.isSafeInteger(capacity) || capacity < 1) throw new RangeError("Disk history capacity must be positive.");
  let controller: Apple2DiskII | undefined, medium: ReturnType<Apple2DiskII["inspectMedium"]> = null;
  let detach: (() => void) | undefined, recording = true, capturing = false, pending: DiskIITransfer[] | undefined;
  let sequence = 0, latestData: DiskIIByteEvent | undefined;
  const events: DiskIIByteEvent[] = [], stream = createDos33StreamInspector();
  const addresses = new Array<number>(35 * 16).fill(0), data = new Array<number>(35 * 16).fill(0);
  function clear(): void {
    events.length = 0; sequence = 0; latestData = undefined; pending = undefined;
    addresses.fill(0); data.fill(0); stream.interrupt();
  }
  function subscribe(): void {
    detach?.(); detach = undefined;
    if (recording && medium) {
      const stopTransfers = controller!.observeTransfers(transfer => {
        if (capturing) (pending ??= []).push(transfer);
        else stream.interrupt(); // A host access has no executing CPU instruction.
      });
      const stopWrites = medium.observeWrites(() => stream.interrupt());
      detach = () => { stopTransfers(); stopWrites(); };
    }
  }
  return {
    get recording() { return recording; },
    get count() { return sequence; },
    get latestData() { return latestData; },
    entries(): readonly DiskIIByteEvent[] { return [...events]; },
    sectors(track: number) {
      return Array.from({ length: 16 }, (_, physicalSector) => ({ physicalSector,
        addresses: addresses[track * 16 + physicalSector] ?? 0, data: data[track * 16 + physicalSector] ?? 0 }));
    },
    clear,
    record(enabled: boolean): void {
      if (enabled === recording) return;
      recording = enabled; stream.interrupt(); subscribe();
    },
    connect(selected: Apple2DiskII): boolean {
      const current = selected.inspectMedium();
      if (selected === controller && current === medium) return false;
      controller = selected; medium = current; clear(); subscribe(); return true;
    },
    capture(caller: DebugLocation, step: () => Cpu6502StepRecord): Cpu6502StepRecord {
      if (!recording || !medium) return step();
      capturing = true;
      let record: Cpu6502StepRecord | undefined;
      try { return record = step(); }
      finally {
        capturing = false;
        if (pending) {
          const bytes = Object.freeze([...(record?.instruction.bytes ?? [])]), location = Object.freeze({ ...caller });
          for (const transfer of pending) {
            const numbered = { ...transfer, number: ++sequence }, field = stream.consume(numbered);
            const event: DiskIIByteEvent = Object.freeze({ ...numbered, caller: location, instruction: bytes,
              outcome: record?.outcome ?? "error", ...(field && { field: Object.freeze(field) }) });
            events.push(event); if (events.length > capacity) events.shift();
            if (field?.valid && field.sector !== undefined) {
              const index = field.track * 16 + field.physicalSector;
              if (field.kind === "address") addresses[index]!++;
              else { data[index]!++; latestData = event; }
            }
          }
          pending = undefined;
        }
      }
    },
  };
}
