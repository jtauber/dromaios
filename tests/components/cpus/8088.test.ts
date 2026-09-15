import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu8088 } from "../../../src/components/cpus/8088.js";
import type { Cpu8088Flags, Cpu8088State, Cpu8088Snapshot, Cpu8088MemoryAccess } from "../../../src/components/cpus/8088.js";
import { Ram } from "../../../src/components/memory/ram.js";
import { ObservedRam } from "../../helpers/observed-ram.js";
import { runCpu } from "../../../src/runtime/run-cpu.js";

// Literal encodings from Intel's instruction table, independent of the core's selector arrays.
const wordMoves = [
  [0xb8, "ax"], [0xb9, "cx"], [0xba, "dx"], [0xbb, "bx"],
  [0xbc, "sp"], [0xbd, "bp"], [0xbe, "si"], [0xbf, "di"],
] as const;
const byteMoves = [
  [0xb0, "ax", "low"], [0xb1, "cx", "low"], [0xb2, "dx", "low"], [0xb3, "bx", "low"],
  [0xb4, "ax", "high"], [0xb5, "cx", "high"], [0xb6, "dx", "high"], [0xb7, "bx", "high"],
] as const;

function initialState(overrides: Partial<Cpu8088State> = {}): Cpu8088State {
  return { halted: false, ax: 0x1122, bx: 0x3344, cx: 0x5566, dx: 0x7788, sp: 0x8000, bp: 0x9000, si: 0x10, di: 0x20,
    cs: 0x1234, ds: 0x2000, ss: 0x3000, es: 0x4000, ip: 0x100, flags: flags(0x1ff), ...overrides };
}

// A compact test enumeration of the nine flags, independent of packed FLAGS bit positions.
function flags(bits: number): Cpu8088Flags {
  return { cf: Boolean(bits & 1), pf: Boolean(bits & 2), af: Boolean(bits & 4), zf: Boolean(bits & 8),
    sf: Boolean(bits & 16), tf: Boolean(bits & 32), if: Boolean(bits & 64), df: Boolean(bits & 128), of: Boolean(bits & 256) };
}

function snapshot(state: Cpu8088State): Cpu8088Snapshot {
  return { ...state, flags: { ...state.flags },
    al: state.ax % 256, ah: Math.floor(state.ax / 256), bl: state.bx % 256, bh: Math.floor(state.bx / 256),
    cl: state.cx % 256, ch: Math.floor(state.cx / 256), dl: state.dx % 256, dh: Math.floor(state.dx / 256),
    pc: (state.cs * 16 + state.ip) % 1048576 };
}

// Signed ranges and a bit count provide an oracle independent of the CPU's bitwise flag formulas.
function addition(before: Cpu8088State, operand: number, width: 8 | 16 = 16): Cpu8088State {
  const modulus = 2 ** width;
  const sign = modulus / 2;
  const accumulator = before.ax % modulus;
  const total = accumulator + operand;
  const result = total % modulus;
  const signedTotal = (accumulator < sign ? accumulator : accumulator - modulus)
    + (operand < sign ? operand : operand - modulus);
  const ones = (result % 256).toString(2).replaceAll("0", "").length;
  const ax = width === 8 ? Math.floor(before.ax / 256) * 256 + result : result;
  return { ...before, ax, ip: (before.ip + 1 + width / 8) % 65536, flags: { ...before.flags,
    cf: total >= modulus, pf: ones % 2 === 0, af: accumulator % 16 + operand % 16 >= 16,
    zf: result === 0, sf: result >= sign, of: signedTotal < -sign || signedTotal >= sign } };
}

function checkStep(ram: ObservedRam, before: Cpu8088State, bytes: readonly number[], after: Cpu8088State,
  addresses: readonly number[] = bytes.map((_, i) => (before.cs * 16 + (before.ip + i) % 65536) % 1048576), dataAccesses: readonly Cpu8088MemoryAccess[] = []): void {
  bytes.forEach((byte, index) => ram.write(addresses[index]!, byte));
  ram.accesses.length = 0;
  const cpu = new Cpu8088(ram, before);
  const accesses = [...bytes.map((value, index) => ({ kind: "read", address: addresses[index]!, value })), ...dataAccesses];
  assert.deepEqual(cpu.step(), { before: snapshot(before), after: snapshot(after),
    instruction: { address: addresses[0], bytes }, outcome: "executed", accesses });
  assert.deepEqual(cpu.snapshot(), snapshot(after));
  assert.deepEqual(ram.accesses, accesses);
}

test("8088 construction and inspection detach stored state, byte views, and physical PC without RAM access", () => {
  const ram = new ObservedRam(0x100000);
  const state = initialState();
  const expected = snapshot(state);
  const cpu = new Cpu8088(ram, state);
  const first = cpu.snapshot();
  const second = cpu.snapshot();
  const restored = new Cpu8088(ram, first);
  state.ax = 0;
  state.cs = 0;
  state.flags.cf = false;
  Reflect.set(first, "al", 0);
  Reflect.set(first, "pc", 0);
  Reflect.set(first.flags, "if", false);
  assert.deepEqual(second, expected);
  assert.deepEqual(cpu.snapshot(), expected);
  assert.deepEqual(restored.snapshot(), expected);
  assert.deepEqual(ram.accesses, []);
});

test("8088 copies each declared getter once and ignores extra metadata and contradictory derived views", () => {
  const state = initialState();
  const expected = snapshot(state);
  const calls = new Map<string, number>();
  for (const [label, object] of [["state", state], ["flags", state.flags]] as const) {
    for (const [name, value] of Object.entries(object)) {
      Object.defineProperty(object, name, { enumerable: false, get: () => {
        const key = `${label}.${name}`;
        calls.set(key, (calls.get(key) ?? 0) + 1);
        return value;
      } });
    }
    for (const name of ["metadata", "al", "ah", "pc"]) {
      Object.defineProperty(object, name, { get: () => { throw new Error(`Unexpected ${label}.${name}`); } });
    }
  }
  assert.deepEqual(new Cpu8088(new Ram(0x100000), state).snapshot(), expected);
  assert.equal(calls.size, 24);
  assert.ok([...calls.values()].every(count => count === 1));
});

