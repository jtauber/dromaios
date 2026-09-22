import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu8088 } from "../../../../src/components/cpus/generated/8088-cpu.js";
import type { Cpu8088State, Cpu8088MemoryAccess } from "../../../../src/components/cpus/generated/8088-cpu.js";
import { ObservedRam } from "../../../helpers/observed-ram.js";
import { address, flags, initialState, shiftedResult, shiftForms, snapshot } from "./helpers.js";

const forms = [
  ...shiftForms.flatMap(([name, selector]) => [0xd0, 0xd1, 0xd2, 0xd3].map(opcode => ({ name, selector: selector * 8, opcode }))),
  ...(["MUL", "IMUL", "DIV", "IDIV"] as const).flatMap((name, i) => [0xf6, 0xf7].map(opcode => ({ name, selector: (i + 4) * 8, opcode }))),
];
const wrap = (n: number) => (n + 65536) % 65536;
function expected(before: Cpu8088State, initial: Map<number, number>, program: number[], form: typeof forms[number]) {
  const state = structuredClone(before), bytes = new Map(initial), accesses: Cpu8088MemoryAccess[] = [];
  const partial: { state: Cpu8088State; bytes: Map<number, number> }[] = [];
  const effect = (access: Cpu8088MemoryAccess) => { partial.push({ state: structuredClone(state), bytes: new Map(bytes) }); accesses.push(access); };
  const read = (a: number) => { assert.ok(bytes.has(a)); const value = bytes.get(a)!; effect({ kind: "read", address: a, value }); return value; };
  const write = (a: number, value: number) => { effect({ kind: "write", address: a, value }); bytes.set(a, value); };
  for (const byte of program) { assert.equal(read(address(state.cs, state.ip)), byte); state.ip = wrap(state.ip + 1); }
  const width = form.opcode % 2 ? 16 : 8, low = read(address(before.es, 0xffff));
  const operand = width === 8 ? low : low + read(address(before.es, 0)) * 256;
  let fault = false;
  if (form.opcode < 0xf0) {
    const result = shiftedResult(form.name as typeof shiftForms[number][0], width, operand, form.opcode < 0xd2 ? 1 : before.cx % 256, state.flags);
    state.flags = result.flags;
    write(address(before.es, 0xffff), result.result % 256);
    if (width === 16) write(address(before.es, 0), Math.floor(result.result / 256));
  } else {
    const signed = form.name.startsWith("I"), divisor = signed ? BigInt.asIntN(width, BigInt(operand)) : BigInt(operand);
    const modulus = 1n << BigInt(width);
    if (form.name.endsWith("MUL")) {
      const left = signed ? BigInt.asIntN(width, BigInt(state.ax)) : BigInt.asUintN(width, BigInt(state.ax)), product = left * divisor;
      state.ax = Number(BigInt.asUintN(16, product));
      if (width === 16) state.dx = Number(BigInt.asUintN(16, product >> 16n));
      state.flags.cf = state.flags.of = product !== (signed ? BigInt.asIntN(width, product) : BigInt.asUintN(width, product));
    } else {
      const raw = BigInt(width === 8 ? state.ax : state.dx * 65536 + state.ax), dividend = signed ? BigInt.asIntN(width * 2, raw) : raw;
      const quotient = divisor === 0n ? 0n : dividend / divisor;
      fault = divisor === 0n || (signed ? quotient <= -modulus / 2n || quotient >= modulus / 2n : quotient >= modulus);
      if (!fault) {
        const q = Number(BigInt.asUintN(width, quotient)), r = Number(BigInt.asUintN(width, dividend % divisor));
        state.ax = width === 8 ? r * 256 + q : q; if (width === 16) state.dx = r;
      }
    }
  }
  if (fault) {
    const ip = read(0) + read(1) * 256, cs = read(2) + read(3) * 256;
    const status = 0xf002 + Object.entries({ cf: 0, pf: 2, af: 4, zf: 6, sf: 7, tf: 8, if: 9, df: 10, of: 11 })
      .reduce((sum, [key, bit]) => sum + Number(state.flags[key as keyof Cpu8088State["flags"]]) * 2 ** bit, 0);
    state.flags.if = state.flags.tf = false; state.interruptDeferred = state.recognitionDeferred = false;
    for (const word of [status, state.cs, state.ip]) { state.sp = wrap(state.sp - 2); write(address(state.ss, state.sp), word % 256); write(address(state.ss, state.sp + 1), Math.floor(word / 256)); }
    state.cs = cs; state.ip = ip;
  }
  state.interruptDeferred = state.recognitionDeferred = false; state.trapPending = before.flags.tf;
  return { partial, accesses, fault, after: { state, bytes } };
}

test("8088 arithmetic decoders preserve every byte-failure boundary, including division delivery and zero-count writes", () => {
  assert.equal(forms.length, 36);
  for (const form of forms) for (const count of [0, 1, 255]) for (const overlap of [false, true]) for (const operand of [0, 3]) {
    const before = initialState({ ax: 0x7fff, dx: 0, cx: count, cs: overlap ? 0xffff : 0x1234, ip: 0xfffd, es: 0xffff,
      ss: 0x3333, sp: 1, flags: flags(count ? 511 : 0), recognitionDeferred: true, interruptDeferred: true });
    const program = [0x36, 0x26, 0xf0, form.opcode, form.selector + 6, 0xff, 0xff];
    const initial = new Map([[0, 0x78], [1, 0x56], [2, 0x21], [3, 0x43], [address(before.es, 0xffff), operand], [address(before.es, 0), 0]]);
    program.forEach((byte, i) => initial.set(address(before.cs, before.ip + i), byte));
    const oracle = expected(before, initial, program, form), failure = Error("failed byte");
    for (let failAt = -1; failAt < oracle.accesses.length; failAt++) {
      let armed = false, attempts = 0;
      const attempt = () => { if (armed && attempts++ === failAt) throw failure; };
      class FaultRam extends ObservedRam {
        override read(a: number) { attempt(); return super.read(a); }
        override write(a: number, byte: number) { attempt(); super.write(a, byte); }
      }
      const ram = new FaultRam(0x100000); initial.forEach((byte, a) => ram.write(a, byte)); ram.accesses.length = 0;
      const cpu = new Cpu8088(ram, before), label = [form.name, form.opcode, count, overlap, operand, failAt].join(":"); armed = true;
      if (failAt < 0) assert.deepEqual(cpu.step(), {
        before: snapshot(before), after: snapshot(oracle.after.state), instruction: { address: address(before.cs, before.ip), bytes: program },
        accesses: oracle.accesses, outcome: "executed", ...(oracle.fault ? { interrupt: { source: "divide-error", vector: 0 } } : {}),
      }, label);
      else assert.throws(() => cpu.step(), error => error === failure);
      const after = failAt < 0 ? oracle.after : oracle.partial[failAt]!;
      assert.deepEqual(cpu.snapshot(), snapshot(after.state), label);
      assert.deepEqual(ram.accesses, oracle.accesses.slice(0, failAt < 0 ? undefined : failAt), label);
      armed = false;
      for (const a of new Set([...after.bytes.keys(), ...oracle.after.bytes.keys()])) assert.equal(ram.read(a), after.bytes.get(a) ?? 0, label);
      assert.doesNotThrow(() => cpu.reset());
    }
  }
});
