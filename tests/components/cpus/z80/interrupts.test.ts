import assert from "node:assert/strict";
import { test } from "node:test";
import { CpuZ80 } from "../../../../src/components/cpus/z80.js";
import { Ram } from "../../../../src/components/memory/ram.js";
import { ObservedRam } from "../../../helpers/observed-ram.js";
import { initialState, snapshot, flagPattern, cbRows, indexOpcodes, edOpcodes, indexes, readAccess, writeAccess, IoRam } from "./helpers.js";

for (const opcode of [0xf3, 0xfb]) {
  test(`Z80 interrupt ${opcode === 0xf3 ? "DI" : "EI"} checks both IFFs, inhibition latches, every flag pattern, and every R value`, () => {
    const ram = new ObservedRam();
    ram.write(0xffff, opcode);
    for (let bits = 0; bits < 64; bits++) for (let r = 0; r < 256; r++) {
      const before = initialState({ pc: 0xffff, r, flags: flagPattern(bits), iff1: !!(bits & 1), iff2: !!(bits & 2),
        interruptDeferred: !!(bits & 4), nmiDeferred: !!(bits & 8) });
      const cpu = new CpuZ80(ram, before);
      const enabled = opcode === 0xfb;
      ram.accesses.length = 0;
      assert.deepEqual(cpu.step(), { before: snapshot(before), after: snapshot({ ...before, pc: 0,
        r: Math.floor(r / 128) * 128 + (r + 1) % 128, iff1: enabled, iff2: enabled,
        interruptDeferred: enabled, nmiDeferred: false }), instruction: { address: 0xffff, bytes: [opcode] },
        accesses: [readAccess(0xffff, opcode)], outcome: "executed" });
      assert.deepEqual(ram.accesses, [readAccess(0xffff, opcode)]);
    }
  });
}

test("Z80 interrupt modes use only documented selectors and preserve both IFFs and flags", () => {
  for (const [opcode, im] of [[0x46, 0], [0x56, 1], [0x5e, 2]] as const) for (const oldMode of [0, 1, 2] as const) {
    for (let bits = 0; bits < 64; bits++) {
      const before = initialState({ im: oldMode, iff1: !!(bits & 1), iff2: !!(bits & 2), flags: flagPattern(bits),
        interruptDeferred: true, nmiDeferred: true, pc: 0xffff });
      const ram = new ObservedRam();
      ram.write(0xffff, 0xed); ram.write(0, opcode);
      ram.accesses.length = 0;
      const record = new CpuZ80(ram, before).step();
      assert.deepEqual(record.after, snapshot({ ...before, pc: 1, r: 0x80, im, interruptDeferred: false, nmiDeferred: false }));
      assert.deepEqual(record.before, snapshot(before));
      assert.deepEqual(record.accesses, [readAccess(0xffff, 0xed), readAccess(0, opcode)]);
      assert.deepEqual(record.accesses, ram.accesses);
    }
  }
});

for (const opcode of [0x45, 0x4d]) {
  test(`Z80 interrupt ${opcode === 0x45 ? "RETN" : "RETI"} restores PC and IFF1 with stack wrapping and retirement notification`, () => {
    const ram = new ObservedRam();
    for (let bits = 0; bits < 64; bits++) for (const sp of [0, 1, 0xffff, 0x2000, 0x2001]) {
      for (const iff1 of [false, true]) for (const iff2 of [false, true]) {
        const state = initialState({ flags: flagPattern(bits), sp, iff1, iff2, interruptDeferred: true, nmiDeferred: true });
        ram.write(sp, 0x34); ram.write((sp + 1) % 65536, 0x12);
        ram.write(0x2000, 0xed); ram.write(0x2001, opcode);
        const low = ram.read(sp), high = ram.read((sp + 1) % 65536);
        const after = snapshot({ ...state, sp: (sp + 2) % 65536, pc: low + high * 256, r: 0x80,
          iff1: iff2, interruptDeferred: iff1 !== iff2, nmiDeferred: false });
        let notifications = 0;
        const cpu = new CpuZ80(ram, state, undefined, () => {
          notifications++;
          assert.deepEqual(cpu.snapshot(), after, "notification follows architectural retirement");
          assert.equal(ram.accesses.length, 4);
        });
        ram.accesses.length = 0;
        assert.deepEqual(cpu.step(), { before: snapshot(state), after, outcome: "executed",
          instruction: { address: 0x2000, bytes: [0xed, opcode] }, accesses: [readAccess(0x2000, 0xed), readAccess(0x2001, opcode),
            readAccess(sp, low), readAccess((sp + 1) % 65536, high)] });
        assert.equal(notifications, opcode === 0x4d ? 1 : 0);
      }
    }
  });
}

