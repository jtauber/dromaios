import assert from "node:assert/strict";
import { test } from "node:test";
import type { Cpu8080StepRecord } from "../../../src/components/cpus/generated/8080-cpu.js";
import { create8080AltairCommandPromptLesson } from "../../../src/machines/generated/8080/altair-command-prompt-lesson.js";

type Machine = ReturnType<typeof create8080AltairCommandPromptLesson>;
const bytes = (text: string) => [...text].map(character => character.charCodeAt(0));
// Independent image transcription: main loop, receive routine, then preserving print routine.
const program = `31 00 02 21 20 01 CD 65 00 21 00 01 06 08
CD 5B 00 FE 0A CA 26 00 77 D3 01 23 05 C2 0E 00
CD 5B 00 FE 0A C2 1E 00 3E 00 77 3E 0A D3 01
78 FE 08 CA 03 00 FE 07 C2 46 00 21 00 01 7E FE 48 CA 4C 00 FE 3F CA 52 00
21 60 01 C3 55 00 21 30 01 C3 55 00 21 40 01 CD 65 00 C3 03 00
DB 00 FE 00 CA 5B 00 DB 01 C9 E5 7E FE 00 CA 72 00 D3 01 23 C3 66 00 E1 C9`
  .split(/\s+/).map(value => Number.parseInt(value, 16));

function until(machine: Machine, ready: () => boolean, limit = 2000): Cpu8080StepRecord[] {
  const records: Cpu8080StepRecord[] = [];
  while (!ready()) {
    assert.ok(records.length < limit, "The program should reach the next boundary");
    const record = machine.cpu.step();
    assert.equal(record.outcome, "executed");
    records.push(record);
  }
  return records;
}

function send(machine: Machine, value: number): Cpu8080StepRecord[] {
  assert.equal(machine.cpu.snapshot().pc, 0x5b);
  assert.equal(machine.input.offer(value), true);
  return until(machine, () => machine.input.snapshot().pendingByte === null && machine.cpu.snapshot().pc === 0x5b);
}

function session() {
  const output: number[] = [];
  const machine = create8080AltairCommandPromptLesson({ output: value => { output.push(value); } });
  const startup = until(machine, () => machine.cpu.snapshot().pc === 0x5b);
  return { machine, output, startup };
}

test("the command prompt has a complete independent image, zero state, and fresh devices", () => {
  const machine = create8080AltairCommandPromptLesson({ output: () => assert.fail("Unexpected output") });
  assert.deepEqual(machine.cpu.snapshot(), {
    a: 0, b: 0, c: 0, d: 0, e: 0, h: 0, l: 0, pc: 0, sp: 0, bc: 0, de: 0, hl: 0,
    flags: { s: false, z: false, ac: false, p: false, cy: false },
    interruptEnabled: false, interruptDeferred: false, halted: false,
  });
  assert.equal(program.length, 116);
  const expected = Array<number>(0x10000).fill(0);
  expected.splice(0, program.length, ...program);
  for (const [address, text] of [[0x120, "> "], [0x130, "HELLO\n"], [0x140, "H=HELLO ?=HELP\n"], [0x160, "UNKNOWN\n"]] as const) {
    expected.splice(address, text.length, ...bytes(text));
  }
  assert.equal(machine.ram.size, expected.length);
  for (const [address, value] of expected.entries()) assert.equal(machine.ram.read(address), value, `RAM at ${address}`);
  assert.deepEqual(machine.input.snapshot(), { pendingByte: null });
  assert.deepEqual(machine.output.snapshot(), { lastByte: null });
  assert.equal("endAddress" in machine, false);
  machine.input.offer(72); machine.ram.write(0x100, 72);
  const fresh = create8080AltairCommandPromptLesson({ output: () => assert.fail("Unexpected output") });
  assert.equal(fresh.ram.read(0x100), 0);
  assert.deepEqual(fresh.input.snapshot(), { pendingByte: null });
});

test("startup prints through RAM, preserves HL, balances the print call, and waits inside receive", () => {
  const { machine, output, startup } = session();
  assert.equal(startup.length, 24);
  assert.deepEqual(output, bytes("> "));
  assert.deepEqual(startup[2]!.accesses.slice(3), [
    { kind: "write", address: 0x1ff, value: 0 }, { kind: "write", address: 0x1fe, value: 9 },
  ]);
  assert.deepEqual(startup[3]!.accesses.slice(1), [
    { kind: "write", address: 0x1fd, value: 1 }, { kind: "write", address: 0x1fc, value: 0x20 },
  ]);
  assert.deepEqual(startup[19]!.accesses.slice(1), [
    { kind: "read", address: 0x1fc, value: 0x20 }, { kind: "read", address: 0x1fd, value: 1 },
  ]);
  assert.deepEqual([startup[20]!.after.hl, startup[20]!.after.sp, startup[20]!.after.pc], [0x120, 0x200, 9]);
  for (let trip = 0; trip < 5; trip++) {
    const polling = Array.from({ length: 3 }, () => machine.cpu.step());
    assert.deepEqual(polling.map(record => record.before.pc), [0x5b, 0x5d, 0x5f]);
    assert.deepEqual(polling.flatMap(record => record.accesses).filter(access => access.kind !== "read"), [{ kind: "input", port: 0, value: 0 }]);
    const { hl, b, pc, sp, halted } = machine.cpu.snapshot();
    assert.deepEqual([hl, b, pc, sp, halted], [0x100, 8, 0x5b, 0x1fe, false]);
    assert.deepEqual(output, bytes("> "));
  }
});

