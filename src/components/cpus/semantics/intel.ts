import { addWrap, concat, fetchByte, flagValue, literal, readFlag, readMemory, readRegister, readSource, subtract, updateFlags, value, writeMemory, writeRegister } from "./model.ts";
import type { CpuDeclaration, Flag, FlagPolicy, InstructionDefinition, Register, Statement, ValueSource } from "./model.ts";
import { readWord, registerSource, transfer, writeWord } from "./builders.ts";
import { defineInstruction } from "./validate.ts";
import { byteStack, stackPop, stackPush, wordStack } from "./stack.ts";

type IntelByteOperand = "a" | "b" | "c" | "d" | "e" | "h" | "l" | "m";

interface IntelByteCpu {
  readonly declaration: CpuDeclaration;
  register(field: "a" | "b" | "c" | "d" | "e" | "h" | "l"): Register;
}

interface IntelWordCpu extends IntelByteCpu {
  register(field: "a" | "b" | "c" | "d" | "e" | "h" | "l" | "sp" | "pc"): Register;
}
type WordRegister = Register | { readonly source: ValueSource; readonly write: readonly Statement[] };
type WordTransfer = "immediate" | "load" | "store" | "copy";

const wordSource = (register: WordRegister): ValueSource => "kind" in register ? registerSource(register) : register.source;
const wordDestination = (register: WordRegister): Register | readonly Statement[] => "kind" in register ? register : register.write;

export const immediateWord: ValueSource = { name: "immediate word, low byte first", width: 16,
  steps: [fetchByte("low"), fetchByte("high")], result: concat(value("high"), value("low")) };

/** Register pushes capture the complete word before SP; pops replace it only after both reads. */
export function intelStackTransfer(cpu: IntelWordCpu, register: WordRegister, operation: "push" | "pop", name: string) {
  const stack = wordStack(byteStack(cpu.register("sp"), "occupied"), "little-endian");
  return operation === "push" ? stackPush(cpu.declaration, name, stack, wordSource(register))
    : stackPop(cpu.declaration, name, stack, wordDestination(register));
}

/** Complete word transfers own operand fetching, source capture, and ordered writes; flags are never accessed. */
export function intelWordTransfer(cpu: IntelWordCpu, register: WordRegister, operation: WordTransfer, name: string): InstructionDefinition {
  const memory = operation === "load" || operation === "store";
  const address = value("address"), next = addWrap(address, literal(16, 1));
  const word = readWord("low-first", address, next);
  const source: ValueSource = operation === "immediate" ? immediateWord : operation === "load"
    ? { name: "memory word, low byte first", width: 16,
      steps: [readSource("address", immediateWord), ...word.steps], result: word.result }
    : wordSource(register);
  const destination = operation === "copy" ? cpu.register("sp") : operation === "store"
    ? writeWord("low-first", address, next, value("result"))
    : wordDestination(register);
  return defineInstruction({ cpu: cpu.declaration, name,
    explanation: (memory ? "Fetch the complete address low byte first, then " : operation === "immediate" ? "Fetch the immediate low byte then high byte; " : "")
      + (operation === "store" ? "capture the complete source before writing memory low byte then high byte, wrapping at FFFF. Never read the destination; a failed second write retains the first. "
        : operation === "load" ? "read memory low byte then high byte, wrapping at FFFF. Only after both reads succeed, write the destination. "
        : operation === "copy" ? "Capture the complete source, then write SP without memory access. " : "write the destination only after both fetches succeed. ")
      + "Register pairs use explicit high-then-low byte reads and writes. Preserve flags, alternate banks, and control state without accessing them. Completed accesses remain on failure.",
    steps: [...(operation === "store" ? [readSource("address", immediateWord)] : []), ...transfer(destination, source)],
  });
}

