import type { Cpu68000State } from "../../src/components/cpus/state/68000.js";

export function initialState(bits = 127): Cpu68000State {
  return { d0: 0x11223344, d1: 0x55667788, d2: 0x99aabbcc, d3: 0xddeeff00,
    d4: 0x01234567, d5: 0x89abcdef, d6: 0xfedcba98, d7: 0x76543210,
    a0: 0x10000000, a1: 0x20000000, a2: 0x30000000, a3: 0x40000000,
    a4: 0x50000000, a5: 0x60000000, a6: 0x70000000, usp: 0x34ffe000, ssp: 0x56ffd000,
    pc: 0xab001000, ir: 0x1234, faulted: false, entry: { kind: "none", vector: 0 }, halted: false, tracePending: false, interruptMask: 2,
    flags: { x: Boolean(bits & 1), n: Boolean(bits & 2), z: Boolean(bits & 4), v: Boolean(bits & 8), c: Boolean(bits & 16), t: Boolean(bits & 32), s: Boolean(bits & 64) } };
}
