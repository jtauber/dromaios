// Each word is a view of its high and low stored bytes, never separate state.
export const pairBytes = { bc: ["b", "c"], de: ["d", "e"], hl: ["h", "l"] } as const;
export type RegisterPair = keyof typeof pairBytes;