test("Z80 interrupt EI inhibition survives snapshots and rejection, renews on EI, and expires on ordinary or HALT retirement", () => {
  for (const following of [[0x00], [0x76], [0xed, 0xb0], [0xed, 0xb2], [0xed, 0x4d]]) {
    const ram = new Ram(65536);
    [0xfb, 0xfb, ...following].forEach((byte, i) => ram.write(0x2000 + i, byte));
    const cpu = new CpuZ80(ram, initialState({ b: 2, h: 0x40, l: 0, sp: 0x9000 }), { readPort: () => 0, writePort: () => {} });
    const never = (): number => assert.fail("a deferred IRQ must not acknowledge");
    cpu.step();
    assert.equal(cpu.interrupt("irq", never).outcome, "ignored");
    const resumed = new CpuZ80(ram, cpu.snapshot(), { readPort: () => 0, writePort: () => {} });
    assert.deepEqual(resumed.interrupt("irq", never), cpu.interrupt("irq", never));
    assert.equal(resumed.step().after.interruptDeferred, true, "consecutive EI renews inhibition");
    ram.write(0x2002, 0xed); ram.write(0x2003, 0x00);
    const beforeRejected = resumed.snapshot();
    assert.equal(resumed.step().outcome, "unsupported");
    assert.deepEqual(resumed.snapshot(), beforeRejected);
    assert.equal(resumed.interrupt("irq", never).outcome, "ignored");
    following.forEach((byte, i) => ram.write(0x2002 + i, byte));
    const retired = resumed.step();
    assert.equal(retired.after.interruptDeferred, false);
    assert.equal(resumed.interrupt("irq", () => 0).outcome, "accepted");
  }
  const ram = new Ram(65536);
  ram.write(0x2000, 0xfb); ram.write(0x2001, 0xf3);
  const cpu = new CpuZ80(ram, initialState());
  cpu.step(); cpu.step();
  const ignored = cpu.interrupt("irq", () => assert.fail("DI disables acknowledgement"));
  assert.equal(ignored.outcome, "ignored");
  if (ignored.outcome === "ignored") assert.equal(ignored.reason, "disabled");
  assert.equal(ignored.after.interruptDeferred, false);
});

test("Z80 interrupt ignored requests are detached, silent, and do not release HALT or consume inhibition", () => {
  for (const iff1 of [false, true]) for (const deferred of [false, true]) for (const halted of [false, true]) {
    if (iff1 && !deferred) continue;
    const ram = new ObservedRam();
    const state = initialState({ iff1, interruptDeferred: deferred, halted });
    const cpu = new CpuZ80(ram, state);
    const record = cpu.interrupt("irq", () => assert.fail("ignored acknowledgement"));
    assert.deepEqual(record, { before: snapshot(state), after: snapshot(state), source: "irq", instruction: null,
      accesses: [], outcome: "ignored", reason: iff1 ? "deferred" : "disabled" });
    assert.deepEqual(ram.accesses, []);
    assert.notStrictEqual(record.before, record.after);
    assert.deepEqual(cpu.interrupt("irq", () => 0), record);
  }
  const ram = new ObservedRam();
  const cpu = new CpuZ80(ram, initialState({ nmiDeferred: true, halted: true }));
  const before = cpu.snapshot();
  assert.deepEqual(cpu.interrupt("nmi"), { before, after: before, source: "nmi", instruction: null,
    accesses: [], outcome: "ignored", reason: "deferred" });
  // @ts-expect-error Sources are a closed set, including for JavaScript callers.
  assert.throws(() => cpu.interrupt("reset"), RangeError);
  // @ts-expect-error An IRQ must supply an acknowledgement function.
  assert.throws(() => cpu.interrupt("irq"), TypeError);
  // @ts-expect-error A number is not an acknowledgement function.
  assert.throws(() => cpu.interrupt("irq", 0xff), TypeError);
  assert.deepEqual(cpu.snapshot(), before);
  assert.deepEqual(ram.accesses, []);
});

