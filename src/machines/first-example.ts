import { Ram } from "../components/memory/ram.js";

// MVI A,2; ADI 3; STA 0080H; HLT. See docs/first-example.md.
const PROGRAM = [0x3e, 0x02, 0xc6, 0x03, 0x32, 0x80, 0x00, 0x76] as const;

/** Allocate a fresh lesson memory image; this does not execute the program. */
export function createFirstExampleMemory(): Ram {
  const ram = new Ram(0x10000);
  for (const [address, value] of PROGRAM.entries()) {
    ram.write(address, value);
  }
  return ram;
}
