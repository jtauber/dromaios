import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { create8080AltairBasic } from "../../../src/machines/generated/8080/altair-basic.js";

const tapePath = process.env.ALTAIR_BASIC_TAPE;

test("the historical tape boots 4K BASIC, probes RAM, and evaluates direct arithmetic", {
  skip: tapePath === undefined ? "Set ALTAIR_BASIC_TAPE to the externally supplied 4K BASIC 3.2 tape" : false,
}, () => {
  assert.ok(tapePath);
  const tape = readFileSync(tapePath);
  assert.equal(tape.length, 4352, "Expected the complete archived tape stream");
  assert.equal(createHash("sha256").update(tape).digest("hex"),
    "fd01fd8b5c3dfbf67709809a1da6409ff1e0cb9c108fbe6a5129f8ad8e68d90f", "Tape identity");

  const input = [...tape], output: number[] = [];
  let offered = 0, consumed = 0, steps = 0, transcript = "";
  let loaderEntered = false, basicEntered = false, probedHole = false;
  const loaderWrites: { address: number; value: number }[] = [];
  const machine = create8080AltairBasic({ serial: byte => {
    output.push(byte);
    // Terminal display policy only: the serial device retains all eight bits.
    transcript += String.fromCharCode(byte & 0x7f);
  } });
  machine.sense.offer(0x0c);

  function until(suffix: string): string {
    const start = transcript.length;
    for (let attempt = 0; attempt < 200_000; attempt++) {
      if (offered < input.length && machine.serial.offer(input[offered]!)) offered++;
      const record = machine.cpu.step();
      steps++;
      assert.equal(record.outcome, "executed", `Unexpected stop at ${record.before.pc.toString(16)}`);
      for (const access of record.accesses) {
        if (access.kind === "input" && access.port === 0x11) consumed++;
        if (access.kind === "write") {
          if (!loaderEntered) loaderWrites.push({ address: access.address, value: access.value });
          if (access.address === 0x1000) probedHole = true;
        }
      }
      if (!loaderEntered && record.after.pc === 0x0f00) {
        loaderEntered = true;
        assert.equal(consumed, 366);
        assert.deepEqual(loaderWrites, Array.from({ length: 174 }, (_, index) => ({
          address: 0x0fad - index, value: tape[192 + index],
        })), "The entered bootstrap deposits the reverse-order loader from the tape");
      }
      if (loaderEntered && !basicEntered && record.after.pc === 0) {
        basicEntered = true;
        assert.equal(consumed, 4300, "The checksum loader consumes the payload and start record");
        assert.ok(tape.subarray(consumed).every(byte => byte === 0), "Only zero trailer padding remains");
        assert.equal(machine.ram.read(0), 0xf3, "BASIC has replaced the panel bootstrap");
      }
      if (transcript.slice(start).endsWith(suffix)) return transcript.slice(start);
    }
    assert.fail(`No ${JSON.stringify(suffix)} after ${steps} steps; PC=${machine.cpu.snapshot().pc.toString(16)}; output=${JSON.stringify(transcript)}`);
  }
  function send(text: string): void { input.push(...Buffer.from(text, "ascii")); }

  assert.equal(until("MEMORY SIZE?"), "\r\nMEMORY SIZE?");
  assert.ok(loaderEntered && basicEntered);
  send("\r");
  assert.equal(until("TERMINAL WIDTH?"), " \r\nTERMINAL WIDTH?");
  assert.ok(probedHole, "BASIC discovers the RAM boundary through actual writes");
  assert.equal(machine.memory.read(0x1000), 255);
  send("\r");
  assert.equal(until("WANT SIN?"), " \r\nWANT SIN?");
  send("Y\r");
  assert.equal(until("OK\r\r\n"),
    " Y\r\n\r\n727 BYTES FREE\r\r\n\r\r\nBASIC VERSION 3.2\r\r\n[4K VERSION]\r\r\n\r\r\nOK\r\r\n");
  send("PRINT 40+2\r");
  assert.equal(until("OK\r\r\n"), "PRINT 40+2\r\n 42 \r\n\r\r\nOK\r\r\n");
  assert.equal(offered, input.length);
  assert.equal(machine.serial.snapshot().full, false);
  assert.ok(output.some(byte => byte > 127), "The terminal conversion does not hide an eight-bit device limitation");
});
