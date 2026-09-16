import { test } from "node:test";
import { ObservedRam } from "../../../helpers/observed-ram.js";
import { initialState, flags, checkStep, addressedState, addressingCases, words, address, put, wordBytes, dataReads, dataWrites } from "./helpers.js";

const wordStacks = [
  [0x50, 0x58, "ax"], [0x51, 0x59, "cx"], [0x52, 0x5a, "dx"], [0x53, 0x5b, "bx"],
  [0x54, 0x5c, "sp"], [0x55, 0x5d, "bp"], [0x56, 0x5e, "si"], [0x57, 0x5f, "di"],
] as const;

for (const [push, pop, register] of wordStacks) {
  test(`8088 PUSH/POP ${register.toUpperCase()} preserve flags, use SS, and wrap SP and physical addresses`, () => {
    const ram = new ObservedRam(0x100000);
    for (const [ss, sp, pushedSp, pushLow, pushHigh, poppedSp, popLow, popHigh] of [
      [0x3000, 0x8000, 0x7ffe, 0x37ffe, 0x37fff, 0x8002, 0x38000, 0x38001],
      [0x1234, 0, 0xfffe, 0x2233e, 0x2233f, 2, 0x12340, 0x12341],
      [0x1234, 1, 0xffff, 0x2233f, 0x12340, 3, 0x12341, 0x12342],
      [0x1234, 0xffff, 0xfffd, 0x2233d, 0x2233e, 1, 0x2233f, 0x12340],
      [0xffff, 0x11, 0x0f, 0xfffff, 0, 0x13, 1, 2],
      [0xffff, 0x0f, 0x0d, 0xffffd, 0xffffe, 0x11, 0xfffff, 0],
    ] as const) {
      for (let bits = 0; bits < 512; bits++) {
        const before = initialState({ cs: 0x4000, ip: 0xffff, ss, sp, flags: flags(bits) });
        const value = register === "sp" ? pushedSp : before[register];
        checkStep(ram, before, [push], { ...before, sp: pushedSp, ip: 0 }, [0x4ffff], [
          { kind: "write", address: pushLow, value: value % 256 },
          { kind: "write", address: pushHigh, value: Math.floor(value / 256) },
        ]);
        ram.write(popLow, 0xef);
        ram.write(popHigh, 0xbe);
        checkStep(ram, before, [pop], { ...before, ip: 0, sp: poppedSp, [register]: 0xbeef }, [0x4ffff], [
          { kind: "read", address: popLow, value: 0xef }, { kind: "read", address: popHigh, value: 0xbe },
        ]);
      }
    }
  });
}

test("8088 PUSH SP stores its decremented value and POP SP replaces the increment for every pointer value", () => {
  const ram = new ObservedRam(0x100000);
  for (let sp = 0; sp < 65536; sp++) {
    const before = initialState({ sp });
    const pushed = (sp + 65534) % 65536;
    const low = 0x30000 + pushed;
    const high = 0x30000 + (pushed + 1) % 65536;
    checkStep(ram, before, [0x54], { ...before, sp: pushed, ip: 0x101 }, undefined, [
      { kind: "write", address: low, value: pushed % 256 },
      { kind: "write", address: high, value: Math.floor(pushed / 256) },
    ]);
    const value = 65535 - sp;
    ram.write(0x30000 + sp, value % 256);
    ram.write(0x30000 + (sp + 1) % 65536, Math.floor(value / 256));
    checkStep(ram, before, [0x5c], { ...before, sp: value, ip: 0x101 }, undefined, [
      { kind: "read", address: 0x30000 + sp, value: value % 256 },
      { kind: "read", address: 0x30000 + (sp + 1) % 65536, value: Math.floor(value / 256) },
    ]);
  }
});

test("8088 POP DX reproduces the hardware case that wraps the stack word from SS:FFFF to SS:0000", () => {
  // SingleStepTests/8088 V2 5A, idx 3252, hash 445ddb088cd7d3f60bfb27947ee7c2152b3b4e82.
  const ram = new ObservedRam(0x100000);
  const before = initialState({ cs: 0x4afa, ip: 0x5854, ss: 0x4b5a, sp: 0xffff });
  ram.write(0x5b59f, 0xa7);
  ram.write(0x4b5a0, 0x11);
  ram.write(0x5b5a0, 0xde); // A physically consecutive high byte would be wrong.
  checkStep(ram, before, [0x5a], { ...before, ip: 0x5855, sp: 1, dx: 0x11a7 }, [0x507f4], [
    { kind: "read", address: 0x5b59f, value: 0xa7 }, { kind: "read", address: 0x4b5a0, value: 0x11 },
  ]);
});

