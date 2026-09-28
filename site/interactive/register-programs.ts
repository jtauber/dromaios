import { create8080RegisterLesson } from "../../src/machines/generated/8080/register-lesson.js";
import { create8080AddOneLesson } from "../../src/machines/generated/8080/add-one-lesson.js";
import { create8080JumpLesson } from "../../src/machines/generated/8080/jump-lesson.js";
import { create8080LoopLesson } from "../../src/machines/generated/8080/loop-lesson.js";
import type { Cpu8080StepRecord } from "../../src/components/cpus/generated/8080-cpu.js";

export type ExecutedStep = Extract<Cpu8080StepRecord, { outcome: "executed" }>;
type ReadByte = (address: number) => number;

export interface LessonInstruction {
  readonly address: number;
  readonly length: number;
  readonly action: "read" | "add" | "write" | "jump";
  readonly mnemonic: (read: ReadByte) => string;
  readonly explanation: (read: ReadByte) => string;
  readonly prompt: string;
  readonly describe: (record: ExecutedStep, previousDestination: number) => string;
}

interface RegisterProgram {
  readonly createMachine: () => ReturnType<typeof create8080LoopLesson> & { readonly endAddress?: number };
  readonly instructions: readonly LessonInstruction[];
  readonly operandAddress?: number;
  readonly jumpOperand?: { readonly address: number; readonly destinations: readonly number[] };
  readonly showHistory?: boolean;
}

export function hex(value: number, digits: number): string { return value.toString(16).toUpperCase().padStart(digits, "0"); }
export function readAddress(read: ReadByte, address: number): number { return read(address) | (read(address + 1) << 8); }

// These descriptions label the lesson's known instructions; only the CPU executes them.
function load(address: number): LessonInstruction {
  return {
    address, length: 3, action: "read", mnemonic: () => "LDA 0003H", explanation: () => "Read address 3 into A",
    prompt: "First, read address 3 into A. Predict which values will change.",
    describe: ({ before, after }) => `Read ${after.a} from address 3 into A, replacing ${before.a}. Reading left memory unchanged.`,
  };
}

function add(address: number): LessonInstruction {
  return {
    address, length: 2, action: "add", mnemonic: read => `ADI ${read(address + 1)}`,
    explanation: read => read(address + 1) === 1 ? "Add one to A" : `Add ${read(address + 1)} to A`,
    prompt: "Now add one to A. Will either memory location change?",
    describe: ({ instruction, before, after }) => {
      const value = instruction.bytes[1]!;
      return `Added ${value === 1 ? "one" : value} to ${before.a}. A now holds ${after.a}; carry is ${Number(after.flags.cy)}. Memory is unchanged.`;
    },
  };
}

function store(address: number, prompt = "Write the result in A to address 4."): LessonInstruction {
  return {
    address, length: 3, action: "write", mnemonic: () => "STA 0004H", explanation: () => "Write A to address 4", prompt,
    describe: ({ after }, previous) => `Wrote ${after.a} from A to address 4, replacing ${previous}. A kept its value.`,
  };
}

function jump(address: number, continuation: (destination: number) => string): LessonInstruction {
  return {
    address, length: 3, action: "jump",
    mnemonic: read => `JMP ${hex(readAddress(read, address + 1), 4)}H`,
    explanation: read => `Jump to ${hex(readAddress(read, address + 1), 4)}`,
    prompt: "The jump changes where the processor looks next.",
    describe: ({ before, after }) => `Jumped from ${hex(before.pc, 4)} to ${hex(after.pc, 4)}. A, flags, and memory are unchanged. ${continuation(after.pc)}`,
  };
}

const programs: Readonly<Record<string, RegisterProgram>> = {
  copy: {
    createMachine: create8080RegisterLesson,
    instructions: [load(0x100), store(0x103, "A has its own copy. You can change the byte at address 3 before writing A to address 4.")],
  },
  "add-one": {
    createMachine: create8080AddOneLesson,
    instructions: [load(0x100), add(0x103), store(0x105)],
    operandAddress: 0x104,
  },
  jump: {
    createMachine: create8080JumpLesson,
    instructions: [
      load(0x100),
      jump(0x103, destination => destination === 0x108 ? "The addition was skipped; its bytes were not fetched." : "The addition will run next."),
      add(0x106), store(0x108),
    ],
    jumpOperand: { address: 0x104, destinations: [0x106, 0x108] },
    showHistory: true,
  },
  loop: {
    createMachine: create8080LoopLesson,
    instructions: [load(0x100), add(0x103), store(0x105), jump(0x108, () => "The next addition uses the value still in A; the load does not run again.")],
    showHistory: true,
  },
};

export function registerProgram(name: string | undefined): RegisterProgram {
  const program = name !== undefined && Object.hasOwn(programs, name) ? programs[name] : undefined;
  if (!program) throw new Error(`Unknown register lesson: ${name}`);
  return program;
}
