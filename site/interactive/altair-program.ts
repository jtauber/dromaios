import { Cpu8080 } from "../../src/components/cpus/generated/8080-cpu.js";
import type { BytePorts } from "../../src/components/cpus/port-access.js";
import type { ByteOutput } from "../../src/components/devices/byte-output.js";
import type { ByteInput } from "../../src/components/devices/byte-input.js";
import type { Ram } from "../../src/components/memory/ram.js";
import { create8080AltairProgramLesson } from "../../src/machines/generated/8080/altair-program-lesson.js";
import { create8080CountdownLesson } from "../../src/machines/generated/8080/countdown-lesson.js";
import { create8080AltairOutputLesson } from "../../src/machines/generated/8080/altair-output-lesson.js";
import { create8080AltairInputLesson } from "../../src/machines/generated/8080/altair-input-lesson.js";
import { create8080AltairPollingLesson } from "../../src/machines/generated/8080/altair-polling-lesson.js";
import { create8080AltairReplyLesson } from "../../src/machines/generated/8080/altair-reply-lesson.js";
import { create8080OutputExample } from "../../src/machines/generated/8080/output-example.js";
import { create8080AltairTerminatedMessageLesson } from "../../src/machines/generated/8080/altair-terminated-message-lesson.js";
import { createAltairMemoryPanel } from "./altair-panel.js";
import { registerProgram, hex, readAddress, load, loadImmediate, add, compare, jump, jumpIf } from "./register-programs.js";
import type { CompletedInstruction, LessonInstruction } from "./register-programs.js";

interface LessonMachine {
  readonly cpu: Cpu8080;
  readonly ram: Ram;
  readonly endAddress?: number;
  readonly ports?: BytePorts;
  readonly output?: ByteOutput;
  readonly input?: ByteInput;
}

function outputInstruction(address: number): LessonInstruction {
  return {
    address, length: 2, action: "output", mnemonic: () => "OUT 01H",
    explanation: () => "Send A to output port 1",
    prompt: "Send A to the output device. Will A or RAM change?",
    describe: record => {
      const transfer = record.accesses.find(access => access.kind === "output");
      if (!transfer || transfer.kind !== "output") throw new Error("Expected a captured output transfer.");
      return `Sent ${transfer.value} from A to output port ${transfer.port}. The output device now holds that byte. A, flags, and RAM are unchanged.`;
    },
  };
}

function inputInstruction(address: number): LessonInstruction {
  return {
    address, length: 2, action: "input", mnemonic: () => "IN 01H",
    explanation: () => "Receive the waiting byte from input port 1 into A",
    prompt: "Receive the waiting byte into A. Will the output device change?",
    describe: ({ before, after }) => `Received ${after.a} from input port 1 into A, replacing ${before.a}. Reading left the input device empty. Flags, RAM, and the output device were unchanged.`,
  };
}

const readinessInstruction: LessonInstruction = {
  address: 0x100, length: 2, action: "input", mnemonic: () => "IN 00H",
  explanation: () => "Read readiness from input port 0 into A: 0 empty, 1 ready",
  prompt: "Check readiness without receiving the byte. What will A hold?",
  describe: ({ before, after }) => `Read readiness ${after.a} (${after.a === 0 ? "empty" : "ready"}) from input port 0 into A, replacing ${before.a}. Checking consumed no data. Flags, RAM, and the output device were unchanged.`,
};

function loadPointer(address: number): LessonInstruction {
  return {
    address, length: 3, action: "read", mnemonic: read => `LXI H,${hex(readAddress(read, address + 1), 4)}H`,
    explanation: read => `Put address ${hex(readAddress(read, address + 1), 4)} into HL`,
    prompt: "Set the message pointer. Has a character been read yet?",
    describe: ({ before, after }) => `Set HL from ${hex(before.hl, 4)} to ${hex(after.hl, 4)}. H holds ${hex(after.h, 2)} and L holds ${hex(after.l, 2)}. A, flags, RAM, and output are unchanged; no message byte was read.`,
  };
}

function readPointedByte(address: number): LessonInstruction {
  return {
    address, length: 1, action: "read", mnemonic: () => "MOV A,M",
    explanation: () => "Read the RAM byte addressed by HL into A",
    prompt: "Read through HL. Will the pointer or display change?",
    describe: ({ before, after }) => `Read ${after.a} from RAM at ${hex(before.hl, 4)} into A, replacing ${before.a}. HL still holds ${hex(after.hl, 4)}; other data registers, flags, RAM, and output are unchanged.`,
  };
}

function advancePointer(address: number): LessonInstruction {
  return {
    address, length: 1, action: "add", mnemonic: () => "INX H",
    explanation: () => "Advance HL to the next address",
    prompt: "Advance the pointer. Does A change too?",
    describe: ({ before, after }) => `Advanced HL from ${hex(before.hl, 4)} to ${hex(after.hl, 4)}. A still holds ${after.a}; other data registers, flags, RAM, and output are unchanged. No byte was read from the new address.`,
  };
}

function haltInstruction(address: number): LessonInstruction {
  return {
    address, length: 1, action: "halt", mnemonic: () => "HLT",
    explanation: () => "Halt the CPU",
    prompt: "Halt the CPU. What state will it preserve?",
    describe: ({ after }) => `Executed HLT. PC advanced to ${hex(after.pc, 4)} and the CPU is now halted. Data registers, flags, RAM, and output are preserved. RUN cannot resume a halted CPU; start this lesson again for a fresh run.`,
  };
}