test("8088 relative CALL fetches its word before stacking the following IP, preserving CS and every flag", () => {
  const ram = new ObservedRam(0x100000);
  for (const [cs, ip, displacement, target, addresses] of [
    [0x1234, 0x100, 0, 0x103, [0x12440, 0x12441, 0x12442]],
    [0x1234, 0xfffe, 0x7fff, 0x8000, [0x2233e, 0x2233f, 0x12340]],
    [0x1234, 0xffff, 0x8000, 0x8002, [0x2233f, 0x12340, 0x12341]],
    [0xffff, 0xd, 0xffff, 0xf, [0xffffd, 0xffffe, 0xfffff]],
  ] as const) {
    for (const [ss, sp] of [[0x3000, 0x8000], [0x1234, 1], [0xffff, 0x11], [cs, (ip + 2) % 65536]] as const) {
      for (let bits = 0; bits < 512; bits++) {
        const before = initialState({ cs, ip, ss, sp, flags: flags(bits) });
        const returnIp = (ip + 3) % 65536;
        const newSp = (sp + 65534) % 65536;
        checkStep(ram, before, [0xe8, displacement % 256, Math.floor(displacement / 256)],
          { ...before, ip: target, sp: newSp }, addresses, [
            { kind: "write", address: (ss * 16 + newSp) % 1048576, value: returnIp % 256 },
            { kind: "write", address: (ss * 16 + (newSp + 1) % 65536) % 1048576, value: Math.floor(returnIp / 256) },
          ]);
      }
    }
  }
});

test("8088 near RET pops an unadjusted IP and optionally discards an unsigned byte count without reading parameters", () => {
  const ram = new ObservedRam(0x100000);
  for (const [ss, sp, low, high] of [
    [0x3000, 0x8000, 0x38000, 0x38001], [0x1234, 0xffff, 0x2233f, 0x12340],
    [0xffff, 0x000f, 0xfffff, 0],
  ] as const) {
    for (const target of [0, 1, 0x7fff, 0x8000, 0xffff]) {
      for (const discard of [undefined, 0, 1, 2, 0x7fff, 0x8000, 0xffff]) {
        for (let bits = 0; bits < 512; bits++) {
          const before = initialState({ cs: 0x4000, ip: 0xfffe, ss, sp, flags: flags(bits) });
          ram.write(low, target % 256);
          ram.write(high, Math.floor(target / 256));
          const bytes = discard === undefined ? [0xc3] : [0xc2, discard % 256, Math.floor(discard / 256)];
          checkStep(ram, before, bytes, { ...before, ip: target, sp: (sp + 2 + (discard ?? 0)) % 65536 },
            [0x4fffe, 0x4ffff, 0x40000], [
              { kind: "read", address: low, value: target % 256 },
              { kind: "read", address: high, value: Math.floor(target / 256) },
            ]);
        }
      }
    }
  }
});

test("8088 completion segment pushes/pops use original SS despite overrides and segment replacement", () => {
  const ram = new ObservedRam(0x100000);
  for (const [push, pop, segment] of [[0x06, 0x07, "es"], [0x0e, undefined, "cs"], [0x16, 0x17, "ss"], [0x1e, 0x1f, "ds"]] as const) {
    for (const sp of [0, 1, 2, 0xffff]) {
      const before = initialState({ ss: 0xffff, sp });
      checkStep(ram, before, [0x26, push], { ...before, sp: (sp + 65534) % 65536, ip: 0x102 }, undefined,
        dataWrites(before.ss, (sp + 65534) % 65536, wordBytes(before[segment])));
      if (pop === undefined) continue;
      put(ram, before.ss, sp, [0x78, 0x56]);
      checkStep(ram, before, [0x26, pop], { ...before, [segment]: 0x5678, recognitionDeferred: true, sp: (sp + 2) % 65536, ip: 0x102 }, undefined,
        dataReads(before.ss, sp, [0x78, 0x56]));
    }
  }
});

