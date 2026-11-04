import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { create6502Apple2, romImages } from "../../src/machines/generated/6502/apple2.js";
import { Dos33Disk } from "../../src/components/devices/dos33-disk.js";
import type { Dos33SectorWrite } from "../../src/components/devices/dos33-disk.js";
import { readApple2Rom, readApple2Disk } from "../../site/interactive/apple2-media.js";
import type { Apple2MemoryChange } from "../../site/interactive/apple2-inspection.js";
import { apple2DebugLocation } from "../../site/interactive/apple2-debugger.js";
import type { Apple2Media } from "../../site/interactive/apple2-media.js";
import { createApple2Session, apple2Input } from "../../site/interactive/apple2-session.js";
import { createDos33ReadTrace } from "../../site/interactive/dos33-reads.js";
import type { Cpu6502StepRecord } from "../../src/components/cpus/generated/6502-cpu.js";
import { encodeApple2SavedState, prepareApple2SavedState } from "../../site/interactive/apple2-saved-state.js";

const chapter = readFileSync("src/machines/6502/apple2.md", "utf8");
const media: Apple2Media = JSON.parse(chapter.match(/```json\n([\s\S]*?)```/)![1]!);
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
  function waitForInput(limit = 10_000_000, observe?: (step: Cpu6502StepRecord) => void): void {
    let polls = 0;
    for (let steps = 0; steps < limit; steps++) {
      const record = session.step();
      assert.equal(record.outcome, "executed");
      observe?.(record);
      // Start counting only after the final queued key has been acknowledged: KEYIN
      // still has to return that key to BASIC before it can execute the command.
      if (record.accesses.some(access => access.kind === "read" && access.address >= 0xc000 && access.address < 0xc010)) {
        polls = session.pendingInput || machine.keyboard.snapshot().strobe ? 0 : polls + 1;
      }
      if (polls >= 10 && session.pendingInput === 0 && !machine.keyboard.snapshot().strobe && record.after.pc >= 0xfd1b && record.after.pc <= 0xfd2f) return;
    }
    assert.fail(`No keyboard wait at PC ${machine.cpu.snapshot().pc.toString(16)}:\n${screen()}`);
  }
  function command(text: string, limit?: number, observe?: (step: Cpu6502StepRecord) => void): string {
    session.send(apple2Input(text + "\n")); waitForInput(limit, observe); return screen();
  }
  const prompt = () => machine.ram.read(0x24) === 1 && (machine.ram.read(rows[machine.ram.read(0x25)]!) & 0x7f) === 0x5d;
  function cataloguePages(): string[] {
    const pages = [command("CATALOG")];
    while (!prompt() && pages.length < 5) pages.push(command(""));
    assert.ok(prompt(), "Catalogue pagination must finish before the next command");
    return pages;
  }
  function bootToPrompt(observe?: (step: Cpu6502StepRecord) => void): void {
    waitForInput(60_000_000, observe);
    assert.match(screen(), /DOS VERSION 3\.3\s+08\/25\/80/);
    assert.match(screen(), /LOADING INTEGER INTO LANGUAGE CARD/);
    assert.ok(prompt());
  }
  return { machine, command, screen, cataloguePages, bootToPrompt, waitForInput };
}