test("8088 requires thirteen word registers, nine Boolean flags, and exactly 1 MiB RAM", () => {
  const ram = new ObservedRam(0x100000);
  for (const name of ["ax", "bx", "cx", "dx", "sp", "bp", "si", "di", "cs", "ds", "ss", "es", "ip"] as const) {
    for (const value of [0, 65535]) assert.equal(new Cpu8088(ram, initialState({ [name]: value })).snapshot()[name], value);
    for (const value of [-1, 65536, 0.5, NaN, Infinity, "00", undefined]) {
      const state = initialState();
      Reflect.set(state, name, value);
      assert.throws(() => new Cpu8088(ram, state), RangeError);
    }
  }
  for (const name of ["cf", "pf", "af", "zf", "sf", "tf", "if", "df", "of"]) {
    for (const value of [0, 1, "false", undefined]) {
      const state = initialState();
      Reflect.set(state.flags, name, value);
      assert.throws(() => new Cpu8088(ram, state), TypeError);
    }
  }
  for (const size of [1, 0x10000, 0xfffff, 0x100001]) {
    assert.throws(() => new Cpu8088(new Ram(size), initialState()), /exactly 1 MiB/);
  }
  assert.deepEqual(ram.accesses, []);
});

test("8088 derives both byte halves for every word value and masks every code segment to twenty address bits", () => {
  const ram = new Ram(0x100000);
  for (let value = 0; value < 65536; value++) {
    const state = initialState({ ax: value, bx: 65535 - value, cx: value, dx: 65535 - value, cs: value, ip: 0xffff });
    assert.deepEqual(new Cpu8088(ram, state).snapshot(), snapshot(state));
  }
  for (const [cs, ip, pc] of [[0x1000, 0x2345, 0x12345], [0x1234, 5, 0x12345],
    [0xffff, 0xf, 0xfffff], [0xffff, 0x10, 0], [0xffff, 0xffff, 0x0ffef]] as const) {
    assert.equal(new Cpu8088(ram, initialState({ cs, ip })).snapshot().pc, pc);
  }
});

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

test("8088 rejects every deferred or undocumented first byte with one fetch and no state change", () => {
  const ram = new ObservedRam(0x100000);
  const unsupported = [
    0x0f, 0x60, 0x61, 0x62, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x6b, 0x6c, 0x6d, 0x6e, 0x6f,
    0x9b, 0xc0, 0xc1, 0xc8, 0xc9, 0xcc, 0xcd, 0xce, 0xcf, 0xd6, 0xd8, 0xd9, 0xda, 0xdb, 0xdc, 0xdd, 0xde, 0xdf,
    0xe4, 0xe5, 0xe6, 0xe7, 0xec, 0xed, 0xee, 0xef, 0xf1, 0xfa, 0xfb,
  ];
  for (const [cs, ip, address] of [[0x1234, 0x100, 0x12440], [0xffff, 0xf, 0xfffff], [0xffff, 0x10, 0]] as const) {
    for (const opcode of unsupported) {
      ram.write(address, opcode);
      const before = snapshot(initialState({ cs, ip }));
      const cpu = new Cpu8088(ram, before);
      for (let repeat = 0; repeat < 2; repeat++) {
        ram.accesses.length = 0;
        const accesses = [{ kind: "read", address, value: opcode }];
        assert.deepEqual(cpu.step(), { before, after: before, instruction: { address, bytes: [opcode] },
          outcome: "unsupported", reason: "opcode", accesses });
        assert.deepEqual(cpu.snapshot(), before);
        assert.deepEqual(ram.accesses, accesses);
      }
    }
  }
});

test("8088 reset sets FFFF:0000 and clears segments and all flags without reading a vector or clearing RAM", () => {
  const ram = new ObservedRam(0x100000);
  [0xb8, 0xcd, 0xab].forEach((byte, offset) => ram.write(0xffff0 + offset, byte));
  for (let bits = 0; bits < 512; bits++) {
    const state = initialState({ flags: flags(bits) });
    const cpu = new Cpu8088(ram, state);
    const before = snapshot(state);
    const after = snapshot({ ...state, cs: 0xffff, ip: 0, ds: 0, ss: 0, es: 0, flags: flags(0) });
    ram.accesses.length = 0;
    const reset = cpu.reset();
    assert.deepEqual(reset, { before, after, accesses: [] });
    assert.deepEqual(cpu.reset(), { before: after, after, accesses: [] });
    assert.deepEqual(ram.accesses, []);
    const loaded = cpu.step();
    assert.equal(loaded.after.ax, 0xabcd);
    assert.equal(loaded.after.ip, 3);
    assert.equal(loaded.after.pc, 0xffff3);
    assert.deepEqual(reset.after, after);
  }
});

test("8088 stores can overwrite future instructions and saved records remain detached across edits and reset", () => {
  const ram = new ObservedRam(0x100000);
  [0xa3, 3, 1, 0, 0, 0xa5].forEach((byte, offset) => ram.write(0x12440 + offset, byte));
  const state = initialState({ ax: 0xb8, ds: 0x1234 });
  const cpu = new Cpu8088(ram, state);
  const store = cpu.step();
  const savedStore = structuredClone(store);
  assert.deepEqual(store.accesses.slice(3), [{ kind: "write", address: 0x12443, value: 0xb8 },
    { kind: "write", address: 0x12444, value: 0 }]);
  ram.write(0x12444, 0x5a);
  const load = cpu.step();
  assert.deepEqual(load.instruction, { address: 0x12443, bytes: [0xb8, 0x5a, 0xa5] });
  assert.equal(load.after.ax, 0xa55a);
  assert.equal(load.after.ah, 0xa5);
  assert.equal(load.after.al, 0x5a);
  cpu.reset();
  assert.deepEqual(store, savedStore);
  Reflect.set(store.after.flags, "cf", false);
  Reflect.set(load.after, "ah", 0);
  assert.equal(load.before.flags.cf, true);
  assert.equal(cpu.snapshot().ah, 0xa5);
});

