import { instructions as remaining } from "../../src/components/cpus/generated/6809.js";
import { instructions as base } from "../../src/components/cpus/generated/6809-base.js";

// Names used by the cross-CPU operand probes; immediate bodies now come from
// literal chapter opcodes, while resolved-memory probes retain the indexed bodies.
export const operandBodies6809 = {
  ...remaining,
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
