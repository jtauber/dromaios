import assert from "node:assert/strict";
import { test } from "node:test";
import { callStack16LE } from "../../../src/components/cpus/call-stack.js";
import { ObservedRam } from "../../helpers/observed-ram.js";

test("calls and returns use ordered byte accesses across every stack address, preserving flags and registers", () => {
  const ram = new ObservedRam();
  for (let sp = 0; sp < 65536; sp++) {
    const state = { sp, pc: 0x1234, a: 0x56, flags: { c: true } };
    const stack = callStack16LE(state);
    ram.accesses.length = 0;
    stack.call(0xabcd, (address, value) => {
      assert.equal(state.sp, address); // Each decrement precedes its write.
      ram.write(address, value);
    });
    const low = (sp + 65534) % 65536, high = (sp + 65535) % 65536;
    assert.deepEqual(ram.accesses, [{ kind: "write", address: high, value: 0x12 }, { kind: "write", address: low, value: 0x34 }]);
    assert.deepEqual(state, { sp: low, pc: 0xabcd, a: 0x56, flags: { c: true } });
    stack.return(address => {
      assert.equal(state.sp, address); // Each read precedes its increment.
      return ram.read(address);
    });
    assert.deepEqual(ram.accesses.slice(2), [{ kind: "read", address: low, value: 0x34 }, { kind: "read", address: high, value: 0x12 }]);
    assert.deepEqual(state, { sp, pc: 0x1234, a: 0x56, flags: { c: true } });
  }
});

test("untaken calls and returns perform no pointer or memory accesses; later calls use live state", () => {
  const fail = (): never => { throw new Error("unexpected access"); };
  const idle = callStack16LE({ get pc() { return fail(); }, get sp() { return fail(); } });
  idle.call(0, fail, false);
  idle.return(fail, false);
  const state = { pc: 0, sp: 0 };
  const stack = callStack16LE(state);
  state.pc = 0xffff; state.sp = 1;
  const writes: number[][] = [];
  stack.call(0, (address, value) => writes.push([address, value]));
  assert.deepEqual(writes, [[0, 0xff], [0xffff, 0xff]]);
  state.sp = 0x8000;
  stack.return(address => address === 0x8000 ? 0x78 : 0x56);
  assert.deepEqual(state, { pc: 0x5678, sp: 0x8002 });
});

test("stack access failures retain completed effects without advancing past a failed read", () => {
  const failure = new Error("memory failure"), state = { pc: 0x1234, sp: 0 };
  const stack = callStack16LE(state);
  assert.throws(() => stack.call(0x8000, () => { throw failure; }), error => error === failure);
  assert.deepEqual(state, { pc: 0x1234, sp: 0xffff });
  const reads: number[] = [];
  assert.throws(() => stack.return(address => {
    reads.push(address);
    if (reads.length === 2) throw failure;
    return 0x78;
  }), error => error === failure);
  assert.deepEqual(reads, [0xffff, 0]);
  assert.deepEqual(state, { pc: 0x1234, sp: 0 });
});
