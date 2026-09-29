import { Cpu8080 } from "../../src/components/cpus/generated/8080-cpu.js";
import type { BytePorts } from "../../src/components/cpus/port-access.js";
import type { ByteOutput } from "../../src/components/devices/byte-output.js";
import type { Ram } from "../../src/components/memory/ram.js";
import { create8080AltairProgramLesson } from "../../src/machines/generated/8080/altair-program-lesson.js";
import { create8080CountdownLesson } from "../../src/machines/generated/8080/countdown-lesson.js";
import { create8080AltairOutputLesson } from "../../src/machines/generated/8080/altair-output-lesson.js";
import { createAltairMemoryPanel } from "./altair-panel.js";
import { registerProgram, hex, load, add } from "./register-programs.js";
import type { LessonInstruction } from "./register-programs.js";

interface LessonMachine {
  readonly cpu: Cpu8080;
  readonly ram: Ram;
  readonly endAddress: number;
  readonly ports?: BytePorts;
  readonly output?: ByteOutput;
}

const outputInstruction: LessonInstruction = {
  address: 0x105, length: 2, action: "output", mnemonic: () => "OUT 01H",
  explanation: () => "Send A to output port 1",
  prompt: "Send A to the lamp device. Will A or RAM change?",
  describe: record => {
    const transfer = record.accesses.find(access => access.kind === "output");
    if (!transfer || transfer.kind !== "output") throw new Error("Expected a captured output transfer.");
    return `Sent ${transfer.value} from A to output port ${transfer.port}. The lamp device now holds that byte. A, flags, and RAM are unchanged.`;
  },
};

// A reference for manual entry, never an image loaded into the learner's RAM.
export const altairProgramBytes = [0x3a, 0x03, 0x00, 0xc6, 0x01, 0x32, 0x04, 0x00] as const;
export const altairProgramStart = 0x100;
export const altairOperandAddress = 0x104;
const programs = {
  entry: {
    createMachine: create8080AltairProgramLesson,
    instructions: registerProgram("add-one").instructions,
    bytes: altairProgramBytes,
    editableOperand: altairOperandAddress,
  },
  countdown: {
    createMachine: create8080CountdownLesson,
    instructions: registerProgram("countdown").instructions,
    bytes: [0x3a, 3, 0, 0xd6, 1, 0x32, 4, 0, 0xc2, 3, 1],
    editableOperand: undefined,
  },
  output: {
    createMachine: create8080AltairOutputLesson,
    instructions: [load(0x100), add(0x103), outputInstruction],
    bytes: [0x3a, 3, 0, 0xc6, 1, 0xd3, 1],
    editableOperand: undefined,
  },
} as const;

/** Connect the panel to PC and guard execution of a known lesson program. */
export function createAltairProgram(name: keyof typeof programs = "entry") {
  const { createMachine, instructions, bytes, editableOperand } = programs[name];
  let outputWrites = 0;
  const machine: LessonMachine = createMachine({ output: () => { outputWrites++; } });
  const { ram, endAddress, ports, output } = machine;
  let cpu = machine.cpu;
  const panel = createAltairMemoryPanel(ram, {
    get value() { return cpu.snapshot().pc; },
    set value(pc: number) {
      // Approximate the stopped panel's PC change, preserving all other stored state.
      // Reconstruction uses the public snapshot contract; it is not a CPU reset or guest step.
      cpu = new Cpu8080(ram, { ...cpu.snapshot(), pc }, ports);
    },
  });

  function stepProblem(): string | undefined {
    for (const [offset, expected] of bytes.entries()) {
      const address = altairProgramStart + offset;
      if (address !== editableOperand && ram.read(address) !== expected) {
        return `At ${hex(address, 4)}, RAM holds ${hex(ram.read(address), 2)}; enter ${hex(expected, 2)} from the reference card before stepping.`;
      }
    }
    const pc = cpu.snapshot().pc;
    if (pc === endAddress) return `PC is at ${hex(endAddress, 4)}, just after the program. EXAMINE 0100 to run it again; memory is preserved.`;
    if (!instructions.some(instruction => instruction.address === pc)) {
      return `EXAMINE 0100 to begin. This lesson steps only at instruction starts ${instructions.map(instruction => hex(instruction.address, 4)).join(", ")}.`;
    }
    return undefined;
  }

  return {
    ram, panel, endAddress, instructions, bytes, editableOperand,
    outputSnapshot: () => output && { ...output.snapshot(), writes: outputWrites },
    snapshot: () => cpu.snapshot(),
    stepProblem,
    step() {
      const problem = stepProblem();
      if (problem) throw new Error(problem);
      return cpu.step();
    },
  };
}