/** Stack exchange captures the register and SP before reading low/high, then writing high/low. SP is unchanged. */
export function intelStackExchange(cpu: IntelWordCpu, register: WordRegister, name: string): InstructionDefinition {
  const address = value("address"), next = addWrap(address, literal(16, 1));
  const word = readWord("low-first", address, next);
  return defineInstruction({ cpu: cpu.declaration, name,
    explanation: "Capture the complete register, then SP. Read memory low byte then high byte, wrapping at FFFF. "
      + "Write the original register high byte then low byte to those captured addresses, even if unchanged. "
      + "Only after both writes succeed, replace the register with the captured memory word; pairs read and write high byte first. "
      + "A failed access prevents register writeback and retains completed memory writes. Never write SP or access flags, alternate banks, or control state.",
    steps: [readSource("original", wordSource(register)), readRegister("address", cpu.register("sp")),
      ...word.steps, ...writeWord("high-first", next, address, value("original")),
      ...transfer(wordDestination(register), word.result)],
  });
}

/** Word adjustments wrap without accessing flags; pair views keep their high-then-low order. */
export function intelWordAdjustment(cpu: IntelWordCpu, register: WordRegister, delta: -1 | 1, name: string): InstructionDefinition {
  return defineInstruction({ cpu: cpu.declaration, name,
    explanation: `${delta === 1 ? "Add" : "Subtract"} one with word wraparound. Capture the complete register before writing it; pairs read and write high byte first. Do not access flags, memory, alternate banks, or control state.`,
    steps: [readSource("original", wordSource(register)),
      ...transfer(wordDestination(register), (delta === 1 ? addWrap : subtract)(value("original"), literal(16, 1)))],
  });
}

/** Word arithmetic captures source, destination, and optional carry, then writes the word before flags. */
export function intelWordArithmetic(cpu: IntelWordCpu, destination: WordRegister, source: WordRegister, operation: "add" | "subtract",
  flags: FlagPolicy, name: string, incoming?: Flag): InstructionDefinition {
  const left = value("left"), right = value("right"), carry = incoming === undefined ? undefined : flagValue("carry");
  return defineInstruction({ cpu: cpu.declaration, name,
    explanation: `Read the complete source before the destination, even when both operands name the same register. ${incoming === undefined ? "Do not read incoming flags." : "Then capture incoming carry."} `
      + `${operation === "add" ? "Add" : "Subtract"} with word wraparound; write the destination before applying ${flags.name}. `
      + "Pairs read and write high byte first. Preserve unlisted flags, alternate banks, and control state; no memory access occurs.",
    steps: [readSource("right", wordSource(source)), readSource("left", wordSource(destination)),
      ...(incoming === undefined ? [] : [readFlag("carry", incoming)]),
      ...transfer(wordDestination(destination), (operation === "add" ? addWrap : subtract)(left, right, carry)),
      updateFlags(flags, { left, right, result: value("result"), ...(carry === undefined ? {} : { carry }) })],
  });
}

/** Indexed transfers use one resolved address, capturing the source before writing. */
export function intelByteTransfer(cpu: IntelByteCpu, destination: IntelByteOperand, source: IntelByteOperand | "immediate",
  name: string): InstructionDefinition {
  if (destination === "m" && source === "m") throw new Error("The memory-to-memory slot belongs to HALT.");
  const address = value("address");
  return defineInstruction({ cpu: cpu.declaration, name, inputs: { address: 16 },
    explanation: "Entry follows indexed address resolution; use that captured address. "
      + "Capture the source before writing the destination, including self-transfers and unchanged writes. "
      + "Stores never read the destination. Do not access flags or control state. A failed source read or fetch prevents writeback.",
    steps: [
      ...(source === "immediate" ? [fetchByte("result")] : source === "m"
        ? [readMemory("result", address)] : [readRegister("result", cpu.register(source))]),
      destination === "m" ? writeMemory(address, value("result")) : writeRegister(cpu.register(destination), value("result")),
    ],
  });
}
