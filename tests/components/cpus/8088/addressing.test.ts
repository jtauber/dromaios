import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu8088 } from "../../../../src/components/cpus/8088.js";
import type { Cpu8088MemoryAccess } from "../../../../src/components/cpus/8088.js";
import { ObservedRam } from "../../../helpers/observed-ram.js";
import { byteMoves, initialState, flags, snapshot, addition, checkStep, aluForms, aluResult, registerValue, replaceRegister, addressedState, addressingCases, memoryBytes, segments, address, put, wordBytes, dataReads, dataWrites, reject } from "./helpers.js";

test("8088 instruction fetching wraps IP within CS independently of twenty-bit physical wrap", () => {
  const ram = new ObservedRam(0x100000);
  for (const [cs, ip, addresses, nextIp] of [
    [0x1234, 0xfffe, [0x2233e, 0x2233f, 0x12340], 1],
    [0x1234, 0xffff, [0x2233f, 0x12340, 0x12341], 2],
    [0xffff, 0xf, [0xfffff, 0, 1], 0x12],
    [0xffff, 0xffff, [0xffef, 0xffff0, 0xffff1], 2],
  ] as const) {
    for (const opcode of [0xb8, 5, 0xa3]) {
      const before = initialState({ cs, ip, ax: 0x1234 });
      const after = opcode === 5 ? addition(before, 0x0080)
        : { ...before, ip: nextIp, ax: opcode === 0xb8 ? 0x80 : before.ax };
      const writes: Cpu8088MemoryAccess[] = opcode === 0xa3
        ? [{ kind: "write", address: 0x20080, value: 0x34 }, { kind: "write", address: 0x20081, value: 0x12 }] : [];
      checkStep(ram, before, [opcode, 0x80, 0], after, addresses, writes);
    }
  }
  for (let ip = 0; ip < 65536; ip++) {
    const before = initialState({ ip, cs: 0xffff });
    const addresses = [ip, (ip + 1) % 65536, (ip + 2) % 65536].map(offset => (0xffff0 + offset) % 1048576);
    checkStep(ram, before, [0xb8, 0x34, 0x12], { ...before, ip: (ip + 3) % 65536, ax: 0x1234 }, addresses);
  }
});

test("8088 two-byte instructions fetch only one immediate across IP and physical boundaries", () => {
  const ram = new ObservedRam(0x100000);
  for (const [cs, ip, addresses, nextIp] of [
    [0x1234, 0xffff, [0x2233f, 0x12340], 1], [0xffff, 0xf, [0xfffff, 0], 0x11],
    [0xffff, 0xffff, [0xffef, 0xffff0], 1],
  ] as const) {
    const before = initialState({ cs, ip, ax: 0x12ff });
    checkStep(ram, before, [4, 1], addition(before, 1, 8), addresses);
    for (const [opcode, register, half] of byteMoves) {
      const result = half === "low" ? Math.floor(before[register] / 256) * 256 + 0x80 : 0x8000 + before[register] % 256;
      checkStep(ram, before, [opcode, 0x80], { ...before, [register]: result, ip: nextIp }, addresses);
    }
  }
});

test("8088 ModR/M register ALU and MOV cover both directions, every pair, self operands, and byte aliases", () => {
  const ram = new ObservedRam(0x100000);
  const rows = [...aluForms.map(([name, ...codes]) => [name, ...codes.slice(0, 4)] as const),
    ["TEST", 0x84, 0x85] as const, ["MOV", 0x88, 0x89, 0x8a, 0x8b] as const];
  for (const [name, ...codes] of rows) for (const [index, opcode] of codes.entries()) {
    const width = index % 2 === 0 ? 8 : 16;
    for (let reg = 0; reg < 8; reg++) for (let rm = 0; rm < 8; rm++) {
      for (const bits of [0, 511]) {
        const before = initialState({ flags: flags(bits) });
        const destination = index < 2 ? rm : reg;
        const source = index < 2 ? reg : rm;
        const left = registerValue(before, width, destination);
        const right = registerValue(before, width, source);
        const expected = name === "MOV" ? { result: right, flags: before.flags }
          : aluResult(name, width, left, right, before.flags);
        const after = name === "TEST" || name === "CMP" ? before : replaceRegister(before, width, destination, expected.result);
        checkStep(ram, before, [opcode!, 0xc0 + reg * 8 + rm], { ...after, ip: 0x102, flags: expected.flags });
      }
    }
  }
});

