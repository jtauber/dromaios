import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu8088 } from "../../../../src/components/cpus/generated/8088-cpu.js";
import type { Cpu8088MemoryAccess } from "../../../../src/components/cpus/generated/8088-cpu.js";
import { ObservedRam } from "../../../helpers/observed-ram.js";
import { wordMoves, byteMoves, initialState, flags, snapshot, checkStep, aluResult, registerValue, replaceRegister, addressedState, addressingCases, memoryBytes, unaryForms, unaryResult, shiftForms, shiftedResult, segments, words, address, put, wordBytes, dataReads, dataWrites } from "./helpers.js";
import type { UnaryName, ShiftName } from "./helpers.js";

test("8088 MOV AX,n loads every word low byte first and preserves flags and other registers", () => {
  const ram = new ObservedRam(0x100000);
  for (let value = 0; value < 65536; value++) {
    const before = initialState();
    checkStep(ram, before, [0xb8, value % 256, Math.floor(value / 256)], { ...before, ax: value, ip: 0x103 });
  }
});

test("8088 immediate MOV selects every word register and preserves every incoming flag pattern", () => {
  const ram = new ObservedRam(0x100000);
  for (const [opcode, register] of wordMoves) {
    for (let bits = 0; bits < 512; bits++) {
      for (const value of [0, 0xff, 0x100, 0x7fff, 0x8000, 0xffff]) {
        const before = initialState({ flags: flags(bits) });
        checkStep(ram, before, [opcode, value % 256, Math.floor(value / 256)],
          { ...before, [register]: value, ip: 0x103 });
      }
    }
  }
});

test("8088 immediate byte MOV covers every byte and selector, preserving the other half and all flags", () => {
  const ram = new ObservedRam(0x100000);
  for (const [opcode, register, half] of byteMoves) {
    for (let value = 0; value < 256; value++) {
      for (const original of [0, 0xffff, 0xa55a, 0x5aa5]) {
        const before = initialState({ [register]: original, flags: flags(value + (original % 2) * 256) });
        const result = half === "low" ? Math.floor(original / 256) * 256 + value : value * 256 + original % 256;
        checkStep(ram, before, [opcode, value], { ...before, [register]: result, ip: 0x102 });
      }
    }
  }
});

test("8088 direct byte and word moves preserve all flags, and byte loads preserve AH", () => {
  const ram = new ObservedRam(0x100000);
  for (let bits = 0; bits < 512; bits++) {
    const before = initialState({ ax: 0xa55a, flags: flags(bits) });
    ram.write(0x20081, 0x80);
    ram.write(0x20082, 0x7f);
    checkStep(ram, before, [0xa0, 0x81, 0], { ...before, ax: 0xa580, ip: 0x103 }, undefined,
      [{ kind: "read", address: 0x20081, value: 0x80 }]);
    checkStep(ram, before, [0xa1, 0x81, 0], { ...before, ax: 0x7f80, ip: 0x103 }, undefined,
      [{ kind: "read", address: 0x20081, value: 0x80 }, { kind: "read", address: 0x20082, value: 0x7f }]);
    checkStep(ram, before, [0xa2, 0x81, 0], { ...before, ip: 0x103 }, undefined,
      [{ kind: "write", address: 0x20081, value: 0x5a }]);
    assert.equal(ram.read(0x20082), 0x7f);
    checkStep(ram, before, [0xa3, 0x81, 0], { ...before, ip: 0x103 }, undefined,
      [{ kind: "write", address: 0x20081, value: 0x5a }, { kind: "write", address: 0x20082, value: 0xa5 }]);
  }
});

test("8088 direct byte transfers cover every value, keep AH, and never access the neighboring byte", () => {
  const ram = new ObservedRam(0x100000);
  for (let value = 0; value < 256; value++) {
    const before = initialState({ ax: 0xa500 + value });
    ram.write(0x20080, 0xde);
    ram.write(0x20082, 0xad);
    for (let repeat = 0; repeat < 2; repeat++) {
      checkStep(ram, before, [0xa2, 0x81, 0], { ...before, ip: 0x103 }, undefined,
        [{ kind: "write", address: 0x20081, value }]);
      checkStep(ram, { ...before, ax: 0x5aff }, [0xa0, 0x81, 0], { ...before, ax: 0x5a00 + value, ip: 0x103 }, undefined,
        [{ kind: "read", address: 0x20081, value }]);
    }
    assert.equal(ram.read(0x20080), 0xde);
    assert.equal(ram.read(0x20082), 0xad);
  }
});

