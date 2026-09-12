import { Cpu6502 } from "../components/cpus/6502.js";
import { Ram } from "../components/memory/ram.js";

const START_ADDRESS = 0x0200;
// CLC; LDA #2; ADC #3; STA $0080 (absolute). See docs/6502-example.md.
const PROGRAM = [0x18, 0xa9, 0x02, 0x69, 0x03, 0x8d, 0x80, 0x00] as const;

/** Start or restart the lesson with fresh components; no reset or execution occurs. */
export function create6502Example(): { cpu: Cpu6502; ram: Ram; endAddress: number } {
  const ram = new Ram(0x10000);
  for (const [offset, value] of PROGRAM.entries()) {
    ram.write(START_ADDRESS + offset, value);
  }
  ram.write(0xfffc, START_ADDRESS & 0xff);
  ram.write(0xfffd, START_ADDRESS >>> 8);

  const cpu = new Cpu6502(ram, {
    a: 0,
    x: 0,
    y: 0,
    sp: 0xff,
    pc: START_ADDRESS,
    flags: { n: false, v: false, d: false, i: true, z: false, c: true },
  });
  return { cpu, ram, endAddress: START_ADDRESS + PROGRAM.length };
}
