import { Cpu6809 } from "../components/cpus/6809.js";
import { Ram } from "../components/memory/ram.js";

const START_ADDRESS = 0x0200;
// LDA #2; ADDA #3; STA >$0080 (extended). See docs/6809-example.md.
const PROGRAM = [0x86, 0x02, 0x8b, 0x03, 0xb7, 0x00, 0x80] as const;

/** Start or restart the lesson with fresh components; no reset or execution occurs. */
export function create6809Example(): { cpu: Cpu6809; ram: Ram; endAddress: number } {
  const ram = new Ram(0x10000);
  for (const [offset, value] of PROGRAM.entries()) {
    ram.write(START_ADDRESS + offset, value);
  }
  ram.write(0xfffe, START_ADDRESS >>> 8);
  ram.write(0xffff, START_ADDRESS & 0xff);

  const cpu = new Cpu6809(ram, {
    a: 0,
    b: 0x34,
    dp: 0x12,
    x: 0,
    y: 0,
    s: 0x8000,
    u: 0x4000,
    pc: START_ADDRESS,
    flags: { e: false, f: true, h: true, i: true, n: false, z: false, v: true, c: true },
  });
  return { cpu, ram, endAddress: START_ADDRESS + PROGRAM.length };
}