test("8088 direct word loads cover every offset and value, with data reads after both offset bytes", () => {
  const ram = new ObservedRam(0x100000);
  for (let offset = 0; offset < 65536; offset++) {
    const value = 65535 - offset;
    const low = value % 256;
    const high = Math.floor(value / 256);
    ram.write(0x20000 + offset, low);
    ram.write(0x20000 + (offset + 1) % 65536, high);
    const before = initialState();
    checkStep(ram, before, [0xa1, offset % 256, Math.floor(offset / 256)], { ...before, ax: value, ip: 0x103 }, undefined,
      [{ kind: "read", address: 0x20000 + offset, value: low }, { kind: "read", address: 0x20000 + (offset + 1) % 65536, value: high }]);
  }
});

test("8088 new memory forms keep DS data accesses distinct from wrapped CS instruction fetches", () => {
  const ram = new ObservedRam(0x100000);
  const before = initialState({ cs: 0x1234, ip: 0xffff, ds: 0xffff, ax: 0xa55a });
  const addresses = [0x2233f, 0x12340, 0x12341];
  ram.write(0xfffff, 0x34);
  ram.write(0, 0x12);
  checkStep(ram, before, [0xa0, 0xf, 0], { ...before, ax: 0xa534, ip: 2 }, addresses,
    [{ kind: "read", address: 0xfffff, value: 0x34 }]);
  checkStep(ram, before, [0xa1, 0xf, 0], { ...before, ax: 0x1234, ip: 2 }, addresses,
    [{ kind: "read", address: 0xfffff, value: 0x34 }, { kind: "read", address: 0, value: 0x12 }]);
  checkStep(ram, before, [0xa2, 0xf, 0], { ...before, ip: 2 }, addresses,
    [{ kind: "write", address: 0xfffff, value: 0x5a }]);
  assert.equal(ram.read(0), 0x12);
});

test("8088 word stores cover every DS offset, including odd words, without destination reads", () => {
  const ram = new ObservedRam(0x100000);
  for (let offset = 0; offset < 65536; offset++) {
    const before = initialState({ ax: 0xa55a });
    checkStep(ram, before, [0xa3, offset % 256, Math.floor(offset / 256)], { ...before, ip: 0x103 }, undefined,
      [{ kind: "write", address: 0x20000 + offset, value: 0x5a }, { kind: "write", address: 0x20000 + (offset + 1) % 65536, value: 0xa5 }]);
  }
});

test("8088 data words wrap within their segment and at one MiB, and record unchanged-value writes", () => {
  const ram = new ObservedRam(0x100000);
  for (const [ds, offset, low, high] of [
    [0x1234, 0xffff, 0x2233f, 0x12340], [0xffff, 0xf, 0xfffff, 0],
    [0xffff, 0x10, 0, 1], [0xffff, 0xffff, 0xffef, 0xffff0],
  ] as const) {
    const before = initialState({ ds, ax: 0xa55a });
    ram.write(low, 0x34);
    ram.write(high, 0x12);
    checkStep(ram, before, [0xa0, offset % 256, Math.floor(offset / 256)], { ...before, ax: 0xa534, ip: 0x103 }, undefined,
      [{ kind: "read", address: low, value: 0x34 }]);
    checkStep(ram, before, [0xa1, offset % 256, Math.floor(offset / 256)], { ...before, ax: 0x1234, ip: 0x103 }, undefined,
      [{ kind: "read", address: low, value: 0x34 }, { kind: "read", address: high, value: 0x12 }]);
    checkStep(ram, before, [0xa2, offset % 256, Math.floor(offset / 256)], { ...before, ip: 0x103 }, undefined,
      [{ kind: "write", address: low, value: 0x5a }]);
    assert.equal(ram.read(high), 0x12);
    for (let repeat = 0; repeat < 2; repeat++) {
      checkStep(ram, before, [0xa3, offset % 256, Math.floor(offset / 256)], { ...before, ip: 0x103 }, undefined,
        [{ kind: "write", address: low, value: 0x5a }, { kind: "write", address: high, value: 0xa5 }]);
      assert.equal(ram.read(low), 0x5a);
      assert.equal(ram.read(high), 0xa5);
    }
  }
});

