import { test } from "node:test";
import { ObservedRam } from "../../../helpers/observed-ram.js";
import { initialState, flags, checkStep, resultFlags, reject } from "./helpers.js";

test("8088 completion decimal adjustment follows decimal arithmetic for every valid BCD operand pair", () => {
  const ram = new ObservedRam(0x100000), bcd = (n: number): number => Math.floor(n / 10) * 16 + n % 10;
  for (const subtracting of [false, true]) for (let left = 0; left < 100; left++) for (let right = 0; right < 100; right++) {
    for (const carry of [0, 1]) {
      const a = bcd(left), b = bcd(right), binary = subtracting ? a - b - carry : a + b + carry;
      const decimal = subtracting ? left - right - carry : left + right + carry;
      const before = initialState({ ax: 0xa500 + (binary + 256) % 256, flags: { ...flags(511),
        cf: subtracting ? binary < 0 : binary > 255,
        af: subtracting ? a % 16 < b % 16 + carry : a % 16 + b % 16 + carry >= 16 } });
      const result = bcd((decimal + 100) % 100);
      checkStep(ram, before, [subtracting ? 0x2f : 0x27], { ...before, ax: 0xa500 + result, ip: 0x101,
        flags: { ...before.flags, ...resultFlags(result, 8), cf: decimal < 0 || decimal >= 100,
          af: subtracting ? left % 10 < right % 10 + carry : left % 10 + right % 10 + carry >= 10 } });
    }
  }
});

test("8088 completion original-chip decimal edge cases differ from later x86 and preserve undefined flags", () => {
  const ram = new ObservedRam(0x100000);
  // Hardware-checked AL/AF/CF inputs with explicit outputs: DAA and DAS both use the AF-dependent threshold.
  for (const [opcode, al, af, cf, result, carry] of [
    [0x27, 0x9e, true, false, 0xa4, false], [0x27, 0x9e, false, false, 0x04, true],
    [0x27, 0xfa, true, false, 0x60, true], [0x27, 0x00, true, true, 0x66, true],
    [0x2f, 0x9e, true, false, 0x98, false], [0x2f, 0x9e, false, false, 0x38, true],
    [0x2f, 0x00, true, false, 0xfa, false], [0x2f, 0x00, true, true, 0x9a, true],
  ] as const) for (const old of [0, 511]) {
    const before = initialState({ ax: 0x3600 + al, flags: { ...flags(old), af, cf } });
    checkStep(ram, before, [opcode], { ...before, ax: 0x3600 + result, ip: 0x101,
      flags: { ...before.flags, ...resultFlags(result, 8), af: true, cf: carry } });
  }
  for (const subtracting of [false, true]) for (let al = 0; al < 256; al++) for (const af of [false, true]) {
    for (const ah of [0, 1, 0xff]) {
      const before = initialState({ ax: ah * 256 + al, flags: { ...flags(511), af } });
      const adjusts = al % 16 > 9 || af, delta = adjusts ? subtracting ? -1 : 1 : 0;
      const result = (ah + delta + 256) % 256 * 256 + (al + 6 * delta + 256) % 16;
      checkStep(ram, before, [subtracting ? 0x3f : 0x37], { ...before, ax: result, ip: 0x101,
        flags: { ...before.flags, cf: adjusts, af: adjusts } });
    }
  }
});

test("8088 completion CBW/CWD and AAM/AAD exhaust word values and fixed-radix rejection", () => {
  const ram = new ObservedRam(0x100000);
  for (let ax = 0; ax < 65536; ax++) {
    const before = initialState({ ax, flags: flags(ax % 512) }), al = ax % 256, ah = Math.floor(ax / 256);
    checkStep(ram, before, [0x98], { ...before, ax: al < 128 ? al : 0xff00 + al, ip: 0x101 });
    checkStep(ram, before, [0x99], { ...before, dx: ax < 32768 ? 0 : 0xffff, ip: 0x101 });
    const result = (ah * 10 + al) % 256;
    checkStep(ram, before, [0xd5, 0x0a], { ...before, ax: result, ip: 0x102, flags: { ...before.flags, ...resultFlags(result, 8) } });
    if (ax < 256) checkStep(ram, before, [0xd4, 0x0a], { ...before, ax: Math.floor(al / 10) * 256 + al % 10, ip: 0x102,
      flags: { ...before.flags, ...resultFlags(al % 10, 8) } });
  }
  for (const opcode of [0xd4, 0xd5]) for (let radix = 0; radix < 256; radix++) {
    if (radix !== 10) reject(ram, initialState(), [opcode, radix]);
  }
});
