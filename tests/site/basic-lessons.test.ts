import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { basicDisplay, parseBasicLesson } from "../../site/basic-lesson.js";
import type { BasicTurn } from "../../site/basic-lesson.js";
import { readBasicTape } from "../../site/interactive/altair-basic-media.js";
import { createSerialExecution } from "../../site/interactive/serial-execution.js";
import { createSerialTerminal, terminalInput } from "../../site/interactive/serial-terminal.js";
import { create8080AltairBasic } from "../../src/machines/generated/8080/altair-basic.js";
import { SerialSession } from "../../src/runtime/serial-session.js";
import { readBasicSession, saveBasicSession } from "../../site/interactive/altair-basic-session.js";
import type { BasicSession } from "../../site/interactive/altair-basic-session.js";

const directory = "site/content/basic", tapePath = process.env.ALTAIR_BASIC_TAPE;
const media = JSON.parse(readFileSync("src/machines/8080/altair-basic.md", "utf8").match(/^```json\n(.*?)^```/ms)![1]!);
for (const file of readdirSync(directory).filter(name => name.endsWith(".md")).sort()) {
  const path = `${directory}/${file}`, chapter = parseBasicLesson(readFileSync(path, "utf8"), path);
  test(`BASIC lesson: ${chapter.title}`, {
    skip: tapePath === undefined ? "Set ALTAIR_BASIC_TAPE to check the authored transcript" : false,
  }, async () => { await checkLesson(path, chapter.sessions.flat()); });
}

test("BASIC lessons continue through saved sessions while keeping or replacing the preceding program", {
  skip: tapePath === undefined ? "Set ALTAIR_BASIC_TAPE to check lesson continuation" : false,
}, async () => {
  let previous: BasicSession | undefined;
  for (const [slug, skipSetup] of [["your-first-basic-program", false], ["a-program-that-asks-a-question", false],
    ["a-program-that-makes-a-decision", true], ["a-program-that-asks-again", true],
    ["a-program-that-counts", false], ["counting-with-for-and-next", true],
    ["a-program-that-keeps-a-total", true], ["finding-and-fixing-a-mistake", false],
    ["a-ticket-desk-of-your-own", false]] as const) {
    const path = `${directory}/${slug}.md`, chapter = parseBasicLesson(readFileSync(path, "utf8"), path);
    const state = await checkLesson(path, chapter.sessions.slice(skipSetup ? 1 : 0).flat(), previous);
    previous = await readBasicSession(saveBasicSession(state), media);
  }
});

async function checkLesson(path: string, turns: readonly BasicTurn[], previous?: BasicSession): Promise<BasicSession> {
  assert.ok(tapePath);
  const bytes = readFileSync(tapePath);
  const tape = await readBasicTape({ name: tapePath, size: bytes.length, arrayBuffer: async () => Uint8Array.from(bytes).buffer }, media);
  const session = previous?.session ?? new SerialSession(output => create8080AltairBasic({ serial: output }), tape.bytes);
  const terminal = previous?.terminal ?? createSerialTerminal();
  let location = `${path}: loading BASIC`;
  let next: (() => void) | undefined;
  const execution = createSerialExecution(session, {
    schedule(callback) { next = callback; return () => { next = undefined; }; }, output: terminal.write, onChange() {},
  }, previous?.execution);
  function tick(): void {
    const callback = next; next = undefined;
    assert.ok(callback, `${location}: ${execution.error ?? execution.status}\n${terminal.text}`);
    callback();
  }
  function until(expected: string): void {
    for (let count = 0; count < 200; count++) { tick(); if (terminal.text.endsWith(expected)) return; }
    assert.fail(`Missing ${JSON.stringify(expected)}: ${terminal.text}`);
  }
  execution.run();
  if (previous === undefined) {
    session.machine.sense.offer(0x0c);
    until("MEMORY SIZE? "); session.send([13]);
    until("TERMINAL WIDTH? "); session.send([13]);
    until("WANT SIN? "); session.send(terminalInput("Y\n"));
    until("OK\n"); assert.ok(terminal.text.includes("727 BYTES FREE"));
  }

  for (const turn of turns) {
    location = `${path}:${turn.line}: ${turn.input}`;
    terminal.clear(); // Compare each exchange independently of the bounded display's history.
    const expected = basicDisplay(turn.input + "\n" + turn.output);
    session.send(terminalInput(turn.input + "\n"));
    for (let count = 0; count < 200; count++) {
      tick();
      if (basicDisplay(terminal.text) === expected) break;
    }
    // Echo precedes storage. Give the interpreter time to finish the operation,
    // also catching unwanted output for a line declared to have no reply.
    for (let count = 0; count < 5; count++) tick();
    assert.equal(basicDisplay(terminal.text), expected, location);
    assert.equal(session.pendingInput, 0);
    assert.equal(session.machine.serial.snapshot().full, false);
    assert.equal(session.running, true);
  }
  execution.stop();
  return { session, terminal, tape, execution: execution.snapshot(),
    panel: { lowSwitches: 0, open: false, guides: true }, previousPc: session.machine.cpu.snapshot().pc };
}
