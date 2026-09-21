import { instructions as actions } from "../../src/components/cpus/generated/z80-state.js";
import type { ByteInstructionContext } from "../../src/components/cpus/instruction-context.js";
import { instructions as chapter } from "../../src/components/cpus/generated/z80-chapter.js";

import assert from "node:assert/strict";
import type { CpuZ80State } from "../../src/components/cpus/state/z80.js";

// Test-owned literal CB selectors keep the access-order probes independent of chapter catalogues.
const shifts = { rlc: 0x00, rrc: 0x08, rl: 0x10, rr: 0x18, sla: 0x20, sra: 0x28, srl: 0x38 } as const;
const bits = { bit: 0x40, res: 0x80, set: 0xc0 } as const;
const registers = { B: 0, C: 1, D: 2, E: 3, H: 4, L: 5, A: 7 } as const;
type CbRegisterName = `${keyof typeof shifts | `${keyof typeof bits}${0 | 1 | 2 | 3 | 4 | 5 | 6 | 7}`}${keyof typeof registers}`;
const cbRegisters = Object.fromEntries(Object.entries(registers).flatMap(([register, code]) => [
  ...Object.entries(shifts).map(([name, opcode]) => [`${name}${register}`, chapter[(0xcb00 + opcode + code) as keyof typeof chapter]]),
  ...Object.entries(bits).flatMap(([name, opcode]) => Array.from({ length: 8 }, (_, bit) =>
    [`${name}${bit}${register}`, chapter[(0xcb00 + opcode + bit * 8 + code) as keyof typeof chapter]])),
])) as Record<CbRegisterName, (state: CpuZ80State) => void>;

// These legacy probes begin after address resolution. Supply zero displacement and
// the requested IX only for that initial read; separate chapter/core tests check decoding.
function indexed<Context extends { fetchByte(): number }, Immediate extends boolean = false>(
  execute: (state: CpuZ80State, context: Context) => void, immediate?: Immediate,
) {
  return (state: CpuZ80State, address: number, context: Immediate extends true ? Context : Omit<Context, "fetchByte">) => {
    let displacement = true;
    const observed = new Proxy(state, { get(target, key, receiver) { return key === "ix" ? address : Reflect.get(target, key, receiver); } });
    execute(observed, { ...context, fetchByte() {
      if (displacement) { displacement = false; return 0; }
      if (!immediate) assert.fail("Only the displacement should be fetched");
      return (context as Context).fetchByte();
    } } as Context);
  };
}