const wordStacks = [
  [0x50, 0x58, "ax"], [0x51, 0x59, "cx"], [0x52, 0x5a, "dx"], [0x53, 0x5b, "bx"],
  [0x54, 0x5c, "sp"], [0x55, 0x5d, "bp"], [0x56, 0x5e, "si"], [0x57, 0x5f, "di"],
] as const;

function comparison(before: Cpu8088State, operand: number, width: 8 | 16): Cpu8088State {
  const modulus = 2 ** width;
  const sign = modulus / 2;
  const left = before.ax % modulus;
  const difference = left - operand;
  const result = (difference + modulus) % modulus;
  const signedDifference = (left < sign ? left : left - modulus) - (operand < sign ? operand : operand - modulus);
  return { ...before, ip: (before.ip + 1 + width / 8) % 65536, flags: { ...before.flags,
    cf: difference < 0, af: left % 16 < operand % 16, zf: result === 0, sf: result >= sign,
    of: signedDifference < -sign || signedDifference >= sign,
    pf: (result % 256).toString(2).replaceAll("0", "").length % 2 === 0 } };
}

test("8088 CMP AL covers every byte pair, preserves AX, ignores incoming carry, and computes subtraction flags", () => {
  const ram = new ObservedRam(0x100000);
  for (let left = 0; left < 256; left++) {
    for (let right = 0; right < 256; right++) {
      for (const bits of [0, 511]) {
        const before = initialState({ ax: 0xa500 + left, flags: flags(bits) });
        checkStep(ram, before, [0x3c, right], comparison(before, right, 8));
      }
    }
  }
});

test("8088 CMP AX covers every word against signed and unsigned boundaries with low-byte parity", () => {
  const ram = new ObservedRam(0x100000);
  for (let ax = 0; ax < 65536; ax++) {
    for (const right of [0, 1, 0x7fff, 0x8000, 0xffff]) {
      const before = initialState({ ax, flags: flags(ax % 512) });
      checkStep(ram, before, [0x3d, right % 256, Math.floor(right / 256)], comparison(before, right, 16));
    }
  }
});

test("8088 CMP preserves TF/IF/DF for every flag combination and wraps both operand widths through CS:IP", () => {
  const ram = new ObservedRam(0x100000);
  for (const [cs, ip, addresses] of [
    [0x1234, 0xffff, [0x2233f, 0x12340, 0x12341]],
    [0xffff, 0x000f, [0xfffff, 0, 1]], [0xffff, 0xffff, [0xffef, 0xffff0, 0xffff1]],
  ] as const) {
    for (let bits = 0; bits < 512; bits++) {
      for (const [ax, value] of [[0x8000, 1], [0x7fff, 0xffff], [0x0100, 0], [0xab00, 1], [0xffff, 0xffff]] as const) {
        const before = initialState({ cs, ip, ax, flags: flags(bits) });
        checkStep(ram, before, [0x3c, value % 256], comparison(before, value % 256, 8), addresses);
        checkStep(ram, before, [0x3d, value % 256, Math.floor(value / 256)], comparison(before, value, 16), addresses);
      }
    }
  }
});

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

// Literal truth sets for O S Z P C (bits 4..0), independent of the paired opcode builder.
const conditionalJumps = [
  [0x70, "JO", [16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31]],
  [0x71, "JNO", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]],
  [0x72, "JB", [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31]],
  [0x73, "JAE", [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30]],
  [0x74, "JE", [4, 5, 6, 7, 12, 13, 14, 15, 20, 21, 22, 23, 28, 29, 30, 31]],
  [0x75, "JNE", [0, 1, 2, 3, 8, 9, 10, 11, 16, 17, 18, 19, 24, 25, 26, 27]],
  [0x76, "JBE", [1, 3, 4, 5, 6, 7, 9, 11, 12, 13, 14, 15, 17, 19, 20, 21, 22, 23, 25, 27, 28, 29, 30, 31]],
  [0x77, "JA", [0, 2, 8, 10, 16, 18, 24, 26]],
  [0x78, "JS", [8, 9, 10, 11, 12, 13, 14, 15, 24, 25, 26, 27, 28, 29, 30, 31]],
  [0x79, "JNS", [0, 1, 2, 3, 4, 5, 6, 7, 16, 17, 18, 19, 20, 21, 22, 23]],
  [0x7a, "JP", [2, 3, 6, 7, 10, 11, 14, 15, 18, 19, 22, 23, 26, 27, 30, 31]],
  [0x7b, "JNP", [0, 1, 4, 5, 8, 9, 12, 13, 16, 17, 20, 21, 24, 25, 28, 29]],
  [0x7c, "JL", [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]],
  [0x7d, "JGE", [0, 1, 2, 3, 4, 5, 6, 7, 24, 25, 26, 27, 28, 29, 30, 31]],
  [0x7e, "JLE", [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 28, 29, 30, 31]],
  [0x7f, "JG", [0, 1, 2, 3, 24, 25, 26, 27]],
] as const satisfies readonly (readonly [number, string, readonly number[]])[];

function conditionCode(f: Cpu8088Flags): number {
  return Number(f.of) * 16 + Number(f.sf) * 8 + Number(f.zf) * 4 + Number(f.pf) * 2 + Number(f.cf);
}

