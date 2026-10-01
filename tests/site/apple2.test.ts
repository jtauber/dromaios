import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Apple2Video } from "../../src/components/devices/generated/apple2-video.js";
import { romImages } from "../../src/machines/generated/6502/apple2.js";
import { apple2TextFrame } from "../../site/interactive/apple2-screen.js";
import { createApple2Session, apple2Input, apple2ControlKey } from "../../site/interactive/apple2-session.js";
import { createExecutionController } from "../../site/interactive/execution-controller.js";
import { readRomFile } from "../../site/interactive/rom-file.js";

const romPath = process.env.APPLE2_ROM;
const chapter = readFileSync("src/machines/6502/apple2.md", "utf8");
const container = JSON.parse(chapter.match(/```json\n([\s\S]*?)```/)![1]!);

test("Apple II host input is uppercase ASCII with original editing and break keys", () => {
  assert.deepEqual(apple2Input("print 2+3\r\n"), [..."PRINT 2+3\r"].map(c => c.charCodeAt(0)));
  for (const text of ["one\ntwo", "ß", "é", "🎹"]) assert.throws(() => apple2Input(text));
  const event = { ctrlKey: false, metaKey: false, altKey: false, isComposing: false };
  for (const [key, byte] of [["Backspace", 8], ["ArrowLeft", 8], ["ArrowRight", 21], ["Escape", 27], ["Enter", 13]] as const) {
    assert.equal(apple2ControlKey({ ...event, key }), byte);
    assert.equal(apple2ControlKey({ ...event, key, isComposing: true }), undefined);
  }
  assert.equal(apple2ControlKey({ ...event, key: "c", ctrlKey: true }), 3);
  assert.equal(apple2ControlKey({ ...event, key: "c", metaKey: true }), undefined);
  assert.equal(apple2ControlKey({ ...event, key: "a", ctrlKey: true }), undefined);
});

test("frame inspection reads selected RAM cells without guest I/O and blanks graphics rows", () => {
  const video = new Apple2Video();
  video.write(5, 0); video.write(0, 0); video.write(3, 0);
  const before = video.snapshot(), reads: number[] = [];
  const frame = apple2TextFrame({ read(address) { reads.push(address); return 0x41; } }, video, true);
  assert.equal(reads.length, 160);
  assert.equal(reads[0], 0xa50); assert.equal(reads.at(-1), 0xbf7);
  assert.ok(frame.slice(0, 20).flat().every(cell => cell.character === " " && !cell.inverse));
  assert.ok(frame.slice(20).flat().every(cell => cell.character === "A" && cell.inverse));
  assert.deepEqual(video.snapshot(), before);
});

test("browser Apple II session boots real ROM, pastes BASIC, edits, pauses, breaks, and powers on", {
  skip: romPath === undefined ? "Set APPLE2_ROM to the externally supplied Apple II Plus ROM" : false,
}, async () => {
  assert.ok(romPath);
  const buffer = new Uint8Array(readFileSync(romPath)).buffer;
  const { image } = await readRomFile({ name: "apple2p.rom", size: buffer.byteLength, async arrayBuffer() { return buffer; } }, romImages.firmware, container);
  const session = createApple2Session(image), pending: (() => void)[] = [];
  const execution = createExecutionController({
    step: () => session.step(), canStep: () => true, onChange() {}, batchSize: 2000,
    schedule(callback) { pending.push(callback); return () => {}; },
  });
  function screen(): string {
    return apple2TextFrame(session.machine.ram, session.machine.video, false)
      .map(row => row.map(cell => cell.character).join("").trimEnd()).join("\n").trim();
  }
  function runUntil(ready: () => boolean): void {
    execution.run();
    for (let batch = 0; batch < 200 && !ready(); batch++) pending.shift()!();
    assert.equal(execution.error, undefined);
    assert.ok(ready(), `Condition not reached:\n${screen()}`);
    execution.stop();
  }
  function idle(): boolean {
    const pc = session.machine.cpu.snapshot().pc;
    return session.pendingInput === 0 && !session.machine.keyboard.snapshot().strobe && pc >= 0xfd1b && pc <= 0xfd2f;
  }
  function command(text: string): void { session.send(apple2Input(text + "\n")); runUntil(idle); }
  runUntil(idle);
  assert.match(screen(), /APPLE \]\[/); assert.match(screen(), /\]$/);
  for (const line of ["new", "20 end", "10 print 2+3", "list"]) command(line);
  assert.match(screen(), /\n10\s+PRINT 2\s*\+\s*3\n20\s+END\n/);
  command("run"); assert.match(screen(), /\]RUN\n5\n/);
  session.send([...apple2Input("PRINT 2+9"), 8, ...apple2Input("3\n")]); runUntil(idle);
  assert.match(screen(), /\]PRINT 2\+3\n5\n/);

  session.send(apple2Input("print 1+1\n"));
  const paused = session.machine.snapshot(), queued = session.pendingInput, count = execution.steps;
  for (const callback of pending.splice(0)) callback();
  screen(); assert.deepEqual(session.machine.snapshot(), paused);
  assert.equal(session.pendingInput, queued); assert.equal(execution.steps, count);
  execution.step(); assert.equal(execution.steps, count + 1);
  runUntil(idle); assert.match(screen(), /\]PRINT 1\+1\n2\n/);
  assert.throws(() => session.send([65, 128]), RangeError); assert.equal(session.pendingInput, 0);
  assert.throws(() => session.send(new Array(4097).fill(65)), /queue is full/);
  assert.equal(session.pendingInput, 0);

  for (const line of ["new", "10 goto 10"]) command(line);
  session.send(apple2Input("run\n"));
  const ram = session.machine.ram;
  runUntil(() => session.pendingInput === 0 && ram.read(0x75) === 10 && ram.read(0x76) === 0);
  session.send([3]); runUntil(idle);
  assert.match(screen(), /BREAK IN 10/);
  command("print 1+1"); assert.match(screen(), /\]PRINT 1\+1\n2\n/);

  session.machine.video.read(5); session.machine.keyboard.offer(65); session.send([66]);
  const saved = session.machine.snapshot();
  execution.reset(); session.reset();
  assert.equal(session.pendingInput, 0); assert.equal(session.machine.cpu.snapshot().pc, 0xfa62);
  assert.deepEqual(session.machine.snapshot().ram, saved.ram);
  assert.deepEqual(session.machine.keyboard.snapshot(), saved.keyboard);
  assert.deepEqual(session.machine.video.snapshot(), saved.video);
  const previous = session.machine;
  execution.reset(); session.powerOn();
  assert.notEqual(session.machine, previous);
  assert.equal(session.machine.ram.read(0x801), 0);
  assert.deepEqual(session.machine.keyboard.snapshot(), { key: 0, strobe: false });
  assert.deepEqual(session.machine.video.snapshot(), { text: true, mixed: false, page2: false, hires: false });
  runUntil(idle); assert.match(screen(), /APPLE \]\[/);
});
