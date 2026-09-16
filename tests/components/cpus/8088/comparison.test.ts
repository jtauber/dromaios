import { test } from "node:test";
import type { Cpu8088State } from "../../../../src/components/cpus/8088.js";
import { ObservedRam } from "../../../helpers/observed-ram.js";
import { initialState, flags, checkStep } from "./helpers.js";

function comparison(before: Cpu8088State, operand: number, width: 8 | 16): Cpu8088State {
  const modulus = 2 ** width;
  const sign = modulus / 2;
  const left = before.ax % modulus;
  const difference = left - operand;
  const result = (difference + modulus) % modulus;
  const signedDifference = (left < sign ? left : left - modulus) - (operand < sign ? operand : operand - modulus);
  return { ...before, ip: (before.ip + 1 + width / 8) % 65536, flags: { ...before.flags,
    cf: difference < 0, af: left % 16 < operand % 16, zf: result === 0, sf: result >= sign,
    of: signedDifference < -sign || signedDifference >= sign,
    pf: (result % 256).toString(2).replaceAll("0", "").length % 2 === 0 } };
}

test("8088 CMP AL covers every byte pair, preserves AX, ignores incoming carry, and computes subtraction flags", () => {
  const ram = new ObservedRam(0x100000);
  for (let left = 0; left < 256; left++) {
    for (let right = 0; right < 256; right++) {
      for (const bits of [0, 511]) {
        const before = initialState({ ax: 0xa500 + left, flags: flags(bits) });
        checkStep(ram, before, [0x3c, right], comparison(before, right, 8));
      }
    }
  }
});

test("8088 CMP AX covers every word against signed and unsigned boundaries with low-byte parity", () => {
  const ram = new ObservedRam(0x100000);
  for (let ax = 0; ax < 65536; ax++) {
    for (const right of [0, 1, 0x7fff, 0x8000, 0xffff]) {
      const before = initialState({ ax, flags: flags(ax % 512) });
      checkStep(ram, before, [0x3d, right % 256, Math.floor(right / 256)], comparison(before, right, 16));
    }
  }
});

test("8088 CMP preserves TF/IF/DF for every flag combination and wraps both operand widths through CS:IP", () => {
  const ram = new ObservedRam(0x100000);
  for (const [cs, ip, addresses] of [
    [0x1234, 0xffff, [0x2233f, 0x12340, 0x12341]],
    [0xffff, 0x000f, [0xfffff, 0, 1]], [0xffff, 0xffff, [0xffef, 0xffff0, 0xffff1]],
  ] as const) {
    for (let bits = 0; bits < 512; bits++) {
      for (const [ax, value] of [[0x8000, 1], [0x7fff, 0xffff], [0x0100, 0], [0xab00, 1], [0xffff, 0xffff]] as const) {
        const before = initialState({ cs, ip, ax, flags: flags(bits) });
        checkStep(ram, before, [0x3c, value % 256], comparison(before, value % 256, 8), addresses);
        checkStep(ram, before, [0x3d, value % 256, Math.floor(value / 256)], comparison(before, value, 16), addresses);
      }
    }
  }
});