test("8088 completion indirect near transfers, PUSH and POP select every register and memory mode", () => {
  const ram = new ObservedRam(0x100000);
  for (let reg = 0; reg < 8; reg++) for (const group of [2, 4, 6]) {
    const before = initialState(), value = before[words[reg]!], sp = (before.sp + 65534) % 65536;
    const push = group !== 4;
    checkStep(ram, before, [0xff, 0xc0 + group * 8 + reg], { ...before, sp: push ? sp : before.sp,
      ip: group === 6 ? 0x102 : value }, undefined, push ? dataWrites(before.ss, sp,
      wordBytes(group === 2 ? 0x102 : reg === 4 ? sp : value)) : []);
    put(ram, before.ss, before.sp, [0x78, 0x56]);
    checkStep(ram, before, [0x8f, 0xc0 + reg], { ...before, sp: before.sp + 2, [words[reg]!]: 0x5678, ip: 0x102 }, undefined,
      dataReads(before.ss, before.sp, [0x78, 0x56]));
  }
  for (const form of addressingCases()) for (const group of [2, 4, 6]) {
    const before = addressedState(), bytes = [0xff, form.mod * 64 + group * 8 + form.rm, ...form.displacement];
    const push = group !== 4;
    put(ram, before[form.segment], form.offset, [0x78, 0x56]);
    checkStep(ram, before, bytes, { ...before, sp: push ? before.sp - 2 : before.sp,
      ip: group === 6 ? before.ip + bytes.length : 0x5678 }, undefined,
      [...dataReads(before[form.segment], form.offset, [0x78, 0x56]), ...(push ? dataWrites(before.ss, before.sp - 2,
        wordBytes(group === 2 ? before.ip + bytes.length : 0x5678)) : [])]);
    put(ram, before.ss, before.sp, [0x34, 0x12]);
    const pop = [0x8f, form.mod * 64 + form.rm, ...form.displacement];
    checkStep(ram, before, pop, { ...before, sp: before.sp + 2, ip: before.ip + pop.length }, undefined,
      [...dataReads(before.ss, before.sp, [0x34, 0x12]), ...dataWrites(before[form.segment], form.offset, [0x34, 0x12])]);
  }
});

test("8088 completion far transfers capture pointers before overlapping stack writes and wrap each word", () => {
  const ram = new ObservedRam(0x100000);
  for (const call of [false, true]) for (const indirect of [false, true]) {
    for (const sp of [0, 1, 3, 0xffff]) {
      const before = initialState({ ds: 0xffff, ss: 0xffff, sp });
      const pointer = [0xff, 0xff, 0xfe, 0xff], offset = (sp + 65532) % 65536;
      put(ram, before.ds, offset, pointer);
      const bytes = indirect ? [0xff, call ? 0x1e : 0x2e, ...wordBytes(offset)] : [call ? 0x9a : 0xea, ...pointer];
      checkStep(ram, before, bytes, { ...before, cs: 0xfffe, ip: 0xffff, sp: call ? offset : sp }, undefined,
        [...(indirect ? dataReads(before.ds, offset, pointer) : []), ...(call ? [
          ...dataWrites(before.ss, (sp + 65534) % 65536, wordBytes(before.cs)),
          ...dataWrites(before.ss, offset, wordBytes(before.ip + bytes.length)),
        ] : [])]);
    }
  }
  for (const form of addressingCases()) for (const group of [3, 5]) {
    const before = addressedState(), bytes = [0xff, form.mod * 64 + group * 8 + form.rm, ...form.displacement];
    put(ram, before[form.segment], form.offset, [0x45, 0x23, 0x89, 0x67]);
    checkStep(ram, before, bytes, { ...before, cs: 0x6789, ip: 0x2345, sp: group === 3 ? before.sp - 4 : before.sp }, undefined,
      [...dataReads(before[form.segment], form.offset, [0x45, 0x23, 0x89, 0x67]), ...(group === 3 ? [
        ...dataWrites(before.ss, before.sp - 2, wordBytes(before.cs)),
        ...dataWrites(before.ss, before.sp - 4, wordBytes(before.ip + bytes.length)),
      ] : [])]);
  }
  for (const discard of [undefined, 0, 1, 0x7fff, 0xffff]) for (const sp of [0, 0xfffd, 0xffff]) {
    const before = initialState({ ss: 0xffff, sp });
    put(ram, before.ss, sp, [0x78, 0x56, 0x34, 0x12]);
    const bytes = discard === undefined ? [0xcb] : [0xca, ...wordBytes(discard)];
    checkStep(ram, before, bytes, { ...before, cs: 0x1234, ip: 0x5678, sp: (sp + 4 + (discard ?? 0)) % 65536 }, undefined,
      dataReads(before.ss, sp, [0x78, 0x56, 0x34, 0x12]));
  }
});
