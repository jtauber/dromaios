import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { create8080AltairBasic } from "../../src/machines/generated/8080/altair-basic.js";
import { SerialSession } from "../../src/runtime/serial-session.js";
import { createSerialExecution } from "../../site/interactive/serial-execution.js";
import { createSerialTerminal, terminalInput } from "../../site/interactive/serial-terminal.js";

const tapePath = process.env.ALTAIR_BASIC_TAPE;
test("browser batching and terminal run the supplied BASIC tape, program, STOP, break, and reload", {
  skip: tapePath === undefined ? "Set ALTAIR_BASIC_TAPE for the historical BASIC session" : false,
}, () => {
  assert.ok(tapePath);
  const media = JSON.parse(readFileSync("src/machines/8080/altair-basic.md", "utf8").match(/^```json\n(.*?)^```/ms)![1]!);
  const tape = readFileSync(tapePath);
  assert.equal(tape.length, media.bytes);
  assert.equal(createHash("sha256").update(tape).digest("hex"), media.sha256);
  const session = new SerialSession(output => create8080AltairBasic({ serial: output }), tape);
  const terminal = createSerialTerminal();
  let next: (() => void) | undefined;
  const execution = createSerialExecution(session, {
    schedule(callback) { next = callback; return () => { next = undefined; }; }, output: terminal.write, onChange() {},
  });
  function tick(): void { const callback = next; next = undefined; assert.ok(callback); callback(); }
  function until(suffix: string): void {
    for (let count = 0; count < 200; count++) { tick(); if (terminal.text.endsWith(suffix)) return; }
    assert.fail(`No ${suffix}: ${terminal.text}`);
  }
  session.machine.sense.offer(12); execution.run();
  until("MEMORY SIZE? "); session.send([13]);
  until("TERMINAL WIDTH? "); session.send([13]);
  until("WANT SIN? "); session.send(terminalInput("Y\n"));
  until("OK\n"); assert.ok(terminal.text.includes("727 BYTES FREE"));
  for (const line of ["10 FOR I=1 TO 3", "20 PRINT I*2", "30 NEXT I", "40 END"]) {
    session.send(terminalInput(line + "\n"));
    until(line + "\n");
    for (let count = 0; count < 5; count++) tick(); // Let BASIC store the line before another arrives.
  }
  session.send(terminalInput("RUN\n")); until("OK\n");
  assert.ok(terminal.text.endsWith("RUN\n 2 \n 4 \n 6 \n\nOK\n"));
  session.send(terminalInput("NEW\n")); until("OK\n");
  session.send(terminalInput("10 GOTO 10\n")); until("10 GOTO 10\n");
  for (let count = 0; count < 5; count++) tick();
  session.send(terminalInput("RUN\n")); until("RUN\n");
  const stale = next!;
  execution.stop(); const cpu = session.machine.cpu.snapshot(); stale();
  assert.deepEqual(session.machine.cpu.snapshot(), cpu);
  execution.run(); session.send([3]); until("OK\n");
  assert.ok(execution.records.length <= 12);
  execution.clear(); session.reload(tape); terminal.clear();
  session.machine.sense.offer(12); execution.run(); until("MEMORY SIZE? ");
});
