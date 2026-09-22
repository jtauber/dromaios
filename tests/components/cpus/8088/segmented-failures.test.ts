import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu8088 } from "../../../../src/components/cpus/generated/8088-cpu.js";
import type { Cpu8088State, Cpu8088Flags, Cpu8088MemoryAccess } from "../../../../src/components/cpus/generated/8088-cpu.js";
import { ObservedRam } from "../../../helpers/observed-ram.js";
import { address, aluResult, flags, initialState, snapshot } from "./helpers.js";

const forms = [
  [0x8c, "storeSegment"], [0x8e, "loadSegment"], [0x8d, "LEA"], [0xc4, "LES"], [0xc5, "LDS"], [0xd7, "XLAT"],
  [0xfa, "CLI"], [0xfb, "STI"], [0xcf, "IRET"],
  [0xa4, "move"], [0xa5, "move"], [0xa6, "compare"], [0xa7, "compare"],
  [0xaa, "store"], [0xab, "store"], [0xac, "load"], [0xad, "load"], [0xae, "scan"], [0xaf, "scan"],
] as const;
type Operation = typeof forms[number][1];
const wrap = (n: number) => (n + 65536) % 65536;
const positions = { cf: 0, pf: 2, af: 4, zf: 6, sf: 7, tf: 8, if: 9, df: 10, of: 11 } as const;

function expected(before: Cpu8088State, initial: Map<number, number>, program: readonly number[], operation: Operation, width: 8 | 16, override: boolean, repeat: number) {
  const state = structuredClone(before), bytes = new Map(initial), accesses: Cpu8088MemoryAccess[] = [];
  const partial: { state: Cpu8088State; bytes: Map<number, number> }[] = [];
  const effect = (access: Cpu8088MemoryAccess) => { partial.push({ state: structuredClone(state), bytes: new Map(bytes) }); accesses.push(access); };
  const read = (a: number) => { assert.ok(bytes.has(a)); const value = bytes.get(a)!; effect({ kind: "read", address: a, value }); return value; };
  const write = (a: number, value: number) => { effect({ kind: "write", address: a, value }); bytes.set(a, value); };
  const readWord = (s: number, o: number) => read(address(s, o)) + 256 * read(address(s, o + 1));
  const writeWord = (s: number, o: number, value: number) => { write(address(s, o), value % 256); write(address(s, o + 1), Math.floor(value / 256)); };
  for (const byte of program) { assert.equal(read(address(state.cs, state.ip)), byte); state.ip = wrap(state.ip + 1); }
  const segment = override ? state.ss : state.ds, offset = 0xffff;
  let deferAll = false, deferINTR = false;
  if (operation === "storeSegment") writeWord(segment, offset, state.ss);
  else if (operation === "loadSegment") { state.ss = readWord(segment, offset); deferAll = true; }
  else if (operation === "LEA") state.si = offset;
  else if (operation === "LES" || operation === "LDS") {
    const word = readWord(segment, offset), seg = readWord(segment, wrap(offset + 2));
    state.si = word; state[operation === "LES" ? "es" : "ds"] = seg;
  } else if (operation === "XLAT") {
    const value = read(address(segment, wrap(state.bx + state.ax % 256)));
    state.ax = Math.floor(state.ax / 256) * 256 + value;
  } else if (operation === "CLI") state.flags.if = false;
  else if (operation === "STI") { deferINTR = !state.flags.if; state.flags.if = true; }
  else if (operation === "IRET") {
    const pop = () => { const n = readWord(state.ss, state.sp); state.sp = wrap(state.sp + 2); return n; };
    const ip = pop(), cs = pop(); state.ip = ip; state.cs = cs; state.sp = wrap(state.sp);
    const status = pop(), next = flags(0);
    for (const field of Object.keys(positions) as (keyof Cpu8088Flags)[]) next[field] = Boolean(Math.floor(status / 2 ** positions[field]) % 2);
    deferINTR = !state.flags.if && next.if; state.flags = next;
  } else if (!repeat || state.cx !== 0) {
    const si = state.si, di = state.di, es = state.es;
    const readSource = () => width === 8 ? read(address(segment, si)) : readWord(segment, si);
    const readDestination = () => width === 8 ? read(address(es, di)) : readWord(es, di);
    const writeDestination = (value: number) => width === 8 ? write(address(es, di), value) : writeWord(es, di, value);
    if (operation === "move") writeDestination(readSource());
    else if (operation === "store") writeDestination(state.ax % 2 ** width);
    else if (operation === "load") { const value = readSource(); state.ax = width === 8 ? Math.floor(state.ax / 256) * 256 + value : value; }
    else state.flags = aluResult("SUB", width, operation === "compare" ? readSource() : state.ax % 2 ** width, readDestination(), state.flags).flags;
    const delta = (state.flags.df ? -1 : 1) * width / 8;
    if (["move", "compare", "load"].includes(operation)) state.si = wrap(state.si + delta);
    if (operation !== "load") state.di = wrap(state.di + delta);
    if (repeat) {
      state.cx = wrap(state.cx - 1);
      if (state.cx !== 0 && (!["compare", "scan"].includes(operation) || state.flags.zf === (repeat === 0xf3))) state.ip = before.ip;
    }
  }
  state.interruptDeferred = deferINTR; state.recognitionDeferred = deferAll; state.trapPending = before.trapPending || before.flags.tf;
  return { accesses, partial, after: { state, bytes } };
}