for (const [name, rmByte, rmWord, regByte, regWord] of aluForms) {
  test(`8088 ModR/M ${name} resolves every memory mode, segment, register, width, and direction once`, () => {
    const ram = new ObservedRam(0x100000);
    for (const form of addressingCases()) for (let reg = 0; reg < 8; reg++) {
      for (const [opcode, width, toRegister] of [[rmByte, 8, false], [rmWord, 16, false], [regByte, 8, true], [regWord, 16, true]] as const) {
        const before = addressedState();
        const memory = width === 8 ? 0xa5 : 0x800f;
        const locations = memoryBytes(before, form.segment, form.offset, width, memory);
        for (const [address, value] of locations) ram.write(address, value);
        const register = registerValue(before, width, reg);
        const expected = aluResult(name, width, toRegister ? register : memory, toRegister ? memory : register, before.flags);
        const after = toRegister && name !== "CMP" ? replaceRegister(before, width, reg, expected.result) : before;
        const bytes = [opcode, form.mod * 64 + reg * 8 + form.rm, ...form.displacement];
        const accesses: Cpu8088MemoryAccess[] = locations.map(([address, value]) => ({ kind: "read", address, value }));
        if (!toRegister && name !== "CMP") accesses.push(...memoryBytes(before, form.segment, form.offset, width, expected.result)
          .map(([address, value]) => ({ kind: "write" as const, address, value })));
        checkStep(ram, before, bytes, { ...after, ip: before.ip + bytes.length, flags: expected.flags }, undefined, accesses);
        for (const [address, value] of memoryBytes(before, form.segment, form.offset, width, !toRegister && name !== "CMP" ? expected.result : memory)) {
          assert.equal(ram.read(address), value);
        }
      }
    }
  });
}

test("8088 ModR/M MOV does not read destinations and TEST never writes, across every memory mode and register", () => {
  const ram = new ObservedRam(0x100000);
  for (const form of addressingCases()) for (let reg = 0; reg < 8; reg++) {
    for (const [opcode, width, kind] of [[0x88, 8, "store"], [0x89, 16, "store"], [0x8a, 8, "load"], [0x8b, 16, "load"],
      [0x84, 8, "test"], [0x85, 16, "test"]] as const) {
      const before = addressedState();
      const value = width === 8 ? 0xa5 : 0x800f;
      const locations = memoryBytes(before, form.segment, form.offset, width, value);
      for (const [address, byte] of locations) ram.write(address, byte);
      const register = registerValue(before, width, reg);
      const after = kind === "load" ? replaceRegister(before, width, reg, value) : before;
      const bytes = [opcode, form.mod * 64 + reg * 8 + form.rm, ...form.displacement];
      const accesses = kind === "store" ? memoryBytes(before, form.segment, form.offset, width, register)
        .map(([address, value]) => ({ kind: "write" as const, address, value }))
        : locations.map(([address, value]) => ({ kind: "read" as const, address, value }));
      checkStep(ram, before, bytes, { ...after, ip: before.ip + bytes.length,
        flags: kind === "test" ? aluResult("TEST", width, value, register, before.flags).flags : before.flags }, undefined, accesses);
    }
  }
});

test("8088 immediate ModR/M groups cover every documented operation and register, including every signed byte", () => {
  const ram = new ObservedRam(0x100000);
  for (const [name, , , , , , , group] of aluForms) for (const opcode of [0x80, 0x81, 0x82, 0x83]) {
    if (opcode >= 0x82 && ["OR", "AND", "XOR"].includes(name)) continue;
    const width = opcode % 2 === 0 ? 8 : 16;
    for (let rm = 0; rm < 8; rm++) for (let byte = 0; byte < 256; byte++) {
      const before = initialState({ flags: flags(byte + (rm % 2) * 256) });
      const right = opcode === 0x81 ? 0x7f00 + byte : opcode === 0x83 && byte >= 128 ? 0xff00 + byte : byte;
      const expected = aluResult(name, width, registerValue(before, width, rm), right, before.flags);
      const bytes = [opcode, 0xc0 + group * 8 + rm, byte, ...(opcode === 0x81 ? [0x7f] : [])];
      const after = name === "CMP" ? before : replaceRegister(before, width, rm, expected.result);
      checkStep(ram, before, bytes, { ...after, ip: before.ip + bytes.length, flags: expected.flags });
    }
  }
});

