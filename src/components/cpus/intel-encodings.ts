import { opcodeFamily, opcodePattern } from "./opcodes.ts";

export type IntelByteOperand = "a" | "b" | "c" | "d" | "e" | "h" | "l" | "m";

/** One encoding inventory for generated definitions and their execution bindings. */
function byteTransferForms(operands: readonly IntelByteOperand[], matrix: string) {
  return {
    // 00 ddd 110: fetch an immediate byte, then write the selected destination.
    immediate: opcodeFamily("00 ddd 110", { d: operands }, ({ d: destination }) => ({ destination, source: "immediate" as const })),
    // ddd selects the destination, sss the source; the memory-to-memory slot is HALT.
    matrix: opcodeFamily(matrix, { d: operands, s: operands }, ({ d: destination, s: source }) => ({ destination, source }))
      .filter(([, { destination, source }]) => destination !== "m" || source !== "m"),
  } as const;
}

// 8080/Z80: M is selector 110; 01 110 110 is HALT.
export const intelByteTransferForms = byteTransferForms(["b", "c", "d", "e", "h", "l", "m", "a"], "01 ddd sss");
// 01 ppppp 1: rrmmm selects input ports 0..7 and output ports 8..31.
export const intel8008PortForms = opcodeFamily("01 ppppp 1", { p: Array.from({ length: 32 }, (_, port) => port) }, ({ p }) => p);

// 8008 ccc=vff: v requires false/true; ff selects C/Z/S/P. xxx denotes ignored bits.
export const intel8008ControlForms = {
  halt: [...opcodePattern("00 000 00x", undefined), ...opcodePattern("11 111 111", undefined)],
  conditionalReturns: opcodeFamily("00 ccc 011", { c: [0, 1, 2, 3, 4, 5, 6, 7] }, ({ c: condition }) => condition),
  restarts: opcodeFamily("00 vvv 101", { v: [0x00, 0x08, 0x10, 0x18, 0x20, 0x28, 0x30, 0x38] }, ({ v: address }) => address),
  return: opcodePattern("00 xxx 111", undefined),
  conditionalJumps: opcodeFamily("01 ccc 000", { c: [0, 1, 2, 3, 4, 5, 6, 7] }, ({ c: condition }) => condition),
  conditionalCalls: opcodeFamily("01 ccc 010", { c: [0, 1, 2, 3, 4, 5, 6, 7] }, ({ c: condition }) => condition),
  jump: opcodePattern("01 xxx 100", undefined),
  call: opcodePattern("01 xxx 110", undefined),
} as const;

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
