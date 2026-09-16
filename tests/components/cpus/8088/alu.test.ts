import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu8088 } from "../../../../src/components/cpus/8088.js";
import { ObservedRam } from "../../../helpers/observed-ram.js";
import { initialState, flags, addition, checkStep, aluForms, aluResult, address } from "./helpers.js";

test("8088 ADD AL,n covers every byte pair, ignores carry-in, and preserves AH", () => {
  const ram = new ObservedRam(0x100000);
  for (let al = 0; al < 256; al++) {
    for (let operand = 0; operand < 256; operand++) {
      const before = initialState({ ax: ((al + operand) % 256) * 256 + al, flags: flags(operand % 2 ? 511 : 0) });
      checkStep(ram, before, [4, operand], addition(before, operand, 8));
    }
  }
  for (let bits = 0; bits < 512; bits++) {
    for (const [al, operand] of [[0, 0], [0xf, 1], [0x7f, 1], [0x80, 0x80], [0xff, 1], [0xff, 0xff]] as const) {
      const before = initialState({ ax: 0xa500 + al, flags: flags(bits) });
      checkStep(ram, before, [4, operand], addition(before, operand, 8));
    }
  }
});

test("8088 ADD AX,n covers every word against carry and signed boundaries and all low-byte operand pairs", () => {
  const ram = new ObservedRam(0x100000);
  for (const operand of [0, 1, 0x8000, 0xffff]) {
    for (let ax = 0; ax < 65536; ax++) {
      const before = initialState({ ax });
      checkStep(ram, before, [5, operand % 256, Math.floor(operand / 256)], addition(before, operand));
    }
  }
  for (let a = 0; a < 256; a++) {
    for (let operand = 0; operand < 256; operand++) {
      const before = initialState({ ax: 0x7f00 + a });
      checkStep(ram, before, [5, operand, 0], addition(before, operand));
    }
  }
});

test("8088 original word forms preserve control flags for every incoming flag pattern, and MOV preserves all flags", () => {
  const ram = new ObservedRam(0x100000);
  for (let bits = 0; bits < 512; bits++) {
    for (const [ax, value] of [[0, 0], [0xf, 1], [0xff, 1], [0x7fff, 1], [0x8000, 0x8000], [0xffff, 1]] as const) {
      const before = initialState({ ax, flags: flags(bits) });
      checkStep(ram, before, [5, value % 256, Math.floor(value / 256)], addition(before, value));
      checkStep(ram, before, [0xb8, value % 256, Math.floor(value / 256)], { ...before, ax: value, ip: 0x103 });
      checkStep(ram, before, [0xa3, 0x81, 0], { ...before, ip: 0x103 }, undefined,
        [{ kind: "write", address: 0x20081, value: before.ax % 256 },
          { kind: "write", address: 0x20082, value: Math.floor(before.ax / 256) }]);
    }
  }
});

test("8088 parity uses only the low byte while sign and zero use the whole word", () => {
  const ram = new ObservedRam(0x100000);
  for (const [ax, pf, sf, zf] of [[0x0100, true, false, false], [0x0101, false, false, false],
    [0x8000, true, true, false], [0x8003, true, true, false], [0, true, false, true]] as const) {
    const cpu = new Cpu8088(ram, initialState({ ax }));
    [5, 0, 0].forEach((byte, offset) => ram.write(0x12440 + offset, byte));
    const after = cpu.step().after;
    assert.deepEqual([after.flags.pf, after.flags.sf, after.flags.zf], [pf, sf, zf]);
  }
});

for (const [name, , , , , byteOpcode, wordOpcode] of aluForms.filter(([name]) => name !== "ADD" && name !== "CMP")) {
  test(`8088 ${name} accumulator forms exhaust byte pairs and preserve unrelated state`, () => {
    const ram = new ObservedRam(0x100000);
    for (const carry of name === "ADC" || name === "SBB" ? [false, true] : [false]) {
      for (let left = 0; left < 256; left++) for (let right = 0; right < 256; right++) {
        const before = initialState({ ax: 0xa500 + left, flags: { ...flags((left + right) % 512), cf: carry } });
        const expected = aluResult(name, 8, left, right, before.flags);
        checkStep(ram, before, [byteOpcode, right], { ...before, ax: 0xa500 + expected.result, ip: 0x102, flags: expected.flags });
      }
    }
    for (let bits = 0; bits < 512; bits++) {
      for (const left of [0, 0xf, 0x10, 0xff, 0x7fff, 0x8000, 0xffff]) {
        for (const right of [0, 1, 0xf, 0x7fff, 0x8000, 0xffff]) {
          const before = initialState({ ax: left, flags: flags(bits), cs: 0xffff, ip: 0xffff });
          const expected = aluResult(name, 16, left, right, before.flags);
          checkStep(ram, before, [wordOpcode, right % 256, Math.floor(right / 256)],
            { ...before, ax: expected.result, ip: 2, flags: expected.flags });
        }
      }
    }
  });
}

test("8088 ADC/SBB word arithmetic covers every word with carry or borrow across the complete operand", () => {
  const ram = new ObservedRam(0x100000);
  for (const [name, opcode] of [["ADC", 0x15], ["SBB", 0x1d]] as const) {
    for (const right of [0, 0xffff]) for (let left = 0; left < 65536; left++) {
      const before = initialState({ ax: left });
      const expected = aluResult(name, 16, left, right, before.flags);
      checkStep(ram, before, [opcode, right % 256, Math.floor(right / 256)],
        { ...before, ax: expected.result, ip: 0x103, flags: expected.flags });
    }
  }
});

test("8088 TEST accumulator exhausts byte pairs and preserves AX while setting logic flags", () => {
  const ram = new ObservedRam(0x100000);
  for (let left = 0; left < 256; left++) for (let right = 0; right < 256; right++) {
    const before = initialState({ ax: 0xa500 + left, flags: flags((left + right) % 512) });
    checkStep(ram, before, [0xa8, right], { ...before, ip: 0x102, flags: aluResult("TEST", 8, left, right, before.flags).flags });
  }
  for (let bits = 0; bits < 512; bits++) {
    for (const [left, right] of [[0, 0xffff], [0x100, 0xffff], [0x8000, 0x8000], [0xa55a, 0x5aa5], [0xffff, 0xffff]]) {
      const before = initialState({ ax: left!, flags: flags(bits) });
      checkStep(ram, before, [0xa9, right! % 256, Math.floor(right! / 256)],
        { ...before, ip: 0x103, flags: aluResult("TEST", 16, left!, right!, before.flags).flags });
    }
  }
});