/** The disk-sector bytes and observed CPU writes independently account for the BASIC text. */
function traceAnswer(dos: ReturnType<typeof dosTerminal>, image: Uint8Array, completed: boolean): void {
  const trace = createDos33ReadTrace(), copies: number[][] = [], listing: number[] = [];
  dos.command("NEW");
  dos.command("LOAD ANSWER", undefined, record => {
    trace.observe(dos.machine, record);
    for (const a of record.accesses) {
      if (a.kind === "write" && a.address >= 0x0801 && a.address <= 0x080c && record.before.pc === 0xaca3) {
        copies.push([a.address, a.value]);
        assert.ok(trace.matches({ kind: "write", address: a.address, value: a.value }));
      }
    }
    if (record.after.pc === 0xb093) {
      const read = trace.reads.at(-1)!;
      assert.ok(trace.matches(read));
    }
  });
  const expected = [[17, 0, 0xb3bb], ...[15, 14, 13, 12].map(s => [17, s, 0xb4bb]), [12, 6, 0x9700]];
  if (completed) expected.push([12, 5, 0x9600]);
  assert.deepEqual(trace.reads.map(r => [r.track, r.sector, r.buffer]), expected);
  for (const r of trace.reads) {
    const offset = (r.track * 16 + r.sector) * 256;
    assert.deepEqual(r.bytes, [...image.slice(offset, offset + 256)]);
    assert.equal(trace.matches(r), false, "Returning to the prompt expires a read stop");
  }
  assert.deepEqual(trace.reads[5]!.bytes.slice(12, 14), completed ? [12, 5] : [0, 0]);
  const payload = [...image.slice(0xc502, 0xc50e)];
  assert.deepEqual(copies, completed ? payload.map((b, i) => [0x0801 + i, b]) : []);
  const program = (length: number) => Array.from({ length }, (_, i) => dos.machine.ram.read(0x0801 + i));
  assert.deepEqual(program(completed ? 12 : 2), completed ? payload : [0, 0]);
  const text = dos.command("LIST", undefined, record => {
    trace.observe(dos.machine, record);
    if (record.after.pc === (completed ? 0xd715 : 0xd6de)
      && trace.matches({ kind: "read", address: completed ? 0x0805 : 0x0802, value: completed ? 0xba : 0 })) listing.push(record.after.pc);
  });
  assert.equal(listing.length, 1);
  assert.match(text, completed ? /\]LIST\n+10\s+PRINT\s*6\s*\*\s*7\n+\]$/ : /\]LIST\n+\]$/);
  assert.match(dos.command("RUN"), completed ? /\]RUN\n42\n+\]$/ : /\]RUN\n+\]$/);
}

/** Read INTBASIC from the pinned Master's catalogue entry and T/S list, independently of the laboratory parser. */
function integerBasicPayload(disk: Uint8Array): Uint8Array {
  const entry = 0x11d74;
  assert.equal(String.fromCharCode(...disk.slice(entry + 3, entry + 33).map(b => b & 0x7f)).trimEnd(), "INTBASIC");
  assert.deepEqual([...disk.slice(entry + 33, entry + 35)], [50, 0]);
  const sectorAt = (pointer: number) => (disk[pointer]! * 16 + disk[pointer + 1]!) * 256;
  const list = sectorAt(entry);
  assert.deepEqual([...disk.slice(list + 1, list + 3)], [0, 0], "One T/S list contains the whole file");
  const file = new Uint8Array(49 * 256);
  for (let i = 0; i < 49; i++) {
    const base = sectorAt(list + 12 + 2 * i);
    assert.notEqual(base, 0); file.set(disk.subarray(base, base + 256), i * 256);
  }
  assert.deepEqual([...file.slice(0, 4)], [0, 0x10, 0, 0x30]);
  return file.slice(4, 4 + 0x3000);
}

