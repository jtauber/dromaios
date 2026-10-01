import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { create8080AltairBasic } from "../../src/machines/generated/8080/altair-basic.js";
import { SerialSession } from "../../src/runtime/serial-session.js";
import { createSerialTerminal, terminalInput } from "../../site/interactive/serial-terminal.js";
import { readBasicTape } from "../../site/interactive/altair-basic-media.js";
import { basicSessionStorage, readBasicSession, saveBasicSession } from "../../site/interactive/altair-basic-session.js";
import type { BasicSession } from "../../site/interactive/altair-basic-session.js";

const media = JSON.parse(readFileSync("src/machines/8080/altair-basic.md", "utf8").match(/^```json\n(.*?)^```/ms)![1]!);
function fresh(): BasicSession {
  return { session: new SerialSession(output => create8080AltairBasic({ serial: output })),
    terminal: createSerialTerminal(), panel: { lowSwitches: 0xa5, open: false, guides: false },
    execution: { steps: 123 }, previousPc: 0x1234 };
}

test("BASIC checkpoints preserve stopped hardware, terminal cursor, panel choices, queues, and errors", async () => {
  const state = fresh();
  state.session.machine.cpu.step();
  state.session.machine.sense.offer(12);
  state.session.machine.ram.write(0xfff, 42);
  state.session.send([65, 13]);
  state.terminal.write([...Buffer.from("HELLO\rX")]);
  const saved = saveBasicSession({ ...state, execution: { steps: 456, error: "device failed" } });
  const restored = await readBasicSession(saved, media);
  assert.equal(restored.session.running, false);
  assert.deepEqual(restored.session.machine.snapshot(), state.session.machine.snapshot());
  assert.deepEqual(restored.session.snapshotTransport(), state.session.snapshotTransport());
  assert.deepEqual(restored.terminal.snapshot(), state.terminal.snapshot());
  assert.deepEqual(restored.panel, state.panel);
  assert.equal(restored.previousPc, state.previousPc);
  assert.deepEqual(restored.execution, { steps: 456, error: "device failed" });
  state.session.start();
  assert.throws(() => saveBasicSession(state), /Stop BASIC/);
  restored.session.reload();
  assert.deepEqual(restored.session.machine.snapshot(), fresh().session.machine.snapshot());
});

test("invalid or incompatible saved sessions cannot produce partially restored machines", async () => {
  const saved = JSON.parse(saveBasicSession(fresh()));
  for (const invalid of [null, {}, { ...saved, version: 2 }, { ...saved, machine: undefined },
    { ...saved, panel: { ...saved.panel, lowSwitches: 256 } }, { ...saved, previousPc: -1 },
    { ...saved, execution: {} }, { ...saved, terminal: undefined },
    { ...saved, transport: { ...saved.transport, tapePosition: 1 } },
    { ...saved, transport: { ...saved.transport, input: Array(4097).fill(0) } },
    { ...saved, tape: { name: "wrong", bytes: [1] } },
    { ...saved, tape: { name: "wrong", bytes: Array(media.bytes).fill(0) } }]) {
    await assert.rejects(readBasicSession(JSON.stringify(invalid), media));
  }
  await assert.rejects(readBasicSession("{", media));
  await assert.rejects(readBasicSession(" ".repeat(250001), media));
});

test("tab storage isolates paths and removes stale state when the latest save fails", () => {
  const values = new Map<string, string>();
  let fail = false;
  const storage = { getItem: (key: string) => values.get(key) ?? null,
    setItem(key: string, value: string) { if (fail) throw new Error("Quota exceeded"); values.set(key, value); },
    removeItem(key: string) { values.delete(key); } };
  const first = basicSessionStorage(() => storage, "/learn/"), second = basicSessionStorage(() => storage, "/demo/learn/");
  first.write("old"); second.write("independent");
  first.write("latest"); assert.equal(first.read(), "latest");
  fail = true;
  assert.throws(() => first.write("unsaved"), /Quota/);
  assert.equal(first.read(), null);
  assert.equal(second.read(), "independent");
  const denied = basicSessionStorage(() => { throw new Error("Storage denied"); }, "/learn/");
  assert.throws(denied.read, /Storage denied/);
  assert.throws(() => denied.write("x"), /Storage denied/);
});

const tapePath = process.env.ALTAIR_BASIC_TAPE;
test("the original BASIC tape resumes mid-load and at INPUT, keeps its program, then starts fresh", {
  skip: tapePath === undefined ? "Set ALTAIR_BASIC_TAPE to check session continuation" : false,
}, async () => {
  assert.ok(tapePath);
  const bytes = Uint8Array.from(readFileSync(tapePath));
  const tape = await readBasicTape({ name: "BASIC.tap", size: bytes.length, arrayBuffer: async () => bytes.buffer }, media);
  let state: BasicSession = { ...fresh(), tape };
  state.session.reload(tape.bytes); state.session.machine.sense.offer(12);
  function tick(): void { state.session.run(2000); state.terminal.write(state.session.drainOutput()); }
  function until(suffix: string): void {
    for (let count = 0; count < 200; count++) { tick(); if (state.terminal.text.endsWith(suffix)) return; }
    assert.fail(`Missing ${suffix}: ${state.terminal.text}`);
  }
  async function navigate(): Promise<void> {
    state.session.stop();
    const saved = saveBasicSession(state);
    const restored = await readBasicSession(saved, media);
    assert.equal(restored.session.running, false);
    assert.deepEqual(restored.session.machine.snapshot(), state.session.machine.snapshot());
    assert.deepEqual(restored.session.snapshotTransport(), state.session.snapshotTransport());
    assert.deepEqual(restored.terminal.snapshot(), state.terminal.snapshot());
    state = restored;
  }
  state.session.start(); tick();
  assert.ok(state.session.tapePosition > 0 && state.session.tapePosition < tape.bytes.length);
  await navigate(); state.session.start();
  until("MEMORY SIZE? "); state.session.send([13]);
  until("TERMINAL WIDTH? "); state.session.send([13]);
  until("WANT SIN? "); state.session.send(terminalInput("Y\n"));
  until("OK\n");
  for (const line of ["10 INPUT N", "20 PRINT N*2", "30 END"]) {
    state.session.send(terminalInput(line + "\n")); until(line + "\n");
    for (let count = 0; count < 5; count++) tick();
  }
  state.session.send(terminalInput("RUN\n")); until("? ");
  await navigate(); state.session.start();
  state.session.send(terminalInput("3\n"));
  state.session.run(1); state.terminal.write(state.session.drainOutput());
  assert.equal(state.session.pendingInput, 1, "One byte has been offered; the rest remains queued");
  await navigate(); state.session.start(); until("OK\n");
  assert.ok(state.terminal.text.endsWith("? 3\n 6 \n\nOK\n"));
  state.session.send(terminalInput("LIST\n")); until("OK\n");
  assert.ok(state.terminal.text.endsWith("10 INPUT N\n20 PRINT N*2\n30 END\nOK\n"));
  state.session.reset(); await navigate();
  assert.equal(state.session.tapeLength, 0);
  assert.equal(state.tape!.bytes.length, media.bytes, "Reset ejects the attached tape but retains the verified file");
  state.session.reload(state.tape!.bytes); state.terminal.clear();
  assert.equal(state.session.machine.sense.snapshot().switches, 0);
  state.session.machine.sense.offer(12); state.session.start(); until("MEMORY SIZE? ");
});
