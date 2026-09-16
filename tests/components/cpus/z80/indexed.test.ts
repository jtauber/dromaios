import { test } from "node:test";
import { ObservedRam } from "../../../helpers/observed-ram.js";
import { initialState, flagPattern, aluForms, expectedAlu, cbRows, expectedCb, indexes, readAccess, writeAccess, checkPrefixedStep } from "./helpers.js";

for (const { prefix, index } of indexes) {
  test(`Z80 ${index.toUpperCase()} byte transfers use signed displacement, real H/L, and captured immediate bytes`, () => {
    const ram = new ObservedRam();
    const transfers = [
      { register: "b", load: 0x46, store: 0x70 }, { register: "c", load: 0x4e, store: 0x71 },
      { register: "d", load: 0x56, store: 0x72 }, { register: "e", load: 0x5e, store: 0x73 },
      { register: "h", load: 0x66, store: 0x74 }, { register: "l", load: 0x6e, store: 0x75 },
      { register: "a", load: 0x7e, store: 0x77 },
    ] as const;
    for (let displacement = 0; displacement < 256; displacement++) for (const pointer of [0, 0xffff]) {
      const target = (pointer + (displacement < 128 ? displacement : displacement - 256) + 65536) % 65536;
      const value = (displacement * 37 + 11) % 256;
      const before = initialState({ [index]: pointer, flags: flagPattern(displacement % 64) });
      for (const { register, load, store } of transfers) {
        ram.write(target, value);
        checkPrefixedStep(ram, before, [prefix, load, displacement], { [register]: value }, [readAccess(target, value)]);
        checkPrefixedStep(ram, { ...before, [register]: value }, [prefix, store, displacement], {}, [writeAccess(target, value)]);
      }
      checkPrefixedStep(ram, before, [prefix, 0x36, displacement, value], {}, [writeAccess(target, value)]);
    }
    for (const target of [0xffff, 0, 1, 2]) {
      // The immediate store can overwrite its prefix, opcode, displacement, or immediate.
      const before = initialState({ pc: 0xffff, [index]: target });
      checkPrefixedStep(ram, before, [prefix, 0x36, 0, 0x9a], {}, [writeAccess(target, 0x9a)]);
    }
  });

  test(`Z80 ${index.toUpperCase()} memory ALU and INC/DEC share byte semantics without changing the pointer`, () => {
    const ram = new ObservedRam();
    for (let value = 0; value < 256; value++) for (const carry of [false, true]) {
      const before = initialState({ a: (value * 73 + 7) % 256, [index]: 0x80, flags: { ...flagPattern(value % 32), c: carry } });
      ram.write(0, value);
      for (const { name, opcodes } of aluForms) {
        checkPrefixedStep(ram, before, [prefix, opcodes[6]!, 0x80], expectedAlu(name, before.a, value, carry), [readAccess(0, value)]);
      }
      for (const [opcode, delta] of [[0x34, 1], [0x35, -1]] as const) {
        ram.write(0, value);
        const result = (value + delta + 256) % 256;
        const signed = (value < 128 ? value : value - 256) + delta;
        checkPrefixedStep(ram, before, [prefix, opcode, 0x80], { flags: {
          s: result >= 128, z: result === 0, h: value % 16 + delta < 0 || value % 16 + delta > 15,
          pv: signed < -128 || signed > 127, n: delta < 0, c: carry,
        } }, [readAccess(0, value), writeAccess(0, result)]);
      }
    }
  });

  test(`Z80 ${index.toUpperCase()} word operations preserve byte registers and flags, with wrapped data and stack order`, () => {
    const ram = new ObservedRam();
    const boundaries = [0, 1, 0xff, 0x0fff, 0x1000, 0x7fff, 0x8000, 0xffff];
    for (const value of boundaries) for (let bits = 0; bits < 64; bits++) {
      const before = initialState({ pc: 0xfffe, [index]: value, sp: 0xffff, flags: flagPattern(bits) });
      const immediate = value ^ 0xffff;
      checkPrefixedStep(ram, before, [prefix, 0x21, immediate % 256, Math.floor(immediate / 256)], { [index]: immediate });
      checkPrefixedStep(ram, before, [prefix, 0x23], { [index]: (value + 1) % 65536 });
      checkPrefixedStep(ram, before, [prefix, 0x2b], { [index]: (value + 65535) % 65536 });
      checkPrefixedStep(ram, before, [prefix, 0xe9], { pc: value });
      checkPrefixedStep(ram, before, [prefix, 0xf9], { sp: value });
      for (const [pair, opcode] of [["bc", 0x09], ["de", 0x19], [index, 0x29], ["sp", 0x39]] as const) {
        const right = pair === "bc" ? 0x2233 : pair === "de" ? 0x4455 : before[pair];
        const sum = value + right;
        checkPrefixedStep(ram, before, [prefix, opcode], { [index]: sum % 65536,
          flags: { ...before.flags, h: value % 4096 + right % 4096 >= 4096, n: false, c: sum >= 65536 } });
      }
      // Data/stack wraps across FFFF; code is elsewhere for these cases.
      const state = { ...before, pc: 0x2000 };
      ram.write(0xffff, 0x34); ram.write(0, 0x12);
      checkPrefixedStep(ram, state, [prefix, 0x2a, 0xff, 0xff], { [index]: 0x1234 }, [readAccess(0xffff, 0x34), readAccess(0, 0x12)]);
      checkPrefixedStep(ram, state, [prefix, 0xe1], { [index]: 0x1234, sp: 1 }, [readAccess(0xffff, 0x34), readAccess(0, 0x12)]);
      checkPrefixedStep(ram, state, [prefix, 0xe3], { [index]: 0x1234 },
        [readAccess(0xffff, 0x34), readAccess(0, 0x12), writeAccess(0, Math.floor(value / 256)), writeAccess(0xffff, value % 256)]);
      checkPrefixedStep(ram, state, [prefix, 0x22, 0xff, 0xff], {}, [writeAccess(0xffff, value % 256), writeAccess(0, Math.floor(value / 256))]);
      checkPrefixedStep(ram, { ...state, sp: 1 }, [prefix, 0xe5], { sp: 0xffff }, [writeAccess(0, Math.floor(value / 256)), writeAccess(0xffff, value % 256)]);
    }
    // Stack can contain either encoding byte; both fetches precede data access.
    for (const sp of [0xffff, 0, 1]) {
      const before = initialState({ pc: 0xffff, sp, [index]: 0x7e9a });
      ram.write(1, 0x56); ram.write(2, 0x34);
      const low = sp === 0xffff ? prefix : sp === 0 ? 0xe3 : 0x56;
      const high = sp === 0xffff ? 0xe3 : sp === 0 ? 0x56 : 0x34;
      checkPrefixedStep(ram, before, [prefix, 0xe3], { [index]: high * 256 + low },
        [readAccess(sp, low), readAccess((sp + 1) % 65536, high), writeAccess((sp + 1) % 65536, 0x7e), writeAccess(sp, 0x9a)]);
    }
  });

  test(`Z80 ${index.toUpperCase()} CB covers every documented operation, byte, displacement, and carry`, () => {
    const ram = new ObservedRam();
    for (const { name, bit, base } of cbRows) for (let value = 0; value < 256; value++) for (const carry of [false, true]) {
      const displacement = (value * 17) % 256;
      const target = (displacement < 128 ? displacement : displacement - 256) + 1;
      const address = (target + 65536) % 65536;
      const before = initialState({ [index]: 1, r: value, flags: { ...flagPattern(value % 32), c: carry } });
      const expected = expectedCb(name, bit, value, before.flags);
      ram.write(address, value);
      checkPrefixedStep(ram, before, [prefix, 0xcb, displacement, base + 6], { flags: expected.flags },
        [readAccess(address, value), ...(name === "BIT" ? [] : [writeAccess(address, expected.value)])]);
    }
    for (const { name, bit, base } of cbRows) for (let overlap = 0; overlap < 4; overlap++) {
      const bytes = [prefix, 0xcb, 0, base + 6];
      const address = (0xfffe + overlap) % 65536;
      const before = initialState({ pc: 0xfffe, [index]: address });
      const value = bytes[overlap]!;
      const expected = expectedCb(name, bit, value, before.flags);
      checkPrefixedStep(ram, before, bytes, { flags: expected.flags },
        [readAccess(address, value), ...(name === "BIT" ? [] : [writeAccess(address, expected.value)])]);
    }
  });
}
