import { Ram } from "../components/memory/ram.js";

interface MemoryBlock {
  readonly address: number;
  readonly bytes: readonly number[];
}

interface RamExampleDefinition<State> {
  readonly ramSize?: number;
  readonly memory: readonly MemoryBlock[];
  readonly initialState: State;
}

interface RamMachine<Cpu> {
  cpu: Cpu;
  ram: Ram;
}

interface ExampleFactories<Machine> {
  /** Allocate and load RAM without constructing a CPU. */
  readonly createMemory: () => Ram;
  readonly create: () => Machine;
}

// Preserve the required completion address only for examples that specify one.
// Infer State from the constructor, not from the supplied initialization data.
/** Define fresh flat-RAM setups, defaulting to 64 KiB. CPU constructors validate state. */
export function defineRamExample<State, Cpu>(
  Cpu: new (ram: Ram, initialState: State) => Cpu,
  definition: RamExampleDefinition<NoInfer<State>> & { readonly endAddress: number },
): ExampleFactories<RamMachine<Cpu> & { endAddress: number }>;
export function defineRamExample<State, Cpu>(
  Cpu: new (ram: Ram, initialState: State) => Cpu,
  definition: RamExampleDefinition<NoInfer<State>>,
): ExampleFactories<RamMachine<Cpu>>;
export function defineRamExample<State, Cpu>(
  Cpu: new (ram: Ram, initialState: State) => Cpu,
  { ramSize = 0x10000, memory, initialState, endAddress }: RamExampleDefinition<State> & { readonly endAddress?: number },
): ExampleFactories<RamMachine<Cpu> & { endAddress?: number }> {
  const createMemory = (): Ram => {
    const ram = new Ram(ramSize);
    for (const { address, bytes } of memory) {
      for (const [offset, value] of bytes.entries()) {
        ram.write(address + offset, value);
      }
    }
    return ram;
  };

  return {
    createMemory,
    create: () => {
      const ram = createMemory();
      const machine = { cpu: new Cpu(ram, initialState), ram };
      return endAddress === undefined ? machine : { ...machine, endAddress };
    },
  };
}
