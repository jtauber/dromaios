import { Cpu6502 } from "../../src/components/cpus/generated/6502-cpu.js";
import type { createApple2Session } from "./apple2-session.js";

export type Editable6502Register = "a" | "x" | "y" | "sp" | "pc";

/** A debugger edit replaces only the CPU; the bus, RAM, devices, and media retain their identity. */
export function editApple2Register(machine: ReturnType<typeof createApple2Session>["machine"],
  register: Editable6502Register, text: string): void {
  const width = register === "pc" ? 4 : 2;
  if (!new RegExp(`^\\$?[\\da-f]{1,${width}}$`, "i").test(text.trim())) {
    throw new RangeError(`Use a hexadecimal value from ${"0".repeat(width)} to ${"F".repeat(width)}.`);
  }
  const value = parseInt(text.trim().replace(/^\$/, ""), 16);
  machine.cpu = new Cpu6502(machine.memory, { ...machine.cpu.snapshot(), [register]: value });
}

