import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { create6502Apple2, romImages } from "../../src/machines/generated/6502/apple2.js";
import { Dos33Disk } from "../../src/components/devices/dos33-disk.js";
import { readApple2Rom, readApple2Disk } from "../../site/interactive/apple2-media.js";
import type { Apple2Media } from "../../site/interactive/apple2-media.js";
import { createApple2Session, apple2Input } from "../../site/interactive/apple2-session.js";
import { encodeApple2SavedState, prepareApple2SavedState } from "../../site/interactive/apple2-saved-state.js";

const media: Apple2Media = JSON.parse(readFileSync("src/machines/6502/apple2.md", "utf8").match(/```json\n([\s\S]*?)```/)![1]!);
function file(bytes: Uint8Array, name = "local file") {
  const buffer = new Uint8Array(bytes).buffer;
  return { name, size: buffer.byteLength, async arrayBuffer() { return buffer; } };
}
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

test("Apple II media checks whole containers, bootstrap slices, and selected disk identity before replacement", async () => {
  const bytes = new Uint8Array(20480);
  bytes.fill(0xa5, 1536, 1792); bytes.fill(0x42, 8192);
  const expected = { size: 12288, sha256: hash(bytes.subarray(8192)) };
  const synthetic: Apple2Media = { ...media, sha256: hash(bytes), bootstrap: { ...media.bootstrap, sha256: hash(bytes.subarray(1536, 1792)) } };
  const rom = await readApple2Rom(file(bytes), expected, synthetic);
  assert.equal(rom.image.createRom(expected).read(0), 0x42);
  assert.deepEqual(rom.bootstrap, new Array(256).fill(0xa5));
  assert.ok(Object.isFrozen(rom.bootstrap));
  assert.equal((await readApple2Rom(file(bytes.subarray(8192)), expected, synthetic)).bootstrap, undefined);
  await assert.rejects(readApple2Rom(file(bytes), expected, { ...synthetic, bootstrap: { ...synthetic.bootstrap, sha256: "0".repeat(64) } }), /bootstrap/);
  await assert.rejects(readApple2Rom(file(bytes), expected, { ...synthetic, bootstrap: { ...synthetic.bootstrap, offset: 20400 } }), /layout/);
  bytes[0] = 1; // Unmapped container bytes must still be authenticated.
  await assert.rejects(readApple2Rom(file(bytes), expected, synthetic), /SHA-256/);
  await assert.rejects(readApple2Disk(file(new Uint8Array(1)), media.disk), /143,360/);
  await assert.rejects(readApple2Disk(file(new Uint8Array(143360)), media.disk), /System Master/);
  const diskBytes = new Uint8Array(143360), selected = await readApple2Disk(file(diskBytes), { bytes: 143360, sha256: hash(diskBytes) });
  diskBytes[0] = 255; assert.equal(selected.disk.snapshot()[0], 0);
  assert.ok(selected.systemMaster);
  for (const mode of ["read-only", "writable-copy"] as const) {
    const local = await readApple2Disk(file(diskBytes, "answer.dsk"), media.disk, mode);
    assert.equal(local.systemMaster, false);
    assert.equal(local.disk.writable, mode === "writable-copy");
    assert.deepEqual(local.disk.exportImage(), diskBytes);
    await assert.rejects(readApple2Disk(file(diskBytes.subarray(1)), media.disk, mode), /143,360/);
  }
});

/** Drive DOS through the keyboard and observe its output in page-one text RAM. */
function dosTerminal(session: ReturnType<typeof createApple2Session>) {
  const { machine } = session;
  // Independent Apple II page-one text rows, rather than the production video decoder.
  const rows = [0x400, 0x480, 0x500, 0x580, 0x600, 0x680, 0x700, 0x780,
    0x428, 0x4a8, 0x528, 0x5a8, 0x628, 0x6a8, 0x728, 0x7a8,
    0x450, 0x4d0, 0x550, 0x5d0, 0x650, 0x6d0, 0x750, 0x7d0];
  function screen(): string {
    return rows.map(start => Array.from({ length: 40 }, (_, column) => {
      const code = machine.ram.read(start + column) & 0x3f;
      return String.fromCharCode(code < 32 ? code + 64 : code);
    }).join("").trimEnd()).join("\n").trim();
  }
  function waitForInput(limit = 10_000_000): void {
    let polls = 0;
    for (let steps = 0; steps < limit; steps++) {
      const record = session.step();
      assert.equal(record.outcome, "executed");
      // Start counting only after the final queued key has been acknowledged: KEYIN
      // still has to return that key to BASIC before it can execute the command.
      if (record.accesses.some(access => access.kind === "read" && access.address >= 0xc000 && access.address < 0xc010)) {
        polls = session.pendingInput || machine.keyboard.snapshot().strobe ? 0 : polls + 1;
      }
      if (polls >= 10 && session.pendingInput === 0 && !machine.keyboard.snapshot().strobe && record.after.pc >= 0xfd1b && record.after.pc <= 0xfd2f) return;
    }
    assert.fail(`No keyboard wait at PC ${machine.cpu.snapshot().pc.toString(16)}:\n${screen()}`);
  }
  function command(text: string, limit?: number): string {
    session.send(apple2Input(text + "\n")); waitForInput(limit); return screen();
  }
  const prompt = () => machine.ram.read(0x24) === 1 && (machine.ram.read(rows[machine.ram.read(0x25)]!) & 0x7f) === 0x5d;
  function cataloguePages(): string[] {
    const pages = [command("CATALOG")];
    while (!prompt() && pages.length < 5) pages.push(command(""));
    assert.ok(prompt(), "Catalogue pagination must finish before the next command");
    return pages;
  }
  function bootToPrompt(): void {
    waitForInput(60_000_000);
    assert.match(screen(), /DOS VERSION 3\.3\s+08\/25\/80/);
    assert.match(screen(), /LOADING INTEGER INTO LANGUAGE CARD/);
    assert.ok(prompt());
  }
  return { command, screen, cataloguePages, bootToPrompt };
}