test("commands are exact, case-sensitive lines, and every raw one-byte value has a defined response", () => {
  for (let value = 0; value <= 255; value++) {
    const { machine, output } = session();
    const records = send(machine, value);
    if (value !== 10) {
      assert.deepEqual(output, [...bytes("> "), value]); // Echo only; no interpretation before LF.
      records.push(...send(machine, 10));
    }
    const reply = value === 10 ? "" : value === 72 ? "HELLO\n" : value === 63 ? "H=HELLO ?=HELP\n" : "UNKNOWN\n";
    assert.deepEqual(output, [...bytes("> "), ...(value === 10 ? [] : [value]), ...bytes(`\n${reply}> `)]);
    assert.deepEqual(records.flatMap(record => record.accesses).filter(access => access.kind === "input" && access.port === 1)
      .map(access => access.value), value === 10 ? [10] : [value, 10]);
    const { b, hl, sp, halted } = machine.cpu.snapshot();
    assert.deepEqual([b, hl, sp, halted], [8, 0x100, 0x1fe, false]);
    assert.equal(machine.ram.read(value === 10 ? 0x100 : 0x101), 0);
  }
});

test("full lines drain through LF without writes beyond the buffer or interpreting excess as a new command", () => {
  for (const length of [0, 1, 2, 7, 8, 9, 16, 40]) {
    const { machine, output } = session();
    for (let address = 0xff; address <= 0x109; address++) machine.ram.write(address, 0xa5);
    const input = Array.from({ length }, (_, index) => index === 8 ? 63 : 72);
    const records = input.flatMap(value => send(machine, value));
    assert.deepEqual(output, [...bytes("> "), ...input.slice(0, 8)]);
    assert.deepEqual([machine.cpu.snapshot().b, machine.cpu.snapshot().hl], [Math.max(8 - length, 0), 0x100 + Math.min(length, 8)]);
    records.push(...send(machine, 10));
    const reply = length === 0 ? "" : length === 1 ? "HELLO\n" : "UNKNOWN\n";
    assert.deepEqual(output, [...bytes("> "), ...input.slice(0, 8), ...bytes(`\n${reply}> `)]);
    const writes = records.flatMap(record => record.accesses).filter(access => access.kind === "write" && access.address < 0x1fc);
    assert.deepEqual(writes, [...input.slice(0, 8), 0].map((value, index) => ({ kind: "write", address: 0x100 + index, value })));
    assert.equal(machine.ram.read(0xff), 0xa5);
    assert.equal(machine.ram.read(0x109), 0xa5);
    send(machine, 63); send(machine, 10);
    const help = bytes("?\nH=HELLO ?=HELP\n> ");
    assert.deepEqual(output.slice(-help.length), help);
    assert.equal(machine.ram.read(0x101), 0); // A new terminator hides any stale longer suffix.
  }
});

test("repeated commands balance every call and preserve program, messages, and stack sentinels", () => {
  const { machine, output } = session();
  machine.ram.write(0x1fb, 0xa5); machine.ram.write(0x200, 0x5a);
  const before = Array.from({ length: 0x10000 }, (_, address) => machine.ram.read(address));
  const records: Cpu8080StepRecord[] = [];
  const lines = ["H", "?", "", "h", "HI", "H ", "H\0", "H"];
  for (let trip = 0; trip < 4; trip++) for (const line of lines) {
    records.push(...[...bytes(line), 10].flatMap(value => send(machine, value)));
  }
  const replies = lines.map(line => `${line}\n${line === "H" ? "HELLO\n" : line === "?" ? "H=HELLO ?=HELP\n" : line === "" ? "" : "UNKNOWN\n"}> `).join("");
  assert.deepEqual(output, bytes("> " + replies.repeat(4)));
  for (const record of records) {
    if (record.instruction?.bytes[0] === 0xc9) assert.equal(record.after.sp, 0x200);
    assert.ok(record.after.sp >= 0x1fc && record.after.sp <= 0x200);
    for (const access of record.accesses) if (access.kind === "write") {
      assert.ok((access.address >= 0x100 && access.address <= 0x108) || (access.address >= 0x1fc && access.address <= 0x1ff));
    }
  }
  for (let address = 0; address < before.length; address++) {
    if ((address >= 0x100 && address <= 0x108) || (address >= 0x1fc && address <= 0x1ff)) continue;
    assert.equal(machine.ram.read(address), before[address]);
  }
});

test("reset clears devices and CPU control but preserves RAM, data registers, flags, and host output", () => {
  const { machine, output } = session();
  send(machine, 72); send(machine, 10); machine.input.offer(63);
  const before = machine.cpu.snapshot();
  const emitted = [...output];
  machine.reset();
  assert.deepEqual(machine.cpu.snapshot(), { ...before, pc: 0 });
  assert.deepEqual(machine.input.snapshot(), { pendingByte: null });
  assert.deepEqual(machine.output.snapshot(), { lastByte: null });
  assert.equal(machine.ram.read(0x100), 72);
  assert.deepEqual(output, emitted);
  until(machine, () => machine.cpu.snapshot().pc === 0x5b);
  assert.deepEqual(output, [...emitted, ...bytes("> ")]);
});
