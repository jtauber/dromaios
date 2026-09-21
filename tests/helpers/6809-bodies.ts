import type { Cpu6809State } from "../../src/components/cpus/state/6809.js";
import type { ByteInstructionContext } from "../../src/components/cpus/instruction-context.js";
import type { ByteMemory } from "../../src/components/cpus/memory-access.js";
import { instructions as actions } from "../../src/components/cpus/generated/6809-state.js";
import { instructions as base } from "../../src/components/cpus/generated/6809.js";

const unexpected = (): never => { throw new Error("Unexpected data-memory access"); };

// Supply extended instruction bytes while retaining independently checked operand effects.
function extended(execute: (state: Cpu6809State, instruction: ByteInstructionContext) => void) {
  return (state: Cpu6809State, address: number, context: Partial<ByteMemory>): void => {
    const bytes = [address >> 8, address & 0xff];
    execute(state, { readByte: unexpected, writeByte: unexpected, ...context, fetchByte: () => bytes.shift()! });
  };
}

// LEA has only indexed encodings: use extended indirect through a synthetic pointer.
function lea(execute: (state: Cpu6809State, instruction: ByteInstructionContext) => void) {
  return (state: Cpu6809State, address: number): void => {
    const bytes = [0x9f, 0, 0];
    execute(state, { fetchByte: () => bytes.shift()!, writeByte: unexpected,
      readByte: pointer => pointer === 0 ? address >> 8 : address & 0xff });
  };
}

// Names used by independent cross-CPU probes; migrated bodies use literal
// chapter opcodes throughout.
export const bodies6809 = {
  sync: base[0x13], cwai: base[0x3c], rti: base[0x3b],
  swi: base[0x3f], swi2: base[0x103f], swi3: base[0x113f],
  pshs: base[0x34], puls: base[0x35], pshu: base[0x36], pulu: base[0x37],
  pushFrame: actions.pushSystemRegisters,
  cmpdImmediate: base[0x1083], cmpdMemory: extended(base[0x10b3]),
  cmpyImmediate: base[0x108c], cmpyMemory: extended(base[0x10bc]),
  cmpuImmediate: base[0x1183], cmpuMemory: extended(base[0x11b3]),
  cmpsImmediate: base[0x118c], cmpsMemory: extended(base[0x11bc]),
  ldyImmediate: base[0x108e], ldyMemory: extended(base[0x10be]), styMemory: extended(base[0x10bf]),
  ldsImmediate: base[0x10ce], ldsMemory: extended(base[0x10fe]), stsMemory: extended(base[0x10ff]),
  lbrn: base[0x1021], lbhi: base[0x1022], lbls: base[0x1023],
  lbcc: base[0x1024], lbcs: base[0x1025], lbne: base[0x1026], lbeq: base[0x1027],
  lbvc: base[0x1028], lbvs: base[0x1029], lbpl: base[0x102a], lbmi: base[0x102b],
  lbge: base[0x102c], lblt: base[0x102d], lbgt: base[0x102e], lble: base[0x102f],

  subaMemory: extended(base[0xb0]),
  subbMemory: extended(base[0xf0]),
  cmpaMemory: extended(base[0xb1]),
  cmpbMemory: extended(base[0xf1]),
  sbcaMemory: extended(base[0xb2]),
  sbcbMemory: extended(base[0xf2]),
  andaMemory: extended(base[0xb4]),
  andbMemory: extended(base[0xf4]),
  bitaMemory: extended(base[0xb5]),
  bitbMemory: extended(base[0xf5]),
  ldaMemory: extended(base[0xb6]),
  ldbMemory: extended(base[0xf6]),
  staMemory: extended(base[0xb7]),
  stbMemory: extended(base[0xf7]),
  eoraMemory: extended(base[0xb8]),
  eorbMemory: extended(base[0xf8]),
  adcaMemory: extended(base[0xb9]),
  adcbMemory: extended(base[0xf9]),
  oraMemory: extended(base[0xba]),
  orbMemory: extended(base[0xfa]),
  addaMemory: extended(base[0xbb]),
  addbMemory: extended(base[0xfb]),
  subdMemory: extended(base[0xb3]),
  adddMemory: extended(base[0xf3]),
  cmpxMemory: extended(base[0xbc]),
  ldxMemory: extended(base[0xbe]),
  stxMemory: extended(base[0xbf]),
  lduMemory: extended(base[0xfe]),
  stuMemory: extended(base[0xff]),
  lddMemory: extended(base[0xfc]),
  stdMemory: extended(base[0xfd]),
  negMemory: extended(base[0x70]),
  comMemory: extended(base[0x73]),
  lsrMemory: extended(base[0x74]),
  rorMemory: extended(base[0x76]),
  asrMemory: extended(base[0x77]),
  aslMemory: extended(base[0x78]),
  rolMemory: extended(base[0x79]),
  decMemory: extended(base[0x7a]),
  incMemory: extended(base[0x7c]),
  tstMemory: extended(base[0x7d]),
  clrMemory: extended(base[0x7f]),
  leax: lea(base[0x30]), leay: lea(base[0x31]), leas: lea(base[0x32]), leau: lea(base[0x33]),

  nop: base[0x12], daa: base[0x19], orcc: base[0x1a], andcc: base[0x1c],
  sex: base[0x1d], abx: base[0x3a], mul: base[0x3d],
  bsr: base[0x8d], lbsr: base[0x17], rts: base[0x39], lbra: base[0x16],
  jsr: actions.call, jump: actions.jump,
  bra: base[0x20], brn: base[0x21], bhi: base[0x22], bls: base[0x23],
  bcc: base[0x24], bcs: base[0x25], bne: base[0x26], beq: base[0x27],
  bvc: base[0x28], bvs: base[0x29], bpl: base[0x2a], bmi: base[0x2b],
  bge: base[0x2c], blt: base[0x2d], bgt: base[0x2e], ble: base[0x2f],
  negA: base[0x40], negB: base[0x50],
  comA: base[0x43], comB: base[0x53],
  lsrA: base[0x44], lsrB: base[0x54],
  rorA: base[0x46], rorB: base[0x56],
  asrA: base[0x47], asrB: base[0x57],
  aslA: base[0x48], aslB: base[0x58],
  rolA: base[0x49], rolB: base[0x59],
  decA: base[0x4a], decB: base[0x5a],
  incA: base[0x4c], incB: base[0x5c],
  tstA: base[0x4d], tstB: base[0x5d],
  clrA: base[0x4f], clrB: base[0x5f],
  subaImmediate: base[0x80], subbImmediate: base[0xc0],
  cmpaImmediate: base[0x81], cmpbImmediate: base[0xc1],
  sbcaImmediate: base[0x82], sbcbImmediate: base[0xc2],
  andaImmediate: base[0x84], andbImmediate: base[0xc4],
  bitaImmediate: base[0x85], bitbImmediate: base[0xc5],
  ldaImmediate: base[0x86], ldbImmediate: base[0xc6],
  eoraImmediate: base[0x88], eorbImmediate: base[0xc8],
  adcaImmediate: base[0x89], adcbImmediate: base[0xc9],
  oraImmediate: base[0x8a], orbImmediate: base[0xca],
  addaImmediate: base[0x8b], addbImmediate: base[0xcb],
  subdImmediate: base[0x83], adddImmediate: base[0xc3],
  cmpxImmediate: base[0x8c],
  ldxImmediate: base[0x8e], lduImmediate: base[0xce], lddImmediate: base[0xcc],
};