const romPath = process.env.APPLE2_ROM, diskPath = process.env.APPLE2_DISK;
test("native Disk II boots DOS, runs BASIC, and distinguishes protected and writable media", {
  skip: romPath === undefined || diskPath === undefined ? "Set APPLE2_ROM (20 KiB container) and APPLE2_DISK to the selected local media" : false,
}, async t => {
  assert.ok(romPath); assert.ok(diskPath);
  const rom = await readApple2Rom(file(readFileSync(romPath)), romImages.firmware, media);
  const bootstrap = rom.bootstrap;
  assert.ok(bootstrap, "Disk acceptance needs the container's slot-6 bootstrap");
  const selected = await readApple2Disk(file(readFileSync(diskPath)), media.disk);
  const session = createApple2Session(rom.image, { bootstrap, image: selected.disk });
  const machine = session.machine, terminal = dosTerminal(session);
  const { command, screen } = terminal;
  const original = machine.disk.snapshot().media;
  await t.test("bootstrap continues identically after restoring a Disk II read", () => {
    for (let i = 0; i < 1_000_000; i++) {
      const record = session.step();
      assert.equal(record.outcome, "executed");
      if (!record.accesses.some(access => access.kind === "read" && access.address === 0xc0ec)) continue;
      const saved = machine.snapshot(), resumed = create6502Apple2({ firmware: rom.image }, saved);
      screen(); machine.disk.inspect(); assert.deepEqual(machine.snapshot(), saved);
      for (let step = 0; step < 1000; step++) assert.deepEqual(session.step(), resumed.cpu.step());
      assert.deepEqual(machine.snapshot(), resumed.snapshot());
      return;
    }
    assert.fail("The bootstrap never read the Disk II latch");
  });
  terminal.bootToPrompt();
  const pages = terminal.cataloguePages(), catalogue = pages.join("\n");
  assert.ok(pages.length > 1);
  assert.match(catalogue, /\*A 006 HELLO/); assert.match(catalogue, /\*A 009 COLOR DEMOSOFT/);
  command("NEW"); command("LOAD HELLO"); command("LIST");
  assert.match(screen(), /200\s+VTAB 10/);
  assert.match(screen(), /BLOAD INTBASIC,A\$D000/);
  for (const line of ["NEW", "20 END", "10 PRINT 2+3", "LIST", "RUN"]) command(line);
  assert.match(screen(), /\n10\s+PRINT 2\s*\+\s*3\n20\s+END/);
  assert.match(screen(), /\]RUN\n5\n/);
  command("SAVE TEST"); assert.match(screen(), /WRITE PROTECTED/);
  assert.deepEqual(machine.disk.snapshot().media, original);

  await t.test("DOS runs ANSWER from a fresh export and can save another file on the restored writable disk", async () => {
    const master = selected.disk.exportImage();
    assert.doesNotMatch(catalogue, /\bANSWER$/m);
    const working = await readApple2Disk(file(master, "dos33-master.dsk"), media.disk, "writable-copy");
    machine.disk.insert(working.disk);
    command("NEW"); command("10 PRINT 6*7");
    command("SAVE ANSWER", 20_000_000); // Allocating and saving the new file takes about 13 million instructions.
    const listing = terminal.cataloguePages().join("\n");
    assert.match(listing, /^ *A 002 ANSWER$/m);

    function loadAndRun(dos: ReturnType<typeof dosTerminal>): void {
      dos.command("NEW");
      assert.match(dos.command("LIST"), /\]LIST\n+\]$/);
      dos.command("LOAD ANSWER");
      assert.match(dos.command("LIST"), /\]LIST\n+10\s+PRINT\s*6\s*\*\s*7\n+\]$/);
      assert.match(dos.command("RUN"), /\]RUN\n42\n+\]$/);
    }
    loadAndRun(terminal);
    const exported = machine.disk.exportImage();
    assert.equal(exported.length, Dos33Disk.size);
    assert.notDeepEqual(exported, master);
    assert.deepEqual(selected.disk.exportImage(), master);
    const checkpoint = await encodeApple2SavedState({ machine: "apple2-plus", name: "With ANSWER", diskName: working.name,
      savedAt: new Date().toISOString(), flash: false, state: session.snapshot() });
    session.eject();
    const restored = await prepareApple2SavedState(checkpoint, rom.image, media);
    assert.equal(restored.diskName, working.name);
    assert.deepEqual(restored.session.machine.disk.exportImage(), exported);
    const restoredDos = dosTerminal(restored.session);
    restoredDos.command("SAVE RESTORED", 20_000_000);
    const restoredListing = restoredDos.cataloguePages().join("\n");
    for (const name of ["ANSWER", "RESTORED"]) assert.match(restoredListing, new RegExp(`^ *A 002 ${name}$`, "m"));

    const downloaded = await readApple2Disk(file(exported, "dos33-master-saved.dsk"), media.disk, "read-only");
    const fresh = dosTerminal(createApple2Session(rom.image, { bootstrap, image: downloaded.disk }));
    fresh.bootToPrompt();
    loadAndRun(fresh);
  });

  await t.test("DOS RWTS writes track 18 sector 6, reads it back, and changes only $12600–$126FF in the export", () => {
    const master = selected.disk.exportImage();
    machine.disk.insert(new Dos33Disk(master, { writable: true }));
    const put = (address: number, bytes: ArrayLike<number>) => {
      for (let i = 0; i < bytes.length; i++) machine.ram.write(address + i, bytes[i]!);
    };
    // CALL 768 enters a guest loop: LDA #$03, LDY #$80, JSR RWTS, JMP $0300.
    // Observe each return before the JMP and supply the next request in the same IOB.
    put(0x300, [0xa9, 3, 0xa0, 0x80, 0x20, 0xd9, 3, 0x4c, 0, 3]);
    put(0x380, [1, 0x60, 1, 0, 18, 6, 0xa0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    put(0x3a0, [0, 1, 0xef, 0xd8]); // Device characteristics for a Disk II.
    session.send(apple2Input("CALL 768\n"));
    function rwts(operation: number, bufferPage: number): void {
      machine.ram.write(0x389, bufferPage); machine.ram.write(0x38c, operation);
      for (let i = 0; i < 2_000_000; i++) {
        const { after, outcome } = session.step();
        assert.equal(outcome, "executed");
        if (after.pc === 0x307) {
          assert.equal(after.flags.c, false, `RWTS error ${machine.ram.read(0x38d)}`); return;
        }
      }
      assert.fail("RWTS did not return to the guest caller");
    }
    const payload = Uint8Array.from({ length: 256 }, (_, i) => i ^ 0x53);
    put(0x2000, payload);
    rwts(2, 0x20); // Write from $2000.
    put(0x2100, payload.map(byte => byte ^ 0xff));
    rwts(1, 0x21); // Read into a different buffer through the same DOS entry point.
    const buffer = (address: number) => Uint8Array.from({ length: 256 }, (_, i) => machine.ram.read(address + i));
    assert.deepEqual(buffer(0x2100), payload);

    const expected = master.slice();
    expected.set(payload, 0x12600); // DOS-order file offset: (18 × 16 + 6) × 256.
    const exported = machine.disk.exportImage();
    assert.deepEqual(exported, expected);
    assert.deepEqual(selected.disk.exportImage(), master);
    machine.disk.insert(new Dos33Disk(exported));
    put(0x2200, payload.map(byte => byte ^ 0xff));
    rwts(1, 0x22);
    assert.deepEqual(buffer(0x2200), payload);
  });
  machine.disk.insert(selected.disk);
  const before = machine.disk.snapshot(); session.reset(); assert.deepEqual(machine.disk.snapshot(), before);
  session.powerOn();
  assert.equal(session.machine.disk.inspect().position, 0);
  assert.equal(session.machine.disk.inspect().halfTrack, 0);
  assert.equal(session.machine.disk.inspect().motor, false);
  assert.deepEqual(session.machine.disk.snapshot().media, original);
  session.eject();
  assert.equal(session.machine.disk.inspect().loaded, false);
  session.powerOn(); assert.equal(session.machine.disk.inspect().installed, false, "Fresh power-on without media is ROM-only");
});
