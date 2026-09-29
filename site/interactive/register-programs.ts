import { create8080RegisterLesson } from "../../src/machines/generated/8080/register-lesson.js";
import { create8080AddOneLesson } from "../../src/machines/generated/8080/add-one-lesson.js";
import { create8080JumpLesson } from "../../src/machines/generated/8080/jump-lesson.js";
import { create8080LoopLesson } from "../../src/machines/generated/8080/loop-lesson.js";
import { create8080ConditionalLoopLesson } from "../../src/machines/generated/8080/conditional-loop-lesson.js";
import { create8080CountdownLesson } from "../../src/machines/generated/8080/countdown-lesson.js";
import { create8080ComparisonLesson } from "../../src/machines/generated/8080/comparison-lesson.js";
import type { Cpu8080StepRecord } from "../../src/components/cpus/generated/8080-cpu.js";

export type ExecutedStep = Extract<Cpu8080StepRecord, { outcome: "executed" }>;
/** A completed instruction, including HLT, but never an already-halted no-op. */
export type CompletedInstruction = Pick<ExecutedStep, "before" | "after" | "instruction" | "accesses"> & {
  readonly outcome: "executed" | "halted";
};
type ReadByte = (address: number) => number;

export interface LessonInstruction {
  readonly address: number;
  readonly length: number;
  readonly action: "read" | "add" | "subtract" | "compare" | "write" | "jump" | "input" | "output" | "halt";
  readonly mnemonic: (read: ReadByte) => string;
  readonly explanation: (read: ReadByte) => string;
  readonly prompt: string;
  readonly describe: (record: CompletedInstruction, previousDestination: number) => string;
}

interface RegisterProgram {
  readonly createMachine: () => ReturnType<typeof create8080LoopLesson> & { readonly endAddress?: number };
  readonly instructions: readonly LessonInstruction[];
  readonly operandAddress?: number;
  readonly jumpOperand?: { readonly address: number; readonly destinations: readonly number[] };
  readonly showHistory?: boolean;
  readonly flag?: "cy" | "z";
}

export function hex(value: number, digits: number): string { return value.toString(16).toUpperCase().padStart(digits, "0"); }
export function readAddress(read: ReadByte, address: number): number { return read(address) | (read(address + 1) << 8); }

// These descriptions label the lesson's known instructions; only the CPU executes them.
export function load(address: number): LessonInstruction {
  return {
    address, length: 3, action: "read", mnemonic: () => "LDA 0003H", explanation: () => "Read address 3 into A",
    prompt: "First, read address 3 into A. Predict which values will change.",
    describe: ({ before, after }) => `Read ${after.a} from address 3 into A, replacing ${before.a}. Reading left memory unchanged.`,
  };
}

export function loadImmediate(address: number, register: "a" | "b" | "c" | "d" | "e" | "h" | "l" = "a"): LessonInstruction {
  const name = register.toUpperCase();
  return {
    address, length: 2, action: "read", mnemonic: read => `MVI ${name},${hex(read(address + 1), 2)}H`,
    explanation: read => `Put ${read(address + 1)} into ${name}`,
    prompt: `Copy the byte in the instruction into ${name}. Has the output device received it yet?`,
    describe: ({ instruction, before, after }) => `Copied ${instruction.bytes[1]} from the instruction into ${name}, replacing ${before[register]}. ${name} now holds ${after[register]}; flags, RAM, and the output device are unchanged.`,
  };
}

export function add(address: number, flag: "cy" | "z" = "cy"): LessonInstruction {
  return {
    address, length: 2, action: "add", mnemonic: read => `ADI ${read(address + 1)}`,
    explanation: read => read(address + 1) === 1 ? "Add one to A" : `Add ${read(address + 1)} to A`,
    prompt: "Now add one to A. Will either memory location change?",
    describe: ({ instruction, before, after }) => {
      const value = instruction.bytes[1]!;
      const label = flag === "cy" ? "carry" : "zero flag Z";
      return `Added ${value === 1 ? "one" : value} to ${before.a}. A now holds ${after.a}; ${label} is ${Number(after.flags[flag])}. Memory is unchanged.`;
    },
  };
}

