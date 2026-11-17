import type { XtDisketteAccess, XtDisketteTransfer, XtIo } from "../../src/machines/8088/pc-xt/io.js";
import type { IbmXtDisketteSnapshot } from "../../src/components/devices/generated/ibm-xt-diskette.js";
import type { XtBoundary } from "./xt-session.js";
import type { DebugLocation } from "./instruction-debugger.js";
import { xtDebugLocation } from "./xt-inspection.js";

interface Sector {
  offset: number;
  firstByte: number;
  lastByte: number;
  firstAddress: number;
  lastAddress: number;
  bytes: number;
  direction: XtDisketteTransfer["direction"];
  terminal: boolean;
}
interface Operation {
  id: number;
  command?: number;
  parameters: number[];
  continued: boolean;
  caller?: DebugLocation;
  started: number;
  updated: number;
  state: "parameters" | "executing" | "issued" | "result" | "complete" | "interrupted";
  note?: string;
  sectors: Sector[];
  omittedSectors: number;
  bytes: number;
  result: number[];
  consumed: number;
  irq6: boolean;
}
export type XtDiskOperation = Readonly<Omit<Operation, "parameters" | "result" | "sectors">> & {
  readonly parameters: readonly number[]; readonly result: readonly number[]; readonly sectors: readonly Readonly<Sector>[];
};
export interface XtDiskActivityMark {
  readonly epoch: number;
  readonly continuity: number;
  readonly sequence: number;
  readonly complete: boolean;
}

