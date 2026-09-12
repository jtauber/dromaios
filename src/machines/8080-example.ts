import { Cpu8080 } from "../components/cpus/8080.js";
import { Ram } from "../components/memory/ram.js";

const START_ADDRESS = 0x0000;
// MVI A,2; ADI 3; STA 0080H; HLT. See docs/8080-example.md.
const PROGRAM = [0x3e, 0x02, 0xc6, 0x03, 0x32, 0x80, 0x00, 0x76] as const;

/** Allocate a fresh lesson memory image; this does not execute the program. */
export function create8080ExampleMemory(): Ram {
  const ram = new Ram(0x10000);
  for (const [offset, value] of PROGRAM.entries()) {
    ram.write(START_ADDRESS + offset, value);
  }
  return ram;
}

/** Start or restart the lesson with fresh components; no reset or execution occurs. */
export function create8080Example(): { cpu: Cpu8080; ram: Ram } {
  const ram = create8080ExampleMemory();
  const cpu = new Cpu8080(ram, {
    a: 0,
    b: 0,
    c: 0,
    d: 0,
    e: 0,
    h: 0,
    l: 0,
    pc: START_ADDRESS,
    sp: 0,
    flags: { s: false, z: false, ac: false, p: false, cy: false },
    interruptEnabled: false,
    halted: false,
  });
  return { cpu, ram };
}