for (const [opcode, mnemonic, codes] of conditionalJumps) {
  const takenCodes: readonly number[] = codes;
  test(`8088 ${mnemonic} follows its independent truth table for all flags and preserves CS across boundaries`, () => {
    const ram = new ObservedRam(0x100000);
    for (const [cs, ip, displacement, fallthrough, target, addresses] of [
      [0x1234, 0xffff, 0x80, 1, 0xff81, [0x2233f, 0x12340]],
      [0x1234, 0xfffd, 1, 0xffff, 0, [0x2233d, 0x2233e]],
      [0x1234, 0, 0xff, 2, 1, [0x12340, 0x12341]],
      [0xffff, 0x000f, 0x7f, 0x11, 0x90, [0xfffff, 0]],
      [0xffff, 0xffff, 0xfe, 1, 0xffff, [0xffef, 0xffff0]],
    ] as const) {
      for (let bits = 0; bits < 512; bits++) {
        const before = initialState({ cs, ip, flags: flags(bits) });
        const taken = takenCodes.includes(conditionCode(before.flags));
        checkStep(ram, before, [opcode, displacement], { ...before, ip: taken ? target : fallthrough }, addresses);
      }
    }
  });
  test(`8088 ${mnemonic} reads every displacement on both paths and interprets taken offsets as signed bytes`, () => {
    const ram = new ObservedRam(0x100000);
    for (const take of [false, true]) {
      const bits = Array.from({ length: 512 }, (_, bits) => bits)
        .find(bits => takenCodes.includes(conditionCode(flags(bits))) === take)!;
      const before = initialState({ flags: flags(bits) });
      for (let byte = 0; byte < 256; byte++) {
        const offset = new DataView(Uint8Array.of(byte).buffer).getInt8(0);
        checkStep(ram, before, [opcode, byte], { ...before, ip: take ? (0x102 + offset) % 65536 : 0x102 });
      }
    }
  });
}

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

test("8088 short and near JMP wrap IP, preserve CS and flags, and never access their targets", () => {
  const ram = new ObservedRam(0x100000);
  for (const [bytes, cs, ip, target, addresses] of [
    [[0xeb, 0x80], 0x1234, 0, 0xff82, [0x12340, 0x12341]],
    [[0xeb, 0x7f], 0x1234, 0xfffe, 0x7f, [0x2233e, 0x2233f]],
    [[0xeb, 0xfe], 0xffff, 0xf, 0xf, [0xfffff, 0]],
    [[0xe9, 0, 0], 0x1234, 0xffff, 2, [0x2233f, 0x12340, 0x12341]],
    [[0xe9, 0xff, 0x7f], 0x1234, 0xfffe, 0x8000, [0x2233e, 0x2233f, 0x12340]],
    [[0xe9, 0, 0x80], 0xffff, 0xe, 0x8011, [0xffffe, 0xfffff, 0]],
    [[0xe9, 0xfd, 0xff], 0xffff, 0xffff, 0xffff, [0xffef, 0xffff0, 0xffff1]],
  ] as const) {
    for (let bits = 0; bits < 512; bits++) {
      const before = initialState({ cs, ip, flags: flags(bits) });
      checkStep(ram, before, bytes, { ...before, ip: target }, addresses);
    }
  }
});

// Rows are literal documented encodings, including each ModR/M operation selector.
const aluForms = [
  ["ADD", 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0],
  ["OR",  0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 1],
  ["ADC", 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 2],
  ["SBB", 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 3],
  ["AND", 0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 4],
  ["SUB", 0x28, 0x29, 0x2a, 0x2b, 0x2c, 0x2d, 5],
  ["XOR", 0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 6],
  ["CMP", 0x38, 0x39, 0x3a, 0x3b, 0x3c, 0x3d, 7],
] as const;
type AluName = typeof aluForms[number][0] | "TEST";

function aluResult(name: AluName, width: 8 | 16, left: number, right: number, old: Cpu8088Flags) {
  const modulus = 2 ** width;
  const sign = modulus / 2;
  const signed = (value: number) => value < sign ? value : value - modulus;
  const subtract = name === "SUB" || name === "SBB" || name === "CMP";
  const arithmetic = subtract || name === "ADD" || name === "ADC";
  const carry = (name === "ADC" || name === "SBB") && old.cf ? 1 : 0;
  const total = subtract ? left - right - carry : left + right + carry;
  // Logic expectations are constructed one bit at a time, independently of bitwise operators.
  let logical = 0;
  for (let bit = 0; bit < width; bit++) {
    const l = Math.floor(left / 2 ** bit) % 2;
    const r = Math.floor(right / 2 ** bit) % 2;
    if (name === "OR" ? l + r > 0 : name === "XOR" ? l !== r : l * r === 1) logical += 2 ** bit;
  }
  const result = arithmetic ? (total % modulus + modulus) % modulus : logical;
  const signedTotal = subtract ? signed(left) - signed(right) - carry : signed(left) + signed(right) + carry;
  return { result, flags: { ...old,
    cf: arithmetic && (total < 0 || total >= modulus),
    af: arithmetic && (subtract ? left % 16 < right % 16 + carry : left % 16 + right % 16 + carry >= 16),
    of: arithmetic && (signedTotal < -sign || signedTotal >= sign),
    pf: (result % 256).toString(2).replaceAll("0", "").length % 2 === 0,
    zf: result === 0, sf: result >= sign } };
}

function registerValue(state: Cpu8088State, width: 8 | 16, selector: number): number {
  if (width === 16) return state[wordMoves[selector]![1]];
  const [, word, half] = byteMoves[selector]!;
  return half === "low" ? state[word] % 256 : Math.floor(state[word] / 256);
}

function replaceRegister(state: Cpu8088State, width: 8 | 16, selector: number, value: number): Cpu8088State {
  if (width === 16) return { ...state, [wordMoves[selector]![1]]: value };
  const [, word, half] = byteMoves[selector]!;
  return { ...state, [word]: half === "low" ? Math.floor(state[word] / 256) * 256 + value : value * 256 + state[word] % 256 };
}

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