test("8088 immediate ModR/M memory groups fetch complete encodings before read/modify/write and comparisons do not write", () => {
  const ram = new ObservedRam(0x100000);
  for (const [name, , , , , , , group] of aluForms) for (const opcode of [0x80, 0x81, 0x82, 0x83]) {
    if (opcode >= 0x82 && ["OR", "AND", "XOR"].includes(name)) continue;
    const width = opcode % 2 === 0 ? 8 : 16;
    for (const form of addressingCases()) for (const immediate of [0, 1, 0x7f, 0x80, 0xff]) {
      const before = addressedState();
      const left = width === 8 ? 0xf0 : 0x8000;
      const right = opcode === 0x81 ? 0xff00 + immediate : opcode === 0x83 && immediate >= 128 ? 0xff00 + immediate : immediate;
      const locations = memoryBytes(before, form.segment, form.offset, width, left);
      for (const [address, byte] of locations) ram.write(address, byte);
      const expected = aluResult(name, width, left, right, before.flags);
      const bytes = [opcode, form.mod * 64 + group * 8 + form.rm, ...form.displacement, immediate, ...(opcode === 0x81 ? [0xff] : [])];
      const accesses: Cpu8088MemoryAccess[] = locations.map(([address, value]) => ({ kind: "read", address, value }));
      if (name !== "CMP") accesses.push(...memoryBytes(before, form.segment, form.offset, width, expected.result)
        .map(([address, value]) => ({ kind: "write" as const, address, value })));
      checkStep(ram, before, bytes, { ...before, ip: before.ip + bytes.length, flags: expected.flags }, undefined, accesses);
    }
  }
});

test("8088 rejects unused 82/83 operation selectors after ModR/M only, with complete atomic state preservation", () => {
  const ram = new ObservedRam(0x100000);
  for (const opcode of [0x82, 0x83]) for (const group of [1, 4, 6]) {
    for (let mode = 0; mode < 4; mode++) for (let rm = 0; rm < 8; rm++) {
      const before = initialState({ cs: 0xffff, ip: 0xffff });
      const modRM = mode * 64 + group * 8 + rm;
      ram.write(0xffef, opcode); ram.write(0xffff0, modRM); ram.write(0xffff1, 0xa5);
      const cpu = new Cpu8088(ram, before);
      const expected = snapshot(before);
      for (let repeat = 0; repeat < 2; repeat++) {
        ram.accesses.length = 0;
        const accesses = [{ kind: "read", address: 0xffef, value: opcode }, { kind: "read", address: 0xffff0, value: modRM }];
        assert.deepEqual(cpu.step(), { before: expected, after: expected, instruction: { address: 0xffef, bytes: [opcode, modRM] },
          accesses, outcome: "unsupported", reason: "opcode" });
        assert.deepEqual(ram.accesses, accesses);
      }
      // The rejected decode leaves no stale operand or instruction state.
      ram.write(0xffff0, 0xc0); ram.write(0xffff1, 1);
      assert.equal(cpu.step().outcome, "executed");
      assert.equal(cpu.snapshot().ip, 2);
    }
  }
});

test("8088 ModR/M read/modify/write wraps segment offsets and bus addresses independently of wrapped instruction fetches", () => {
  const ram = new ObservedRam(0x100000);
  for (const [segment, value, offset, low, high] of [
    ["ds", 0xffff, 0x000f, 0xfffff, 0],
    ["ss", 0x1234, 0xffff, 0x2233f, 0x12340],
    ["ss", 0xffff, 0xffff, 0x0ffef, 0xffff0],
  ] as const) {
    const before = initialState({ [segment]: value, bp: offset, cs: 0xabcd, ip: 0xfffe });
    ram.write(low, 0xff); ram.write(high, 0x7f);
    const bytes = segment === "ds" ? [0x83, 0x06, offset % 256, Math.floor(offset / 256), 1] : [0x83, 0x46, 0, 1];
    const expected = aluResult("ADD", 16, 0x7fff, 1, before.flags);
    checkStep(ram, before, bytes, { ...before, ip: bytes.length - 2, flags: expected.flags }, undefined,
      [{ kind: "read", address: low, value: 0xff }, { kind: "read", address: high, value: 0x7f },
        { kind: "write", address: low, value: 0 }, { kind: "write", address: high, value: 0x80 }]);
  }
});