// Existing cross-CPU probes keep their names; every migrated entry calls a literal chapter opcode.
export const bodiesZ80 = {
  ...actions, ...chapter, ...cbRegisters,
  pushIX: chapter[0xdde5],
  popIX: chapter[0xdde1],
  jumpIX: chapter[0xdde9],
  immediateIXWord: chapter[0xdd21],
  storeIXWord: chapter[0xdd22],
  loadIXWord: chapter[0xdd2a],
  copyIXWord: chapter[0xddf9],
  exchangeIXWord: chapter[0xdde3],
  incIXWord: chapter[0xdd23],
  decIXWord: chapter[0xdd2b],
  addIXBC: chapter[0xdd09],
  addIXDE: chapter[0xdd19],
  addIXIX: chapter[0xdd29],
  addIXSP: chapter[0xdd39],
  pushIY: chapter[0xfde5],
  popIY: chapter[0xfde1],
  jumpIY: chapter[0xfde9],
  immediateIYWord: chapter[0xfd21],
  storeIYWord: chapter[0xfd22],
  loadIYWord: chapter[0xfd2a],
  copyIYWord: chapter[0xfdf9],
  exchangeIYWord: chapter[0xfde3],
  incIYWord: chapter[0xfd23],
  decIYWord: chapter[0xfd2b],
  addIYBC: chapter[0xfd09],
  addIYDE: chapter[0xfd19],
  addIYIY: chapter[0xfd29],
  addIYSP: chapter[0xfd39],
  loadBMemory: indexed(chapter[0xdd46]),
  storeBMemory: indexed(chapter[0xdd70]),
  loadCMemory: indexed(chapter[0xdd4e]),
  storeCMemory: indexed(chapter[0xdd71]),
  loadDMemory: indexed(chapter[0xdd56]),
  storeDMemory: indexed(chapter[0xdd72]),
  loadEMemory: indexed(chapter[0xdd5e]),
  storeEMemory: indexed(chapter[0xdd73]),
  loadHMemory: indexed(chapter[0xdd66]),
  storeHMemory: indexed(chapter[0xdd74]),
  loadLMemory: indexed(chapter[0xdd6e]),
  storeLMemory: indexed(chapter[0xdd75]),
  loadAMemory: indexed(chapter[0xdd7e]),
  storeAMemory: indexed(chapter[0xdd77]),
  storeImmediateMemory: indexed(chapter[0xdd36], true),
  addMemory: indexed(chapter[0xdd86]),
  adcMemory: indexed(chapter[0xdd8e]),
  subMemory: indexed(chapter[0xdd96]),
  sbcMemory: indexed(chapter[0xdd9e]),
  andMemory: indexed(chapter[0xdda6]),
  xorMemory: indexed(chapter[0xddae]),
  orMemory: indexed(chapter[0xddb6]),
  cpMemory: indexed(chapter[0xddbe]),
  bit0Memory: (state: CpuZ80State, address: number, context: Pick<ByteInstructionContext, "readByte">) => actions.bitMemory(state, address, 1, context),
  bit1Memory: (state: CpuZ80State, address: number, context: Pick<ByteInstructionContext, "readByte">) => actions.bitMemory(state, address, 2, context),
  bit2Memory: (state: CpuZ80State, address: number, context: Pick<ByteInstructionContext, "readByte">) => actions.bitMemory(state, address, 4, context),
  bit3Memory: (state: CpuZ80State, address: number, context: Pick<ByteInstructionContext, "readByte">) => actions.bitMemory(state, address, 8, context),
  bit4Memory: (state: CpuZ80State, address: number, context: Pick<ByteInstructionContext, "readByte">) => actions.bitMemory(state, address, 16, context),
  bit5Memory: (state: CpuZ80State, address: number, context: Pick<ByteInstructionContext, "readByte">) => actions.bitMemory(state, address, 32, context),
  bit6Memory: (state: CpuZ80State, address: number, context: Pick<ByteInstructionContext, "readByte">) => actions.bitMemory(state, address, 64, context),
  bit7Memory: (state: CpuZ80State, address: number, context: Pick<ByteInstructionContext, "readByte">) => actions.bitMemory(state, address, 128, context),
  res0Memory: (state: CpuZ80State, address: number, context: Pick<ByteInstructionContext, "readByte" | "writeByte">) => actions.resMemory(state, address, 1, context),
  res1Memory: (state: CpuZ80State, address: number, context: Pick<ByteInstructionContext, "readByte" | "writeByte">) => actions.resMemory(state, address, 2, context),
  res2Memory: (state: CpuZ80State, address: number, context: Pick<ByteInstructionContext, "readByte" | "writeByte">) => actions.resMemory(state, address, 4, context),
  res3Memory: (state: CpuZ80State, address: number, context: Pick<ByteInstructionContext, "readByte" | "writeByte">) => actions.resMemory(state, address, 8, context),
  res4Memory: (state: CpuZ80State, address: number, context: Pick<ByteInstructionContext, "readByte" | "writeByte">) => actions.resMemory(state, address, 16, context),
  res5Memory: (state: CpuZ80State, address: number, context: Pick<ByteInstructionContext, "readByte" | "writeByte">) => actions.resMemory(state, address, 32, context),
  res6Memory: (state: CpuZ80State, address: number, context: Pick<ByteInstructionContext, "readByte" | "writeByte">) => actions.resMemory(state, address, 64, context),
  res7Memory: (state: CpuZ80State, address: number, context: Pick<ByteInstructionContext, "readByte" | "writeByte">) => actions.resMemory(state, address, 128, context),
  set0Memory: (state: CpuZ80State, address: number, context: Pick<ByteInstructionContext, "readByte" | "writeByte">) => actions.setMemory(state, address, 1, context),
  set1Memory: (state: CpuZ80State, address: number, context: Pick<ByteInstructionContext, "readByte" | "writeByte">) => actions.setMemory(state, address, 2, context),
  set2Memory: (state: CpuZ80State, address: number, context: Pick<ByteInstructionContext, "readByte" | "writeByte">) => actions.setMemory(state, address, 4, context),
  set3Memory: (state: CpuZ80State, address: number, context: Pick<ByteInstructionContext, "readByte" | "writeByte">) => actions.setMemory(state, address, 8, context),
  set4Memory: (state: CpuZ80State, address: number, context: Pick<ByteInstructionContext, "readByte" | "writeByte">) => actions.setMemory(state, address, 16, context),
  set5Memory: (state: CpuZ80State, address: number, context: Pick<ByteInstructionContext, "readByte" | "writeByte">) => actions.setMemory(state, address, 32, context),
  set6Memory: (state: CpuZ80State, address: number, context: Pick<ByteInstructionContext, "readByte" | "writeByte">) => actions.setMemory(state, address, 64, context),
  set7Memory: (state: CpuZ80State, address: number, context: Pick<ByteInstructionContext, "readByte" | "writeByte">) => actions.setMemory(state, address, 128, context),
  im0: chapter[0xed46], im1: chapter[0xed56], im2: chapter[0xed5e],
  retn: chapter[0xed45], reti: chapter[0xed4d], neg: chapter[0xed44],
  rld: chapter[0xed6f], rrd: chapter[0xed67], loadIFromA: chapter[0xed47],
  loadRFromA: chapter[0xed4f], loadAFromI: chapter[0xed57], loadAFromR: chapter[0xed5f],
  ldi: chapter[0xeda0], ldd: chapter[0xeda8], ldir: chapter[0xedb0],
  lddr: chapter[0xedb8], cpi: chapter[0xeda1], cpd: chapter[0xeda9],
  cpir: chapter[0xedb1], cpdr: chapter[0xedb9], ini: chapter[0xeda2],
  ind: chapter[0xedaa], inir: chapter[0xedb2], indr: chapter[0xedba],
  outi: chapter[0xeda3], outd: chapter[0xedab], otir: chapter[0xedb3],
  otdr: chapter[0xedbb], inputB: chapter[0xed40], outputB: chapter[0xed41],
  inputC: chapter[0xed48], outputC: chapter[0xed49], inputD: chapter[0xed50],
  outputD: chapter[0xed51], inputE: chapter[0xed58], outputE: chapter[0xed59],
  inputH: chapter[0xed60], outputH: chapter[0xed61], inputL: chapter[0xed68],
  outputL: chapter[0xed69], inputA: chapter[0xed78], outputA: chapter[0xed79],
  sbcHLBC: chapter[0xed42], adcHLBC: chapter[0xed4a], storeBCMemory: chapter[0xed43],
  loadBCMemory: chapter[0xed4b], sbcHLDE: chapter[0xed52], adcHLDE: chapter[0xed5a],
  storeDEMemory: chapter[0xed53], loadDEMemory: chapter[0xed5b], sbcHLHL: chapter[0xed62],
  adcHLHL: chapter[0xed6a], storeHLMemory: chapter[0xed63], loadHLMemory: chapter[0xed6b],
  sbcHLSP: chapter[0xed72], adcHLSP: chapter[0xed7a], storeSPMemory: chapter[0xed73],
  loadSPMemory: chapter[0xed7b],
  di: chapter[0xf3], ei: chapter[0xfb], input: chapter[0xdb], output: chapter[0xd3],
  exchangeAf: chapter[0x08], exchangeGeneralBanks: chapter[0xd9],
  jr: chapter[0x18], jrNZ: chapter[0x20], jrZ: chapter[0x28], jrNC: chapter[0x30], jrC: chapter[0x38], djnz: chapter[0x10],
  rlca: chapter[0x07], rrca: chapter[0x0f], rla: chapter[0x17], rra: chapter[0x1f],
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