/** A passive protocol history, separate from both device state and the bounded raw byte trace. */
export function createXtDiskActivity(current: () => XtIo, capacity = 64) {
  if (!Number.isSafeInteger(capacity) || capacity < 1) throw new RangeError("Disk activity capacity must be positive.");
  let io: XtIo | undefined, detach = () => {}, recording = true, capturing = false, needsSeed = true;
  let pending: XtDisketteAccess[] | undefined, active: Operation | undefined, sequence = 0, revision = 0;
  let epoch = 0, continuity = 0;
  const history: Operation[] = [];
  function interrupt(note: string): void {
    if (active) { active.state = "interrupted"; active.note = note; active = undefined; revision++; }
  }
  function append(command: number | undefined, ticks: number, continued: boolean, caller?: DebugLocation): Operation {
    interrupt("A later command replaced the unfinished observation.");
    active = { id: ++sequence, command, parameters: [], continued, caller, started: ticks, updated: ticks,
      state: "parameters", sectors: [], omittedSectors: 0, bytes: 0, result: [], consumed: 0, irq6: false };
    history.push(active); if (history.length > capacity) history.shift(); revision++;
    return active;
  }
  function result(state: IbmXtDisketteSnapshot, ticks: number): void {
    if (!active || state.phase !== 2) return;
    active.result = state.results.slice(0, state.result_index + state.result_left);
    active.consumed = state.result_index; active.state = "result"; active.updated = ticks; revision++;
  }
  function seed(): void {
    needsSeed = false;
    const state = io!.disketteState().diskette;
    if (!state.phase) return;
    // Sense Interrupt does not replace COMMAND. A short result alone cannot identify its command.
    const command = state.phase === 2 && state.result_index + state.result_left !== 7 ? undefined : state.command;
    const operation = append(command, io!.clock.ticks, true);
    operation.parameters = command === undefined ? [] : state.parameters.slice(0, state.received);
    operation.state = state.phase === 1 ? "parameters" : "executing";
    result(state, io!.clock.ticks);
  }
  function connect(): void {
    const next = current();
    if (io === next) return;
    continuity++;
    interrupt("The machine was replaced.");
    detach(); io = next; needsSeed = true;
    if (!recording) return;
    detach = io.observeDiskette(access => {
      if (!recording) return;
      if (capturing) (pending ??= []).push(access);
      else { interrupt("A controller access occurred outside captured execution."); needsSeed = true; continuity++; }
    });
  }
  function access(event: XtDisketteAccess, caller: DebugLocation, ticks: number): void {
    const { before, after, value } = event;
    if (event.kind === "control") {
      if (!(value & 4)) interrupt("Controller reset abandoned the operation.");
      return;
    }
    if (event.kind === "write") {
      // A data-port write in the wrong phase is not an accepted command or parameter.
      if (before.phase > 1 || (before.phase === 0 && after.phase === 0)
        || (before.phase === 1 && after.received === before.received)) return;
      if (before.phase === 0) append(value, ticks, false, caller);
      if (!active) return;
      active.parameters = after.parameters.slice(0, after.received);
      // Sense Interrupt has no parameters and deliberately retains the previous command register.
      if (before.phase === 0 && value === 8) active.parameters = [];
      active.updated = ticks;
      active.state = after.phase === 1 ? "parameters" : after.phase === 0 ? "issued" : "executing";
      result(after, ticks);
      if (active.state === "issued") active = undefined;
      revision++;
    } else if (before.phase === 2 && active) {
      result(before, ticks);
      active.consumed = after.result_index;
      if (!after.result_left) { active.state = "complete"; active = undefined; }
      revision++;
    }
  }
  function dma(transfer: XtDisketteTransfer, ticks: number): void {
    if (!active) append(undefined, ticks, true).state = "executing";
    const op = active!, offset = transfer.offset - transfer.offset % 512, byte = transfer.offset % 512;
    let sector = op.sectors.at(-1);
    // Split at a sector boundary, discontinuity, direction change, or a 64 KiB RAM wrap.
    if (!sector || sector.offset !== offset || byte !== sector.lastByte + 1 || transfer.address !== sector.lastAddress + 1 || sector.direction !== transfer.direction) {
      sector = { offset, firstByte: byte, lastByte: byte, firstAddress: transfer.address, lastAddress: transfer.address,
        bytes: 0, direction: transfer.direction, terminal: false };
      op.sectors.push(sector);
      if (op.sectors.length > 128) { op.sectors.shift(); op.omittedSectors++; }
    }
    sector.lastByte = byte; sector.lastAddress = transfer.address; sector.bytes++; sector.terminal ||= transfer.terminal;
    op.bytes++; op.updated = ticks; revision++;
    // Results are available at completion, even before software reads the first status byte.
    if (transfer.terminal || byte === 511) result(io!.disketteState().diskette, ticks);
  }
  function reset(): void {
    interrupt("Inspection restarted."); history.length = 0; sequence = 0; revision++; epoch++; continuity++; needsSeed = true;
    connect(); if (recording) seed();
  }
  connect(); seed();
  return {
    capacity,
    get revision() { return revision; },
    get epoch() { return epoch; },
    get recording() { return recording; },
    get discarded() { return Math.max(0, sequence - capacity); },
    mark(): XtDiskActivityMark {
      connect();
      return { epoch, continuity, sequence, complete: recording && !needsSeed && !active };
    },
    since(mark: XtDiskActivityMark): { readonly complete: boolean; readonly operations: readonly XtDiskOperation[] } {
      connect();
      const operations = mark.epoch === epoch ? this.entries().filter(op => op.id > mark.sequence) : [];
      const complete = mark.complete && recording && mark.epoch === epoch && mark.continuity === continuity
        && sequence - mark.sequence <= capacity && !needsSeed && !active
        && operations.every(op => !op.continued && !op.omittedSectors && !op.note);
      return { complete, operations };
    },
    entries(): readonly XtDiskOperation[] {
      return history.map(op => ({ ...op, ...(op.caller && { caller: { ...op.caller } }), parameters: [...op.parameters],
        result: [...op.result], sectors: op.sectors.map(sector => ({ ...sector })) }));
    },
    record(enabled: boolean): void {
      if (enabled === recording) return;
      interrupt("Recording paused before completion."); recording = enabled; needsSeed = true; revision++; continuity++;
      detach(); io = undefined;
      connect(); if (enabled) seed();
    },
    reset,
    capture(step: () => XtBoundary): XtBoundary {
      connect(); if (!recording) return step();
      if (needsSeed) seed();
      capturing = true;
      try {
        const record = step(), ticks = io!.clock.ticks;
        if (record.dma) dma(record.dma, ticks);
        for (const event of pending ?? []) access(event, xtDebugLocation(record.before), ticks);
        if (active && record.outcome === "accepted" && record.source === "intr" && (record.vector & 7) === 6) {
          active.irq6 = true; active.updated = ticks; revision++;
        }
        return record;
      } catch (cause) { interrupt("Execution failed; partial effects are not reconstructed."); needsSeed = true; continuity++; throw cause; }
      finally { capturing = false; pending = undefined; }
    },
    dispose(): void { detach(); recording = false; },
  };
}
