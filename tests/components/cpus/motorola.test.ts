import assert from "node:assert/strict";
import { test } from "node:test";
import { add, subtract } from "../../../src/components/cpus/alu.js";
import { motorolaArithmeticFlags } from "../../../src/components/cpus/motorola.js";

import { initialState } from "../../helpers/68000-state.js";
import { instructions as m68000 } from "../../../src/components/cpus/generated/68000-control.js";
import { instructions as m6800 } from "../../../src/components/cpus/generated/6800.js";

test("Motorola condition encodings agree with unsigned and signed comparisons", () => {
  const state = initialState(), conditions = [m68000.ST_d0, m68000.SF_d0, m68000.SHI_d0, m68000.SLS_d0,
    m68000.SCC_d0, m68000.SCS_d0, m68000.SNE_d0, m68000.SEQ_d0, m68000.SVC_d0, m68000.SVS_d0,
    m68000.SPL_d0, m68000.SMI_d0, m68000.SGE_d0, m68000.SLT_d0, m68000.SGT_d0, m68000.SLE_d0];
  for (let left = 0; left < 256; left++) for (let right = 0; right < 256; right++) {
    const signedLeft = left < 128 ? left : left - 256, signedRight = right < 128 ? right : right - 256;
    const difference = signedLeft - signedRight;
    const byte = (left - right + 256) % 256;
    const flags = { n: byte >= 128, z: byte === 0, v: difference < -128 || difference > 127, c: left < right };
    Object.assign(state.flags, flags);
    assert.deepEqual(conditions.map(run => { run(state, 0, 0, 0); return state.d0 % 256 === 255; }), [
      true, false, left > right, left <= right, left >= right, left < right, left !== right, left === right,
      difference >= -128 && difference <= 127, difference < -128 || difference > 127,
      byte < 128, byte >= 128, signedLeft >= signedRight, signedLeft < signedRight,
      signedLeft > signedRight, signedLeft <= signedRight,
    ]);
  }
});

test("Motorola decimal correction updates the supplied flags and preserves H and control flags", () => {
  for (const incoming of [false, true]) {
    const flags = { h: incoming, c: incoming, n: true, z: true, v: true, i: !incoming, f: incoming };
    const state = { a: 0x9a, b: 0, x: 0, sp: 0, pc: 0, waiting: false, flags };
    m6800[0x19](state);
    assert.equal(state.a, 0);
    assert.equal(state.flags, flags);
    assert.deepEqual(flags, { h: incoming, c: true, n: false, z: true, v: false, i: !incoming, f: incoming });
  }
});

test("Motorola arithmetic flag policies are pure and leave H/X and control flags to the instruction", () => {
  for (const width of [8, 16, 32] as const) {
    const modulus = 2 ** width, half = modulus / 2;
    for (const left of [0, 1, half - 1, half, modulus - 1]) for (const right of [0, 1, half - 1, half, modulus - 1]) {
      for (const adding of [false, true]) for (const incoming of [0, 1] as const) {
        const total = adding ? left + right + incoming : left - right - incoming;
        const normalized = (total % modulus + modulus) % modulus;
        const signed = (value: number) => value < half ? value : value - modulus;
        const signedTotal = adding ? signed(left) + signed(right) + incoming : signed(left) - signed(right) - incoming;
        const facts = Object.freeze((adding ? add : subtract)(width, left, right, incoming));
        const original = { ...facts };
        const changes = motorolaArithmeticFlags(width, facts);
        assert.deepEqual(changes, { n: normalized >= half, z: normalized === 0,
          v: signedTotal < -half || signedTotal >= half, c: adding ? total >= modulus : total < 0 });
        assert.deepEqual(facts, original);
        const otherFlags = { h: true, x: true, f: false, i: true, n: false, z: true, v: false, c: true };
        assert.deepEqual({ ...otherFlags, ...changes }, { ...changes, h: true, x: true, f: false, i: true });
      }
    }
  }
});
