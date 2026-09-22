import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu8088 } from "../../../../src/components/cpus/8088.js";
import { Ram } from "../../../../src/components/memory/ram.js";
import { flags, initialState } from "./helpers.js";

test("8088 resolves port connections per active step, after the snapshot and before fetching", () => {
  const events: string[] = [];
  class CallbackRam extends Ram {
    override read(address: number): number { events.push(`read ${address}`); return super.read(address); }
  }
  const ram = new CallbackRam(0x100000);
  [0xe4, 0x10, 0xe4, 0x20, 0xf4].forEach((byte, address) => ram.write(address, byte));
  const first = { readPort: () => { events.push("first"); return 0x12; }, writePort: () => {} };
  const second = { readPort: () => { events.push("second"); return 0x34; }, writePort: () => {} };
  let selected = first, expectedIp = 0;
  const connections = { get ports() {
    assert.equal(cpu.snapshot().ip, expectedIp);
    assert.throws(() => cpu.reset(), /not be reentrant/);
    events.push("ports"); return selected;
  } };
  const cpu = new Cpu8088(ram, initialState({ cs: 0, ip: 0, flags: flags(0) }), connections);
  assert.deepEqual([...events], []); cpu.snapshot(); assert.deepEqual([...events], []);
  assert.equal(cpu.step().after.al, 0x12);
  assert.deepEqual([...events], ["ports", "read 0", "read 1", "first"]);
  selected = second; expectedIp = 2; events.length = 0;
  assert.equal(cpu.step().after.al, 0x34);
  assert.deepEqual([...events], ["ports", "read 2", "read 3", "second"]);
  expectedIp = 4; events.length = 0; assert.equal(cpu.step().outcome, "halted");
  assert.deepEqual([...events], ["ports", "read 4"]);
  events.length = 0; cpu.step(); cpu.reset(); assert.deepEqual([...events], []);
  const trap = new Cpu8088(ram, initialState({ trapPending: true, halted: true, flags: flags(0) }), connections);
  assert.equal(trap.step().interrupt?.source, "trap"); assert.ok(!events.includes("ports"));
});