test("8088 word moves retain completed accesses and fetched IP when either segmented data access fails", () => {
  const failure = new Error("word access failed");
  class FailingRam extends ObservedRam {
    failAddress = -1;
    override read(address: number): number {
      if (address === this.failAddress) throw failure;
      return super.read(address);
    }
    override write(address: number, value: number): void {
      if (address === this.failAddress) throw failure;
      super.write(address, value);
    }
  }
  // Both offset wrapping and physical wrapping must happen before a failing access.
  for (const [ds, offset, low, high] of [[0x1234, 0xffff, 0x2233f, 0x12340], [0xffff, 0xf, 0xfffff, 0]] as const) {
    for (const store of [false, true]) for (const second of [false, true]) {
      const ram = new FailingRam(0x100000);
      const before = initialState({ cs: 0, ds, ax: 0xa55a });
      const bytes = [store ? 0xa3 : 0xa1, offset % 256, Math.floor(offset / 256)];
      bytes.forEach((value, i) => ram.write(0x100 + i, value));
      ram.write(low, 0x34); ram.write(high, 0x12);
      const cpu = new Cpu8088(ram, before);
      ram.accesses.length = 0; ram.failAddress = second ? high : low;
      assert.throws(() => cpu.step(), error => error === failure);
      assert.deepEqual(cpu.snapshot(), snapshot({ ...before, ip: 0x103 }));
      assert.deepEqual(ram.accesses, [...bytes.map((value, i) => ({ kind: "read", address: 0x100 + i, value })),
        ...(second ? [{ kind: store ? "write" : "read", address: low, value: store ? 0x5a : 0x34 }] : [])]);
      ram.failAddress = -1;
      assert.equal(ram.read(low), store && second ? 0x5a : 0x34);
      assert.equal(ram.read(high), 0x12);
    }
  }
});

test("8088 stores every word value and leaves AX and every other register unchanged", () => {
  const ram = new ObservedRam(0x100000);
  for (let ax = 0; ax < 65536; ax++) {
    const before = initialState({ ax });
    checkStep(ram, before, [0xa3, 0x81, 0], { ...before, ip: 0x103 }, undefined,
      [{ kind: "write", address: 0x20081, value: ax % 256 }, { kind: "write", address: 0x20082, value: Math.floor(ax / 256) }]);
  }
});

test("8088 XCHG covers every register pair, byte aliases, self exchanges, accumulator encodings, and flag patterns", () => {
  const ram = new ObservedRam(0x100000);
  for (const width of [8, 16] as const) for (let left = 0; left < 8; left++) for (let right = 0; right < 8; right++) {
    for (let bits = 0; bits < 512; bits++) {
      const before = initialState({ flags: flags(bits) });
      const l = registerValue(before, width, left), r = registerValue(before, width, right);
      const after = replaceRegister(replaceRegister(before, width, left, r), width, right, l);
      checkStep(ram, before, [width === 8 ? 0x86 : 0x87, 0xc0 + right * 8 + left], { ...after, ip: before.ip + 2 });
      if (width === 16 && left === 0) checkStep(ram, before, [0x90 + right], { ...after, ip: before.ip + 1 });
    }
  }
});

test("8088 XCHG memory preserves its resolved address when exchanging an address register and wraps words", () => {
  const ram = new ObservedRam(0x100000);
  for (const width of [8, 16] as const) for (const form of addressingCases()) for (let register = 0; register < 8; register++) {
    const before = addressedState();
    const value = width === 8 ? 0xa5 : 0xa55a;
    const locations = memoryBytes(before, form.segment, form.offset, width, value);
    for (const [address, byte] of locations) ram.write(address, byte);
    const bytes = [width === 8 ? 0x86 : 0x87, form.mod * 64 + register * 8 + form.rm, ...form.displacement];
    const accesses: Cpu8088MemoryAccess[] = [
      ...locations.map(([address, value]) => ({ kind: "read" as const, address, value })),
      ...memoryBytes(before, form.segment, form.offset, width, registerValue(before, width, register))
        .map(([address, value]) => ({ kind: "write" as const, address, value })),
    ];
    checkStep(ram, before, bytes, { ...replaceRegister(before, width, register, value), ip: before.ip + bytes.length }, undefined, accesses);
  }
});

test("8088 immediate MOV/TEST r/m select every register, preserve byte halves, and exhaust byte TEST operands", () => {
  const ram = new ObservedRam(0x100000);
  for (const testOnly of [false, true]) for (const width of [8, 16] as const) {
    const opcode = (testOnly ? 0xf6 : 0xc6) + (width === 16 ? 1 : 0);
    for (let value = 0; value < 65536; value++) {
      const rm = value % 8;
      const old = width === 8 ? Math.floor(value / 256) : value;
      const immediate = width === 8 ? value % 256 : 65535 - value;
      const before = replaceRegister(initialState({ flags: flags(value % 512) }), width, rm, old);
      const bytes = [opcode, 0xc0 + rm, immediate % 256, ...(width === 16 ? [Math.floor(immediate / 256)] : [])];
      const expected = aluResult("TEST", width, old, immediate, before.flags);
      const after = testOnly ? { ...before, flags: expected.flags } : replaceRegister(before, width, rm, immediate);
      checkStep(ram, before, bytes, { ...after, ip: before.ip + bytes.length });
    }
  }
});