// Literal base offsets for BX=FFF0, BP=FFF8, SI=0020, DI=0030. No core decoder is used.
const memoryForms = [
  [0, 0x10, "ds"], [1, 0x20, "ds"], [2, 0x18, "ss"], [3, 0x28, "ss"],
  [4, 0x20, "ds"], [5, 0x30, "ds"], [6, 0xfff8, "ss"], [7, 0xfff0, "ds"],
] as const;
function addressedState(): Cpu8088State {
  return initialState({ bx: 0xfff0, bp: 0xfff8, si: 0x20, di: 0x30, ds: 0xffff, ss: 0x3456 });
}
function addressingCases() {
  return memoryForms.flatMap(([rm, base, segment]) => [
    { rm, mod: 0, displacement: rm === 6 ? [0xff, 0xff] : [], offset: rm === 6 ? 0xffff : base, segment: rm === 6 ? "ds" as const : segment },
    ...[0, 1, 0x7f, 0x80, 0xff].map(byte => ({ rm, mod: 1, displacement: [byte],
      offset: (base + (byte < 128 ? byte : byte - 256) + 65536) % 65536, segment })),
    ...[0, 1, 0x7fff, 0x8000, 0xffff].map(word => ({ rm, mod: 2, displacement: [word % 256, Math.floor(word / 256)],
      offset: (base + word) % 65536, segment })),
  ]);
}
function memoryBytes(before: Cpu8088State, segment: "ds" | "ss", offset: number, width: 8 | 16, value: number): [number, number][] {
  return Array.from({ length: width / 8 }, (_, i) => [(before[segment] * 16 + (offset + i) % 65536) % 1048576,
    Math.floor(value / 256 ** i) % 256]);
}

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

const unaryForms = [
  ["INC", 0xfe, 0xff, 0], ["DEC", 0xfe, 0xff, 1],
  ["NOT", 0xf6, 0xf7, 2], ["NEG", 0xf6, 0xf7, 3],
] as const;
type UnaryName = typeof unaryForms[number][0];

function unaryResult(name: UnaryName, width: 8 | 16, value: number, old: Cpu8088Flags) {
  if (name === "NOT") return { result: 2 ** width - 1 - value, flags: old };
  const expected = name === "NEG" ? aluResult("SUB", width, 0, value, old)
    : aluResult(name === "INC" ? "ADD" : "SUB", width, value, 1, old);
  if (name !== "NEG") expected.flags.cf = old.cf;
  return expected;
}

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

const shiftForms = [["ROL", 0], ["ROR", 1], ["RCL", 2], ["RCR", 3], ["SHL", 4], ["SHR", 5], ["SAR", 7]] as const;
type ShiftName = typeof shiftForms[number][0];

// Rotate a string ring, or take a slice of a zero/sign-extended string. No CPU helper or repeated single-bit arithmetic.
function shiftedResult(name: ShiftName, width: 8 | 16, value: number, count: number, old: Cpu8088Flags) {
  if (count === 0) return { result: value, flags: old };
  const bits = value.toString(2).padStart(width, "0");
  const rotate = name.startsWith("R");
  const left = name === "ROL" || name === "RCL" || name === "SHL";
  let output: string;
  let carry: boolean;
  if (rotate) {
    const throughCarry = name === "RCL" || name === "RCR";
    const ring = bits + (throughCarry ? Number(old.cf) : "");
    const offset = (left ? count : ring.length - count % ring.length) % ring.length;
    const rotated = ring.slice(offset) + ring.slice(0, offset);
    output = rotated.slice(0, width);
    carry = (throughCarry || left ? rotated.at(-1) : rotated[0]) === "1";
  } else {
    const fill = name === "SAR" ? bits[0]! : "0";
    output = left ? (bits + "0".repeat(count)).slice(count, count + width) : (fill.repeat(count) + bits).slice(0, width);
    carry = (count <= width ? bits[left ? count - 1 : width - count] : fill) === "1";
  }
  const result = parseInt(output, 2);
  return { result, flags: { ...old, cf: carry,
    of: count === 1 ? bits[0] !== output[0] : old.of,
    ...(rotate ? {} : { af: false, sf: output[0] === "1", zf: result === 0,
      pf: output.slice(-8).replaceAll("0", "").length % 2 === 0 }) } };
}

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