// A reference for manual entry, never an image loaded into the learner's RAM.
export const altairProgramBytes = [0x3a, 0x03, 0x00, 0xc6, 0x01, 0x32, 0x04, 0x00] as const;
export const altairOperandAddress = 0x104;
// Both polling programs wait for readiness before consuming the pending byte.
const receiveInstructions = [readinessInstruction, compare(0x102), jumpIf(0x104, "z", 1), inputInstruction(0x107)];
const receiveBytes = [0xdb, 0, 0xfe, 0, 0xca, 0, 1, 0xdb, 1];
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
    instructions: [load(0x100), add(0x103), outputInstruction(0x105)],
    bytes: [0x3a, 3, 0, 0xc6, 1, 0xd3, 1],
    editableOperand: undefined,
  },
  input: {
    createMachine: create8080AltairInputLesson,
    instructions: [inputInstruction(0x100), outputInstruction(0x102)],
    bytes: [0xdb, 1, 0xd3, 1],
    editableOperand: undefined,
  },
  polling: {
    createMachine: create8080AltairPollingLesson,
    instructions: [...receiveInstructions, outputInstruction(0x109), jump(0x10b, () => "Next, check readiness again.")],
    bytes: [...receiveBytes, 0xd3, 1, 0xc3, 0, 1],
    editableOperand: undefined,
  },
  reply: {
    createMachine: create8080AltairReplyLesson,
    instructions: [...receiveInstructions, compare(0x109), jumpIf(0x10b, "z", 0), loadImmediate(0x10e),
      outputInstruction(0x110), jump(0x112, () => "Next, check readiness again.")],
    bytes: [...receiveBytes, 0xfe, 0x61, 0xc2, 0x10, 1, 0x3e, 0x41, 0xd3, 1, 0xc3, 0, 1],
    editableOperand: undefined,
  },
  message: {
    createMachine: create8080OutputExample,
    instructions: [
      loadPointer(0),
      loadImmediate(3, "b"),
      readPointedByte(5),
      outputInstruction(6),
      advancePointer(8),
      {
        address: 9, length: 1, action: "subtract", mnemonic: () => "DCR B",
        explanation: () => "Subtract one from the remaining count in B",
        prompt: "Count the byte just sent. Is anything left to send?",
        describe: ({ before, after }) => `Decreased B from ${before.b} to ${after.b}. Zero flag Z is ${Number(after.flags.z)}. A, HL, carry, RAM, and output are unchanged.`,
      },
      jumpIf(0x0a, "z", 0),
      haltInstruction(0x0d),
    ] satisfies readonly LessonInstruction[],
    bytes: [0x21, 0, 1, 0x06, 6, 0x7e, 0xd3, 1, 0x23, 0x05, 0xc2, 5, 0, 0x76],
    editableOperand: undefined,
  },
  "terminated-message": {
    createMachine: create8080AltairTerminatedMessageLesson,
    instructions: [loadPointer(0), readPointedByte(3), compare(4), jumpIf(6, "z", 1),
      outputInstruction(9), advancePointer(0x0b), jump(0x0c, () => "Next, read through HL again."), haltInstruction(0x0f)],
    bytes: [0x21, 0, 1, 0x7e, 0xfe, 0, 0xca, 0x0f, 0, 0xd3, 1, 0x23, 0xc3, 3, 0, 0x76],
    editableOperand: undefined,
  },
} as const;

/** Connect the panel to PC and guard execution of a known lesson program. */
export function createAltairProgram(name: keyof typeof programs = "entry", onOutput: (value: number) => void = () => {}) {
  const { createMachine, instructions, bytes, editableOperand } = programs[name];
  const startAddress = instructions[0]!.address;
  let outputWrites = 0;
  const machine: LessonMachine = createMachine({ output: value => { outputWrites++; onOutput(value); } });
  const { ram, endAddress, ports, output, input } = machine;
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
      const address = startAddress + offset;
      if (address !== editableOperand && ram.read(address) !== expected) {
        return `At ${hex(address, 4)}, RAM holds ${hex(ram.read(address), 2)}; enter ${hex(expected, 2)} from the reference card before stepping.`;
      }
    }
    const { pc, halted } = cpu.snapshot();
    if (halted) return "The CPU is halted. EXAMINE changes PC but does not release HALT. Start this lesson again for a fresh run.";
    if (pc === endAddress) return `PC is at ${hex(endAddress, 4)}, just after the program. EXAMINE ${hex(startAddress, 4)} to run it again; memory is preserved.`;
    const instruction = instructions.find(instruction => instruction.address === pc);
    if (!instruction) {
      return `EXAMINE ${hex(startAddress, 4)} to begin. This lesson steps only at instruction starts ${instructions.map(instruction => hex(instruction.address, 4)).join(", ")}.`;
    }
    // A lesson guard, not CPU waiting: an unguarded empty read would return zero.
    if (name === "input" && instruction.action === "input" && input?.snapshot().pendingByte === null) {
      return "Send a byte to the input device first. This lesson pauses before IN while the device is empty; after sending, RUN or step to receive it.";
    }
    return undefined;
  }

  return {
    ram, panel, startAddress, endAddress, instructions, bytes, editableOperand,
    outputSnapshot: () => output && { ...output.snapshot(), writes: outputWrites },
    inputSnapshot: () => input?.snapshot(),
    offerInput(value: number): boolean {
      if (!input) throw new Error("This lesson has no input device.");
      return input.offer(value);
    },
    snapshot: () => cpu.snapshot(),
    stepProblem,
    step(): CompletedInstruction {
      const problem = stepProblem();
      if (problem) throw new Error(problem);
      const record = cpu.step();
      if (record.outcome === "unsupported" || record.instruction === null) {
        throw new Error("The Altair lesson expected a completed instruction.");
      }
      return { ...record, instruction: record.instruction };
    },
  };
}