test("all 19 new 8088 forms retain exact byte effects and retirement across prefixes, wrap, overlap, and every failed access", () => {
  assert.equal(forms.length, 19);
  const failure = Error("failed byte access");
  for (const [opcode, operation] of forms) for (const override of [false, true]) for (const bits of [0, 511]) {
    const string = opcode >= 0xa4 && opcode <= 0xaf, compares = operation === "compare" || operation === "scan";
    for (const repeat of string ? compares ? [0, 0xf2, 0xf3] : [0, 0xf3] : [0]) for (const cx of string ? [0, 1, 2] : [2]) {
      const before = initialState({ cs: 0xabcd, ip: 0xffff, ds: 0x2222, es: 0xffff, ss: 0xffff, sp: 0xffff,
        bx: 0xfff0, ax: 0x1210, si: 0xffff, di: 0, cx, flags: flags(bits), recognitionDeferred: true, interruptDeferred: true });
      const suffix = opcode === 0x8c || opcode === 0x8e ? [0x16, 0xff, 0xff] : [0x8d, 0xc4, 0xc5].includes(opcode) ? [0x36, 0xff, 0xff] : [];
      const program = [...(override ? [0x26, 0x36, 0xf0] : []), ...(repeat ? [repeat === 0xf2 ? 0xf3 : 0xf2, repeat] : []), opcode, ...suffix];
      const initial = new Map<number, number>();
      for (const [s, o] of [[before.ds, before.si], [before.es, before.di], [before.ss, before.sp],
        [before.ds, wrap(before.bx + before.ax % 256)], [before.ss, wrap(before.bx + before.ax % 256)]]) {
        [0x34, 0x12, 0xef, 0xbe, 0x02, 0x02].forEach((value, i) => initial.set(address(s!, o! + i), value));
      }
      program.forEach((value, i) => initial.set(address(before.cs, before.ip + i), value));
      const oracle = expected(before, initial, program, operation, opcode % 2 ? 16 : 8, override, repeat);
      for (let failAt = -1; failAt < oracle.accesses.length; failAt++) {
        let armed = false, attempts = 0;
        const attempt = () => { if (armed && attempts++ === failAt) throw failure; };
        class FaultRam extends ObservedRam {
          override read(a: number) { attempt(); return super.read(a); }
          override write(a: number, value: number) { attempt(); super.write(a, value); }
        }
        const ram = new FaultRam(0x100000); initial.forEach((value, a) => ram.write(a, value)); ram.accesses.length = 0;
        const cpu = new Cpu8088(ram, before); armed = true;
        const label = [operation, opcode, override, bits, repeat, cx, failAt].join(":");
        if (failAt < 0) {
          const record = cpu.step();
          assert.deepEqual(record, { before: snapshot(before), after: snapshot(oracle.after.state),
            instruction: { address: address(before.cs, before.ip), bytes: program }, accesses: oracle.accesses, outcome: "executed" }, label);
        } else assert.throws(() => cpu.step(), error => error === failure);
        const after = failAt < 0 ? oracle.after : oracle.partial[failAt]!;
        assert.deepEqual(cpu.snapshot(), snapshot(after.state), label);
        assert.deepEqual(ram.accesses, oracle.accesses.slice(0, failAt < 0 ? undefined : failAt), label);
        assert.equal(attempts, failAt < 0 ? oracle.accesses.length : failAt + 1);
        armed = false;
        const addresses = new Set([...after.bytes.keys(), ...oracle.accesses.filter(a => a.kind === "write").map(a => a.address)]);
        addresses.forEach(a => assert.equal(ram.read(a), after.bytes.get(a) ?? 0, label));
        cpu.reset(); assert.equal(cpu.snapshot().ip, 0);
      }
    }
  }
});

test("8088 transfer and string decoders reject unsupported prefixes and selectors before body effects", () => {
  const rejected: number[][] = [];
  for (const [opcode, operation] of forms) for (const repeat of [0xf2, 0xf3]) {
    if (opcode >= 0xa4 && opcode <= 0xaf && (repeat === 0xf3 || ["compare", "scan"].includes(operation))) continue;
    rejected.push([repeat, opcode]);
  }
  for (let modRM = 0; modRM < 256; modRM++) {
    const selector = Math.floor(modRM / 8) % 8;
    if (selector > 3) rejected.push([0x8c, modRM]);
    if (selector > 3 || selector === 1) rejected.push([0x8e, modRM]);
    if (modRM >= 0xc0) for (const opcode of [0x8d, 0xc4, 0xc5]) rejected.push([opcode, modRM]);
  }
  const before = initialState({ ip: 0xffff, flags: flags(511), recognitionDeferred: true, interruptDeferred: true, trapPending: true });
  const ram = new ObservedRam(0x100000);
  for (const bytes of rejected) {
    [...bytes, 0x55, 0xaa, 0x99].forEach((value, i) => ram.write(address(before.cs, before.ip + i), value)); ram.accesses.length = 0;
    const cpu = new Cpu8088(ram, before), accesses = bytes.map((value, i) => ({ kind: "read", address: address(before.cs, before.ip + i), value }));
    assert.deepEqual(cpu.step(), { before: snapshot(before), after: snapshot(before),
      instruction: { address: address(before.cs, before.ip), bytes }, accesses, outcome: "unsupported", reason: "opcode" });
    assert.deepEqual(ram.accesses, accesses);
  }
});
