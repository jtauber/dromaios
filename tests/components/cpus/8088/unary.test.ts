import { test } from "node:test";
import type { Cpu8088MemoryAccess } from "../../../../src/components/cpus/8088.js";
import { ObservedRam } from "../../../helpers/observed-ram.js";
import { initialState, flags, checkStep, aluResult, replaceRegister, addressedState, addressingCases, memoryBytes, unaryForms, unaryResult, address } from "./helpers.js";

test("8088 INC/DEC selects all word registers, preserves CF and control flags, and wraps without stack accesses", () => {
  const ram = new ObservedRam(0x100000);
  for (const [inc, dec, register] of [[0x40, 0x48, "ax"], [0x41, 0x49, "cx"], [0x42, 0x4a, "dx"], [0x43, 0x4b, "bx"],
    [0x44, 0x4c, "sp"], [0x45, 0x4d, "bp"], [0x46, 0x4e, "si"], [0x47, 0x4f, "di"]] as const) {
    for (const [opcode, operation] of [[inc, "ADD"], [dec, "SUB"]] as const) {
      for (let bits = 0; bits < 512; bits++) for (const value of [0, 0xf, 0x10, 0x7fff, 0x8000, 0xffff]) {
        const before = initialState({ [register]: value, flags: flags(bits), ip: 0xffff });
        const expected = aluResult(operation, 16, value, 1, before.flags);
        checkStep(ram, before, [opcode], { ...before, [register]: expected.result, ip: 0,
          flags: { ...expected.flags, cf: before.flags.cf } });
      }
    }
  }
  for (let value = 0; value < 65536; value++) {
    for (const [opcode, operation] of [[0x44, "ADD"], [0x4c, "SUB"]] as const) {
      const before = initialState({ sp: value, flags: flags(value % 512) });
      const expected = aluResult(operation, 16, value, 1, before.flags);
      checkStep(ram, before, [opcode], { ...before, sp: expected.result, ip: 0x101,
        flags: { ...expected.flags, cf: before.flags.cf } });
    }
  }
});

for (const [name, byteOpcode, wordOpcode, group] of unaryForms) {
  test(`8088 ${name} r/m covers every byte/word, both incoming carries, register selection, and byte halves`, () => {
    const ram = new ObservedRam(0x100000);
    for (const width of [8, 16] as const) for (let value = 0; value < 2 ** width; value++) for (const carry of [0, 1]) {
      const rm = value % 8;
      const before = replaceRegister(initialState({ flags: flags((value * 2) % 512 + carry) }), width, rm, value);
      const expected = unaryResult(name, width, value, before.flags);
      checkStep(ram, before, [width === 8 ? byteOpcode : wordOpcode, 0xc0 + group * 8 + rm],
        { ...replaceRegister(before, width, rm, expected.result), ip: before.ip + 2, flags: expected.flags });
    }
  });

  test(`8088 ${name} memory resolves every addressing form once and reads before writing, preserving control flags`, () => {
    const ram = new ObservedRam(0x100000);
    for (const width of [8, 16] as const) for (const form of addressingCases()) {
      for (const value of [0, 1, 2 ** (width - 1) - 1, 2 ** (width - 1), 2 ** width - 1]) {
        const before = addressedState();
        const locations = memoryBytes(before, form.segment, form.offset, width, value);
        for (const [address, byte] of locations) ram.write(address, byte);
        const expected = unaryResult(name, width, value, before.flags);
        const bytes = [width === 8 ? byteOpcode : wordOpcode, form.mod * 64 + group * 8 + form.rm, ...form.displacement];
        const accesses: Cpu8088MemoryAccess[] = [
          ...locations.map(([address, value]) => ({ kind: "read" as const, address, value })),
          ...memoryBytes(before, form.segment, form.offset, width, expected.result).map(([address, value]) => ({ kind: "write" as const, address, value })),
        ];
        checkStep(ram, before, bytes, { ...before, ip: before.ip + bytes.length, flags: expected.flags }, undefined, accesses);
      }
    }
  });
}
