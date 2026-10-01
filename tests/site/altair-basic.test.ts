import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { create8080AltairBasic } from "../../src/machines/generated/8080/altair-basic.js";
import { SerialSession } from "../../src/runtime/serial-session.js";
import { createAltairMachinePanel } from "../../site/interactive/altair-machine-panel.js";
import { describeBasicTape, readBasicTape } from "../../site/interactive/altair-basic-media.js";
import { createSerialExecution } from "../../site/interactive/serial-execution.js";
import { createSerialTerminal, terminalInput } from "../../site/interactive/serial-terminal.js";

const tapePath = process.env.ALTAIR_BASIC_TAPE;
test("browser batching and terminal run the supplied BASIC tape, program, STOP, break, and reload", {
  skip: tapePath === undefined ? "Set ALTAIR_BASIC_TAPE for the historical BASIC session" : false,
}, async () => {
  assert.ok(tapePath);
  const media = JSON.parse(readFileSync("src/machines/8080/altair-basic.md", "utf8").match(/^```json\n(.*?)^```/ms)![1]!);
  const tape = readFileSync(tapePath);
  assert.equal(tape.length, media.bytes);
  assert.equal(createHash("sha256").update(tape).digest("hex"), media.sha256);
  const verified = await readBasicTape({ name: "4k-basic-3-2.tap", size: tape.length, arrayBuffer: async () => Uint8Array.from(tape).buffer }, media);
  const session = new SerialSession(output => create8080AltairBasic({ serial: output }), verified.bytes);
  const terminal = createSerialTerminal();
  let panel = createAltairMachinePanel(session.machine, () => !session.running);
  function setSwitches(value: number): void {
    for (let bit = 0; bit < 16; bit++) if ((panel.switches ^ value) & (1 << bit)) panel.toggleSwitch(bit);
  }
  let next: (() => void) | undefined;
  const execution = createSerialExecution(session, {
    schedule(callback) { next = callback; return () => { next = undefined; }; }, output: terminal.write, onChange() {},
  });
  function tick(): void { const callback = next; next = undefined; assert.ok(callback); callback(); }
  function until(suffix: string): void {
    for (let count = 0; count < 200; count++) { tick(); if (terminal.text.endsWith(suffix)) return; }
    assert.fail(`No ${suffix}: ${terminal.text}`);
  }
  function command(line: string): string {
    const start = terminal.text.length;
    session.send(terminalInput(line + "\n")); until("OK\n");
    return terminal.text.slice(start);
  }
  function enterLine(line: string): void {
    const start = terminal.text.length;
    session.send(terminalInput(line + "\n")); until(line + "\n");
    for (let count = 0; count < 5; count++) tick(); // Let BASIC store the line before another arrives.
    assert.equal(terminal.text.slice(start), line + "\n", "Storing a line echoes it without executing it or printing OK");
  }
  setSwitches(0x0c00); execution.run();
  until("MEMORY SIZE? "); session.send([13]);
  until("TERMINAL WIDTH? "); session.send([13]);
  until("WANT SIN? "); session.send(terminalInput("Y\n"));
  until("OK\n"); assert.ok(terminal.text.includes("727 BYTES FREE"));
  execution.stop();
  const ready = session.machine.cpu.snapshot(), records = execution.records;
  setSwitches(0x0fff); panel.examine();
  assert.equal(panel.data, session.machine.ram.read(0xfff));
  panel.examineNext(); assert.equal(panel.data, 0xff);
  setSwitches(ready.pc); panel.examine(); setSwitches(0x0c00);
  assert.deepEqual(session.machine.cpu.snapshot(), ready);
  assert.equal(execution.records, records); // Panel actions do not invent CPU execution records.
  execution.run();

  // "Your first BASIC program": immediate commands, stored lines, LIST, repeated RUN, and replacement.
  assert.equal(command("PRINT 2+3"), "PRINT 2+3\n 5 \n\nOK\n");
  assert.equal(command("PRINT 2+8"), "PRINT 2+8\n 10 \n\nOK\n");
  for (const line of ['10 PRINT "HELLO"', "20 PRINT 2+3", "30 END"]) enterLine(line);
  assert.equal(command("LIST"), 'LIST\n\n10 PRINT "HELLO"\n20 PRINT 2+3\n30 END\nOK\n');
  for (let count = 0; count < 2; count++) assert.equal(command("RUN"), "RUN\nHELLO\n 5 \n\nOK\n");
  enterLine("20 PRINT 2+8");
  assert.equal(command("LIST"), 'LIST\n\n10 PRINT "HELLO"\n20 PRINT 2+8\n30 END\nOK\n');
  assert.equal(command("RUN"), "RUN\nHELLO\n 10 \n\nOK\n");
  enterLine('10 PRINT "HI"');
  assert.equal(command("RUN"), "RUN\nHI\n 10 \n\nOK\n");
  command("NEW");

  for (const line of ["10 FOR I=1 TO 3", "20 PRINT I*2", "30 NEXT I", "40 END"]) enterLine(line);
  session.send(terminalInput("RUN\n")); until("OK\n");
  assert.ok(terminal.text.endsWith("RUN\n 2 \n 4 \n 6 \n\nOK\n"));
  session.send(terminalInput("NEW\n")); until("OK\n");
  enterLine("10 GOTO 10");
  session.send(terminalInput("RUN\n")); until("RUN\n");
  const stale = next!;
  execution.stop(); const cpu = session.machine.cpu.snapshot(); stale();
  assert.deepEqual(session.machine.cpu.snapshot(), cpu);
  execution.run(); session.send([3]); until("OK\n");
  assert.ok(execution.records.length <= 12);
  execution.clear();
  const loadedMachine = session.machine, beforeReset = terminal.text;
  session.send(terminalInput("PRINT 123")); session.reset();
  assert.equal(session.machine, loadedMachine);
  assert.equal(session.pendingInput, 0);
  assert.equal(session.tapeLength, 0);
  assert.equal(terminal.text, beforeReset);
  assert.match(describeBasicTape(verified, session.tapePosition, session.tapeLength), /tape ejected by reset/);
  session.reload(verified.bytes); terminal.clear();
  assert.match(describeBasicTape(verified, session.tapePosition, session.tapeLength), /0 \/ 4,352 bytes offered/);
  panel = createAltairMachinePanel(session.machine, () => !session.running);
  assert.equal(panel.switches, 0);
  setSwitches(0x0c00); execution.run(); until("MEMORY SIZE? ");
});
