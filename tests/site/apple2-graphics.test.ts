import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Apple2Video } from "../../src/components/devices/generated/apple2-video.js";
import { romImages } from "../../src/machines/generated/6502/apple2.js";
import { literateBlocks } from "../../src/literate.js";
import { apple2HiresFrame, apple2LoresFrame, apple2TextFrame } from "../../site/interactive/apple2-screen.js";
import { createApple2Session, apple2Input } from "../../site/interactive/apple2-session.js";
import { readRomFile } from "../../site/interactive/rom-file.js";

test("high-resolution frames capture only visible bytes and preserve page and mode state", () => {
  const video = new Apple2Video({ text: false, mixed: true, page2: true, hires: true });
  const before = video.snapshot(), reads: number[] = [];
  const ram = { read(address: number) {
    reads.push(address);
    return address === 0x4000 ? 0x40 : address === 0x4001 ? 0x81 : 0;
  } };
  const frame = apple2HiresFrame(ram, video);
  assert.equal(frame.length, 192);
  assert.equal(reads.length, 6400);
  assert.equal(new Set(reads).size, 6400);
  assert.deepEqual(reads.slice(0, 40), Array.from({ length: 40 }, (_, column) => 0x4000 + column));
  assert.equal(reads[40], 0x4400); assert.equal(reads.at(-1), 0x5df7);
  assert.deepEqual(frame[0], Array.from({ length: 140 }, (_, pair) => pair === 3 ? 3 : 0));
  assert.ok(frame.slice(160).every(row => row === undefined));
  assert.deepEqual(video.snapshot(), before);
  video.write(2, 0); reads.length = 0;
  assert.equal(apple2HiresFrame(ram, video)[191]!.length, 140);
  assert.equal(reads.length, 7680); assert.equal(reads.at(-1), 0x5ff7);
  video.write(4, 0);
  assert.ok(apple2HiresFrame(ram, video).every(row => row!.every(colour => colour === 0)));
  for (const address of [6, 1]) {
    video.read(address); reads.length = 0;
    assert.ok(apple2HiresFrame(ram, video).every(row => row === undefined));
    assert.deepEqual(reads, []);
  }
});

const romPath = process.env.APPLE2_ROM;
test("the published high-resolution program draws through real Applesoft and survives page changes", {
  skip: romPath === undefined ? "Set APPLE2_ROM to the externally supplied Apple II Plus ROM" : false,
}, async () => {
  assert.ok(romPath);
  const chapter = readFileSync("src/machines/6502/apple2.md", "utf8");
  const container = JSON.parse(chapter.match(/```json\n([\s\S]*?)```/)![1]!);
  const buffer = new Uint8Array(readFileSync(romPath)).buffer;
  const { image } = await readRomFile({ name: "apple2p.rom", size: buffer.byteLength, async arrayBuffer() { return buffer; } }, romImages.firmware, container);
  const session = createApple2Session(image), { ram, video } = session.machine;
  const screen = () => apple2TextFrame(ram, video, false).map(row => row.map(cell => cell.character).join("")).join("\n");
  function waitForInput(): void {
    for (let batch = 0; batch < 1000; batch++) {
      for (let step = 0; step < 2000; step++) session.step();
      const pc = session.machine.cpu.snapshot().pc;
      if (session.pendingInput === 0 && !session.machine.keyboard.snapshot().strobe && pc >= 0xfd1b && pc <= 0xfd2f) return;
    }
    assert.fail(`No Applesoft prompt:\n${screen()}`);
  }
  const command = (text: string): void => { session.send(apple2Input(text + "\n")); waitForInput(); };
  waitForInput();
  const examples = literateBlocks(chapter, "basic", line => { throw new Error(`Unclosed BASIC fence at ${line}`); });
  assert.equal(examples.length, 2);
  command("NEW");
  for (const line of examples[1]!.lines) command(line.text);
  command("RUN");
  assert.match(screen(), /HIGH RESOLUTION/);
  assert.deepEqual(video.snapshot(), { text: false, mixed: true, page2: false, hires: true });
  const expected = Array.from({ length: 192 }, (_, row) => row >= 160 ? undefined :
    Array.from({ length: 140 }, (_, pair) => {
      const band = Math.floor(row / 20);
      return band >= 1 && band <= 6 && row % 20 < 8 && pair >= 7 && pair <= 132 && band !== 4 ? band : 0;
    }));
  assert.deepEqual(apple2HiresFrame(ram, video), expected);
  // The first scan line of each band, transcribed separately from the decoder's address arithmetic.
  for (const [base, evenByte, oddByte] of [
    [0x3100, 0x2a, 0x55], [0x2280, 0x55, 0x2a], [0x3380, 0x7f, 0x7f],
    [0x2128, 0x80, 0x80], [0x3228, 0xaa, 0xd5], [0x23a8, 0xd5, 0xaa],
  ] as const) {
    assert.deepEqual(Array.from({ length: 40 }, (_, column) => ram.read(base + column)),
      Array.from({ length: 40 }, (_, column) => column < 2 || column >= 38 ? 0 : column % 2 === 0 ? evenByte : oddByte));
  }
  const firstPage = Array.from({ length: 0x2000 }, (_, offset) => ram.read(0x2000 + offset));
  command("HGR2");
  assert.deepEqual(video.snapshot(), { text: false, mixed: false, page2: true, hires: true });
  assert.ok(apple2HiresFrame(ram, video).every(row => row!.every(colour => colour === 0)));
  command("HCOLOR=3"); command("HPLOT 0,191 TO 279,191");
  assert.deepEqual(apple2HiresFrame(ram, video)[191], new Array(140).fill(3));
  assert.deepEqual(Array.from({ length: 40 }, (_, column) => ram.read(0x5fd0 + column)), new Array(40).fill(0x7f));
  assert.deepEqual(Array.from({ length: 0x2000 }, (_, offset) => ram.read(0x2000 + offset)), firstPage);
  const before = session.machine.snapshot();
  apple2HiresFrame(ram, video); apple2LoresFrame(ram, video); screen();
  assert.deepEqual(session.machine.snapshot(), before);
  command("POKE 49235,0");
  assert.ok(apple2HiresFrame(ram, video).slice(160).every(row => row === undefined));
  command("POKE 49236,0");
  assert.deepEqual(apple2HiresFrame(ram, video), expected);
  command("TEXT");
  assert.ok(apple2HiresFrame(ram, video).every(row => row === undefined));
  assert.ok(apple2LoresFrame(ram, video).every(row => row === undefined));
  command("RUN");
  assert.match(screen(), /HIGH RESOLUTION/);
  assert.deepEqual(apple2HiresFrame(ram, video), expected);
});