for (const im of [1, 2] as const) {
  test(`Z80 interrupt IM ${im} checks every vector byte, refresh wrapping, and stack/vector overlap in access order`, () => {
    const ram = new ObservedRam();
    for (let vector = 0; vector < 256; vector++) for (const i of [0, 0x42, 0xff]) for (const sp of [0, 1, 0x4201, 0xffff]) {
      const state = initialState({ pc: vector * 257, sp, i, im, iff1: true, iff2: !!(vector & 1), r: vector, halted: !!(vector & 2), flags: flagPattern(vector % 64) });
      const pointer = i * 256 + vector, pointerHigh = (pointer + 1) % 65536;
      ram.write(pointer, 0x34); ram.write(pointerHigh, 0x12);
      const highAddress = (sp + 65535) % 65536, lowAddress = (sp + 65534) % 65536;
      const memory = new Map([[pointer, 0x34], [pointerHigh, 0x12]]);
      memory.set(highAddress, Math.floor(state.pc / 256)); memory.set(lowAddress, state.pc % 256);
      const pc = im === 1 ? 0x38 : memory.get(pointer)! + memory.get(pointerHigh)! * 256;
      const cpu = new CpuZ80(ram, state);
      let calls = 0;
      ram.accesses.length = 0;
      const record = cpu.interrupt("irq", () => {
        calls++;
        assert.equal(ram.accesses.length, 0);
        assert.equal(cpu.snapshot().iff1, false); assert.equal(cpu.snapshot().iff2, false);
        assert.equal(cpu.snapshot().halted, false);
        return vector;
      });
      const accesses = [writeAccess(highAddress, Math.floor(state.pc / 256)), writeAccess(lowAddress, state.pc % 256),
        ...(im === 2 ? [readAccess(pointer, memory.get(pointer)!), readAccess(pointerHigh, memory.get(pointerHigh)!)] : [])];
      assert.deepEqual(record, { before: snapshot(state), after: snapshot({ ...state, pc, sp: lowAddress,
        r: Math.floor(vector / 128) * 128 + (vector + 1) % 128, iff1: false, iff2: false, halted: false }),
        source: "irq", outcome: "accepted", instruction: null, accesses: [{ kind: "acknowledge", value: vector }, ...accesses] });
      assert.deepEqual(ram.accesses, accesses);
      assert.equal(calls, 1);
    }
  });
}

