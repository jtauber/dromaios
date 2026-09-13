import { Cpu8080 } from "../components/cpus/8080.js";
import { Ram } from "../components/memory/ram.js";

const START_ADDRESS = 0x0000;
// LXI SP,2000H; LXI B,1234H; PUSH B; LXI B,0000H; POP B; HLT.
// See docs/8080-stack-example.md.
const PROGRAM = [0x31, 0x00, 0x20, 0x01, 0x34, 0x12, 0xc5, 0x01, 0x00, 0x00, 0xc1, 0x76] as const;

/** Allocate a fresh lesson memory image; this does not execute the program. */
export function create8080StackExampleMemory(): Ram {
  const ram = new Ram(0x10000);
  for (const [offset, value] of PROGRAM.entries()) {
    ram.write(START_ADDRESS + offset, value);
  }
  return ram;
}

/** Start or restart the lesson with fresh components; no reset or execution occurs. */
export function create8080StackExample(): { cpu: Cpu8080; ram: Ram } {
  const ram = create8080StackExampleMemory();
  const cpu = new Cpu8080(ram, {
    a: 0x11, b: 0x22, c: 0x33, d: 0x44, e: 0x55, h: 0x66, l: 0x77,
    pc: START_ADDRESS,
    sp: 0xabcd,
    flags: { s: true, z: false, ac: true, p: false, cy: true },
    interruptEnabled: false,
    halted: false,
  });
  return { cpu, ram };
}
