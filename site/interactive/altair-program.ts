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
import { create8080AltairBufferLesson } from "../../src/machines/generated/8080/altair-buffer-lesson.js";
import { create8080AltairSubroutineLesson } from "../../src/machines/generated/8080/altair-subroutine-lesson.js";
import { create8080AltairNestedCallLesson } from "../../src/machines/generated/8080/altair-nested-call-lesson.js";
import { create8080AltairSaveRegistersLesson } from "../../src/machines/generated/8080/altair-save-registers-lesson.js";
import { create8080AltairCommandPromptLesson } from "../../src/machines/generated/8080/altair-command-prompt-lesson.js";
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

function readinessInstruction(address: number): LessonInstruction {
  return {
    address, length: 2, action: "input", mnemonic: () => "IN 00H",
    explanation: () => "Read readiness from input port 0 into A: 0 empty, 1 ready",
    prompt: "Check readiness without receiving the byte. What will A hold?",
    describe: ({ before, after }) => `Read readiness ${after.a} (${after.a === 0 ? "empty" : "ready"}) from input port 0 into A, replacing ${before.a}. Checking consumed no data. Flags, RAM, and the output device were unchanged.`,
  };
}

function loadPointer(address: number): LessonInstruction {
  return {
    address, length: 3, action: "read", mnemonic: read => `LXI H,${hex(readAddress(read, address + 1), 4)}H`,
    explanation: read => `Put address ${hex(readAddress(read, address + 1), 4)} into HL`,
    prompt: "Set the address pointer. Has a byte been read yet?",
    describe: ({ before, after }) => `Set HL from ${hex(before.hl, 4)} to ${hex(after.hl, 4)}. H holds ${hex(after.h, 2)} and L holds ${hex(after.l, 2)}. A, flags, RAM, and output are unchanged; no data byte was read.`,
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

function writePointedByte(address: number): LessonInstruction {
  return {
    address, length: 1, action: "write", mnemonic: () => "MOV M,A",
    explanation: () => "Store A in the RAM byte addressed by HL",
    prompt: "Store through HL. Will A, the pointer, or the display change?",
    describe: record => {
      const write = record.accesses.find(access => access.kind === "write");
      if (!write || write.kind !== "write") throw new Error("Expected a captured RAM write.");
      return `Wrote ${write.value} from A to RAM at ${hex(write.address, 4)}, the address in HL. Data registers, flags, and output are unchanged. Storing a byte does not advance the pointer or print it.`;
    },
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

function decrementCount(address: number): LessonInstruction {
  return {
    address, length: 1, action: "subtract", mnemonic: () => "DCR B",
    explanation: () => "Subtract one from the count in B",
    prompt: "Decrease the count. Is it zero?",
    describe: ({ before, after }) => `Decreased B from ${before.b} to ${after.b}. Zero flag Z is ${Number(after.flags.z)}. A, HL, carry, RAM, and output are unchanged.`,
  };
}

function readCount(address: number): LessonInstruction {
  return {
    address, length: 1, action: "read", mnemonic: () => "MOV A,B",
    explanation: () => "Copy the slots remaining in B into A for comparison",
    prompt: "Read the remaining count. Does copying it change B or the flags?",
    describe: ({ before, after }) => `Copied B (${before.b}) into A, replacing ${before.a}. B remains ${after.b}; HL, flags, RAM, and output are unchanged. The next comparisons can distinguish an empty line (8 slots left), one character (7), and longer lines.`,
  };
}

function loadStackPointer(address: number): LessonInstruction {
  return {
    address, length: 3, action: "read", mnemonic: read => `LXI SP,${hex(readAddress(read, address + 1), 4)}H`,
    explanation: read => `Put address ${hex(readAddress(read, address + 1), 4)} into SP`,
    prompt: "Choose where the stack begins. Has a return address been saved yet?",
    describe: ({ before, after }) => `Set SP from ${hex(before.sp, 4)} to ${hex(after.sp, 4)}. This selects a stack starting point without reading or writing its RAM. Data registers, flags, and output are unchanged.`,
  };
}

function describeWrites(accesses: CompletedInstruction["accesses"]): string {
  return accesses.flatMap(access => access.kind === "write"
    ? [`${hex(access.address, 4)} ← ${hex(access.value, 2)}`] : []).join(", then ");
}

function pushPointer(address: number): LessonInstruction {
  return {
    address, length: 1, action: "write", mnemonic: () => "PUSH H",
    explanation: () => "Save H and L on the stack without changing HL",
    prompt: "Save the pointer. Which bytes will change, and will HL move?",
    describe: ({ before, after, accesses }) => `Saved HL ${hex(before.hl, 4)} in RAM: ${describeWrites(accesses)}. SP moved from ${hex(before.sp, 4)} to ${hex(after.sp, 4)}. HL still holds ${hex(after.hl, 4)}; A, flags, and output are unchanged. PUSH H saves both H and L.`,
  };
}

function popPointer(address: number): LessonInstruction {
  return {
    address, length: 1, action: "read", mnemonic: () => "POP H",
    explanation: () => "Read the stack's low and high bytes into L and H",
    prompt: "Restore the pointer. Will this return to the caller too?",
    describe: ({ before, after }) => `Read L ${hex(after.l, 2)} from RAM at ${hex(before.sp, 4)} and H ${hex(after.h, 2)} from ${hex((before.sp + 1) & 0xffff, 4)}. HL changed from ${hex(before.hl, 4)} to ${hex(after.hl, 4)}; SP moved from ${hex(before.sp, 4)} to ${hex(after.sp, 4)}. PC advanced to ${hex(after.pc, 4)}, the next instruction. A, flags, RAM, and output are unchanged; POP did not return to the caller.`,
  };
}

function callInstruction(address: number): LessonInstruction {
  return {
    address, length: 3, action: "jump", mnemonic: read => `CALL ${hex(readAddress(read, address + 1), 4)}H`,
    explanation: read => `Save the return address and call the routine at ${hex(readAddress(read, address + 1), 4)}`,
    prompt: "Which address must the CPU remember to continue after this CALL?",
    describe: ({ instruction, before, after, accesses }) => {
      const continuation = (instruction.address + instruction.bytes.length) & 0xffff;
      return `Saved return address ${hex(continuation, 4)} in RAM: ${describeWrites(accesses)}. SP moved from ${hex(before.sp, 4)} to ${hex(after.sp, 4)}; PC moved to ${hex(after.pc, 4)}. A, HL, flags, and output are unchanged. The routine's first instruction is next.`;
    },
  };
}

function returnInstruction(address: number): LessonInstruction {
  return {
    address, length: 1, action: "jump", mnemonic: () => "RET",
    explanation: () => "Read the saved return address from RAM at SP and continue there",
    prompt: "Where will this RET go, and will it erase the saved address?",
    describe: ({ before, after }) => `Read return address ${hex(after.pc, 4)} from RAM at ${hex(before.sp, 4)} and ${hex((before.sp + 1) & 0xffff, 4)} into PC. SP moved from ${hex(before.sp, 4)} to ${hex(after.sp, 4)}. Reading did not erase the bytes. A, HL, flags, and output are unchanged.`,
  };
}

// A reference for manual entry, never an image loaded into the learner's RAM.
export const altairProgramBytes = [0x3a, 0x03, 0x00, 0xc6, 0x01, 0x32, 0x04, 0x00] as const;
export const altairOperandAddress = 0x104;
// The echo and reply programs share their receive loop at 0100.
const receiveInstructions = [readinessInstruction(0x100), compare(0x102), jumpIf(0x104, "z", 1), inputInstruction(0x107)];
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
      decrementCount(9),
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
  buffer: {
    createMachine: create8080AltairBufferLesson,
    instructions: [
      loadPointer(0), loadImmediate(3, "b"),
      readinessInstruction(5), compare(7), jumpIf(9, "z", 1), inputInstruction(0x0c),
      compare(0x0e), jumpIf(0x10, "z", 1), writePointedByte(0x13), advancePointer(0x14),
      decrementCount(0x15), jumpIf(0x16, "z", 0),
      loadImmediate(0x19), writePointedByte(0x1b), loadPointer(0x1c),
      readPointedByte(0x1f), compare(0x20), jumpIf(0x22, "z", 1),
      outputInstruction(0x25), advancePointer(0x27), jump(0x28, () => "Next, read through HL again."), haltInstruction(0x2b),
    ],
    bytes: [0x21, 0, 1, 0x06, 8, 0xdb, 0, 0xfe, 0, 0xca, 5, 0, 0xdb, 1, 0xfe, 10, 0xca, 0x19, 0,
      0x77, 0x23, 0x05, 0xc2, 5, 0, 0x3e, 0, 0x77, 0x21, 0, 1,
      0x7e, 0xfe, 0, 0xca, 0x2b, 0, 0xd3, 1, 0x23, 0xc3, 0x1f, 0, 0x76],
    editableOperand: undefined,
  },
  subroutine: {
    createMachine: create8080AltairSubroutineLesson,
    instructions: [loadStackPointer(0), callInstruction(3), callInstruction(6), haltInstruction(9),
      loadPointer(0x0a), readPointedByte(0x0d), compare(0x0e), jumpIf(0x10, "z", 1),
      outputInstruction(0x13), advancePointer(0x15), jump(0x16, () => "Next, read through HL again."), returnInstruction(0x19)],
    bytes: [0x31, 0, 2, 0xcd, 0x0a, 0, 0xcd, 0x0a, 0, 0x76,
      0x21, 0, 1, 0x7e, 0xfe, 0, 0xca, 0x19, 0, 0xd3, 1, 0x23, 0xc3, 0x0d, 0, 0xc9],
    editableOperand: undefined,
  },
  "nested-call": {
    createMachine: create8080AltairNestedCallLesson,
    instructions: [loadStackPointer(0), callInstruction(3), callInstruction(6), haltInstruction(9),
      loadPointer(0x0a), readPointedByte(0x0d), compare(0x0e), jumpIf(0x10, "z", 1),
      callInstruction(0x13), advancePointer(0x16), jump(0x17, () => "Next, read through HL again."),
      returnInstruction(0x1a), outputInstruction(0x1b), returnInstruction(0x1d)],
    bytes: [0x31, 0, 2, 0xcd, 0x0a, 0, 0xcd, 0x0a, 0, 0x76,
      0x21, 0, 1, 0x7e, 0xfe, 0, 0xca, 0x1a, 0, 0xcd, 0x1b, 0, 0x23, 0xc3, 0x0d, 0, 0xc9, 0xd3, 1, 0xc9],
    editableOperand: undefined,
  },
  "save-registers": {
    createMachine: create8080AltairSaveRegistersLesson,
    instructions: [loadStackPointer(0), loadPointer(3), callInstruction(6), callInstruction(9), haltInstruction(0x0c),
      pushPointer(0x0d), readPointedByte(0x0e), compare(0x0f), jumpIf(0x11, "z", 1),
      outputInstruction(0x14), advancePointer(0x16), jump(0x17, () => "Next, read through HL again."),
      popPointer(0x1a), returnInstruction(0x1b)],
    bytes: [0x31, 0, 2, 0x21, 0, 1, 0xcd, 0x0d, 0, 0xcd, 0x0d, 0, 0x76,
      0xe5, 0x7e, 0xfe, 0, 0xca, 0x1a, 0, 0xd3, 1, 0x23, 0xc3, 0x0e, 0, 0xe1, 0xc9],
    editableOperand: undefined,
  },
  "command-prompt": {
    createMachine: create8080AltairCommandPromptLesson,
    instructions: [
      // Print the prompt and prepare the buffer.
      loadStackPointer(0x00), loadPointer(0x03), callInstruction(0x06),
      loadPointer(0x09), loadImmediate(0x0c, "b"),
      // Collect eight characters at most; drain any excess through LF.
      callInstruction(0x0e), compare(0x11), jumpIf(0x13, "z", 1),
      writePointedByte(0x16), outputInstruction(0x17), advancePointer(0x19),
      decrementCount(0x1a), jumpIf(0x1b, "z", 0), callInstruction(0x1e),
      compare(0x21), jumpIf(0x23, "z", 0),
      // Terminate the line and check its length.
      loadImmediate(0x26), writePointedByte(0x28), loadImmediate(0x29),
      outputInstruction(0x2b), readCount(0x2d), compare(0x2e),
      jumpIf(0x30, "z", 1), compare(0x33), jumpIf(0x35, "z", 0),
      // Read the command from RAM and choose the response.
      loadPointer(0x38), readPointedByte(0x3b), compare(0x3c),
      jumpIf(0x3e, "z", 1), compare(0x41), jumpIf(0x43, "z", 1),
      // Select UNKNOWN, HELLO, or help; print it and return to the prompt.
      loadPointer(0x46), jump(0x49, () => "Next, print the selected response."),
      loadPointer(0x4c), jump(0x4f, () => "Next, print the selected response."),
      loadPointer(0x52), callInstruction(0x55), jump(0x58, () => "Next, print another prompt."),
      // Receive one byte, waiting until it is ready.
      readinessInstruction(0x5b), compare(0x5d), jumpIf(0x5f, "z", 1),
      inputInstruction(0x62), returnInstruction(0x64),
      // Print a zero-terminated message, preserving HL.
      pushPointer(0x65), readPointedByte(0x66), compare(0x67),
      jumpIf(0x69, "z", 1), outputInstruction(0x6c), advancePointer(0x6e),
      jump(0x6f, () => "Next, read through HL again."), popPointer(0x72), returnInstruction(0x73),
    ],
    bytes: [
      0x31, 0x00, 0x02, 0x21, 0x20, 0x01, 0xcd, 0x65, 0x00, 0x21, 0x00, 0x01, 0x06, 0x08, 0xcd, 0x5b,
      0x00, 0xfe, 0x0a, 0xca, 0x26, 0x00, 0x77, 0xd3, 0x01, 0x23, 0x05, 0xc2, 0x0e, 0x00, 0xcd, 0x5b,
      0x00, 0xfe, 0x0a, 0xc2, 0x1e, 0x00, 0x3e, 0x00, 0x77, 0x3e, 0x0a, 0xd3, 0x01, 0x78, 0xfe, 0x08,
      0xca, 0x03, 0x00, 0xfe, 0x07, 0xc2, 0x46, 0x00, 0x21, 0x00, 0x01, 0x7e, 0xfe, 0x48, 0xca, 0x4c,
      0x00, 0xfe, 0x3f, 0xca, 0x52, 0x00, 0x21, 0x60, 0x01, 0xc3, 0x55, 0x00, 0x21, 0x30, 0x01, 0xc3,
      0x55, 0x00, 0x21, 0x40, 0x01, 0xcd, 0x65, 0x00, 0xc3, 0x03, 0x00, 0xdb, 0x00, 0xfe, 0x00, 0xca,
      0x5b, 0x00, 0xdb, 0x01, 0xc9, 0xe5, 0x7e, 0xfe, 0x00, 0xca, 0x72, 0x00, 0xd3, 0x01, 0x23, 0xc3,
      0x66, 0x00, 0xe1, 0xc9,
    ],
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