test("8088 immediate MOV writes without reading and immediate TEST reads without writing across all memory modes", () => {
  const ram = new ObservedRam(0x100000);
  for (const testOnly of [false, true]) for (const width of [8, 16] as const) for (const form of addressingCases()) {
    const before = addressedState();
    const value = width === 8 ? 0x55 : 0x5555;
    const immediate = width === 8 ? 0xaa : 0xaaaa;
    const locations = memoryBytes(before, form.segment, form.offset, width, value);
    for (const [address, byte] of locations) ram.write(address, byte);
    const bytes = [(testOnly ? 0xf6 : 0xc6) + (width === 16 ? 1 : 0), form.mod * 64 + form.rm, ...form.displacement,
      immediate % 256, ...(width === 16 ? [Math.floor(immediate / 256)] : [])];
    const accesses: Cpu8088MemoryAccess[] = testOnly ? locations.map(([address, value]) => ({ kind: "read", address, value }))
      : memoryBytes(before, form.segment, form.offset, width, immediate).map(([address, value]) => ({ kind: "write", address, value }));
    checkStep(ram, before, bytes, { ...before, ip: before.ip + bytes.length,
      flags: testOnly ? aluResult("TEST", width, value, immediate, before.flags).flags : before.flags }, undefined, accesses);
  }
});

test("8088 new memory forms fetch complete encodings before touching overlapping opcode, address, or immediate bytes", () => {
  const ram = new ObservedRam(0x100000);
  const forms = [
    ...unaryForms.flatMap(([name, byte, word, group]) => [{ name, opcode: byte, group }, { name, opcode: word, group }]),
    ...shiftForms.flatMap(([name, group]) => [0xd0, 0xd1, 0xd2, 0xd3].map(opcode => ({ name, opcode, group }))),
    { name: "MOV", opcode: 0xc6, group: 0 }, { name: "MOV", opcode: 0xc7, group: 0 },
    { name: "TEST", opcode: 0xf6, group: 0 }, { name: "TEST", opcode: 0xf7, group: 0 },
    { name: "XCHG", opcode: 0x86, group: 3 }, { name: "XCHG", opcode: 0x87, group: 3 },
  ] as const;
  for (const { name, opcode, group } of forms) for (const ip of [0x100, 0xfffd, 0xffff]) for (let overlap = 0; overlap < 6; overlap++) {
    const width = opcode % 2 === 0 ? 8 : 16;
    const before = initialState({ cs: 0xffff, ds: 0xffff, ip, cx: overlap === 0 ? 0 : 0x21 });
    const offset = (ip + overlap) % 65536;
    const immediate = width === 8 ? 0x80 : 0x8001;
    const bytes = [opcode, 6 + group * 8, offset % 256, Math.floor(offset / 256),
      ...(["MOV", "TEST"].includes(name) ? [immediate % 256, ...(width === 16 ? [Math.floor(immediate / 256)] : [])] : [])];
    const addresses = bytes.map((_, i) => (before.cs * 16 + (ip + i) % 65536) % 1048576);
    const memory = new Map(memoryBytes(before, "ds", offset, width, width === 8 ? 0xa5 : 0xa55a));
    bytes.forEach((value, i) => memory.set(addresses[i]!, value));
    for (const [address, value] of memory) ram.write(address, value);
    const locations = memoryBytes(before, "ds", offset, width, 0).map(([address]) => [address, memory.get(address)!] as const);
    const old = locations[0]![1] + (width === 16 ? locations[1]![1] * 256 : 0);
    let after = { ...before, ip: (ip + bytes.length) % 65536 };
    let result: number | undefined;
    if (name === "MOV") result = immediate;
    else if (name === "TEST") after.flags = aluResult("TEST", width, old, immediate, before.flags).flags;
    else if (name === "XCHG") { result = registerValue(before, width, 3); after = replaceRegister(after, width, 3, old); }
    else {
      const expected = opcode >= 0xd0 && opcode <= 0xd3
        ? shiftedResult(name as ShiftName, width, old, opcode < 0xd2 ? 1 : before.cx, before.flags)
        : unaryResult(name as UnaryName, width, old, before.flags);
      result = expected.result; after.flags = expected.flags;
    }
    const accesses: Cpu8088MemoryAccess[] = name === "MOV" ? [] : locations.map(([address, value]) => ({ kind: "read", address, value }));
    if (result !== undefined) accesses.push(...memoryBytes(before, "ds", offset, width, result)
      .map(([address, value]) => ({ kind: "write" as const, address, value })));
    checkStep(ram, before, bytes, after, addresses, accesses);
  }
});

