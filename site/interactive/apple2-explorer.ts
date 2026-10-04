import type { Cpu6502StepRecord } from "../../src/components/cpus/generated/6502-cpu.js";

export interface AddressLabel {
  readonly address: string;
  readonly name: string;
  readonly description: string;
}
export interface MemoryLabel extends AddressLabel {
  readonly scope: "workspace" | "hardware" | "rom";
}
export interface RomRegion {
  readonly start: string;
  readonly end: string;
  readonly name: string;
}
export interface Apple2TraceEntry {
  readonly record: Cpu6502StepRecord;
  /** Capture the mapping before execution; a later bank switch must not relabel history. */
  readonly romMapped: boolean;
}
export type InstructionControlFlow = "sequential" | "conditional" | "unconditional";
export type InstructionCatalogue = Readonly<Partial<Record<number, {
  readonly name: string;
  readonly length: 1 | 2 | 3;
  readonly controlFlow: InstructionControlFlow;
}>>>;
export const hex = (value: number, width = 4): string => value.toString(16).toUpperCase().padStart(width, "0");

export function parseApple2Address(value: string): number {
  if (!/^\$?[\da-f]{1,4}$/i.test(value.trim())) throw new RangeError("Use a hexadecimal address from 0000 to FFFF.");
  return parseInt(value.trim().replace(/^\$/, ""), 16);
}

function relative6502Target(address: number, offset: number): number {
  return (address + 2 + (offset < 128 ? offset : offset - 256)) & 0xffff;
}

/** A destination encoded in the instruction, not an indirect pointer or a prediction of a branch. */
export function direct6502Target(address: number, bytes: readonly (number | undefined)[], instructions: InstructionCatalogue): number | undefined {
  const instruction = bytes[0] === undefined ? undefined : instructions[bytes[0]];
  if (instruction === undefined || instruction.controlFlow === "sequential") return undefined;
  const low = bytes[1], high = bytes[2];
  if (low === undefined) return undefined;
  if (instruction.name.endsWith(" relative")) return relative6502Target(address, low);
  if (instruction.name.endsWith(" absolute") && high !== undefined) return low | high << 8;
  return undefined;
}

/** The encoded address or base, without consulting registers, pointers, or device state. */
export function address6502Operand(address: number, bytes: readonly (number | undefined)[], instructions: InstructionCatalogue) {
  const instruction = bytes[0] === undefined ? undefined : instructions[bytes[0]];
  if (!instruction || bytes.length < instruction.length || bytes.slice(0, instruction.length).some(byte => byte === undefined)) return undefined;
  const mode = instruction.name.slice(instruction.name.indexOf(" ") + 1);
  const target = direct6502Target(address, bytes, instructions);
  if (target !== undefined) return { address: target, mode, target: true };
  if (mode.includes("zero page")) return { address: bytes[1]!, mode, target: false };
  if (mode.includes("absolute") || mode === "indirect") return { address: bytes[1]! | bytes[2]! << 8, mode, target: false };
  return undefined;
}

/** Format chapter notation from supplied bytes, without fetching operands or following pointers. */
export function disassemble6502(address: number, bytes: readonly (number | undefined)[], instructions: InstructionCatalogue): string {
  const name = bytes[0] === undefined ? undefined : instructions[bytes[0]]?.name;
  if (name === undefined) return "Unknown instruction";
  const byte = bytes[1], high = bytes[2];
  if (/absolute|indirect/.test(name)) {
    const word = byte === undefined || high === undefined ? "????" : hex(byte | high << 8);
    return name.replace("absolute", `$${word}`).replace("indirect", `($${word})`);
  }
  if (name.includes("relative")) {
    const target = byte === undefined ? "????" : hex(relative6502Target(address, byte));
    return name.replace("relative", `$${target}`);
  }
  const operand = byte === undefined ? "??" : hex(byte, 2);
  return name.replace("#byte", `#$${operand}`).replace("zero page", `$${operand}`);
}

export function romRoutine(address: number, romMapped: boolean, routines: readonly AddressLabel[]): AddressLabel | undefined {
  return romMapped && address >= 0xd000 ? routines.find(routine => parseInt(routine.address, 16) === address) : undefined;
}

/** A compact row and the detailed trace share the same captured instruction. */
export function formatApple2Instruction({ record }: Apple2TraceEntry, instructions: InstructionCatalogue): string {
  const { instruction } = record;
  return `${hex(instruction.address)}  ${instruction.bytes.map(byte => hex(byte, 2)).join(" ").padEnd(8)}  ${disassemble6502(instruction.address, instruction.bytes, instructions)}`;
}

/** Rendering has no machine connection: it cannot read a device or observe later RAM contents. */
export function formatApple2Trace({ record, romMapped }: Apple2TraceEntry, instructions: InstructionCatalogue, routines: readonly AddressLabel[]): string {
  const { instruction, before, after, accesses } = record;
  const routine = romRoutine(instruction.address, romMapped, routines);
  const heading = formatApple2Instruction({ record, romMapped }, instructions);
  const changes: string[] = [];
  for (const register of ["a", "x", "y", "sp"] as const) {
    if (before[register] !== after[register]) changes.push(`${register.toUpperCase()} ${hex(before[register], 2)}→${hex(after[register], 2)}`);
  }
  for (const flag of ["n", "v", "d", "i", "z", "c"] as const) {
    if (before.flags[flag] !== after.flags[flag]) changes.push(`${flag.toUpperCase()} ${+before.flags[flag]}→${+after.flags[flag]}`);
  }
  return [
    routine === undefined ? heading : `${heading}  · ${routine.name}\n  ${routine.description}`,
    `  PC → ${hex(after.pc)}${changes.length ? " · " + changes.join(" · ") : ""} · ${record.outcome}`,
    ...accesses.map(access => `  ${access.kind} $${hex(access.address)} = $${hex(access.value, 2)}`),
  ].join("\n");
}

/** One-shot stops are consumed before the target instruction or queued input is executed. */
export function createApple2RunTarget() {
  let target: { address: number; romOnly: boolean; remaining: number } | undefined;
  let status = "";
  return {
    get active() { return target !== undefined; },
    get status() { return status; },
    arm(address: number, romOnly: boolean, budget = 2_000_000): void {
      if (!Number.isInteger(address) || address < 0 || address > 0xffff) throw new RangeError("Use a hexadecimal address from 0000 to FFFF.");
      if (!Number.isSafeInteger(budget) || budget < 1) throw new RangeError("The instruction limit must be positive.");
      target = { address, romOnly, remaining: budget };
      status = `Running to $${hex(address)}${romOnly ? " in ROM" : ""}…`;
    },
    cancel(): void { target = undefined; status = ""; },
    pauseBeforeStep(pc: number, romMapped: boolean): boolean {
      if (target === undefined) return false;
      if (pc === target.address && (!target.romOnly || romMapped)) {
        status = `Stopped before $${hex(pc)}${target.romOnly ? " in ROM" : ""}. Step executes this instruction; Run continues.`;
      } else if (target.remaining === 0) {
        status = `Paused at the instruction limit; $${hex(target.address)} was not reached. The machine is unchanged by the pause.`;
      } else { target.remaining--; return false; }
      target = undefined;
      return true;
    },
  };
}
