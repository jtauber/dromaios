import { opcodeFamily, opcodePattern } from "./opcodes.ts";

export type IntelByteOperand = "a" | "b" | "c" | "d" | "e" | "h" | "l" | "m";

// 00 pp q 010: pp=00/01 uses BC/DE, pp=11 fetches nn; q=0 stores A, q=1 loads A.
// pp=10 belongs to the HL word transfers below.
export const intelAccumulatorTransferForms = {
  indirect: opcodeFamily("00 0p q 010", { p: ["bc", "de"] as const, q: ["store", "load"] as const }, ({ p: address, q: operation }) => ({ address, operation })),
  absolute: opcodeFamily("00 11 q 010", { q: ["store", "load"] as const }, ({ q: operation }) => ({ address: "absolute" as const, operation })),
} as const;

// 8080/Z80 word transfers share base encodings; q in the memory pair selects store/load.
export const intelWordTransferForms = {
  immediate: opcodeFamily("00 pp 0 001", { p: ["bc", "de", "hl", "sp"] as const }, ({ p: register }) => ({ register, operation: "immediate" as const })),
  memory: opcodeFamily("00 10 q 010", { q: ["store", "load"] as const }, ({ q: operation }) => ({ register: "hl" as const, operation })),
  stackPointer: opcodePattern("11 11 1 001", { register: "hl", operation: "copy" } as const),
} as const;

// 8080/Z80: pp selects BC/DE/HL/SP; adjustment q=0 increments, q=1 decrements without flag access.
export const intelWordArithmeticForms = {
  addition: opcodeFamily("00 pp 1 001", { p: ["bc", "de", "hl", "sp"] as const }, ({ p: register }) => ({ register, operation: "add" as const })),
  adjustment: opcodeFamily("00 pp q 011", { p: ["bc", "de", "hl", "sp"] as const, q: ["increment", "decrement"] as const },
    ({ p: register, q: operation }) => ({ register, operation })),
} as const;

// 11 10 m 011: m=0 exchanges HL with (SP); m=1 exchanges DE with HL.
export const intelExchangeForms = opcodeFamily("11 10 m 011", { m: ["stack", "register"] as const }, ({ m: operation }) => operation);

// ccc=ffv: ff selects Z/C/P/S (Z80 uses P/V); v is the required value.
export const intelJumpForms = {
  conditional: opcodeFamily("11 ccc 010", { c: [0, 1, 2, 3, 4, 5, 6, 7] }, ({ c: condition }) => condition),
  absolute: opcodePattern("11 000 011", "absolute"),
  indirect: opcodePattern("11 10 1 001", "indirect"),
} as const;

// 11 pp 0 q01: pp selects BC/DE/HL; pp=11 is the CPU-owned packed status word. q=0 pops, q=1 pushes.
function registerStackForms(pattern: string) {
  return opcodeFamily(pattern, { p: ["bc", "de", "hl", undefined] as const }, ({ p: register }) => register)
    .flatMap(([opcode, register]) => register === undefined ? [] : [[opcode, register] as const]);
}
export const intelStackForms = { pop: registerStackForms("11 pp 0 001"), push: registerStackForms("11 pp 0 101") };

// ccc=ffv uses the jump conditions; ttt selects restart address bits 5..3.
export const intelSubroutineForms = {
  conditionalCalls: opcodeFamily("11 ccc 100", { c: [0, 1, 2, 3, 4, 5, 6, 7] }, ({ c: condition }) => condition),
  call: opcodePattern("11 00 1 101", undefined),
  conditionalReturns: opcodeFamily("11 ccc 000", { c: [0, 1, 2, 3, 4, 5, 6, 7] }, ({ c: condition }) => condition),
  return: opcodePattern("11 00 1 001", undefined),
  restarts: opcodeFamily("11 ttt 111", { t: [0x00, 0x08, 0x10, 0x18, 0x20, 0x28, 0x30, 0x38] }, ({ t: address }) => address),
} as const;