test("Z80 interrupt NMI preserves IFF2, bypasses EI inhibition, and requires an instruction between nested entries", () => {
  for (const iff1 of [false, true]) for (const iff2 of [false, true]) for (const sp of [0, 1, 0xffff, 0x0067]) {
    const ram = new ObservedRam();
    const state = initialState({ pc: 0xabcd, sp, iff1, iff2, halted: true, interruptDeferred: true });
    const cpu = new CpuZ80(ram, state);
    const record = cpu.interrupt("nmi");
    const expected = snapshot({ ...state, pc: 0x66, sp: (sp + 65534) % 65536, r: 0xff, iff1: false, halted: false, nmiDeferred: true });
    assert.deepEqual(record, { before: snapshot(state), after: expected, source: "nmi", outcome: "accepted", instruction: null,
      accesses: [writeAccess((sp + 65535) % 65536, 0xab), writeAccess((sp + 65534) % 65536, 0xcd)] });
    assert.deepEqual(ram.accesses, record.accesses);
    const resumed = new CpuZ80(ram, record.after);
    const ignored = resumed.interrupt("nmi");
    assert.equal(ignored.outcome, "ignored");
    assert.deepEqual(ignored.before, ignored.after);
    ram.write(0x66, 0x00);
    resumed.step();
    const nested = resumed.interrupt("nmi");
    assert.equal(nested.outcome, "accepted");
    assert.equal(nested.after.iff2, iff2);
    assert.equal(nested.after.pc, 0x66);
    assert.equal(nested.after.r, 0x81);
  }
});

test("Z80 interrupt mode 0 runs all 698 documented forms through the same decoder using external instruction bytes", () => {
  const prefixes = [0xcb, 0xdd, 0xed, 0xfd];
  const encodings = [
    ...Array.from({ length: 256 }, (_, opcode) => opcode).filter(opcode => !prefixes.includes(opcode)).map(opcode => [opcode]),
    ...cbRows.flatMap(row => Array.from({ length: 8 }, (_, register) => [0xcb, row.base + register])),
    ...edOpcodes.map(opcode => [0xed, opcode]),
    ...indexes.flatMap(({ prefix }) => [
      ...indexOpcodes.map(opcode => [prefix, opcode]), ...cbRows.map(row => [prefix, 0xcb, 0, row.base + 6]),
    ]),
  ];
  assert.equal(encodings.length, 698);
  for (const encoding of encodings) {
    const ram = new ObservedRam();
    const state = initialState({ im: 0, iff1: true, iff2: true });
    const stream = [...encoding, 0, 0];
    let fetched = 0;
    const cpu = new CpuZ80(ram, state, { readPort: () => 0, writePort: () => {} });
    const record = cpu.interrupt("irq", () => {
      assert.equal(cpu.snapshot().pc, state.pc, "fetching any instruction byte preserves PC");
      assert.ok(fetched < stream.length, "no extra instruction fetches");
      return stream[fetched++]!;
    });
    assert.equal(record.outcome, encoding[0] === 0x76 ? "halted" : "executed", encoding.toString());
    assert.deepEqual(record.instruction, { source: "interrupt", bytes: stream.slice(0, fetched) });
    assert.deepEqual(record.accesses.filter(access => access.kind === "acknowledge"), stream.slice(0, fetched).map(value => ({ kind: "acknowledge", value })));
    assert.deepEqual(record.accesses.filter(access => access.kind === "read" || access.kind === "write"), ram.accesses);
    assert.equal(record.after.r, encoding[0] === 0xed && encoding[1] === 0x4f ? state.a : encoding.length === 1 ? 0xff : 0x80);
  }
});