function traceInterpreterBoot(dos: ReturnType<typeof dosTerminal>, disk: Uint8Array, rom: Uint8Array): void {
  const { machine } = dos, payload = integerBasicPayload(disk), trace = createDos33ReadTrace();
  let copied = 0, requests = 0;
  const writes: Apple2MemoryChange[] = [];
  const detach = (["bank2", "upper"] as const).map(region => machine[region].observeWrites(w =>
    writes.push({ ...w, region, address: w.address + (region === "bank2" ? 0xd000 : 0xe000) })));
  try {
    dos.bootToPrompt(record => {
      if (record.after.pc === 0xa35d) {
        trace.observe(machine, record);
        assert.ok(trace.matches({ dosCommand: "BLOAD INTBASIC,A$D000" }));
        assert.ok(!trace.matches({ dosCommand: "BLOAD INTBASIC" })); // The override matters.
        requests++;
      }
      if (record.before.pc === 0xaca3 && writes.length) {
        assert.equal(requests, 1);
        assert.equal(writes.length, 1);
        const write = writes[0]!;
        assert.equal(write.region, copied < 4096 ? "bank2" : "upper");
        assert.equal(write.address, 0xd000 + copied);
        assert.equal(write.after, payload[copied]);
        if (copied === 0) {
          trace.observe(machine, record, writes);
          assert.equal(record.after.pc, 0xaca5);
          assert.ok(trace.matches({ bank: "bank2", address: 0xd000, value: 0xa9 }));
          assert.ok(!trace.matches({ bank: "bank1", address: 0xd000, value: 0xa9 }));
          assert.equal(apple2DebugLocation(machine, 0xd000).space, "rom");
          assert.equal(machine.firmware.read(0), 0x6f);
        }
        copied++;
      }
      writes.length = 0;
    });
  } finally { detach.forEach(remove => remove()); }
  assert.equal(copied, 12288);
  const state = machine.snapshot();
  assert.deepEqual(state.bank1, new Array(4096).fill(0));
  assert.deepEqual([...state.bank2, ...state.upper], [...payload]);
  assert.deepEqual(Array.from({ length: 12288 }, (_, i) => machine.firmware.read(i)), [...rom]);
}

function traceInterpreterSwitches(dos: ReturnType<typeof dosTerminal>): void {
  const { machine } = dos, before = machine.snapshot(), trace = createDos33ReadTrace();
  const jump = { jumpFrom: 0x9de7, indirect: 0x9d5c, target: 0xe000 };
  function switchBasic(command: "INT" | "FP", mapping: string, first: number[], next: number): string {
    let entered = false, fetched = false;
    const text = dos.command(command, undefined, record => {
      if (entered && !fetched) {
        assert.equal(record.before.pc, 0xe000);
        assert.deepEqual(record.instruction.bytes, first);
        assert.equal(record.after.pc, next);
        fetched = true;
      }
      if (record.before.pc === jump.jumpFrom && record.after.pc === jump.target) {
        trace.observe(machine, record);
        assert.ok(trace.matches(jump)); assert.equal(entered, false);
        assert.equal(apple2DebugLocation(machine).space, mapping);
        entered = true;
      }
    });
    assert.ok(fetched, `${command} must execute the first instruction in ${mapping}`);
    return text;
  }
  assert.match(switchBasic("INT", "lc-upper", [0x20, 0, 0xf0], 0xf000), /\]INT\n+>$/);
  assert.match(dos.command("PRINT 6*7"), />PRINT 6\*7\n42\n+>$/);
  assert.match(switchBasic("FP", "rom", [0x4c, 0x28, 0xf1], 0xf128), />FP\n+\]$/);
  assert.match(dos.command("PRINT 3/2"), /\]PRINT 3\/2\n1\.5\n+\]$/);
  const after = machine.snapshot();
  for (const region of ["bank1", "bank2", "upper"] as const) assert.deepEqual(after[region], before[region]);
}