test("8088 immediate memory ALU fetches overlapping operands before reading or writing RAM and retains earlier records", () => {
  const ram = new ObservedRam(0x100000);
  const before = initialState({ ds: 0x1234 });
  const bytes = [0x81, 0x06, 0x04, 0x01, 1, 0]; // ADD word [0104],1; destination is the immediate itself.
  const expected = aluResult("ADD", 16, 1, 1, before.flags);
  checkStep(ram, before, bytes, { ...before, ip: 0x106, flags: expected.flags }, undefined,
    [{ kind: "read", address: 0x12444, value: 1 }, { kind: "read", address: 0x12445, value: 0 },
      { kind: "write", address: 0x12444, value: 2 }, { kind: "write", address: 0x12445, value: 0 }]);
  const cpu = new Cpu8088(ram, before);
  const record = cpu.step();
  assert.deepEqual(record.instruction!.bytes, [0x81, 6, 4, 1, 2, 0]);
  assert.equal(ram.read(0x12444), 4);
  const saved = structuredClone(record);
  ram.write(0x12444, 9);
  new Cpu8088(ram, before).step();
  assert.deepEqual(record, saved);
});

test("8088 register-only and memory MOV preserve all flags, including unchanged-value writes", () => {
  const ram = new ObservedRam(0x100000);
  for (let bits = 0; bits < 512; bits++) {
    const before = initialState({ flags: flags(bits) });
    checkStep(ram, before, [0x88, 0xe0], { ...before, ax: 0x1111, ip: 0x102 }); // MOV AL,AH
    checkStep(ram, before, [0x89, 0xdb], { ...before, ip: 0x102 }); // MOV BX,BX
    ram.write(0x20080, 0x22); ram.write(0x20081, 0x11);
    checkStep(ram, before, [0x89, 0x06, 0x80, 0], { ...before, ip: 0x104 }, undefined,
      [{ kind: "write", address: 0x20080, value: 0x22 }, { kind: "write", address: 0x20081, value: 0x11 }]);
  }
});

test("8088 completion prefixes select all segments across every memory mode and both widths", () => {
  const ram = new ObservedRam(0x100000);
  for (const [prefix, segment] of segments) for (const form of addressingCases()) for (const width of [8, 16] as const) {
    const before = addressedState(), value = width === 8 ? 0x5a : 0xa55a;
    const data = width === 8 ? [value] : wordBytes(value);
    put(ram, before[segment], form.offset, data);
    const bytes = [prefix, width === 8 ? 0x8a : 0x8b, form.mod * 64 + form.rm, ...form.displacement];
    checkStep(ram, before, bytes, { ...before, ax: width === 8 ? 0x115a : value, ip: before.ip + bytes.length }, undefined,
      dataReads(before[segment], form.offset, data));
    const absolute = [prefix, width === 8 ? 0xa2 : 0xa3, ...wordBytes(form.offset)];
    checkStep(ram, before, absolute, { ...before, ip: before.ip + 4 }, undefined,
      dataWrites(before[segment], form.offset, width === 8 ? [0x22] : [0x22, 0x11]));
  }
});

test("8088 completion prefixes are local, last-of-kind wins, and LOCK permits one ordinary instruction", () => {
  const ram = new ObservedRam(0x100000), before = initialState({ ip: 0xfffc });
  put(ram, before.cs, before.ip, [0xf0, 0x3e, 0x26, 0xa1, 0xff, 0xff, 0xa1, 0xff, 0xff]);
  put(ram, before.es, 0xffff, [0x34, 0x12]); put(ram, before.ds, 0xffff, [0x78, 0x56]);
  const cpu = new Cpu8088(ram, before), first = cpu.step();
  assert.equal(first.after.ax, 0x1234); assert.equal(first.after.ip, 2);
  assert.deepEqual(first.instruction?.bytes, [0xf0, 0x3e, 0x26, 0xa1, 0xff, 0xff]);
  assert.equal(cpu.step().after.ax, 0x5678);
  const many = [...Array<number>(20).fill(0xf0), 0x90];
  checkStep(ram, initialState(), many, initialState({ ip: 0x115 })); // No later-x86 15-byte limit.
  for (let offset = 0; offset < 65536; offset++) ram.write(address(before.cs, offset), 0x26);
  ram.accesses.length = 0;
  const rejected = new Cpu8088(ram, before).step();
  assert.equal(rejected.outcome, "unsupported"); assert.deepEqual(rejected.before, rejected.after);
  assert.equal(rejected.instruction?.bytes.length, 65536); assert.equal(ram.accesses.length, 65536);
  reject(ram, before, [0x26, 0xf0, 0xd6]); // No immediate or interrupt-vector read.
  reject(ram, before, [0xf3, 0x90]);
  reject(ram, before, [0xf2, 0xa4]);
  reject(ram, before, [0xf3, 0xf7]); // Undocumented REP arithmetic is excluded before ModR/M.
});