test("Z80 interrupt mode 0 supplies complete CALL, jump, and relative operands without advancing the interrupted PC", () => {
  for (const pc of [0, 1, 0x2000, 0xffff]) for (const sp of [0, 1, 0x2000, 0xffff]) {
    for (const opcode of [0xcd, 0xc3, 0xc4, 0xcc]) {
      const ram = new ObservedRam();
      ram.write(pc, 0xaa); // Must never be used as an operand byte.
      const before = initialState({ im: 0, iff1: true, pc, sp }); // Z is clear: NZ call taken, Z call untaken.
      const bytes = [opcode, 0x34, 0x12];
      let cursor = 0;
      ram.accesses.length = 0;
      const cpu = new CpuZ80(ram, before);
      const record = cpu.interrupt("irq", () => bytes[cursor++]!);
      const call = opcode === 0xcd || opcode === 0xc4;
      assert.deepEqual(record.after, snapshot({ ...before, pc: opcode === 0xcc ? pc : 0x1234,
        sp: call ? (sp + 65534) % 65536 : sp, r: 0xff, iff1: false, iff2: false }));
      assert.deepEqual(record.instruction, { source: "interrupt", bytes });
      const writes = call ? [writeAccess((sp + 65535) % 65536, Math.floor(pc / 256)), writeAccess((sp + 65534) % 65536, pc % 256)] : [];
      assert.deepEqual(record.accesses, [...bytes.map(value => ({ kind: "acknowledge", value })), ...writes]);
      assert.deepEqual(ram.accesses, writes);
      assert.equal(cursor, 3);
    }
  }
  const ram = new Ram(65536);
  for (const pc of [0, 0xffff]) for (let displacement = 0; displacement < 256; displacement++) {
    const cpu = new CpuZ80(ram, initialState({ im: 0, iff1: true, pc }));
    let cursor = 0;
    const bytes = [0x18, displacement];
    const record = cpu.interrupt("irq", () => bytes[cursor++]!);
    const offset = displacement < 128 ? displacement : displacement - 256;
    assert.equal(record.after.pc, (pc + offset + 65536) % 65536);
    assert.deepEqual(record.accesses, bytes.map(value => ({ kind: "acknowledge", value })));
  }
  for (const [opcode, pc] of [[0xc7, 0], [0xcf, 8], [0xd7, 0x10], [0xdf, 0x18], [0xe7, 0x20], [0xef, 0x28], [0xf7, 0x30], [0xff, 0x38]]) {
    const cpu = new CpuZ80(ram, initialState({ im: 0, pc: 0xabcd, sp: 0, halted: true }));
    const record = cpu.interrupt("irq", () => opcode!);
    assert.equal(record.after.pc, pc);
    assert.equal(record.after.sp, 0xfffe);
    assert.equal(record.after.halted, false);
    assert.deepEqual(record.accesses, [{ kind: "acknowledge", value: opcode }, writeAccess(0xffff, 0xab), writeAccess(0xfffe, 0xcd)]);
  }
});

test("Z80 interrupt mode 0 keeps indexed operands, data memory, port input, and block-repeat refetch distinct", () => {
  const ram = new ObservedRam();
  ram.write(0x3ffe, 0x80);
  const state = initialState({ im: 0, iff1: true, ix: 0x4000 });
  const bytes = [0xdd, 0xcb, 0xfe, 0x06]; // RLC (IX-2): only DD and CB are M1 fetches.
  let cursor = 0;
  ram.accesses.length = 0;
  const record = new CpuZ80(ram, state).interrupt("irq", () => bytes[cursor++]!);
  assert.deepEqual(record.after, snapshot({ ...state, r: 0x80, iff1: false, iff2: false,
    flags: { s: false, z: false, h: false, pv: false, n: false, c: true } }));
  assert.deepEqual(record.accesses, [...bytes.map(value => ({ kind: "acknowledge", value })), readAccess(0x3ffe, 0x80), writeAccess(0x3ffe, 1)]);
  assert.deepEqual(ram.accesses, [readAccess(0x3ffe, 0x80), writeAccess(0x3ffe, 1)]);

  const ioRam = new IoRam();
  ioRam.input = 0x81;
  const cpu = new CpuZ80(ioRam, initialState({ im: 0, iff1: true, b: 2, c: 0x34, h: 0x40, l: 0 }), ioRam.ports);
  let fetched = 0;
  const input = cpu.interrupt("irq", () => [0xed, 0xb2][fetched++]!); // INIR from external bytes
  assert.equal(input.after.pc, 0x1ffe, "repeat phase still subtracts two from PC");
  assert.equal(input.after.b, 1);
  assert.deepEqual(input.accesses, [{ kind: "acknowledge", value: 0xed }, { kind: "acknowledge", value: 0xb2 },
    { kind: "input", port: 0x0234, value: 0x81 }, writeAccess(0x4000, 0x81)]);
  ioRam.write(0x1ffe, 0xed); ioRam.write(0x1fff, 0xb2); ioRam.input = 0x42;
  const next = cpu.step();
  assert.equal(next.after.pc, 0x2000); assert.equal(next.after.b, 0);
  assert.deepEqual(next.accesses, [readAccess(0x1ffe, 0xed), readAccess(0x1fff, 0xb2),
    { kind: "input", port: 0x0134, value: 0x42 }, writeAccess(0x4001, 0x42)]);
  assert.equal(fetched, 2, "normal resumption does not reuse the interrupt stream");
});

