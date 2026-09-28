import { Cpu8080 } from "../../src/components/cpus/generated/8080-cpu.js";
import { create8080AltairProgramLesson } from "../../src/machines/generated/8080/altair-program-lesson.js";
import { createAltairMemoryPanel } from "./altair-panel.js";
import { registerProgram, hex } from "./register-programs.js";

// A reference for manual entry, never an image loaded into the learner's RAM.
export const altairProgramBytes = [0x3a, 0x03, 0x00, 0xc6, 0x01, 0x32, 0x04, 0x00] as const;
export const altairProgramStart = 0x100;
export const altairOperandAddress = 0x104;
const instructions = registerProgram("add-one").instructions;

/** Connect the lesson panel to the CPU's PC and guard the three-instruction exercise. */
export function createAltairProgram() {
  const machine = create8080AltairProgramLesson();
  const { ram, endAddress } = machine;
  let cpu = machine.cpu;
  const panel = createAltairMemoryPanel(ram, {
    get value() { return cpu.snapshot().pc; },
    set value(pc: number) {
      // Approximate the stopped panel's PC change, preserving all other stored state.
      // Reconstruction uses the public snapshot contract; it is not a CPU reset or guest step.
      cpu = new Cpu8080(ram, { ...cpu.snapshot(), pc });
    },
  });

  function stepProblem(): string | undefined {
    for (const [offset, expected] of altairProgramBytes.entries()) {
      const address = altairProgramStart + offset;
      if (address !== altairOperandAddress && ram.read(address) !== expected) {
        return `At ${hex(address, 4)}, RAM holds ${hex(ram.read(address), 2)}; enter ${hex(expected, 2)} from the reference card before stepping.`;
      }
    }
    const pc = cpu.snapshot().pc;
    if (pc === endAddress) return "PC is at 0108, just after the program. EXAMINE 0100 to run it again; memory is preserved.";
    if (!instructions.some(instruction => instruction.address === pc)) {
      return "EXAMINE 0100 to begin. This lesson steps only at instruction starts 0100, 0103, and 0105.";
    }
    return undefined;
  }

  return {
    ram, panel, endAddress, instructions,
    snapshot: () => cpu.snapshot(),
    stepProblem,
    step() {
      const problem = stepProblem();
      if (problem) throw new Error(problem);
      return cpu.step();
    },
  };
}
