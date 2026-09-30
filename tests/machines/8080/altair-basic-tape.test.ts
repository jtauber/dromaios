import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { SerialSession } from "../../../src/runtime/serial-session.js";
import { create8080AltairBasic } from "../../../src/machines/generated/8080/altair-basic.js";

const tapePath = process.env.ALTAIR_BASIC_TAPE;

test("the historical tape boots BASIC and supports editing, programs, guest break, and host controls", {
  skip: tapePath === undefined ? "Set ALTAIR_BASIC_TAPE to the externally supplied 4K BASIC 3.2 tape" : false,
}, () => {
  assert.ok(tapePath);
  const tape = readFileSync(tapePath);
  assert.equal(tape.length, 4352, "Expected the complete archived tape stream");
  assert.equal(createHash("sha256").update(tape).digest("hex"),
    "fd01fd8b5c3dfbf67709809a1da6409ff1e0cb9c108fbe6a5129f8ad8e68d90f", "Tape identity");

  const output: number[] = [];
  let consumed = 0, steps = 0, transcript = "";
  let loaderEntered = false, basicEntered = false, probedHole = false;
  const loaderWrites: { address: number; value: number }[] = [];
  const session = new SerialSession(output => create8080AltairBasic({ serial: output }), tape);
  const machine = session.machine;
  machine.sense.offer(0x0c);
  session.start();

  function advance(maxSteps: number): void {
    const batch = session.run(maxSteps);
    assert.equal(batch.stopReason, "step-limit");
    steps += batch.records.length;
    for (const record of batch.records) {
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
    }
    for (const byte of session.drainOutput()) {
      output.push(byte);
      // Terminal display policy only: the serial device retains all eight bits.
      transcript += String.fromCharCode(byte & 0x7f);
    }
  }
  function until(suffix: string): string {
    const start = transcript.length;
    for (let attempt = 0; attempt < 200_000; attempt++) {
      advance(1);
      if (transcript.slice(start).endsWith(suffix)) return transcript.slice(start);
    }
    assert.fail(`No ${JSON.stringify(suffix)} after ${steps} steps; PC=${session.machine.cpu.snapshot().pc.toString(16)}; output=${JSON.stringify(transcript)}`);
  }
  function send(text: string): void { session.send(Buffer.from(text, "ascii")); }
  function command(text: string): string { send(text + "\r"); return until("OK\r\r\n"); }
  function enterLine(text: string): void {
    send(text + "\r");
    assert.equal(until("\r\n"), text + "\r\n");
    // Echo precedes storage/editing. Allow that work to finish before the next line;
    // this is a bounded test pause, not a timing or prompt detector in the session.
    const start = transcript.length;
    advance(10_000);
    assert.equal(transcript.slice(start), "");
    assert.equal(session.pendingInput, 0);
    assert.equal(session.machine.serial.snapshot().full, false);
  }

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
  assert.equal(session.tapePosition, tape.length);
  assert.equal(session.pendingInput, 0);
  assert.equal(machine.serial.snapshot().full, false);
  assert.ok(output.some(byte => byte > 127), "The terminal conversion does not hide an eight-bit device limitation");

  // Enter out of order: LIST must sort the stored lines, not repeat an input log.
  for (const line of ["50 END", "20 FOR I=1 TO N", "10 INPUT N", "110 RETURN", "30 GOSUB 100", "40 NEXT I", "100 PRINT I*2"]) enterLine(line);
  assert.equal(command("LIST"), "LIST\r\n\r\n10 INPUT N\r\n20 FOR I=1 TO N\r\n30 GOSUB 100\r\n40 NEXT I\r\n50 END\r\n100 PRINT I*2\r\n110 RETURN\r\r\nOK\r\r\n");
  send("RUN\r"); assert.equal(until("? "), "RUN\r\n? ");
  send("3\r"); assert.equal(until("OK\r\r\n"), "3\r\n 2 \r\n 4 \r\n 6 \r\n\r\r\nOK\r\r\n");

  enterLine("100 PRINT I*3");
  enterLine("110");
  assert.equal(command("LIST"), "LIST\r\n\r\n10 INPUT N\r\n20 FOR I=1 TO N\r\n30 GOSUB 100\r\n40 NEXT I\r\n50 END\r\n100 PRINT I*3\r\r\nOK\r\r\n");
  enterLine("110 RETURN");
  send("RUN\r"); assert.equal(until("? "), "RUN\r\n? ");
  send("3\r"); assert.equal(until("OK\r\r\n"), "3\r\n 3 \r\n 6 \r\n 9 \r\n\r\r\nOK\r\r\n");

  // MITS manual pp. 41–42: underscore/backarrow erases a character; @ cancels a line.
  assert.equal(command("PRINT 40+9_2"), "PRINT 40+9_2\r\n 42 \r\n\r\r\nOK\r\r\n");
  assert.equal(command("PRINT 99@PRINT 6*7"), "PRINT 99@\r\nPRINT 6*7\r\n 42 \r\n\r\r\nOK\r\r\n");
  assert.equal(command("NEW"), "NEW\r\n\r\r\nOK\r\r\n");
  assert.equal(command("LIST"), "LIST\r\n\r\r\nOK\r\r\n");

  enterLine("10 GOTO 10");
  send("RUN\r"); assert.equal(until("RUN\r\n"), "RUN\r\n");
  advance(2000);
  session.stop();
  const ramImage = () => Array.from({ length: machine.ram.size }, (_, address) => machine.ram.read(address));
  const paused = { cpu: machine.cpu.snapshot(), serial: machine.serial.snapshot(), ram: ramImage() };
  assert.deepEqual(session.run(2000), { records: [], stopReason: "paused" });
  assert.deepEqual({ cpu: machine.cpu.snapshot(), serial: machine.serial.snapshot(), ram: ramImage() }, paused);
  session.start();
  const start = transcript.length;
  advance(2000);
  assert.equal(transcript.slice(start), "", "Host STOP/resume must not send BASIC a break");
  send("\x03");
  assert.equal(until("OK\r\r\n"), "\r\r\nOK\r\r\n");
  assert.equal(command("PRINT 1+1"), "PRINT 1+1\r\n 2 \r\n\r\r\nOK\r\r\n");

  const loaded = ramImage();
  session.send([42]);
  session.reset();
  assert.equal(session.running, false);
  assert.equal(session.pendingInput, 0);
  assert.equal(machine.cpu.snapshot().pc, 0);
  assert.equal(machine.serial.snapshot().control, 3);
  assert.equal(machine.sense.read(0), 12);
  assert.deepEqual(ramImage(), loaded, "Machine reset does not reconstruct or erase BASIC");
  session.reload(tape);
  assert.notStrictEqual(session.machine, machine);
  assert.equal(session.machine.ram.read(0), 0x3e, "Reload restores the declared panel bootstrap");
  assert.equal(session.machine.sense.read(0), 0);
  assert.equal(session.tapePosition, 0);
  session.machine.sense.offer(12);
  session.start();
  assert.equal(until("MEMORY SIZE?"), "\r\nMEMORY SIZE?", "A fresh tape reload reaches initialization again");
});
