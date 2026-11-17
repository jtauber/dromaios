import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu8088 } from "../../src/components/cpus/generated/8088-cpu.js";
import { Ram } from "../../src/components/memory/ram.js";
import { initialState } from "../components/cpus/8088/helpers.js";
import { createXtDosCalls, dosRequest } from "../../site/interactive/xt-dos-services.js";
import { dosCallLines } from "../../site/interactive/xt-dos-explanation.js";
import { xtRomGuide } from "./xt-inspection-fixture.js";

const catalogue = xtRomGuide.dos;
function fixture(ah = 0x3f, options = {}) {
  const ram = new Ram(0x100000), state = initialState({ cs: 0x100, ip: 0, ss: 0x200, sp: 0x100,
    ax: ah << 8, bx: 5, cx: 4, ds: 0x300, dx: 0, ...options });
  const put = (address: number, bytes: readonly number[]) => bytes.forEach((byte, i) => ram.write(address + i, byte));
  put(0x84, [0, 0, 0, 4]); // INT 21h → 0400:0000.
  put(0x1000, [0xcd, 0x21, 0x90]);
  const cpu = new Cpu8088(ram, state), calls = createXtDosCalls(catalogue, address => ram.read(address));
  const step = () => { const record = cpu.stepTimed(); calls.observe(record); return record; };
  return { ram, cpu, calls, put, step };
}

test("DOS requests follow actual INT 21h delivery; previews and entry samples remain distinct", () => {
  const f = fixture(9); f.put(0x3000, [72, 105, 13, 10, 36]);
  const before = f.cpu.snapshot();
  const record = f.step(), request = dosRequest(catalogue, record, a => f.ram.read(a))!;
  assert.equal(request.service.function, "09"); assert.deepEqual(request.buffer!.bytes, [72, 105, 13, 10]);
  assert.deepEqual(request.returnTo, { cs: before.cs, ip: 2, ss: before.ss, sp: before.sp });
  assert.match(dosCallLines(request, catalogue).join("\n"), /Preview only/);
  assert.match(dosCallLines(f.calls.entries()[0]!, catalogue, f.calls.entries()[0]).join("\n"), /Awaiting return/);
  const trapped = fixture(9, { trapPending: true }).step();
  assert.equal(trapped.instruction, null);
  assert.equal(dosRequest(catalogue, trapped, a => f.ram.read(a)), undefined);
  assert.equal(dosRequest(catalogue, { ...record, before: { ...record.before, ah: 0xff } }, a => f.ram.read(a)), undefined);
  // A later edit cannot rewrite an observed input sample.
  f.ram.write(0x3000, 0x58); assert.equal(f.calls.entries()[0]!.buffer!.bytes[0], 72);
});

test("DOS read results use returned AX and the original pointer, excluding stale bytes and errors", () => {
  for (const [count, carry] of [[2, false], [0, false], [6, true], [8, false]] as const) {
    const f = fixture(); f.step(); f.put(0x3000, [65, 66, 0xde, 0xad, 0xee]);
    // The handler changes DS and DX; the captured caller's buffer still owns the read result.
    f.put(0x4000, [0xb8, count, 0, 0xba, 0, 0x10, 0x8e, 0xda,
      0x36, 0xc6, 0x06, 0xfe, 0, carry ? 1 : 0, 0xcf]);
    while (f.cpu.snapshot().cs !== 0x100) f.step();
    const call = f.calls.entries()[0]!, result = call.result!;
    assert.equal(call.state, "returned"); assert.equal(result.ax, count); assert.equal(result.carry, carry);
    if (carry) {
      assert.equal(result.buffer, undefined);
      assert.match(dosCallLines(call, catalogue, call).join("\n"), /Error 0006 · Invalid handle/);
    } else {
      assert.deepEqual(result.buffer!.bytes, count === 0 ? [] : count === 2 ? [65, 66] : [65, 66, 0xde, 0xad]);
      assert.equal(result.buffer!.segment, 0x300);
      if (count === 8) assert.match(dosCallLines(call, catalogue, call).join("\n"), /AX exceeds requested CX/);
    }
  }
});

