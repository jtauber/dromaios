import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { RomImage } from "../../src/machines/rom-image.js";
import { romImages } from "../../src/machines/generated/8088/pc-xt.js";
import { createXtSession } from "../../site/interactive/xt-session.js";
import { createXtDebugger } from "../../site/interactive/xt-debugger.js";
import { renderXtGraphicsFrame, renderXtTextFrame } from "../../src/machines/8088/pc-xt/video.js";
import { expectLastRows, waitingForKey } from "../machines/8088/pc-xt/rom-console.js";

type Session = ReturnType<typeof createXtSession>;
const firmwarePresent = process.env.XT_BIOS_ROM && process.env.XT_BASIC_ROM && process.env.XT_CGA_ROM;
async function firmware() {
  const image = (slot: keyof typeof romImages, path: string) => RomImage.verify(readFileSync(path), romImages[slot],
    async bytes => createHash("sha256").update(bytes).digest("hex"));
  return { bios: await image("bios", process.env.XT_BIOS_ROM!), basic: await image("basic", process.env.XT_BASIC_ROM!),
    font: await image("font", process.env.XT_CGA_ROM!) };
}
function until(session: Session, done: () => boolean, limit = 2_000_000): void {
  for (let i = 0; i < limit; i++) { if (done()) return; session.step(); }
  assert.fail("Original software did not reach the requested call site.");
}
function pendingInterrupt(session: Session): boolean {
  const state = session.machine.cpu.snapshot();
  return session.machine.io.irq && state.flags.if && !state.interruptDeferred && !state.recognitionDeferred;
}

/** Compare both stepping commands with exactly the same ordinary native boundaries. */
function checkCall(session: Session, frameType: string): void {
  const display = () => session.machine.cga.graphicsSupported() ? renderXtGraphicsFrame(session.machine) : renderXtTextFrame(session.machine);
  const start = session.snapshot(), debug = createXtDebugger(() => session.machine);
  debug.over();
  const first = debug.capture(() => session.step()), frame = debug.frames.at(-1);
  assert.equal(frame?.frameType, frameType);
  let boundaries = 1;
  while (!debug.beforeStep()) { debug.capture(() => session.step()); boundaries++; }
  assert.equal(debug.stop?.kind, "over"); assert.equal(debug.frames.length, 0);
  assert.equal(debug.trackingNote, undefined);
  assert.deepEqual(debug.stop.location, { address: frame!.returnAddress, space: frame!.returnSpace });
  const end = session.snapshot(), pixels = display();

  session.restore(start); debug.reset(); debug.step();
  assert.deepEqual(debug.capture(() => session.step()), first);
  assert.equal(debug.frames.length, 1); debug.out();
  let outBoundaries = 1;
  while (!debug.beforeStep()) { debug.capture(() => session.step()); outBoundaries++; }
  assert.equal(debug.stop?.kind, "out"); assert.equal(outBoundaries, boundaries);
  assert.deepEqual(session.snapshot(), end); assert.deepEqual(display(), pixels);

  session.restore(start); debug.reset();
  for (let i = 0; i < boundaries; i++) session.step();
  assert.deepEqual(session.snapshot(), end, "debugging preserves CPU, RAM, devices, keyboard, disk and clock state");
  assert.deepEqual(display(), pixels);
  debug.dispose();
}

test("original BIOS and BASIC calls and interrupts give identical Step over, Step out and ordinary execution", {
  skip: !firmwarePresent && "Set XT_BIOS_ROM, XT_BASIC_ROM and XT_CGA_ROM for original firmware calls.",
}, async () => {
  const session = createXtSession(await firmware()); session.powerOn("quick");
  until(session, () => waitingForKey(session.machine), 8_000_000);
  session.keyboard.paste("PRINT 2+3\n");
  until(session, () => pendingInterrupt(session)); checkCall(session, "interrupt");
  until(session, () => session.machine.cpu.snapshot().pc === 0xfe991); checkCall(session, "near"); // BIOS → FA59
  until(session, () => session.machine.cpu.snapshot().pc === 0xf91ca); checkCall(session, "near"); // BASIC → 54D5
  until(session, () => {
    const pc = session.machine.cpu.snapshot().pc;
    if (pc < 0xf6000 || pendingInterrupt(session)) return false;
    const rom = pc >= 0xfe000 ? session.machine.bios : session.machine.basic, offset = pc - (pc >= 0xfe000 ? 0xfe000 : 0xf6000);
    return rom.read(offset) === 0xcd && rom.read(offset + 1) === 0x10;
  });
  checkCall(session, "interrupt"); // Software INT 10h, distinct from the pending keyboard IRQ above.
  until(session, () => !session.keyboard.queuedBytes && !session.keyboard.pasteRemaining && waitingForKey(session.machine));
  expectLastRows(session.machine, " 5", "Ok");
});

test("Ultima V near/far calls and IRQs preserve the scene and a Down movement when stepped", {
  skip: !(firmwarePresent && process.env.XT_ULTIMA_DEBUGGER_CHECKPOINT)
    && "Set XT firmware paths and XT_ULTIMA_DEBUGGER_CHECKPOINT to the first-party CGA acceptance checkpoint.",
}, async () => {
  const bindings = await firmware(), session = createXtSession({ ...bindings, font: null });
  session.restore(JSON.parse(readFileSync(process.env.XT_ULTIMA_DEBUGGER_CHECKPOINT!, "utf8")));
  session.install("font", bindings.font);
  until(session, () => session.machine.cpu.snapshot().cs === 0x0c6f && session.machine.cpu.snapshot().ip === 0x1d6c, 6_000_000);
  session.keyboard.down("ArrowDown"); session.keyboard.up("ArrowDown");
  until(session, () => pendingInterrupt(session)); checkCall(session, "interrupt");
  until(session, () => session.machine.cpu.snapshot().pc === 0xde04 && !pendingInterrupt(session)); checkCall(session, "far");
  until(session, () => session.machine.cpu.snapshot().pc === 0xdfa4 && !pendingInterrupt(session)); checkCall(session, "near");
  until(session, () => session.machine.ram.read(0x215c7) === 16
    && session.machine.cpu.snapshot().cs === 0x0c6f && session.machine.cpu.snapshot().ip === 0x1d6c);
  assert.deepEqual([0x215c3, 0x215c6, 0x215c7].map(address => session.machine.ram.read(address)), [13, 15, 16]);
});