export function compare(address: number): LessonInstruction {
  return {
    address, length: 2, action: "compare", mnemonic: read => `CPI ${read(address + 1)}`,
    explanation: read => `Compare A with ${read(address + 1)}`,
    prompt: "Compare A with the target. Will Z be set or clear?",
    describe: ({ instruction, before, after }) =>
      `Compared A (${before.a}) with ${instruction.bytes[1]}. Zero flag Z is ${Number(after.flags.z)}: the values ${after.flags.z ? "match" : "differ"}. A still holds ${after.a}; memory is unchanged.`,
  };
}

function subtract(address: number): LessonInstruction {
  return {
    address, length: 2, action: "subtract", mnemonic: read => `SUI ${read(address + 1)}`,
    explanation: read => read(address + 1) === 1 ? "Subtract one from A" : `Subtract ${read(address + 1)} from A`,
    prompt: "Now subtract one from A. Will the result be zero?",
    describe: ({ instruction, before, after }) => {
      const value = instruction.bytes[1]!;
      return `Subtracted ${value === 1 ? "one" : value} from ${before.a}. A now holds ${after.a}; zero flag Z is ${Number(after.flags.z)}. Memory is unchanged.`;
    },
  };
}

function store(address: number, prompt = "Write the result in A to address 4."): LessonInstruction {
  return {
    address, length: 3, action: "write", mnemonic: () => "STA 0004H", explanation: () => "Write A to address 4", prompt,
    describe: ({ after }, previous) => `Wrote ${after.a} from A to address 4, replacing ${previous}. A kept its value.`,
  };
}

export function jump(address: number, continuation: (destination: number) => string): LessonInstruction {
  return {
    address, length: 3, action: "jump",
    mnemonic: read => `JMP ${hex(readAddress(read, address + 1), 4)}H`,
    explanation: read => `Jump to ${hex(readAddress(read, address + 1), 4)}`,
    prompt: "The jump changes where the processor looks next.",
    describe: ({ before, after }) => `Jumped from ${hex(before.pc, 4)} to ${hex(after.pc, 4)}. A, flags, and memory are unchanged. ${continuation(after.pc)}`,
  };
}

export function jumpIf(address: number, flag: "cy" | "z", expected: 0 | 1): LessonInstruction {
  const mnemonic = { cy: ["JNC", "JC"], z: ["JNZ", "JZ"] }[flag][expected];
  const label = flag.toUpperCase();
  return {
    address, length: 3, action: "jump",
    mnemonic: read => `${mnemonic} ${hex(readAddress(read, address + 1), 4)}H`,
    explanation: read => `Jump to ${hex(readAddress(read, address + 1), 4)} if ${label} = ${expected}`,
    prompt: `Check ${label}. Will the processor jump or continue to the following instruction?`,
    describe: ({ instruction, before, after }) => {
      const taken = Number(before.flags[flag]) === expected;
      const direction = after.pc < instruction.address ? "returned" : "jumped";
      const decision = taken ? `Jump taken: ${direction}` : "Jump not taken: continued";
      return `${label} was ${Number(before.flags[flag])} (${before.flags[flag] ? "set" : "clear"}). ${decision} from ${hex(before.pc, 4)} to ${hex(after.pc, 4)}. A, flags, and memory are unchanged.`;
    },
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
  "conditional-loop": {
    createMachine: create8080ConditionalLoopLesson,
    instructions: [load(0x100), add(0x103), store(0x105), jumpIf(0x108, "cy", 0)],
    showHistory: true,
  },
  countdown: {
    createMachine: create8080CountdownLesson,
    instructions: [load(0x100), subtract(0x103), store(0x105), jumpIf(0x108, "z", 0)],
    showHistory: true,
    flag: "z",
  },
  comparison: {
    createMachine: create8080ComparisonLesson,
    instructions: [load(0x100), add(0x103, "z"), store(0x105), compare(0x108), jumpIf(0x10a, "z", 0)],
    operandAddress: 0x109,
    showHistory: true,
    flag: "z",
  },
};

export function registerProgram(name: string | undefined): RegisterProgram {
  const program = name !== undefined && Object.hasOwn(programs, name) ? programs[name] : undefined;
  if (!program) throw new Error(`Unknown register lesson: ${name}`);
  return program;
}
