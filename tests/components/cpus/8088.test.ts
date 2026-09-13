import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu8088 } from "../../../src/components/cpus/8088.js";
import type { Cpu8088Flags, Cpu8088State, Cpu8088Snapshot, Cpu8088MemoryAccess } from "../../../src/components/cpus/8088.js";
import { Ram } from "../../../src/components/memory/ram.js";
import { ObservedRam } from "../../helpers/observed-ram.js";

function initialState(overrides: Partial<Cpu8088State> = {}): Cpu8088State {
  return { ax: 0x1122, bx: 0x3344, cx: 0x5566, dx: 0x7788, sp: 0x8000, bp: 0x9000, si: 0x10, di: 0x20,
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
function addition(before: Cpu8088State, operand: number): Cpu8088State {
  const total = before.ax + operand;
  const result = total % 65536;
  const signedTotal = (before.ax < 32768 ? before.ax : before.ax - 65536)
    + (operand < 32768 ? operand : operand - 65536);
  const ones = (result % 256).toString(2).replaceAll("0", "").length;
  return { ...before, ax: result, ip: (before.ip + 3) % 65536, flags: { ...before.flags,
    cf: total >= 65536, pf: ones % 2 === 0, af: before.ax % 16 + operand % 16 >= 16,
    zf: result === 0, sf: result >= 32768, of: signedTotal < -32768 || signedTotal > 32767 } };
}

function checkStep(ram: ObservedRam, before: Cpu8088State, bytes: readonly number[], after: Cpu8088State,
  addresses: readonly number[] = [0x12440, 0x12441, 0x12442], writes: readonly Cpu8088MemoryAccess[] = []): void {
  bytes.forEach((byte, index) => ram.write(addresses[index]!, byte));
  ram.accesses.length = 0;
  const cpu = new Cpu8088(ram, before);
  const accesses = [...bytes.map((value, index) => ({ kind: "read", address: addresses[index]!, value })), ...writes];
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
  assert.equal(calls.size, 23);
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

test("8088 all three forms preserve control flags for every incoming flag pattern, and MOV preserves all flags", () => {
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

test("8088 word stores cover every DS offset, including odd words, without destination reads", () => {
  const ram = new ObservedRam(0x100000);
  for (let offset = 0; offset < 65536; offset++) {
    const before = initialState({ ax: 0xa55a });
    checkStep(ram, before, [0xa3, offset % 256, Math.floor(offset / 256)], { ...before, ip: 0x103 }, undefined,
      [{ kind: "write", address: 0x20000 + offset, value: 0x5a }, { kind: "write", address: 0x20001 + offset, value: 0xa5 }]);
  }
});

test("8088 data words cross the segment end physically, wrap at one MiB, and record unchanged-value writes", () => {
  const ram = new ObservedRam(0x100000);
  for (const [ds, offset, low, high] of [
    [0x1234, 0xffff, 0x2233f, 0x22340], [0xffff, 0xf, 0xfffff, 0],
    [0xffff, 0x10, 0, 1], [0xffff, 0xffff, 0xffef, 0xfff0],
  ] as const) {
    const before = initialState({ ds, ax: 0xa55a });
    for (let repeat = 0; repeat < 2; repeat++) {
      checkStep(ram, before, [0xa3, offset % 256, Math.floor(offset / 256)], { ...before, ip: 0x103 }, undefined,
        [{ kind: "write", address: low, value: 0x5a }, { kind: "write", address: high, value: 0xa5 }]);
      assert.equal(ram.read(low), 0x5a);
      assert.equal(ram.read(high), 0xa5);
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

test("8088 rejects every other opcode and prefix with one fetch and no state change", () => {
  const ram = new ObservedRam(0x100000);
  for (const [cs, ip, address] of [[0x1234, 0x100, 0x12440], [0xffff, 0xf, 0xfffff], [0xffff, 0x10, 0]] as const) {
    for (let opcode = 0; opcode < 256; opcode++) {
      if ([5, 0xa3, 0xb8].includes(opcode)) continue;
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