test("Z80 interrupt mode 0 rejection retains acceptance and completed opcode acknowledgements, without operand fetches", () => {
  for (const bytes of [[0xed, 0x00], [0xcb, 0x30], [0xdd, 0x00], [0xfd, 0xcb, 0xff, 0x30]]) {
    const ram = new ObservedRam();
    const before = initialState({ im: 0, iff1: true, iff2: true, halted: true, r: 0xff, pc: 0xffff });
    const cpu = new CpuZ80(ram, before);
    let cursor = 0;
    const record = cpu.interrupt("irq", () => {
      assert.ok(cursor < bytes.length);
      return bytes[cursor++]!;
    });
    assert.deepEqual(record, { before: snapshot(before), after: snapshot({ ...before, iff1: false, iff2: false, halted: false, r: 0x81 }),
      source: "irq", instruction: { source: "interrupt", bytes }, outcome: "unsupported", reason: "opcode",
      accesses: bytes.map(value => ({ kind: "acknowledge", value })) });
    assert.deepEqual(ram.accesses, []);
    assert.equal(cursor, bytes.length);
    assert.equal(cpu.interrupt("irq", () => assert.fail("accepted IRQ disabled IFF1")).outcome, "ignored");
  }
});

test("Z80 interrupt mode 0 can enable interrupts, select another mode, halt, and return with notification", () => {
  const ram = new Ram(65536);
  ram.write(0x2000, 0x00);
  const cpu = new CpuZ80(ram, initialState({ im: 0, iff1: true }));
  const ei = cpu.interrupt("irq", () => 0xfb);
  assert.equal(ei.after.iff1, true); assert.equal(ei.after.iff2, true);
  assert.equal(ei.after.interruptDeferred, true); assert.equal(ei.after.pc, 0x2000);
  assert.equal(cpu.interrupt("irq", () => assert.fail("EI delay")).outcome, "ignored");
  cpu.step();
  let cursor = 0;
  const mode = cpu.interrupt("irq", () => [0xed, 0x56][cursor++]!);
  assert.equal(mode.after.im, 1); assert.equal(mode.after.pc, 0x2001);
  const halted = new CpuZ80(ram, initialState({ im: 0, iff1: true })).interrupt("irq", () => 0x76);
  assert.equal(halted.outcome, "halted"); assert.equal(halted.after.pc, 0x2000);
  ram.write(0xffff, 0x78); ram.write(0, 0x56);
  let notifications = 0, returns = 0;
  const returning = new CpuZ80(ram, initialState({ im: 0, iff1: true, iff2: true, sp: 0xffff }), undefined, () => { notifications++; });
  const reti = returning.interrupt("irq", () => [0xed, 0x4d][returns++]!);
  assert.equal(reti.after.pc, 0x5678); assert.equal(reti.after.sp, 1);
  assert.equal(reti.after.iff1, false, "acceptance cleared IFF2 before RETI restored IFF1");
  assert.equal(notifications, 1);
});

