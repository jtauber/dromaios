import assert from "node:assert/strict";
import { test } from "node:test";
import { byteExecution } from "../../../src/components/cpus/byte-execution.js";
import { Ram } from "../../../src/components/memory/ram.js";

for (const word of ["little", "big"] as const) for (const supplied of [false, true]) {
  test(`shared byte execution keeps interleaved access order and ${word}-endian ${supplied ? "supplied" : "RAM"} words`, () => {
    const ram = new Ram(0x10000), counter = { pc: 0xfffe };
    const bytes = [0x42, 0x34, 0x12]; bytes.forEach((byte, index) => ram.write((counter.pc + index) & 0xffff, byte));
    let stopped = false, value = 0, retired = 0;
    const cpu = byteExecution("fixture", ram, { readPort: () => 0x56, writePort: () => {} },
      () => ({ pc: counter.pc, stopped, value, retired }), {
        counter, stopped: () => stopped, reset: () => { stopped = true; }, retire: () => { retired++; }, acceptInterrupt: () => { stopped = false; },
        word, opcodeAdvance: "dispatch", interruptCounter: "preserve",
        handlers: { 0x42: ({ fetchWord, readPort, writePort, readByte, writeByte }) => {
          value = fetchWord();
          writeByte(0x80, readPort(7));
          writePort(8, readByte(0x80));
          stopped = true;
        } },
      });
    let index = 0;
    const result = supplied ? cpu.interrupt(() => bytes[index++]!) : cpu.step();
    assert.equal(result.outcome, "halted");
    assert.equal(value, word === "little" ? 0x1234 : 0x3412);
    assert.equal(retired, 1); assert.equal(counter.pc, supplied ? 0xfffe : 1);
    assert.deepEqual(result.accesses, [
      ...bytes.map((byte, index) => supplied ? { kind: "acknowledge", value: byte }
        : { kind: "read", address: (0xfffe + index) & 0xffff, value: byte }),
      { kind: "input", port: 7, value: 0x56 }, { kind: "write", address: 0x80, value: 0x56 },
      { kind: "read", address: 0x80, value: 0x56 }, { kind: "output", port: 8, value: 0x56 },
    ]);
    const saved = structuredClone(result);
    cpu.reset(); cpu.interrupt(() => 0x22);
    assert.deepEqual(result, saved);
  });
}
