import { instructions as native } from "../../src/components/cpus/generated/z80.js";
import { instructions as chapter } from "../../src/components/cpus/generated/z80-chapter.js";

// Existing cross-CPU probes keep their names; every migrated entry calls a literal chapter opcode.
export const bodiesZ80 = {
  ...native, ...chapter,
  incB: chapter[0x04], incC: chapter[0x0c], incD: chapter[0x14], incE: chapter[0x1c], incH: chapter[0x24], incL: chapter[0x2c], incA: chapter[0x3c],
  decB: chapter[0x05], decC: chapter[0x0d], decD: chapter[0x15], decE: chapter[0x1d], decH: chapter[0x25], decL: chapter[0x2d], decA: chapter[0x3d],
  addB: chapter[0x80], addC: chapter[0x81], addD: chapter[0x82], addE: chapter[0x83], addH: chapter[0x84], addL: chapter[0x85], addM: chapter[0x86], addA: chapter[0x87],
  addImmediate: chapter[0xc6],
  adcB: chapter[0x88], adcC: chapter[0x89], adcD: chapter[0x8a], adcE: chapter[0x8b], adcH: chapter[0x8c], adcL: chapter[0x8d], adcM: chapter[0x8e], adcA: chapter[0x8f],
  adcImmediate: chapter[0xce],
  subB: chapter[0x90], subC: chapter[0x91], subD: chapter[0x92], subE: chapter[0x93], subH: chapter[0x94], subL: chapter[0x95], subM: chapter[0x96], subA: chapter[0x97],
  subImmediate: chapter[0xd6],
  sbcB: chapter[0x98], sbcC: chapter[0x99], sbcD: chapter[0x9a], sbcE: chapter[0x9b], sbcH: chapter[0x9c], sbcL: chapter[0x9d], sbcM: chapter[0x9e], sbcA: chapter[0x9f],
  sbcImmediate: chapter[0xde],
  andB: chapter[0xa0], andC: chapter[0xa1], andD: chapter[0xa2], andE: chapter[0xa3], andH: chapter[0xa4], andL: chapter[0xa5], andM: chapter[0xa6], andA: chapter[0xa7],
  andImmediate: chapter[0xe6],
  xorB: chapter[0xa8], xorC: chapter[0xa9], xorD: chapter[0xaa], xorE: chapter[0xab], xorH: chapter[0xac], xorL: chapter[0xad], xorM: chapter[0xae], xorA: chapter[0xaf],
  xorImmediate: chapter[0xee],
  orB: chapter[0xb0], orC: chapter[0xb1], orD: chapter[0xb2], orE: chapter[0xb3], orH: chapter[0xb4], orL: chapter[0xb5], orM: chapter[0xb6], orA: chapter[0xb7],
  orImmediate: chapter[0xf6],
  cpB: chapter[0xb8], cpC: chapter[0xb9], cpD: chapter[0xba], cpE: chapter[0xbb], cpH: chapter[0xbc], cpL: chapter[0xbd], cpM: chapter[0xbe], cpA: chapter[0xbf],
  cpImmediate: chapter[0xfe],
};