test("bounded DOS samples handle segment/physical wrap, missing storage, delimiters, and zero-length buffers", () => {
  const f = fixture(9, { ds: 0xffff, dx: 0x000f }); f.step();
  const entry = f.calls.entries()[0]!;
  const record = { ...f.cpu.stepTimed(), before: { ...f.cpu.snapshot(), ah: 9, ds: 0xffff, dx: 0xf },
    outcome: "executed" as const, instruction: { address: 0, bytes: [0xcd, 0x21] }, interrupt: { source: "software" as const, vector: 0x21 } };
  const addresses: number[] = [];
  const request = dosRequest(catalogue, record, address => { addresses.push(address); return addresses.length === 3 ? 36 : 65; })!;
  assert.deepEqual(addresses, [0xfffff, 0, 1]); assert.deepEqual(request.buffer!.bytes, [65, 65]);
  const wrapped: number[] = [];
  dosRequest(catalogue, { ...record, before: { ...record.before, ds: 0x300, dx: 0xffff } }, a => { wrapped.push(a); return wrapped.length === 2 ? 36 : 65; });
  assert.deepEqual(wrapped, [0x12fff, 0x3000]);
  assert.equal(dosRequest(catalogue, record, () => undefined)!.buffer!.end, "unavailable");
  assert.equal(entry.buffer!.end, "limit"); assert.equal(entry.buffer!.bytes.length, 256);
  const zero = fixture(0x40, { cx: 0 }); const zeroRecord = zero.step();
  const zeroRequest = dosRequest(catalogue, zeroRecord, () => assert.fail("Zero count must not read storage"))!;
  assert.deepEqual(zeroRequest.buffer!.bytes, []);
});

test("DOS pairing rejects jumps and stack aliases, accepts RETF 2, and clears unknown returns on restoration", () => {
  const f = fixture(); const entry = f.step();
  const returned = { ...entry.before, ip: 2, pc: 0x1002, ax: 0 };
  const boundary = { ...entry, interrupt: undefined, instruction: { address: 0x4000, bytes: [0xea, 2, 0, 0, 1] }, after: returned };
  f.calls.observe(boundary); assert.equal(f.calls.entries()[0]!.state, "pending");
  f.calls.observe({ ...boundary, instruction: { address: 0x4000, bytes: [0xcf] }, after: { ...returned, ss: 0x201, sp: 0xf0 } });
  assert.equal(f.calls.entries()[0]!.state, "pending");
  f.calls.observe({ ...boundary, instruction: { address: 0x4000, bytes: [0xca, 2, 0] } });
  assert.equal(f.calls.entries()[0]!.state, "returned");
  f.calls.reset(); f.calls.observe({ ...boundary, instruction: { address: 0x4000, bytes: [0xcf] } });
  assert.deepEqual(f.calls.entries(), []);
});

test("termination is a non-returning request; status and print calls do not infer success from CF", () => {
  const f = fixture(0x4c, { ax: 0x4c07 }); f.step(); const call = f.calls.entries()[0]!;
  assert.equal(call.state, "no-return"); assert.equal(call.result, undefined);
  const text = dosCallLines(call, catalogue, call).join("\n"); assert.match(text, /Requested exit status \(7\)/); assert.match(text, /not confirmation/);
  for (const ah of [9, 0x4d]) {
    const g = fixture(ah, { flags: { ...initialState().flags, cf: true } });
    g.step(); g.put(0x4000, [0xb8, 7, 0, 0xcf]); g.step(); g.step();
    const completed = g.calls.entries()[0]!;
    assert.doesNotMatch(dosCallLines(completed, catalogue, completed).join("\n"), /Error |Succeeded/);
  }
});
