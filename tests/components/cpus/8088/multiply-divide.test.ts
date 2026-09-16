import { test } from "node:test";
import { ObservedRam } from "../../../helpers/observed-ram.js";
import { initialState, flags, checkStep, registerValue, addressedState, addressingCases, put, dataReads, checkDivideError } from "./helpers.js";

test("8088 completion multiply exhausts byte operands and checks signed/unsigned word boundaries", () => {
  const ram = new ObservedRam(0x100000);
  for (const signed of [false, true]) for (const width of [8, 16] as const) {
    const values = width === 8 ? Array.from({ length: 256 }, (_, i) => i) : [0, 1, 2, 0x7f, 0xff, 0x100, 0x7fff, 0x8000, 0x8001, 0xfffe, 0xffff];
    for (const left of values) for (const right of values) {
      const a = signed ? BigInt.asIntN(width, BigInt(left)) : BigInt(left);
      const b = signed ? BigInt.asIntN(width, BigInt(right)) : BigInt(right);
      const product = a * b, encoded = BigInt.asUintN(width * 2, product);
      const overflow = product !== (signed ? BigInt.asIntN(width, product) : BigInt.asUintN(width, product));
      const before = initialState({ ax: width === 8 ? 0xa500 + left : left, bx: right, flags: flags((left + right) % 512) });
      checkStep(ram, before, [width === 8 ? 0xf6 : 0xf7, signed ? 0xeb : 0xe3], { ...before,
        ax: Number(encoded % 65536n), dx: width === 16 ? Number(encoded / 65536n) : before.dx, ip: 0x102,
        flags: { ...before.flags, cf: overflow, of: overflow } });
    }
  }
});

test("8088 completion multiply/divide read every register alias before replacing AX or DX", () => {
  const ram = new ObservedRam(0x100000);
  for (let reg = 0; reg < 8; reg++) for (const width of [8, 16] as const) for (const group of [4, 5, 6, 7]) {
    const before = initialState({ ax: 0x017f, bx: 0x0102, cx: 0x0304, dx: 0, sp: 0x100, bp: 0x80, si: 2, di: 3 });
    const operand = BigInt(registerValue(before, width, reg)), signed = group % 2 === 1;
    const divisor = signed ? BigInt.asIntN(width, operand) : operand;
    const bytes = [width === 8 ? 0xf6 : 0xf7, 0xc0 + group * 8 + reg];
    if (group < 6) {
      const accumulator = signed ? BigInt.asIntN(width, BigInt(before.ax)) : BigInt.asUintN(width, BigInt(before.ax));
      const product = accumulator * divisor, encoded = BigInt.asUintN(2 * width, product);
      const overflow = product !== (signed ? BigInt.asIntN(width, product) : BigInt.asUintN(width, product));
      checkStep(ram, before, bytes, { ...before, ax: Number(encoded % 65536n),
        dx: width === 16 ? Number(encoded / 65536n) : before.dx, ip: 0x102, flags: { ...before.flags, cf: overflow, of: overflow } });
    } else {
      const dividend = BigInt(before.ax), quotient = divisor === 0n ? 0n : dividend / divisor;
      const limit = 1n << BigInt(signed ? width - 1 : width);
      if (divisor === 0n || quotient >= limit || signed && quotient <= -limit) checkDivideError(ram, before, bytes);
      else {
        const remainder = dividend % divisor;
        checkStep(ram, before, bytes, { ...before, ip: 0x102,
          ax: width === 8 ? Number(BigInt.asUintN(8, quotient) + BigInt.asUintN(8, remainder) * 256n) : Number(BigInt.asUintN(16, quotient)),
          dx: width === 16 ? Number(BigInt.asUintN(16, remainder)) : before.dx });
      }
    }
  }
});

test("8088 completion division uses full unsigned dividends and truncates signed results toward zero", () => {
  const ram = new ObservedRam(0x100000);
  for (const width of [8, 16] as const) for (const signed of [false, true]) {
    const limit = 1n << BigInt(width), sign = limit / 2n;
    const divisors = signed ? [-sign, -sign + 1n, -127n, -3n, -1n, 0n, 1n, 3n, 127n, sign - 1n] : [0n, 1n, 2n, 3n, sign, limit - 1n];
    for (const divisor of divisors) {
      const quotients = [-sign - 1n, -sign, -sign + 1n, -1n, 0n, 1n, sign - 1n, sign, limit - 1n, limit];
      const dividends = [...quotients.flatMap(q => [q * divisor - 1n, q * divisor, q * divisor + 1n]),
        -(limit * limit / 2n), limit * limit / 2n, limit * limit - 1n];
      for (const input of dividends) {
        const raw = BigInt.asUintN(width * 2, input), dividend = signed ? BigInt.asIntN(width * 2, raw) : raw;
        const before = initialState({ cs: 0xffff, ip: 0xffff, ax: Number(raw % 65536n),
          dx: width === 16 ? Number(raw / 65536n) : 0xa55a, bx: Number(BigInt.asUintN(width, divisor)) });
        const bytes = [width === 8 ? 0xf6 : 0xf7, signed ? 0xfb : 0xf3];
        const quotient = divisor === 0n ? 0n : dividend / divisor;
        // The 1979 manual gives symmetric signed ranges: -127..127 and -32767..32767.
        if (divisor === 0n || (signed ? quotient <= -sign || quotient >= sign : quotient >= limit)) {
          checkDivideError(ram, before, bytes);
        } else {
          const remainder = dividend % divisor;
          checkStep(ram, before, bytes, { ...before, ip: 1,
            ax: width === 8 ? Number(BigInt.asUintN(8, quotient) + BigInt.asUintN(8, remainder) * 256n) : Number(BigInt.asUintN(16, quotient)),
            dx: width === 16 ? Number(BigInt.asUintN(16, remainder)) : before.dx });
        }
      }
    }
  }
});

test("8088 completion multiply/divide memory forms cover all modes, overrides, and divide-error delivery", () => {
  const ram = new ObservedRam(0x100000);
  for (const form of addressingCases()) for (const width of [8, 16] as const) for (const group of [4, 5, 6, 7]) {
    const before = { ...addressedState(), ax: 127, dx: 0 };
    const data = width === 8 ? [3] : [3, 0];
    put(ram, before.es, form.offset, data);
    const bytes = [0x26, width === 8 ? 0xf6 : 0xf7, form.mod * 64 + group * 8 + form.rm, ...form.displacement];
    const multiply = group < 6;
    const overflow = width === 8 && multiply;
    checkStep(ram, before, bytes, { ...before, ip: before.ip + bytes.length,
      ax: multiply ? 381 : width === 8 ? 0x012a : 42, dx: width === 16 ? multiply ? 0 : 1 : before.dx,
      flags: multiply ? { ...before.flags, cf: overflow, of: overflow } : before.flags }, undefined,
      dataReads(before.es, form.offset, data));
    if (!multiply) {
      const zero = data.map(() => 0); put(ram, before.es, form.offset, zero);
      checkDivideError(ram, before, bytes, dataReads(before.es, form.offset, zero));
    }
  }
});