test("Z80 interrupt failures retain acceptance and the exact completed stack/vector effects", () => {
  for (const source of ["nmi", "irq"] as const) for (const im of [0, 1, 2] as const) {
    if (source === "nmi" && im !== 0) continue;
    const bytes = im === 0 ? [0xcd, 0x34, 0x12] : [0x20];
    const acknowledgeCount = source === "nmi" ? 0 : bytes.length;
    const operations = acknowledgeCount + 2 + (source === "irq" && im === 2 ? 2 : 0);
    for (let failAt = 0; failAt < operations; failAt++) {
      const ram = new IoRam();
      ram.write(0x4220, 0x78); ram.write(0x4221, 0x56);
      const state = initialState({ im, sp: 0x9000, i: 0x42, iff1: true, iff2: true, halted: true });
      const cpu = new CpuZ80(ram, state);
      const failure = new Error(`failure ${failAt} in ${source}/${im}`);
      let calls = 0, supplied = 0;
      const attemptedWrites = Math.min(2, Math.max(0, failAt - acknowledgeCount + 1));
      const after = snapshot({ ...state, sp: state.sp - attemptedWrites, iff1: false, iff2: source === "nmi",
        halted: false, r: 0xff, nmiDeferred: source === "nmi" });
      const observe = (): void => {
        if (calls++ === failAt) {
          assert.deepEqual(cpu.snapshot(), after);
          throw failure;
        }
      };
      const acknowledge = (): number => { observe(); return bytes[supplied++]!; };
      ram.observe = observe; ram.accesses.length = 0;
      assert.throws(() => source === "nmi" ? cpu.interrupt("nmi") : cpu.interrupt("irq", acknowledge), error => error === failure);
      assert.deepEqual(cpu.snapshot(), after);
      assert.equal(calls, failAt + 1);
      assert.equal(ram.accesses.length, Math.max(0, failAt - acknowledgeCount));
      ram.observe = undefined;
      assert.deepEqual(cpu.reset().accesses, []);
      assert.equal(cpu.snapshot().nmiDeferred, false);
      assert.equal(cpu.snapshot().interruptDeferred, false);
    }
  }
});

test("Z80 interrupt byte validation never coerces data and counts only opcode fetches in R on failed IM 0 attempts", () => {
  for (const bytes of [[0xcd, 0x34], [0xdd, 0xcb, 0x80], [0xed], []]) {
    for (const invalid of [-1, 256, 0.5, NaN, Infinity, null, undefined, "00"]) {
      const ram = new ObservedRam();
      const state = initialState({ im: 0, iff1: true, iff2: true, halted: true, r: 0xff });
      const cpu = new CpuZ80(ram, state);
      let cursor = 0;
      // @ts-expect-error JavaScript acknowledgement results require runtime validation.
      assert.throws(() => cpu.interrupt("irq", () => cursor < bytes.length ? bytes[cursor++]! : invalid), /Interrupt instruction byte/);
      const twoFetches = bytes[0] === 0xdd || bytes[0] === 0xed;
      assert.deepEqual(cpu.snapshot(), snapshot({ ...state, iff1: false, iff2: false, halted: false, r: twoFetches ? 0x81 : 0x80 }));
      assert.deepEqual(ram.accesses, []);
    }
  }
});

test("Z80 interrupt return faults preserve partial SP, and notification failures preserve a fully retired return", () => {
  for (const opcode of [0x45, 0x4d]) for (const failAt of [0, 1, 2, 3, 4]) {
    if (opcode === 0x45 && failAt === 4) continue;
    const ram = new IoRam();
    ram.write(0x2000, 0xed); ram.write(0x2001, opcode); ram.write(0xffff, 0x78); ram.write(0, 0x56);
    const state = initialState({ sp: 0xffff, iff1: false, iff2: true, interruptDeferred: true, nmiDeferred: true });
    const error = new Error("return failure");
    let reads = 0, notifications = 0;
    const cpu = new CpuZ80(ram, state, undefined, () => { notifications++; throw error; });
    ram.observe = () => { if (reads++ === failAt) throw error; };
    ram.accesses.length = 0;
    assert.throws(() => cpu.step(), failure => failure === error);
    const decoded = failAt >= 2, retired = failAt === 4;
    assert.deepEqual(cpu.snapshot(), snapshot({ ...state, pc: retired ? 0x5678 : decoded ? 0x2002 : 0x2000,
      sp: retired ? 1 : failAt === 3 ? 0 : 0xffff, r: decoded ? 0x80 : state.r,
      iff1: retired, nmiDeferred: !retired }));
    assert.equal(notifications, retired ? 1 : 0);
    assert.equal(ram.accesses.length, failAt);
    ram.observe = undefined;
    cpu.reset(); // Failed callbacks must release the guard.
  }
});

