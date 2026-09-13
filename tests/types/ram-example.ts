import { Cpu8080 } from "../../src/components/cpus/8080.js";
import type { Cpu8080State } from "../../src/components/cpus/8080.js";
import type { Cpu6502, Cpu6502State } from "../../src/components/cpus/6502.js";
import type { Cpu6809 } from "../../src/components/cpus/6809.js";
import type { Ram } from "../../src/components/memory/ram.js";
import { defineRamExample } from "../../src/machines/ram-example.js";
import { create8080Example, create8080ExampleMemory } from "../../src/machines/generated/8080/example.js";
import { create8080RegisterPairsExample } from "../../src/machines/generated/8080/register-pairs-example.js";
import { create8080StackExample } from "../../src/machines/generated/8080/stack-example.js";
import { create8080AddressingExample } from "../../src/machines/generated/8080/addressing-example.js";
import { create6502Example } from "../../src/machines/generated/6502/example.js";
import { create6502AddressingExample } from "../../src/machines/generated/6502/addressing-example.js";
import { create6809Example } from "../../src/machines/generated/6809/example.js";

// Compiled by npm test; never called. Guard inference at the shared setup boundary.
export function checkDefinitions(state8080: Cpu8080State, state6502: Cpu6502State): Cpu8080 {
  const definition = { memory: [{ address: 0, bytes: [0x76] }], initialState: state8080 } as const;
  const example = defineRamExample(Cpu8080, definition);
  const machine = example.create();
  const cpu: Cpu8080 = machine.cpu;
  const ram: Ram = example.createMemory();
  // @ts-expect-error The constructor fixes the state type; unrelated CPU state is rejected.
  defineRamExample(Cpu8080, { memory: [], initialState: state6502 });
  // @ts-expect-error Required stored fields cannot be omitted.
  defineRamExample(Cpu8080, { memory: [], initialState: { a: 0 } });
  // @ts-expect-error Derived pair views are not separate initialization fields.
  defineRamExample(Cpu8080, { memory: [], initialState: { ...state8080, bc: 0 } });
  // @ts-expect-error Definition literals must use the constructor's flag types.
  defineRamExample(Cpu8080, { memory: [], initialState: { ...state8080, flags: { ...state8080.flags, cy: 1 } } });
  // @ts-expect-error An example without a completion address does not gain one.
  machine.endAddress;
  const withEnd = defineRamExample(Cpu8080, { ...definition, endAddress: 1 }).create();
  const endAddress: number = withEnd.endAddress;
  return cpu;
}

export function checkExistingFactories(): void {
  const arithmetic: { cpu: Cpu8080; ram: Ram } = create8080Example();
  const pairs: { cpu: Cpu8080; ram: Ram } = create8080RegisterPairsExample();
  const stack: { cpu: Cpu8080; ram: Ram } = create8080StackExample();
  const addressing: { cpu: Cpu8080; ram: Ram } = create8080AddressingExample();
  const memory: Ram = create8080ExampleMemory();
  const mos: { cpu: Cpu6502; ram: Ram; endAddress: number } = create6502Example();
  const mosAddressing: { cpu: Cpu6502; ram: Ram; endAddress: number } = create6502AddressingExample();
  const motorola: { cpu: Cpu6809; ram: Ram; endAddress: number } = create6809Example();
  // @ts-expect-error The factory keeps the concrete CPU type.
  const wrongCpu: Cpu6502 = create8080Example().cpu;
}
