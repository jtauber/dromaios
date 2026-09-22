import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu8088 } from "../../../../src/components/cpus/generated/8088-cpu.js";
import type { Cpu8088Flags, Cpu8088MemoryAccess, Cpu8088State } from "../../../../src/components/cpus/generated/8088-cpu.js";
import { ObservedRam } from "../../../helpers/observed-ram.js";
import { address, flags, initialState, snapshot, words, wordBytes } from "./helpers.js";

type Register = typeof words[number] | "es" | "cs" | "ss" | "ds";
interface Form {
  opcode: number; operation: "PUSH" | "POP" | "PUSHF" | "POPF" | "CALL" | "JMP" | "RET";
  register?: Register; selector?: number; far?: true; relative?: true; discard?: true;
}
const forms: readonly Form[] = [
  ...words.flatMap((register, i): Form[] => [{ opcode: 0x50 + i, operation: "PUSH", register }, { opcode: 0x58 + i, operation: "POP", register }]),
  ...([[0x06, "es"], [0x0e, "cs"], [0x16, "ss"], [0x1e, "ds"]] as const).map(([opcode, register]): Form => ({ opcode, register, operation: "PUSH" })),
  ...([[0x07, "es"], [0x17, "ss"], [0x1f, "ds"]] as const).map(([opcode, register]): Form => ({ opcode, register, operation: "POP" })),
  { opcode: 0x9c, operation: "PUSHF" }, { opcode: 0x9d, operation: "POPF" },
  { opcode: 0xe8, operation: "CALL", relative: true }, { opcode: 0x9a, operation: "CALL", far: true }, { opcode: 0xea, operation: "JMP", far: true },
  { opcode: 0xc2, operation: "RET", discard: true }, { opcode: 0xc3, operation: "RET" },
  { opcode: 0xca, operation: "RET", discard: true, far: true }, { opcode: 0xcb, operation: "RET", far: true },
  { opcode: 0x8f, operation: "POP", selector: 0 }, { opcode: 0xff, operation: "PUSH", selector: 6 },
  { opcode: 0xff, operation: "CALL", selector: 2 }, { opcode: 0xff, operation: "JMP", selector: 4 },
  { opcode: 0xff, operation: "CALL", selector: 3, far: true }, { opcode: 0xff, operation: "JMP", selector: 5, far: true },
];
const positions = { cf: 0, pf: 2, af: 4, zf: 6, sf: 7, tf: 8, if: 9, df: 10, of: 11 } as const;
const wrap = (n: number) => (n + 65536) % 65536;

// Literal per-instruction schedules record the state before each attempted byte access.
function expected(form: Form, before: Cpu8088State, initial: Map<number, number>, program: readonly number[], offset: number) {
  const state = structuredClone(before), bytes = new Map(initial);
  const accesses: Cpu8088MemoryAccess[] = [], partial: { state: Cpu8088State; bytes: Map<number, number> }[] = [];
  const access = (entry: Cpu8088MemoryAccess) => { partial.push({ state: structuredClone(state), bytes: new Map(bytes) }); accesses.push(entry); };
  const read = (a: number) => { const value = bytes.get(a)!; assert.notEqual(value, undefined); access({ kind: "read", address: a, value }); return value; };
  const write = (a: number, value: number) => { access({ kind: "write", address: a, value }); bytes.set(a, value); };
  const readWord = (s: number, o: number) => read(address(s, o)) + 256 * read(address(s, o + 1));
  const writeWord = (s: number, o: number, value: number) => { write(address(s, o), value % 256); write(address(s, o + 1), Math.floor(value / 256)); };
  const push = (value: number) => { state.sp = wrap(state.sp - 2); writeWord(state.ss, state.sp, value); };
  const pop = () => { const word = readWord(state.ss, state.sp); state.sp = wrap(state.sp + 2); return word; };
  for (const byte of program) { assert.equal(read(address(state.cs, state.ip)), byte); state.ip = wrap(state.ip + 1); }
  let intr = false, all = false;
  const { operation, register } = form;
  if (operation === "PUSHF") {
    const packed = 0xf002 + Object.entries(positions).reduce((n, [field, bit]) => n + Number(state.flags[field as keyof Cpu8088Flags]) * 2 ** bit, 0);
    push(packed);
  } else if (operation === "POPF") {
    const word = pop(), next = flags(0);
    for (const field of Object.keys(positions) as (keyof Cpu8088Flags)[]) next[field] = Boolean(Math.floor(word / 2 ** positions[field]) % 2);
    intr = !state.flags.if && next.if; state.flags = next;
  } else if (operation === "PUSH") {
    const value = register ? state[register] : readWord(before.ds, offset);
    push(register === "sp" ? wrap(value - 2) : value);
  } else if (operation === "POP") {
    const value = pop();
    if (register) { state[register] = value; all = ["es", "ss", "ds"].includes(register); }
    else writeWord(before.ds, offset, value);
  } else if (operation === "RET") {
    const ip = pop(), cs = form.far ? pop() : undefined;
    state.ip = ip; if (cs !== undefined) state.cs = cs;
    state.sp = wrap(state.sp + (form.discard ? 0xff10 : 0));
  } else {
    const target = form.selector !== undefined ? readWord(before.ds, offset) : 0xff10;
    const cs = form.far ? form.selector !== undefined ? readWord(before.ds, wrap(offset + 2)) : 0x1234 : undefined;
    if (operation === "CALL") { if (form.far) push(state.cs); push(state.ip); }
    if (cs !== undefined) state.cs = cs;
    state.ip = form.relative ? wrap(state.ip + target) : target;
  }
  state.interruptDeferred = intr; state.recognitionDeferred = all; state.trapPending = before.flags.tf;
  return { accesses, partial, after: { state, bytes } };
}