test("Z80 interrupt callbacks may inspect snapshots but cannot reenter any CPU mutation", () => {
  for (const operation of ["step", "reset", "irq", "nmi"] as const) {
    for (const stage of ["acknowledge", "memory", "reti"] as const) {
      const ram = new IoRam();
      ram.write(0x2000, 0xed); ram.write(0x2001, 0x4d);
      let observations = 0;
      const nested = (): void => {
        const before = cpu.snapshot();
        assert.throws(() => {
          if (operation === "irq") cpu.interrupt("irq", () => assert.fail("nested acknowledgement"));
          else if (operation === "nmi") cpu.interrupt("nmi");
          else cpu[operation]();
        }, /Z80 step, reset, and interrupt calls must not be reentrant/);
        assert.deepEqual(cpu.snapshot(), before);
        observations++;
      };
      const cpu = new CpuZ80(ram, initialState({ im: 2 }), undefined, nested);
      if (stage === "memory") ram.observe = nested;
      if (stage === "reti") cpu.step();
      else cpu.interrupt("irq", () => { if (stage === "acknowledge") nested(); return 0; });
      assert.ok(observations > 0);
      ram.observe = undefined;
      cpu.reset();
    }
  }
});

test("Z80 interrupt inhibition survives thrown ordinary instructions and clears on reset", () => {
  const ram = new IoRam();
  ram.write(0x2000, 0xdb); ram.write(0x2001, 0x20);
  const state = initialState({ interruptDeferred: true, nmiDeferred: true });
  const cpu = new CpuZ80(ram, state, ram.ports);
  const failure = new Error("input failed");
  ram.observe = kind => { if (kind === "input") throw failure; };
  assert.throws(() => cpu.step(), error => error === failure);
  assert.equal(cpu.snapshot().interruptDeferred, true);
  assert.equal(cpu.snapshot().nmiDeferred, true);
  ram.observe = undefined;
  const before = cpu.snapshot();
  const reset = cpu.reset();
  assert.deepEqual(reset.after, snapshot({ ...before, pc: 0, i: 0, r: 0, iff1: false, iff2: false, im: 0,
    halted: false, interruptDeferred: false, nmiDeferred: false }));
  assert.deepEqual(reset.accesses, []);
});

test("Z80 interrupt return from NMI restores enable state but defers an IRQ until the following instruction", () => {
  for (const returnOpcode of [0x45, 0x4d]) {
    const ram = new Ram(65536);
    ram.write(0x0066, 0xed); ram.write(0x0067, returnOpcode); ram.write(0x2000, 0x00);
    const cpu = new CpuZ80(ram, initialState({ iff1: true, iff2: true, im: 1 }));
    cpu.interrupt("nmi");
    assert.equal(cpu.interrupt("irq", () => assert.fail("NMI cleared IFF1")).outcome, "ignored");
    assert.equal(cpu.step().after.iff1, true);
    const resumed = new CpuZ80(ram, cpu.snapshot());
    const delayed = resumed.interrupt("irq", () => assert.fail("IFF1 changed during return"));
    assert.equal(delayed.outcome, "ignored");
    if (delayed.outcome === "ignored") assert.equal(delayed.reason, "deferred");
    assert.equal(resumed.step().after.interruptDeferred, false);
    assert.equal(resumed.interrupt("irq", () => 0).outcome, "accepted");
  }
});