test("8088 new groups reject every unsupported selector before displacement/data accesses and can retry", () => {
  const ram = new ObservedRam(0x100000);
  for (const [opcode, supported] of [
    [0xc6, [0]], [0xc7, [0]], [0xd0, [0, 1, 2, 3, 4, 5, 7]], [0xd1, [0, 1, 2, 3, 4, 5, 7]],
    [0xd2, [0, 1, 2, 3, 4, 5, 7]], [0xd3, [0, 1, 2, 3, 4, 5, 7]],
    [0xf6, [0, 2, 3, 4, 5, 6, 7]], [0xf7, [0, 2, 3, 4, 5, 6, 7]], [0xfe, [0, 1]], [0xff, [0, 1, 2, 3, 4, 5, 6]], [0x8f, [0]],
  ] as const) for (let group = 0; group < 8; group++) {
    if ((supported as readonly number[]).includes(group)) continue;
    for (let mode = 0; mode < 4; mode++) for (let rm = 0; rm < 8; rm++) {
      const before = initialState({ cs: 0xffff, ip: 0xffff });
      const modRM = mode * 64 + group * 8 + rm;
      ram.write(0xffef, opcode); ram.write(0xffff0, modRM); ram.write(0xffff1, 0xa5);
      const cpu = new Cpu8088(ram, before);
      for (let repeat = 0; repeat < 2; repeat++) {
        ram.accesses.length = 0;
        const accesses = [{ kind: "read", address: 0xffef, value: opcode }, { kind: "read", address: 0xffff0, value: modRM }];
        assert.deepEqual(cpu.step(), { before: snapshot(before), after: snapshot(before),
          instruction: { address: 0xffef, bytes: [opcode, modRM] }, accesses, outcome: "unsupported", reason: "opcode" });
        assert.deepEqual(ram.accesses, accesses);
      }
      ram.write(0xffff0, 0xc0);
      assert.equal(cpu.step().outcome, "executed");
    }
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

// Completion tranche: literal encodings and arithmetic/program oracles, independent of decoder construction.
const segments = [[0x26, "es"], [0x2e, "cs"], [0x36, "ss"], [0x3e, "ds"]] as const;
const words = ["ax", "cx", "dx", "bx", "sp", "bp", "si", "di"] as const;
function address(segment: number, offset: number): number { return (segment * 16 + offset % 65536) % 1048576; }
function put(ram: Ram, segment: number, offset: number, bytes: readonly number[]): void {
  bytes.forEach((value, i) => ram.write(address(segment, offset + i), value));
}
function wordBytes(value: number): number[] { return [value % 256, Math.floor(value / 256)]; }
function dataReads(segment: number, offset: number, bytes: readonly number[]): Cpu8088MemoryAccess[] {
  return bytes.map((value, i) => ({ kind: "read", address: address(segment, offset + i), value }));
}
function dataWrites(segment: number, offset: number, bytes: readonly number[]): Cpu8088MemoryAccess[] {
  return bytes.map((value, i) => ({ kind: "write", address: address(segment, offset + i), value }));
}
function resultFlags(value: number, width: 8 | 16): Pick<Cpu8088Flags, "pf" | "sf" | "zf"> {
  return { pf: (value % 256).toString(2).replaceAll("0", "").length % 2 === 0, sf: value >= 2 ** (width - 1), zf: value === 0 };
}
function reject(ram: ObservedRam, before: Cpu8088State, bytes: readonly number[], reason: "opcode" | "divide-error" = "opcode",
  data: readonly Cpu8088MemoryAccess[] = []): void {
  put(ram, before.cs, before.ip, bytes);
  const cpu = new Cpu8088(ram, before);
  for (let attempt = 0; attempt < 2; attempt++) {
    ram.accesses.length = 0;
    const accesses = [...dataReads(before.cs, before.ip, bytes), ...data];
    assert.deepEqual(cpu.step(), { before: snapshot(before), after: snapshot(before), outcome: "unsupported", reason,
      instruction: { address: snapshot(before).pc, bytes }, accesses });
    assert.deepEqual(ram.accesses, accesses);
  }
}

test("8088 completion halt is stored, validated, detached, resumable, and cleared by reset", () => {
  const ram = new ObservedRam(0x100000), before = initialState({ ip: 0xffff });
  put(ram, before.cs, before.ip, [0xf4]);
  const cpu = new Cpu8088(ram, before);
  const after = snapshot({ ...before, ip: 0, halted: true });
  ram.accesses.length = 0;
  assert.deepEqual(runCpu(cpu, { maxSteps: 10 }), { stopReason: "halted", records: [{
    before: snapshot(before), after, outcome: "halted", instruction: { address: snapshot(before).pc, bytes: [0xf4] },
    accesses: dataReads(before.cs, before.ip, [0xf4]),
  }] });
  for (const stopped of [cpu, new Cpu8088(ram, after)]) {
    ram.accesses.length = 0;
    assert.deepEqual(stopped.step(), { before: after, after, instruction: null, outcome: "halted", accesses: [] });
    assert.deepEqual(ram.accesses, []);
    assert.equal(stopped.reset().after.halted, false);
  }
  for (const value of [0, 1, undefined, "false", null]) {
    const state = initialState(); Reflect.set(state, "halted", value);
    assert.throws(() => new Cpu8088(ram, state), TypeError);
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
  reject(ram, before, [0x26, 0xf0, 0xcd]); // No immediate or interrupt-vector read.
  reject(ram, before, [0xf3, 0x90]);
  reject(ram, before, [0xf2, 0xa4]);
  reject(ram, before, [0xf3, 0xf7]); // Undocumented REP arithmetic is excluded before ModR/M.
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
    if (segment !== "cs") checkStep(ram, before, [0x8e, modRM], { ...before, [segment]: before[words[reg]!], ip: 0x102 });
  }
  for (let selector = 0; selector < 4; selector++) for (const form of addressingCases()) {
    const before = addressedState(), segment = segments[selector]![1];
    const suffix = [form.mod * 64 + selector * 8 + form.rm, ...form.displacement];
    checkStep(ram, before, [0x8c, ...suffix], { ...before, ip: before.ip + 1 + suffix.length }, undefined,
      dataWrites(before[form.segment], form.offset, wordBytes(before[segment])));
    if (segment === "cs") continue;
    put(ram, before[form.segment], form.offset, [0x34, 0x12]);
    checkStep(ram, before, [0x8e, ...suffix], { ...before, [segment]: 0x1234, ip: before.ip + 1 + suffix.length }, undefined,
      dataReads(before[form.segment], form.offset, [0x34, 0x12]));
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
      checkStep(ram, before, [0x26, pop], { ...before, [segment]: 0x5678, sp: (sp + 2) % 65536, ip: 0x102 }, undefined,
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

test("8088 completion LOOP conditions use post-decrement CX, JCXZ preserves it, and all flags survive", () => {
  const ram = new ObservedRam(0x100000);
  for (const opcode of [0xe0, 0xe1, 0xe2, 0xe3]) for (const cx of [0, 1, 2, 0x8000, 0xffff]) {
    for (let bits = 0; bits < 512; bits++) for (const displacement of [0, 0x7f, 0x80, 0xff]) {
      const before = initialState({ cx, ip: 0xffff, flags: flags(bits) });
      const count = opcode === 0xe3 ? cx : (cx + 65535) % 65536;
      const take = opcode === 0xe3 ? count === 0 : count !== 0 && (opcode === 0xe2 || before.flags.zf === (opcode === 0xe1));
      checkStep(ram, before, [opcode, displacement], { ...before, cx: count,
        ip: take ? (1 + (displacement < 128 ? displacement : displacement - 256) + 65536) % 65536 : 1 });
    }
  }
});

test("8088 completion flag transfers define reserved bits and preserve unselected flags", () => {
  const ram = new ObservedRam(0x100000);
  const positions = { cf: 0, pf: 2, af: 4, zf: 6, sf: 7, tf: 8, if: 9, df: 10, of: 11 } as const;
  for (let bits = 0; bits < 512; bits++) {
    const before = initialState({ flags: flags(bits), ss: 0xffff, sp: 1 });
    const packed = 0xf002 + Object.entries(positions).reduce((n, [flag, bit]) => n + (before.flags[flag as keyof Cpu8088Flags] ? 2 ** bit : 0), 0);
    checkStep(ram, before, [0x9c], { ...before, sp: 0xffff, ip: 0x101 }, undefined, dataWrites(before.ss, 0xffff, wordBytes(packed)));
    checkStep(ram, before, [0x9f], { ...before, ax: (packed % 256) * 256 + 0x22, ip: 0x101 });
    for (const [opcode, flag, value] of [[0xf5, "cf", !before.flags.cf], [0xf8, "cf", false], [0xf9, "cf", true],
      [0xfc, "df", false], [0xfd, "df", true]] as const) {
      checkStep(ram, before, [opcode], { ...before, ip: 0x101, flags: { ...before.flags, [flag]: value } });
    }
  }
  for (let packed = 0; packed < 65536; packed++) {
    const before = initialState();
    const decoded = Object.fromEntries(Object.entries(positions).map(([flag, bit]) => [flag, Math.floor(packed / 2 ** bit) % 2 === 1])) as Cpu8088Flags;
    put(ram, before.ss, before.sp, wordBytes(packed));
    checkStep(ram, before, [0x9d], { ...before, flags: decoded, sp: before.sp + 2, ip: 0x101 }, undefined,
      dataReads(before.ss, before.sp, wordBytes(packed)));
  }
  for (let ah = 0; ah < 256; ah++) for (const bits of [0, 511]) {
    const before = initialState({ ax: ah * 256 + 0x55, flags: flags(bits) });
    const selected = { cf: ah % 2 === 1, pf: Math.floor(ah / 4) % 2 === 1, af: Math.floor(ah / 16) % 2 === 1,
      zf: Math.floor(ah / 64) % 2 === 1, sf: ah >= 128 };
    checkStep(ram, before, [0x9e], { ...before, ip: 0x101, flags: { ...before.flags, ...selected } });
  }
});

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
      if (divisor === 0n || quotient >= limit || signed && quotient <= -limit) reject(ram, before, bytes, "divide-error");
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
          reject(ram, before, bytes, "divide-error");
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

test("8088 completion multiply/divide memory forms cover all modes, overrides, and atomic error reads", () => {
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
      reject(ram, before, bytes, "divide-error", dataReads(before.es, form.offset, zero));
    }
  }
});

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

test("8088 completion XLAT wraps BX+AL, honors each segment override, and reads exactly one byte", () => {
  const ram = new ObservedRam(0x100000);
  for (const [prefix, segment] of segments) for (let al = 0; al < 256; al++) {
    const before = initialState({ ax: 0xa500 + al, bx: 0xff80 }), offset = (before.bx + al) % 65536;
    put(ram, before[segment], offset, [255 - al]);
    checkStep(ram, before, [prefix, 0xd7], { ...before, ax: 0xa500 + 255 - al, ip: 0x102 }, undefined,
      dataReads(before[segment], offset, [255 - al]));
  }
});

const strings = [
  [0xa4, "move", 8], [0xa5, "move", 16], [0xa6, "compare", 8], [0xa7, "compare", 16],
  [0xaa, "store", 8], [0xab, "store", 16], [0xac, "load", 8], [0xad, "load", 16],
  [0xae, "scan", 8], [0xaf, "scan", 16],
] as const;

test("8088 completion all strings use fixed ES destinations, source overrides, and DF-controlled wrapping", () => {
  const ram = new ObservedRam(0x100000);
  for (const [opcode, operation, width] of strings) for (const df of [false, true]) {
    for (const offset of [0, 0xf, 0xffff]) for (const override of [false, true]) {
      const before = initialState({ ds: 0xffff, ss: 0x5555, es: 0x6789, si: offset, di: offset,
        flags: { ...flags(511), df }, ax: 0x0100 });
      const sourceSegment = override ? before.ss : before.ds, source = width === 8 ? [0xff] : [0xff, 0x7f];
      const destination = width === 8 ? [1] : [1, 0x80], accumulator = width === 8 ? [0] : [0, 1];
      put(ram, sourceSegment, offset, source); put(ram, before.es, offset, destination);
      const bytes = [...(override ? [0x36] : []), opcode];
      const readsSource = ["move", "compare", "load"].includes(operation), readsDestination = ["compare", "scan"].includes(operation);
      const writesDestination = ["move", "store"].includes(operation);
      const left = operation === "scan" ? width === 8 ? 0 : 0x100 : width === 8 ? 0xff : 0x7fff;
      const right = width === 8 ? 1 : 0x8001;
      const next = (offset + (df ? -1 : 1) * width / 8 + 65536) % 65536;
      checkStep(ram, before, bytes, { ...before, ip: before.ip + bytes.length,
        ax: operation === "load" ? width === 8 ? 0x01ff : 0x7fff : before.ax,
        si: readsSource ? next : offset, di: operation === "load" ? offset : next,
        flags: readsDestination ? aluResult("SUB", width, left, right, before.flags).flags : before.flags }, undefined,
      [...(readsSource ? dataReads(sourceSegment, offset, source) : []), ...(readsDestination ? dataReads(before.es, offset, destination) : []),
        ...(writesDestination ? dataWrites(before.es, offset, operation === "move" ? source : accumulator) : [])]);
    }
  }
});

test("8088 completion REP executes one element per step and restores solely from visible state", () => {
  const ram = new ObservedRam(0x100000), before = initialState({ cx: 3, si: 0xfffe, di: 0xffff,
    flags: { ...flags(511), df: false }, ds: 0x2000, es: 0xffff });
  const bytes = [0x3e, 0xf3, 0xa5]; put(ram, before.cs, before.ip, bytes);
  put(ram, before.ds, before.si, [1, 2, 3, 4, 5, 6]);
  const cpu = new Cpu8088(ram, before);
  const first = runCpu(cpu, { maxSteps: 1 }), retained = structuredClone(first);
  assert.equal(first.stopReason, "step-limit");
  assert.deepEqual(first.records[0]?.after, snapshot({ ...before, cx: 2, si: 0, di: 1 }));
  const resumed = new Cpu8088(ram, cpu.snapshot());
  put(ram, before.ds, 0, [0x33, 0x44]); // Each element reads current RAM.
  const rest = runCpu(resumed, { maxSteps: 2, endAddress: address(before.cs, before.ip + 3) });
  assert.equal(rest.stopReason, "completed");
  assert.deepEqual(rest.records.map(record => [record.after.cx, record.after.si, record.after.di, record.after.ip]),
    [[1, 2, 3, before.ip], [0, 4, 5, before.ip + 3]]);
  assert.deepEqual([...first.records, ...rest.records].map(record => record.instruction?.bytes), [bytes, bytes, bytes]);
  assert.deepEqual(Array.from({ length: 6 }, (_, i) => ram.read(address(before.es, 0xffff + i))), [1, 2, 0x33, 0x44, 5, 6]);
  assert.deepEqual(first, retained);
  // Refetching is explicit: replace the pending REP with HLT and no hidden iteration continues.
  put(ram, before.cs, before.ip, [0xf4]);
  assert.equal(cpu.step().outcome, "halted"); assert.equal(cpu.snapshot().cx, 2);
});

test("8088 completion repeated strings handle empty counts, termination flags, and prefix precedence", () => {
  const ram = new ObservedRam(0x100000);
  for (const [opcode, operation, width] of strings) for (const rep of [0xf2, 0xf3]) {
    const compares = operation === "compare" || operation === "scan";
    if (rep === 0xf2 && !compares) continue;
    for (const cx of [0, 1, 2, 0xffff]) for (const equal of [false, true]) for (const incomingZF of [false, true]) {
      const before = initialState({ cx, ax: 7, flags: { ...flags(511), zf: incomingZF, df: false } });
      const source = width === 8 ? [7] : [7, 0], destination = width === 8 ? [equal ? 7 : 6] : [equal ? 7 : 6, 0];
      put(ram, before.ds, before.si, source); put(ram, before.es, before.di, destination);
      // The final repeat prefix wins; repeat testing uses the new ZF, irrespective of incoming ZF.
      const bytes = [rep === 0xf2 ? 0xf3 : 0xf2, rep, opcode];
      put(ram, before.cs, before.ip, bytes); ram.accesses.length = 0;
      const record = new Cpu8088(ram, before).step(), actual = record.after;
      assert.equal(record.outcome, "executed");
      assert.equal(actual.cx, cx === 0 ? 0 : cx - 1);
      const again = cx > 1 && (!compares || equal === (rep === 0xf3));
      assert.equal(actual.ip, again ? before.ip : before.ip + bytes.length);
      if (cx === 0) {
        assert.deepEqual(actual, snapshot({ ...before, ip: before.ip + bytes.length }));
        assert.deepEqual(record.accesses, dataReads(before.cs, before.ip, bytes));
      } else {
        assert.equal(actual.flags.zf, compares ? equal : incomingZF);
        assert.equal(actual.si, before.si + (["move", "compare", "load"].includes(operation) ? width / 8 : 0));
        assert.equal(actual.di, before.di + (operation === "load" ? 0 : width / 8));
      }
    }
  }
});

test("8088 completion memory-only and segment selectors reject all invalid ModR/M forms atomically", () => {
  const ram = new ObservedRam(0x100000), before = initialState({ ip: 0xffff, cs: 0xffff });
  for (let modRM = 0; modRM < 256; modRM++) {
    const selector = Math.floor(modRM / 8) % 8;
    for (const opcode of [0x8c, 0x8e]) {
      if (selector > 3 || opcode === 0x8e && selector === 1) reject(ram, before, [0x26, opcode, modRM]);
    }
    if (modRM < 0xc0) continue;
    for (const opcode of [0x8d, 0xc4, 0xc5]) reject(ram, before, [0x26, opcode, modRM]);
    if (selector === 3 || selector === 5) reject(ram, before, [0x26, 0xff, modRM]);
  }
});

test("8088 completion accounts for all 291 documented forms: 268 implemented and 23 deferred", () => {
  const ram = new Ram(0x100000);
  const unused = [0x0f, ...Array.from({ length: 16 }, (_, i) => 0x60 + i), 0xc0, 0xc1, 0xc8, 0xc9, 0xd6, 0xf1];
  const prefixes = [0x26, 0x2e, 0x36, 0x3e, 0xf0, 0xf2, 0xf3];
  const deferred = [0x9b, 0xcc, 0xcd, 0xce, 0xcf, 0xd8, 0xd9, 0xda, 0xdb, 0xdc, 0xdd, 0xde, 0xdf,
    0xe4, 0xe5, 0xe6, 0xe7, 0xec, 0xed, 0xee, 0xef, 0xfa, 0xfb];
  // Table 4-13 expands these operation selectors; all other ModR/M fields are operands.
  const groups: Readonly<Record<number, readonly number[]>> = {
    0x80: [0, 1, 2, 3, 4, 5, 6, 7], 0x81: [0, 1, 2, 3, 4, 5, 6, 7],
    0x82: [0, 2, 3, 5, 7], 0x83: [0, 2, 3, 5, 7],
    0xd0: [0, 1, 2, 3, 4, 5, 7], 0xd1: [0, 1, 2, 3, 4, 5, 7],
    0xd2: [0, 1, 2, 3, 4, 5, 7], 0xd3: [0, 1, 2, 3, 4, 5, 7],
    0xf6: [0, 2, 3, 4, 5, 6, 7], 0xf7: [0, 2, 3, 4, 5, 6, 7], 0xfe: [0, 1], 0xff: [0, 1, 2, 3, 4, 5, 6],
  };
  let documented = 0, complete = 0;
  for (let opcode = 0; opcode < 256; opcode++) {
    if (unused.includes(opcode) || prefixes.includes(opcode)) continue;
    for (const group of groups[opcode] ?? [0]) {
      documented++;
      const before = initialState({ ax: 12, dx: 0, cx: 1 });
      put(ram, before.ds, 0, [3, 0, 0x34, 0x12]);
      const bytes = [opcode, opcode === 0xd4 || opcode === 0xd5 ? 10 : group * 8 + 6, 0, 0, 0, 0];
      put(ram, before.cs, before.ip, bytes);
      const record = new Cpu8088(ram, before).step();
      const accepted = record.outcome !== "unsupported";
      assert.equal(accepted, !deferred.includes(opcode), `Opcode ${opcode.toString(16)} /${group}`);
      if (accepted) complete++;
    }
  }
  assert.equal(documented, 291); assert.equal(complete, 268); assert.equal(deferred.length, 23);
});
