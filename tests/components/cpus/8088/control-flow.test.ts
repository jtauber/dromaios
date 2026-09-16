import { test } from "node:test";
import type { Cpu8088Flags } from "../../../../src/components/cpus/8088.js";
import { ObservedRam } from "../../../helpers/observed-ram.js";
import { initialState, flags, checkStep } from "./helpers.js";

// Literal truth sets for O S Z P C (bits 4..0), independent of the paired opcode builder.
const conditionalJumps = [
  [0x70, "JO", [16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31]],
  [0x71, "JNO", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]],
  [0x72, "JB", [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31]],
  [0x73, "JAE", [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30]],
  [0x74, "JE", [4, 5, 6, 7, 12, 13, 14, 15, 20, 21, 22, 23, 28, 29, 30, 31]],
  [0x75, "JNE", [0, 1, 2, 3, 8, 9, 10, 11, 16, 17, 18, 19, 24, 25, 26, 27]],
  [0x76, "JBE", [1, 3, 4, 5, 6, 7, 9, 11, 12, 13, 14, 15, 17, 19, 20, 21, 22, 23, 25, 27, 28, 29, 30, 31]],
  [0x77, "JA", [0, 2, 8, 10, 16, 18, 24, 26]],
  [0x78, "JS", [8, 9, 10, 11, 12, 13, 14, 15, 24, 25, 26, 27, 28, 29, 30, 31]],
  [0x79, "JNS", [0, 1, 2, 3, 4, 5, 6, 7, 16, 17, 18, 19, 20, 21, 22, 23]],
  [0x7a, "JP", [2, 3, 6, 7, 10, 11, 14, 15, 18, 19, 22, 23, 26, 27, 30, 31]],
  [0x7b, "JNP", [0, 1, 4, 5, 8, 9, 12, 13, 16, 17, 20, 21, 24, 25, 28, 29]],
  [0x7c, "JL", [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]],
  [0x7d, "JGE", [0, 1, 2, 3, 4, 5, 6, 7, 24, 25, 26, 27, 28, 29, 30, 31]],
  [0x7e, "JLE", [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 28, 29, 30, 31]],
  [0x7f, "JG", [0, 1, 2, 3, 24, 25, 26, 27]],
] as const satisfies readonly (readonly [number, string, readonly number[]])[];

function conditionCode(f: Cpu8088Flags): number {
  return Number(f.of) * 16 + Number(f.sf) * 8 + Number(f.zf) * 4 + Number(f.pf) * 2 + Number(f.cf);
}

for (const [opcode, mnemonic, codes] of conditionalJumps) {
  const takenCodes: readonly number[] = codes;
  test(`8088 ${mnemonic} follows its independent truth table for all flags and preserves CS across boundaries`, () => {
    const ram = new ObservedRam(0x100000);
    for (const [cs, ip, displacement, fallthrough, target, addresses] of [
      [0x1234, 0xffff, 0x80, 1, 0xff81, [0x2233f, 0x12340]],
      [0x1234, 0xfffd, 1, 0xffff, 0, [0x2233d, 0x2233e]],
      [0x1234, 0, 0xff, 2, 1, [0x12340, 0x12341]],
      [0xffff, 0x000f, 0x7f, 0x11, 0x90, [0xfffff, 0]],
      [0xffff, 0xffff, 0xfe, 1, 0xffff, [0xffef, 0xffff0]],
    ] as const) {
      for (let bits = 0; bits < 512; bits++) {
        const before = initialState({ cs, ip, flags: flags(bits) });
        const taken = takenCodes.includes(conditionCode(before.flags));
        checkStep(ram, before, [opcode, displacement], { ...before, ip: taken ? target : fallthrough }, addresses);
      }
    }
  });
  test(`8088 ${mnemonic} reads every displacement on both paths and interprets taken offsets as signed bytes`, () => {
    const ram = new ObservedRam(0x100000);
    for (const take of [false, true]) {
      const bits = Array.from({ length: 512 }, (_, bits) => bits)
        .find(bits => takenCodes.includes(conditionCode(flags(bits))) === take)!;
      const before = initialState({ flags: flags(bits) });
      for (let byte = 0; byte < 256; byte++) {
        const offset = new DataView(Uint8Array.of(byte).buffer).getInt8(0);
        checkStep(ram, before, [opcode, byte], { ...before, ip: take ? (0x102 + offset) % 65536 : 0x102 });
      }
    }
  });
}

test("8088 short and near JMP wrap IP, preserve CS and flags, and never access their targets", () => {
  const ram = new ObservedRam(0x100000);
  for (const [bytes, cs, ip, target, addresses] of [
    [[0xeb, 0x80], 0x1234, 0, 0xff82, [0x12340, 0x12341]],
    [[0xeb, 0x7f], 0x1234, 0xfffe, 0x7f, [0x2233e, 0x2233f]],
    [[0xeb, 0xfe], 0xffff, 0xf, 0xf, [0xfffff, 0]],
    [[0xe9, 0, 0], 0x1234, 0xffff, 2, [0x2233f, 0x12340, 0x12341]],
    [[0xe9, 0xff, 0x7f], 0x1234, 0xfffe, 0x8000, [0x2233e, 0x2233f, 0x12340]],
    [[0xe9, 0, 0x80], 0xffff, 0xe, 0x8011, [0xffffe, 0xfffff, 0]],
    [[0xe9, 0xfd, 0xff], 0xffff, 0xffff, 0xffff, [0xffef, 0xffff0, 0xffff1]],
  ] as const) {
    for (let bits = 0; bits < 512; bits++) {
      const before = initialState({ cs, ip, flags: flags(bits) });
      checkStep(ram, before, bytes, { ...before, ip: target }, addresses);
    }
  }
});

test("8088 completion LOOP conditions use post-decrement CX, JCXZ preserves it, and all flags survive", () => {
  const ram = new ObservedRam(0x100000);
  for (const opcode of [0xe0, 0xe1, 0xe2, 0xe3]) for (const cx of [0, 1, 2, 0x8000, 0xffff]) {
    for (let bits = 0; bits < 512; bits++) for (const displacement of [0, 0x7f, 0x80, 0xff]) {
      const before = initialState({ cx, ip: 0xffff, flags: flags(bits) });
      const count = opcode === 0xe3 ? cx : (cx + 65535) % 65536;
      const take = opcode === 0xe3 ? count === 0 : count !== 0 && (opcode === 0xe2 || before.flags.zf === (opcode === 0xe1));
      checkStep(ram, before, [opcode, displacement], { ...before, cx: count,
        ip: take ? (1 + (displacement < 128 ? displacement : displacement - 256) + 65536) % 65536 : 1 });
    }
  }
});