test("8088 transfers and unary/shift operations preserve retained records through RAM edits, resumption, and reset", () => {
  const ram = new ObservedRam(0x100000);
  const before = initialState({ ax: 0x8001, dx: 0x1234 });
  [0xd1, 0xe8, 0xd1, 0xda, 0x87, 0x16, 0x80, 0].forEach((value, i) => ram.write(0x12440 + i, value)); // SHR AX,1; RCR DX,1; XCHG [0080],DX
  const cpu = new Cpu8088(ram, before);
  const first = cpu.step();
  const saved = structuredClone(first);
  assert.equal(first.after.ax, 0x4000);
  assert.equal(first.after.flags.cf, true);
  const resumed = new Cpu8088(ram, cpu.snapshot());
  assert.equal(resumed.step().after.dx, 0x891a);
  ram.write(0x20080, 0x5a); ram.write(0x20081, 0xa5);
  const exchange = resumed.step();
  assert.equal(exchange.after.dx, 0xa55a);
  assert.equal(ram.read(0x20080), 0x1a); assert.equal(ram.read(0x20081), 0x89);
  const savedExchange = structuredClone(exchange);
  ram.write(0x20080, 0xff);
  resumed.reset();
  assert.deepEqual(first, saved);
  assert.deepEqual(exchange, savedExchange);
  assert.equal(cpu.snapshot().ip, 0x102);
});

test("8088 completion segment MOV, LEA, LES and LDS preserve resolved addresses and exact access widths", () => {
  const ram = new ObservedRam(0x100000);
  for (const form of addressingCases()) for (let reg = 0; reg < 8; reg++) {
    const before = addressedState(), modRM = form.mod * 64 + reg * 8 + form.rm;
    const suffix = [modRM, ...form.displacement];
    checkStep(ram, before, [0x8d, ...suffix], { ...before, [words[reg]!]: form.offset, ip: before.ip + 1 + suffix.length });
    for (const [opcode, segment] of [[0xc4, "es"], [0xc5, "ds"]] as const) {
      const pointer = [0x78, 0x56, 0x34, 0x12];
      put(ram, before[form.segment], form.offset, pointer);
      checkStep(ram, before, [opcode, ...suffix], { ...before, [words[reg]!]: 0x5678, [segment]: 0x1234,
        ip: before.ip + 1 + suffix.length }, undefined, dataReads(before[form.segment], form.offset, pointer));
    }
  }
  for (let selector = 0; selector < 4; selector++) for (let reg = 0; reg < 8; reg++) {
    const segment = segments[selector]![1], before = initialState(), modRM = 0xc0 + selector * 8 + reg;
    checkStep(ram, before, [0x8c, modRM], { ...before, [words[reg]!]: before[segment], ip: 0x102 });
    if (segment !== "cs") checkStep(ram, before, [0x8e, modRM], { ...before, [segment]: before[words[reg]!], recognitionDeferred: true, ip: 0x102 });
  }
  for (let selector = 0; selector < 4; selector++) for (const form of addressingCases()) {
    const before = addressedState(), segment = segments[selector]![1];
    const suffix = [form.mod * 64 + selector * 8 + form.rm, ...form.displacement];
    checkStep(ram, before, [0x8c, ...suffix], { ...before, ip: before.ip + 1 + suffix.length }, undefined,
      dataWrites(before[form.segment], form.offset, wordBytes(before[segment])));
    if (segment === "cs") continue;
    put(ram, before[form.segment], form.offset, [0x34, 0x12]);
    checkStep(ram, before, [0x8e, ...suffix], { ...before, [segment]: 0x1234, recognitionDeferred: true, ip: before.ip + 1 + suffix.length }, undefined,
      dataReads(before[form.segment], form.offset, [0x34, 0x12]));
  }
});

test("8088 completion XLAT wraps BX+AL, honors each segment override, and reads exactly one byte", () => {
  const ram = new ObservedRam(0x100000);
  for (const [prefix, segment] of segments) for (let al = 0; al < 256; al++) {
    const before = initialState({ ax: 0xa500 + al, bx: 0xff80 }), offset = (before.bx + al) % 65536;
    put(ram, before[segment], offset, [255 - al]);
    checkStep(ram, before, [prefix, 0xd7], { ...before, ax: 0xa500 + 255 - al, ip: 0x102 }, undefined,
      dataReads(before[segment], offset, [255 - al]));
  }
});
