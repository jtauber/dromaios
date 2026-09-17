import { initialState, flagPattern } from "../components/cpus/z80/helpers.js";

// Native encodings independent of the production family inventory; null means an absolute address.
export const accumulatorTransfers = [
  { opcode: 0x02, pair: ["b", "c"], operation: "store" },
  { opcode: 0x0a, pair: ["b", "c"], operation: "load" },
  { opcode: 0x12, pair: ["d", "e"], operation: "store" },
  { opcode: 0x1a, pair: ["d", "e"], operation: "load" },
  { opcode: 0x32, pair: null, operation: "store" },
  { opcode: 0x3a, pair: null, operation: "load" },
] as const;

export function accumulatorState(bits = 0) {
  return { ...initialState(), interruptEnabled: true,
    flags: { ...flagPattern(bits), cy: Boolean(bits & 4), ac: Boolean(bits & 8), p: Boolean(bits & 16) } };
}
