import { test } from "node:test";
import type { Cpu8088MemoryAccess } from "../../../../src/components/cpus/8088.js";
import { ObservedRam } from "../../../helpers/observed-ram.js";
import { initialState, flags, checkStep, registerValue, replaceRegister, addressedState, addressingCases, memoryBytes, shiftForms, shiftedResult, address } from "./helpers.js";

for (const [name, group] of shiftForms) {
  test(`8088 ${name} byte CL forms exhaust every value, all 256 counts, and both incoming carry values`, () => {
    const ram = new ObservedRam(0x100000);
    for (let value = 0; value < 256; value++) for (let count = 0; count < 256; count++) for (const carry of [0, 1]) {
      const before = initialState({ ax: 0xa500 + value, cx: 0xb600 + count, flags: flags((value * 2) % 512 + carry) });
      const expected = shiftedResult(name, 8, value, count, before.flags);
      checkStep(ram, before, [0xd2, 0xc0 + group * 8], { ...before, ax: 0xa500 + expected.result, ip: before.ip + 2, flags: expected.flags });
    }
  });

  test(`8088 ${name} word forms cover every value at count one, large counts, and all flags`, () => {
    const ram = new ObservedRam(0x100000);
    for (let value = 0; value < 65536; value++) {
      const before = initialState({ ax: value, flags: flags(value % 512) });
      const expected = shiftedResult(name, 16, value, 1, before.flags);
      checkStep(ram, before, [0xd1, 0xc0 + group * 8], { ...before, ax: expected.result, ip: before.ip + 2, flags: expected.flags });
    }
    for (const width of [8, 16] as const) for (let count = 0; count < 256; count++) {
      for (const value of [0, 1, 2, 2 ** (width - 1) - 1, 2 ** (width - 1), 2 ** width - 1, 0x55, 0xaa]) {
        for (const carry of [0, 1]) {
          const before = initialState({ ax: value, cx: 0x5600 + count, flags: flags(510 + carry) });
          const expected = shiftedResult(name, width, value, count, before.flags);
          checkStep(ram, before, [width === 8 ? 0xd2 : 0xd3, 0xc0 + group * 8],
            { ...before, ax: expected.result, ip: before.ip + 2, flags: expected.flags });
        }
      }
    }
    for (const opcode of [0xd0, 0xd1, 0xd2, 0xd3]) for (let bits = 0; bits < 512; bits++) {
      const width = opcode % 2 === 0 ? 8 : 16;
      for (const count of [0, 1, 2, 32, 255]) {
        const before = initialState({ ax: 2 ** (width - 1), cx: count, flags: flags(bits) });
        const expected = shiftedResult(name, width, before.ax, opcode < 0xd2 ? 1 : count, before.flags);
        checkStep(ram, before, [opcode, 0xc0 + group * 8], { ...before, ax: expected.result, ip: before.ip + 2, flags: expected.flags });
      }
    }
  });

  test(`8088 ${name} selects every register and memory form, captures CL before writes, and records zero-count writes`, () => {
    const ram = new ObservedRam(0x100000);
    for (const opcode of [0xd0, 0xd1, 0xd2, 0xd3]) {
      const width = opcode % 2 === 0 ? 8 : 16;
      for (let rm = 0; rm < 8; rm++) for (let count = 0; count < 256; count++) {
        const before = initialState({ cx: 0x8000 + count, flags: flags((count * 2) % 512 + rm % 2) });
        const expected = shiftedResult(name, width, registerValue(before, width, rm), opcode < 0xd2 ? 1 : count, before.flags);
        checkStep(ram, before, [opcode, 0xc0 + group * 8 + rm],
          { ...replaceRegister(before, width, rm, expected.result), ip: before.ip + 2, flags: expected.flags });
      }
      for (const form of addressingCases()) for (const count of [0, 1, 2, 8, 9, 16, 17, 32, 255]) {
        const before = { ...addressedState(), cx: 0xab00 + count };
        const value = 2 ** (width - 1) + 1;
        const locations = memoryBytes(before, form.segment, form.offset, width, value);
        for (const [address, byte] of locations) ram.write(address, byte);
        const expected = shiftedResult(name, width, value, opcode < 0xd2 ? 1 : count, before.flags);
        const bytes = [opcode, form.mod * 64 + group * 8 + form.rm, ...form.displacement];
        const accesses: Cpu8088MemoryAccess[] = [
          ...locations.map(([address, value]) => ({ kind: "read" as const, address, value })),
          ...memoryBytes(before, form.segment, form.offset, width, expected.result).map(([address, value]) => ({ kind: "write" as const, address, value })),
        ];
        checkStep(ram, before, bytes, { ...before, ip: before.ip + bytes.length, flags: expected.flags }, undefined, accesses);
      }
    }
  });
}
