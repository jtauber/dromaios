import assert from "node:assert/strict";
import { runInput } from "./rom-console.js";

type Xt = Parameters<typeof runInput>[0];

/** Follow a guest INT 21h file read or write to its return. AX then counts the bytes transferred at DS:DX. */
export function dosTransfer(machine: Xt, input: readonly number[], operation: "read" | "write", exactSize?: number) {
  const functionNumber = operation === "read" ? 0x3f : 0x40;
  let cs = -1, ip = -1, ds = 0, dx = 0, requested = 0, transferred = 0;
  runInput(machine, input, { limit: 3_000_000, until: (_, { before, after, instruction }) => {
    if (before.ah === functionNumber && (exactSize === undefined || before.cx === exactSize)
      && instruction?.bytes[0] === 0xcd && instruction.bytes[1] === 0x21) {
      ds = before.ds; dx = before.dx; requested = before.cx;
      cs = before.cs; ip = (before.ip + 2) & 0xffff;
    }
    if (after.cs !== cs || after.ip !== ip) return false;
    assert.equal(after.flags.cf, false);
    transferred = after.ax;
    assert.ok(transferred <= requested);
    if (exactSize !== undefined) assert.equal(transferred, exactSize);
    return true;
  } });
  const physical = (i: number) => ((ds << 4) + ((dx + i) & 0xffff)) & 0xfffff;
  return { base: physical(0), bytes: Uint8Array.from({ length: transferred }, (_, i) => machine.ram.read(physical(i))) };
}
