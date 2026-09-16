import assert from "node:assert/strict";
import { test } from "node:test";
import { CpuZ80 } from "../../../../src/components/cpus/z80.js";
import type { CpuZ80Flags } from "../../../../src/components/cpus/z80.js";
import { ObservedRam } from "../../../helpers/observed-ram.js";
import { initialState, flagPattern, checkBaseStep, wordPairForms, withPair, readAccess, writeAccess, refreshTwice, checkPrefixedStep } from "./helpers.js";

for (const form of wordPairForms) {
  test(`Z80 pair INC/DEC ${form.high ?? "SP"} wraps every word and preserves every flag and the alternate bank`, () => {
    const ram = new ObservedRam();
    for (let value = 0; value < 65536; value++) for (const delta of [1, -1]) {
      const before = withPair(initialState({ pc: 0xffff, flags: flagPattern(value % 64) }), form, value);
      checkBaseStep(ram, before, [delta === 1 ? form.inc : form.dec],
        { ...withPair(before, form, (value + delta + 65536) % 65536), pc: 0, r: 0xff });
    }
  });

  test(`Z80 ADD HL form ${form.add.toString(16)} covers every word and half-carry boundaries while preserving S/Z/PV`, () => {
    const ram = new ObservedRam();
    const check = (left: number, right: number, flags: CpuZ80Flags) => {
      const before = withPair(initialState({ h: Math.floor(left / 256), l: left % 256, flags, pc: 0xffff }), form, right);
      const hl = before.h * 256 + before.l;
      const total = hl + right, result = total % 65536;
      checkBaseStep(ram, before, [form.add], { h: Math.floor(result / 256), l: result % 256,
        flags: { ...flags, h: hl % 4096 + right % 4096 >= 4096, n: false, c: total >= 65536 } });
    };
    const boundaries = [0, 1, 0x0fff, 0x1000, 0x7fff, 0x8000, 0xffff];
    for (let value = 0; value < 65536; value++) {
      check(value, form.high === "h" ? value : boundaries[value % boundaries.length]!, flagPattern(value % 64));
      if (form.high !== "h") check(boundaries[value % boundaries.length]!, value, flagPattern(63 - value % 64));
    }
    for (const left of boundaries) for (const right of boundaries) for (let bits = 0; bits < 64; bits++) check(left, right, flagPattern(bits));
  });
}

const edWords = [
  { ...wordPairForms[0], adc: 0x4a, sbc: 0x42, load: 0x4b, store: 0x43 },
  { ...wordPairForms[1], adc: 0x5a, sbc: 0x52, load: 0x5b, store: 0x53 },
  { ...wordPairForms[2], adc: 0x6a, sbc: 0x62, load: 0x6b, store: 0x63 },
  { ...wordPairForms[3], adc: 0x7a, sbc: 0x72, load: 0x7b, store: 0x73 },
] as const;

for (const form of edWords) {
  test(`Z80 ED word arithmetic ${form.high ?? "SP"} uses full-word S/Z/overflow and bit-11 half carry`, () => {
    const ram = new ObservedRam();
    const boundaries = [0, 1, 0x0ffe, 0x0fff, 0x1000, 0x7ffe, 0x7fff, 0x8000, 0x8001, 0xfffe, 0xffff];
    const signed = (value: number): number => value < 32768 ? value : value - 65536;
    for (const left of boundaries) for (const right of boundaries) for (let bits = 0; bits < 64; bits++) for (const subtract of [false, true]) {
      const before = withPair(initialState({ h: Math.floor(left / 256), l: left % 256, flags: flagPattern(bits), pc: 0xffff }), form, right);
      const hl = before.h * 256 + before.l, carry = Number(before.flags.c);
      const total = subtract ? hl - right - carry : hl + right + carry;
      const signedTotal = subtract ? signed(hl) - signed(right) - carry : signed(hl) + signed(right) + carry;
      const lowTotal = subtract ? hl % 4096 - right % 4096 - carry : hl % 4096 + right % 4096 + carry;
      const result = (total + 65536) % 65536;
      checkPrefixedStep(ram, before, [0xed, subtract ? form.sbc : form.adc], {
        h: Math.floor(result / 256), l: result % 256,
        flags: { s: result >= 32768, z: result === 0, h: lowTotal < 0 || lowTotal >= 4096,
          pv: signedTotal < -32768 || signedTotal > 32767, n: subtract, c: total < 0 || total >= 65536 },
      });
    }
  });

  test(`Z80 ED word transfers ${form.high ?? "SP"} capture addresses and transfer low/high across wrap and code overlap`, () => {
    const ram = new ObservedRam();
    for (const target of [0, 0xffff, 0x2000, 0x2001, 0x2002, 0x2003]) for (let bits = 0; bits < 64; bits++) {
      const before = withPair(initialState({ flags: flagPattern(bits) }), form, 0x9a7e);
      const addressBytes = [target % 256, Math.floor(target / 256)];
      const bytes = [0xed, form.load, ...addressBytes];
      const initialByte = (address: number) => address >= 0x2000 && address < 0x2004 ? bytes[address - 0x2000]!
        : address === target ? 0x34 : 0x12;
      ram.write(target, 0x34); ram.write((target + 1) % 65536, 0x12);
      const low = initialByte(target), high = initialByte((target + 1) % 65536);
      const loaded = withPair(before, form, high * 256 + low);
      checkPrefixedStep(ram, before, bytes, { ...loaded, pc: 0x2004, r: refreshTwice(before.r) },
        [readAccess(target, low), readAccess((target + 1) % 65536, high)]);
      checkPrefixedStep(ram, before, [0xed, form.store, ...addressBytes], {},
        [writeAccess(target, 0x7e), writeAccess((target + 1) % 65536, 0x9a)]);
    }
  });
}

test("Z80 special-register transfers distinguish IFF2 from IFF1 and observe R after opcode fetches", () => {
  const ram = new ObservedRam();
  for (let value = 0; value < 256; value++) for (let bits = 0; bits < 64; bits++) for (const iff2 of [false, true]) {
    const before = initialState({ a: value, i: value ^ 0xff, r: (value + 51) % 256, interruptDeferred: false, nmiDeferred: false, iff1: !iff2, iff2, flags: flagPattern(bits), pc: 0xffff });
    checkPrefixedStep(ram, before, [0xed, 0x47], { i: value });
    checkPrefixedStep(ram, before, [0xed, 0x4f], { r: value });
    for (const [opcode, a] of [[0x57, before.i], [0x5f, refreshTwice(before.r)]] as const) {
      checkPrefixedStep(ram, before, [0xed, opcode], { a, flags: { s: a >= 128, z: a === 0, h: false, pv: iff2, n: false, c: before.flags.c } });
    }
  }
  [0xed, 0x4f, 0xed, 0x5f, 0x00].forEach((value, i) => ram.write(0x2000 + i, value));
  const cpu = new CpuZ80(ram, initialState({ a: 0xff, r: 0 }));
  assert.equal(cpu.step().after.r, 0xff);
  const saved = cpu.step();
  assert.equal(saved.after.a, 0x81); assert.equal(saved.after.r, 0x81);
  const retained = structuredClone(saved);
  assert.equal(cpu.step().after.r, 0x82);
  cpu.reset();
  assert.deepEqual(saved, retained);
});
