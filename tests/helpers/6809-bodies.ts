import { instructions as remaining } from "../../src/components/cpus/generated/6809.js";
import { instructions as actions } from "../../src/components/cpus/generated/6809-state.js";
import { instructions as base } from "../../src/components/cpus/generated/6809-base.js";

// Names used by independent cross-CPU probes; migrated bodies use literal
// chapter opcodes, while remaining indexed/prefixed forms keep their native names.
export const bodies6809 = {
  ...remaining,
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