const romPath = process.env.APPLE2_ROM, diskPath = process.env.APPLE2_DISK;
test("native Disk II boots DOS, runs BASIC, and distinguishes protected and writable media", {
  skip: romPath === undefined || diskPath === undefined ? "Set APPLE2_ROM (20 KiB container) and APPLE2_DISK to the selected local media" : false,
}, async t => {
  assert.ok(romPath); assert.ok(diskPath);
  const container = readFileSync(romPath);
  const rom = await readApple2Rom(file(container), romImages.firmware, media);
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
  traceInterpreterBoot(terminal, selected.disk.exportImage(), container.subarray(media.offset));
  await t.test("RUN COLOR DEMO matches its catalogue name, executes the on-disk tokens and clears the first visible cell", () => {
    const demo = createApple2Session(rom.image);
    demo.restore(session.snapshot()); // Keep the first prompt and its DOS banner for the screen comparison.
    const dos = dosTerminal(demo), { machine } = demo, trace = createDos33ReadTrace();
    const image = selected.disk.exportImage();
    const catalogue = { catalogueName: "COLOR DEMO", address: 0xb50e, value: 0x81 };
    const token = { kind: "read", address: 0x8e82, value: 0x4e } as const;
    const cell = { page: 1, textCell: [0, 0], before: 0xc4, after: 0xa0 } as const;
    let matches = 0, executing = false, cleared = false;
    const writes: Apple2MemoryChange[] = [];
    const detach = machine.ram.observeWrites(w => { if (executing && !cleared) writes.push({ ...w, region: "ram" }); });
    let menu: string;
    try {
      menu = dos.command("RUN COLOR DEMO", undefined, record => {
        trace.observe(machine, record, writes);
        if (record.after.pc === 0xabb5 && trace.matches(catalogue)) {
          const read = trace.reads.at(-1)!;
          assert.deepEqual([read.track, read.sector, read.buffer], [17, 14, 0xb4bb]);
          assert.deepEqual(read.bytes.slice(0x51, 0x51 + 35), [...image.slice(0x11e51, 0x11e51 + 35)]);
          assert.deepEqual(read.bytes.slice(0x51, 0x54), [28, 15, 0x81]);
          matches++;
        }
        if (record.after.pc === 0xe686 && trace.matches(token)) {
          assert.equal(matches, 2); // DOS reopens the file after entering Integer BASIC.
          assert.equal(apple2DebugLocation(machine).space, "lc-upper");
          const reads = trace.reads.slice(-9);
          assert.deepEqual(reads.map(r => [r.track, r.sector, r.buffer]),
            Array.from({ length: 9 }, (_, i) => [28, 15 - i, i === 0 ? 0x9700 : 0x9600]));
          const data: number[] = [];
          for (const [i, r] of reads.slice(1).entries()) {
            const [track, sector] = reads[0]!.bytes.slice(12 + i * 2, 14 + i * 2);
            const offset = (track! * 16 + sector!) * 256;
            assert.deepEqual(r.bytes, [...image.subarray(offset, offset + 256)]);
            data.push(...r.bytes);
          }
          assert.deepEqual(data.slice(0, 6), [0x81, 0x07, 0x47, 30, 0, 0x4e]);
          assert.deepEqual(Array.from({ length: 1921 }, (_, i) => machine.ram.read(0x8e7f + i)), data.slice(2, 1923));
          assert.equal(record.after.a, 0x4e);
          assert.equal(executing, false);
          executing = true;
        }
        if (executing && !cleared) {
          assert.deepEqual(machine.video.snapshot(), { text: true, mixed: false, page2: false, hires: false });
          if (writes.some(w => w.address >= 0x400 && w.address < 0x800 && w.before !== w.after)) {
            assert.deepEqual([record.before.pc, record.after.pc], [0xfca0, 0xfca2]);
            assert.equal(apple2DebugLocation(machine).space, "lc-upper");
            assert.ok(trace.matches(cell));
            assert.match(dos.screen(), /^OS VERSION 3\.3/); // screen() trims the newly leading space.
            cleared = true;
          }
        }
        writes.length = 0;
      });
    } finally { detach(); }
    assert.ok(cleared);
    assert.match(menu, /APPLE DEMONSTRATION PROGRAMS[\s\S]+WHICH WOULD YOU LIKE\?$/);
    dos.command("5");
    assert.match(dos.command("LIST 30"), /30 DIM A\$\(40\)/);
    assert.match(dos.command("LIST 200"), /200 TEXT\s*:\s*CALL C/);
    assert.deepEqual(machine.disk.exportImage(), image);
  });
  traceInterpreterSwitches(terminal);
  await t.test("BSAVE a 300-byte binary, cold-boot its export, BLOAD every byte and trace the BRUN handoff", async () => {
    // Fork the booted Master at its prompt. The experiment gets its own writable disk.
    const working = createApple2Session(rom.image);
    working.restore(session.snapshot());
    working.machine.disk.insert(new Dos33Disk(selected.disk.exportImage(), { writable: true }));
    const source = dosTerminal(working);
    const section = chapter.split("## Following a DOS binary into execution\n")[1]!.split("\n## ")[0]!;
    const recipe = section.match(/^```text\n([\s\S]*?)\n```$/m);
    assert.ok(recipe, "Run the BSAVE recipe published in the Apple II chapter");
    for (const line of recipe[1]!.split("\n")) source.command(line, 20_000_000);
    assert.match(source.cataloguePages().join("\n"), /^ *B 003 BEACON$/m);

    const expected = Uint8Array.from({ length: 300 }, (_, i) => i & 0xff);
    expected.set([0xad, 0x2b, 0x61, 0x8d, 0x94, 0x07, 0x60]); expected[299] = 0xaa;
    const exported = working.machine.disk.exportImage();
    assert.deepEqual([...exported.slice(0xc60c, 0xc610)], [12, 5, 12, 4]);
    assert.deepEqual([...exported.slice(0xc500, 0xc504)], [0, 0x60, 0x2c, 1]);
    assert.deepEqual(exported.slice(0xc504, 0xc600), expected.slice(0, 252));
    assert.deepEqual(exported.slice(0xc400, 0xc430), expected.slice(252));

    const mounted = await readApple2Disk(file(exported, "BEACON.dsk"), media.disk, "read-only");
    const cold = dosTerminal(createApple2Session(rom.image, { bootstrap, image: mounted.disk }));
    cold.bootToPrompt();
    const { ram } = cold.machine, trace = createDos33ReadTrace();
    const payload = () => Uint8Array.from({ length: 300 }, (_, i) => ram.read(0x6000 + i));
    const search = [[17, 0, 0xb3bb], ...[15, 14, 13, 12].map(s => [17, s, 0xb4bb]), [12, 6, 0x9700]];
    const entry = { jumpFrom: 0xa394, indirect: 0xaa72, target: 0x6000 };
    for (const command of ["BLOAD", "BRUN"]) {
      trace.clear();
      // No expected byte is present before either command. Guard the exact range.
      expected.forEach((b, i) => ram.write(0x6000 + i, b ^ 0xff));
      ram.write(0x5fff, 0x55); ram.write(0x612c, 0x77);
      const programSteps: number[][] = [], copies: number[][] = [];
      let handoffs = 0;
      const text = cold.command(command + " BEACON", undefined, record => {
        trace.observe(cold.machine, record);
        const pc = record.before.pc;
        if (pc === 0xaca3) {
          const dest = record.accesses.find(a => a.kind === "write" && a.address >= 0x6000 && a.address < 0x612c);
          if (dest) copies.push([dest.address, dest.value, trace.reads.at(-1)!.sector]);
        }
        if (trace.matches(entry)) {
          handoffs++;
          assert.deepEqual(payload(), expected);
          assert.deepEqual([ram.read(0xaa72), ram.read(0xaa73)], [0, 0x60]);
        }
        if (pc >= 0x6000 && pc < 0x612c) programSteps.push([pc, record.after.pc]);
      });
      assert.deepEqual(trace.reads.map(r => [r.track, r.sector, r.buffer]),
        [...search, ...search, [12, 5, 0x9600], [12, 4, 0x9600]]);
      for (const { track, sector, bytes } of trace.reads) {
        const offset = (track * 16 + sector) * 256;
        assert.deepEqual(bytes, [...exported.slice(offset, offset + 256)]);
      }
      assert.deepEqual(copies, Array.from(expected, (b, i) => [0x6000 + i, b, i < 252 ? 5 : 4]));
      assert.deepEqual(payload(), expected);
      assert.deepEqual([ram.read(0x5fff), ram.read(0x612c)], [0x55, 0x77]);
      assert.ok(text.endsWith("]"));
      if (command === "BLOAD") {
        assert.equal(handoffs, 0); assert.deepEqual(programSteps, []);
      } else {
        assert.equal(handoffs, 1);
        assert.deepEqual(programSteps, [[0x6000, 0x6003], [0x6003, 0x6006], [0x6006, 0xa17d]]);
        assert.equal(ram.read(0x0794), 0xaa); assert.match(text, /^ {20}\*$/m);
      }
    }
    assert.deepEqual(cold.machine.disk.exportImage(), exported);
  });

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

  await t.test("DOS runs ANSWER from a fresh export and can save another file on the restored writable disk", async t => {
    const master = selected.disk.exportImage();
    assert.doesNotMatch(catalogue, /\bANSWER$/m);
    const working = await readApple2Disk(file(master, "dos33-master.dsk"), media.disk, "writable-copy");
    machine.disk.insert(working.disk);
    command("NEW"); command("10 PRINT 6*7");
    const writes: Dos33SectorWrite[] = [];
    const detach = working.disk.observeWrites(write => writes.push(write));
    session.send(apple2Input("SAVE ANSWER\n"));
    // Stop partway through the fifth field, before DOS commits the pointer to the program sector.
    let midway: ReturnType<typeof session.snapshot> | undefined;
    for (let i = 0; i < 15_000_000; i++) {
      const record = session.step();
      assert.equal(record.outcome, "executed");
      if (writes.length === 4 && record.accesses.some(a => a.address === 0xc0ec)
        && machine.disk.inspect().q7 && machine.disk.snapshot().shifted?.length === 100) {
        midway = session.snapshot(); break;
      }
    }
    assert.ok(midway, "DOS must reach the middle of its fifth sector write");
    terminal.waitForInput(20_000_000);
    detach();
    assert.deepEqual(writes.map(w => [w.track, w.sector]), [[17, 0], [17, 12], [12, 6], [12, 5], [12, 6], [17, 0], [17, 12]]);
    assert.deepEqual(writes.filter(w => w.sector === 6).map(w => w.bytes.slice(12, 14)), [[0, 0], [12, 5]]);
    const complete = machine.disk.exportImage();

    await t.test("restoration finishes the pending write and power loss keeps the earlier one-sector catalogue entry", async () => {
      const saved = await encodeApple2SavedState({ machine: "apple2-plus", name: "Writing the T/S list", diskName: working.name,
        savedAt: new Date().toISOString(), flash: false, state: midway });
      const { session: resumed } = await prepareApple2SavedState(saved, rom.image, media);
      const tail: Dos33SectorWrite[] = [];
      resumed.machine.disk.inspectMedium()!.observeWrites(write => tail.push(write));
      dosTerminal(resumed).waitForInput(20_000_000);
      assert.deepEqual(tail, writes.slice(4));
      assert.deepEqual(resumed.machine.disk.exportImage(), complete);

      const { session: cut } = await prepareApple2SavedState(saved, rom.image, media);
      cut.powerOn();
      assert.equal(cut.machine.disk.snapshot().shifted, undefined);
      const partial = cut.machine.disk.exportImage();
      assert.deepEqual(partial.slice(0xc500, 0xc600), complete.slice(0xc500, 0xc600), "The program data was already written");
      assert.deepEqual([...partial.slice(0xc60c, 0xc60e)], [0, 0], "The list does not yet point to the program data");
      const cold = dosTerminal(cut);
      cold.bootToPrompt();
      traceAnswer(cold, partial, false);
      assert.match(cold.cataloguePages().join("\n"), /^ *A 001 ANSWER$/m);
    });
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
    traceAnswer(fresh, exported, true);
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