test("all 38 migrated 8088 stack/control forms preserve exactly completed effects at every byte failure and retire only on success", () => {
  assert.equal(forms.length, 38);
  const failure = Error("byte access failed");
  for (const form of forms) for (const prefixes of [[], [0x26, 0x3e, 0xf0]]) for (const sp of [1, 0xf, 0xffff]) for (const bits of [0, 511]) {
    const before = initialState({ cs: 0xabcd, ip: 0xffff, ds: 0xffff, ss: 0xffff, sp, flags: flags(bits),
      interruptDeferred: true, recognitionDeferred: true });
    const offset = sp === 0xf ? 0xf : 0xffff;
    const operands = form.selector !== undefined ? [form.selector * 8 + 6, ...wordBytes(offset)]
      : form.relative || form.discard ? [0x10, 0xff] : form.far && form.operation !== "RET" ? [0x10, 0xff, 0x34, 0x12] : [];
    const program = [...prefixes, form.opcode, ...operands], initial = new Map<number, number>();
    program.forEach((byte, i) => initial.set(address(before.cs, before.ip + i), byte));
    [0x02, 0x02, 0xef, 0xbe].forEach((byte, i) => initial.set(address(before.ss, sp + i), byte));
    [0x34, 0x12, 0x78, 0x56].forEach((byte, i) => initial.set(address(before.ds, offset + i), byte));
    const oracle = expected(form, before, initial, program, offset);
    for (let failAt = -1; failAt < oracle.accesses.length; failAt++) {
      let armed = false, attempts = 0;
      const attempt = () => { if (armed && attempts++ === failAt) throw failure; };
      class FaultRam extends ObservedRam {
        override read(a: number) { attempt(); return super.read(a); }
        override write(a: number, value: number) { attempt(); super.write(a, value); }
      }
      const ram = new FaultRam(0x100000);
      initial.forEach((byte, a) => ram.write(a, byte)); ram.accesses.length = 0;
      const cpu = new Cpu8088(ram, before); armed = true;
      if (failAt < 0) {
        const record = cpu.step();
        assert.equal(record.outcome, "executed");
        assert.deepEqual(record.instruction, { address: address(before.cs, before.ip), bytes: program });
        assert.deepEqual(record.accesses, oracle.accesses);
      } else assert.throws(() => cpu.step(), error => error === failure);
      const after = failAt < 0 ? oracle.after : oracle.partial[failAt]!;
      assert.deepEqual(cpu.snapshot(), snapshot(after.state), [form.opcode, form.selector, sp, bits, failAt].join(":"));
      assert.deepEqual(ram.accesses, oracle.accesses.slice(0, failAt < 0 ? undefined : failAt));
      assert.equal(attempts, failAt < 0 ? oracle.accesses.length : failAt + 1);
      armed = false;
      const addresses = new Set([...after.bytes.keys(), ...oracle.accesses.filter(a => a.kind === "write").map(a => a.address)]);
      addresses.forEach(a => assert.equal(ram.read(a), after.bytes.get(a) ?? 0));
      cpu.reset(); assert.equal(cpu.snapshot().ip, 0);
    }
  }
});

test("migrated 8088 stack/control forms reject REP and invalid stack/far selectors before operands or body effects", () => {
  const ram = new ObservedRam(0x100000), before = initialState({ ip: 0xffff, flags: flags(511), interruptDeferred: true, recognitionDeferred: true, trapPending: true });
  const rejected = [
    ...[...new Set(forms.map(form => form.opcode))].flatMap(opcode => [[0xf2, opcode], [0xf3, opcode]]),
    ...Array.from({ length: 256 }, (_, modRM) => modRM).filter(modRM => (Math.floor(modRM / 8) % 8) !== 0).map(modRM => [0x8f, modRM]),
    ...Array.from({ length: 64 }, (_, n) => 0xc0 + n).filter(modRM => [3, 5].includes(Math.floor(modRM / 8) % 8)).map(modRM => [0xff, modRM]),
  ];
  for (const bytes of rejected) {
    [...bytes, 0x99, 0x88, 0x77].forEach((byte, i) => ram.write(address(before.cs, before.ip + i), byte)); ram.accesses.length = 0;
    const cpu = new Cpu8088(ram, before);
    const accesses = bytes.map((value, i) => ({ kind: "read" as const, address: address(before.cs, before.ip + i), value }));
    assert.deepEqual(cpu.step(), { before: snapshot(before), after: snapshot(before), instruction: { address: address(before.cs, before.ip), bytes },
      accesses, outcome: "unsupported", reason: "opcode" });
    assert.deepEqual(ram.accesses, accesses);
  }
});
