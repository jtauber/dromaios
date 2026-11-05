import type { createApple2Session } from "./apple2-session.js";
import type { DebugLocation } from "./instruction-debugger.js";
import { hex } from "./apple2-explorer.js";

type Machine = ReturnType<typeof createApple2Session>["machine"];

/** In the verified ROM's statement dispatcher, TXTPTR identifies the byte about to execute. */
export function applesoftStatement(machine: Machine, at: DebugLocation) {
  if (at.space !== "rom" || at.address !== 0xd828) return undefined;
  const word = (address: number) => machine.ram.read(address) | machine.ram.read(address + 1) << 8;
  const line = word(0x75), address = word(0xb8);
  if (line >= 0xff00 || address < word(0x67) || address >= Math.min(word(0x69), machine.ram.size)) return undefined;
  const byte = machine.ram.read(address);
  if (byte !== 0 && byte !== 0x3a) return { line, address };
}

/** Recognize the direct prompt after it is written, including when END leaves CURLIN set. */
export function applesoftStepBoundary(machine: Machine, at: DebugLocation, queued: number): string | undefined {
  const statement = applesoftStatement(machine, at);
  if (statement) return `Before Applesoft line ${statement.line} at $${hex(statement.address)}.`;
  if (at.space !== "rom") return undefined;
  if (at.address === 0xfd6f && machine.ram.read(0x33) === 0xdd) {
    const sp = machine.cpu.snapshot().sp;
    const stack = (offset: number) => machine.ram.read(0x100 + ((sp + offset) & 0xff));
    // D441 calls D52E, whose JSR at D530 enters GETLN. INPUT has a different caller.
    if (stack(1) === 0x32 && stack(2) === 0xd5 && stack(3) === 0x43 && stack(4) === 0xd4) return "Applesoft ] prompt.";
  }
  if (at.address === 0xfd21 && !queued && !machine.keyboard.snapshot().strobe) return "Waiting for keyboard input.";
}
