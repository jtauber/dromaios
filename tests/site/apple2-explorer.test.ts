import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { families } from "../../src/components/cpus/semantics/generated/6502.js";
import { romImages } from "../../src/machines/generated/6502/apple2.js";
import { createApple2Session } from "../../site/interactive/apple2-session.js";
import { createApple2RunTarget, disassemble6502, formatApple2Trace, romRoutine } from "../../site/interactive/apple2-explorer.js";
import type { RomRoutine, Apple2TraceEntry } from "../../site/interactive/apple2-explorer.js";
import { readRomFile } from "../../site/interactive/rom-file.js";
import { apple2StorageReader, apple2MemoryAddresses } from "../../site/interactive/apple2-inspection.js";
import { apple2TextFrame } from "../../site/interactive/apple2-screen.js";
import { Dos33Disk } from "../../src/components/devices/dos33-disk.js";
import { Cpu6502 } from "../../src/components/cpus/generated/6502-cpu.js";
import { Ram } from "../../src/components/memory/ram.js";
import { instructionCatalogue6502 } from "../../site/6502-instruction-catalogue.js";
import { apple2CodeRows } from "../../site/interactive/apple2-disassembly.js";
import { disassemble6502Rows } from "../../site/interactive/6502-disassembly.js";

const instructions = instructionCatalogue6502(Object.values(families).flat());
const annotations: { sha256: string; routines: RomRoutine[] } = JSON.parse(readFileSync("docs/software/apple2p-rom.md", "utf8").match(/```json\n([\s\S]*?)```/)![1]!);

test("6502 disassembly uses chapter names and captured operands for all addressing forms", () => {
  assert.equal(Object.keys(instructions).length, 151);
  const examples: [number[], string][] = [
    [[0xa9, 0x41], "LDA #$41"], [[0xa5, 0x28], "LDA $28"], [[0xb5, 0x28], "LDA $28,X"],
    [[0xb6, 0x28], "LDX $28,Y"], [[0xad, 0x10, 0xc0], "LDA $C010"],
    [[0xbd, 0x00, 0x02], "LDA $0200,X"], [[0xb9, 0x00, 0x02], "LDA $0200,Y"],
    [[0xa1, 0x28], "LDA ($28,X)"], [[0xb1, 0x28], "LDA ($28),Y"],
    [[0x6c, 0x36, 0x00], "JMP ($0036)"], [[0x20, 0xed, 0xfd], "JSR $FDED"],
    [[0x10, 0xf5], "BPL $FD1B"], [[0x0a], "ASL A"], [[0xea], "NOP"], [[0x00, 0xff], "BRK"],
  ];
  for (const [bytes, expected] of examples) assert.equal(disassemble6502(0xfd24, bytes, instructions), expected);
  assert.equal(disassemble6502(0xffff, [0xd0, 0xfe], instructions), "BNE $FFFF");
  assert.equal(disassemble6502(0xffff, [0xd0, 0x7f], instructions), "BNE $0080");
  assert.equal(disassemble6502(0, [0xad, 0x10], instructions), "LDA $????");
  assert.equal(disassemble6502(0, [0xa9], instructions), "LDA #$??");
  assert.equal(disassemble6502(0, [0xd0], instructions), "BNE $????");
  assert.equal(disassemble6502(0, [0x02], instructions), "Unknown instruction");
  assert.equal(disassemble6502(0, [], instructions), "Unknown instruction");
  for (const opcode of Object.keys(instructions).map(Number)) {
    assert.doesNotMatch(disassemble6502(0, [opcode, 0x12, 0x34], instructions), /byte|absolute|relative|zero page|indirect|Unknown/);
  }
});

test("one-shot stops distinguish mapped ROM, stop at the current PC, and enforce a budget", () => {
  const target = createApple2RunTarget();
  target.arm(0xfd21, true, 2);
  assert.equal(target.pauseBeforeStep(0xfd21, false), false);
  assert.equal(target.pauseBeforeStep(0x1234, true), false);
  // Reaching the target on the last permitted instruction wins over exhaustion.
  assert.equal(target.pauseBeforeStep(0xfd21, true), true);
  assert.match(target.status, /Stopped before/);
  assert.equal(target.active, false);
  assert.equal(target.pauseBeforeStep(0xfd21, true), false);
  target.arm(0xfd21, false);
  assert.equal(target.pauseBeforeStep(0xfd21, false), true);
  target.arm(0xfd21, false, 1);
  assert.equal(target.pauseBeforeStep(0, true), false);
  assert.equal(target.pauseBeforeStep(0, true), true);
  assert.match(target.status, /not reached/);
  target.arm(0, false); target.cancel();
  assert.equal(target.active, false); assert.equal(target.status, "");
  for (const invalid of [-1, 65536, 1.5, NaN]) assert.throws(() => target.arm(invalid, false), RangeError);
  assert.equal(romRoutine(0xfd21, false, annotations.routines), undefined);
});

test("trace formatting retains captured bytes, changes, and access order after memory changes", () => {
  const memory = new Ram(65536);
  [0xad, 0x00, 0xc0].forEach((byte, index) => memory.write(0x200 + index, byte));
  memory.write(0xc000, 0xc1);
  const cpu = new Cpu6502(memory, { a: 0, x: 0, y: 0, pc: 0x200, sp: 0xff,
    flags: { n: false, v: false, d: false, i: false, z: true, c: false } });
  const record = cpu.step();
  memory.write(0x200, 0xea); memory.write(0xc000, 0);
  memory.read = () => { throw new Error("No speculative reads"); };
  assert.equal(formatApple2Trace({ record, romMapped: false }, instructions, []),
    "0200  AD 00 C0  LDA $C000\n  PC → 0203 · A 00→C1 · N 0→1 · Z 1→0 · executed\n"
    + "  read $0200 = $AD\n  read $0201 = $00\n  read $0202 = $C0\n  read $C000 = $C1");
});

const romPath = process.env.APPLE2_ROM;
test("the published ROM walkthrough reaches the prompt and follows A through polling, acknowledgement, and echo", {
  skip: romPath === undefined ? "Set APPLE2_ROM to the selected local firmware" : false,
}, async () => {
  assert.ok(romPath);
  assert.equal(annotations.sha256, romImages.firmware.sha256);
  const buffer = new Uint8Array(readFileSync(romPath)).buffer;
  const container = JSON.parse(readFileSync("src/machines/6502/apple2.md", "utf8").match(/```json\n([\s\S]*?)```/)![1]!);
  const rom = await readRomFile({ name: "local ROM", size: buffer.byteLength, async arrayBuffer() { return buffer; } }, romImages.firmware, container);
  const session = createApple2Session(rom.image), { machine } = session, target = createApple2RunTarget();
  const entries: Apple2TraceEntry[] = [];
  function step() {
    const romMapped = !machine.language.ramRead(), record = session.step();
    assert.equal(record.outcome, "executed");
    entries.push({ record, romMapped });
    if (entries.length > 12) entries.shift();
    return record;
  }
  function runTo(name: string): void {
    const routine = annotations.routines.find(routine => routine.name === name)!;
    assert.ok(routine);
    target.arm(parseInt(routine.address, 16), true);
    while (!target.pauseBeforeStep(machine.cpu.snapshot().pc, !machine.language.ramRead())) step();
    assert.match(target.status, /Stopped before/);
  }
  function screen() { return apple2TextFrame(machine.ram, machine.video, false).map(row => row.map(cell => cell.character).join("").trimEnd()).join("\n").trim(); }
  assert.equal(machine.cpu.snapshot().pc, 0xfa62);
  assert.deepEqual(step().instruction.bytes, [0xd8]);
  runTo("HOME"); assert.equal(machine.cpu.snapshot().pc, 0xfc58);
  runTo("COUT");
  const output = step();
  assert.deepEqual(output.instruction.bytes, [0x6c, 0x36, 0]);
  assert.deepEqual(output.accesses.map(access => access.address), [0xfded, 0xfdee, 0xfdef, 0x36, 0x37]);
  runTo("KEYIN2"); assert.match(screen(), /APPLE \]\[/); assert.match(screen(), /\]$/);
  assert.deepEqual(disassemble6502Rows(apple2StorageReader(machine), 0xfd21, instructions, 2).map(row => [row.address, row.bytes, row.assembly]), [
    [0xfd21, [0x2c, 0x00, 0xc0], "BIT $C000"], [0xfd24, [0x10, 0xf5], "BPL $FD1B"],
  ]);
  assert.deepEqual(apple2CodeRows(apple2StorageReader(machine), 0xfd21, instructions, true, entries)
    .slice(0, 4).map(row => row.address), [0xfd18, 0xfd1b, 0xfd1d, 0xfd21]);
  session.send([65]);
  runTo("KEYIN2"); assert.equal(session.pendingInput, 1); // Stop before offering queued input.
  const poll = step();
  assert.deepEqual(poll.accesses.slice(3), [{ kind: "read", address: 0xc000, value: 0xc1 }]);
  assert.equal(poll.after.flags.n, true);
  assert.equal(step().after.pc, 0xfd26); // BPL falls through.
  runTo("Acknowledge key");
  assert.equal(machine.cpu.snapshot().a, 0xc1); assert.equal(machine.keyboard.snapshot().strobe, true);

  // Inspection never has a live bus connection, even with a key ready and the disk motor on.
  machine.disk.install(new Array(256).fill(0));
  machine.disk.insert(new Dos33Disk(new Uint8Array(Dos33Disk.size)));
  machine.disk.read(9); machine.disk.read(12);
  assert.equal(machine.disk.inspect().position, 1);
  machine.language.read(1); // Arm its prewrite latch without mapping RAM over ROM.
  const before = machine.snapshot(), read = machine.memory.read;
  machine.memory.read = () => { throw new Error("Inspection must not read the guest bus"); };
  const rendered = entries.map(entry => formatApple2Trace(entry, instructions, annotations.routines));
  romRoutine(machine.cpu.snapshot().pc, !machine.language.ramRead(), annotations.routines);
  machine.disk.inspect(); machine.keyboard.snapshot(); machine.language.snapshot();
  const storage = apple2StorageReader(machine);
  for (const address of [0, 0x100, 0x400, 0xbff8, 0xc000, 0xc008, 0xc050, 0xc080, 0xc0e8, 0xc600, 0xd000, 0xfff8]) {
    apple2MemoryAddresses(address, 128).map(storage);
    disassemble6502Rows(storage, address, instructions);
    apple2CodeRows(storage, address, instructions, true, entries);
  }
  assert.deepEqual(machine.snapshot(), before);
  machine.memory.read = read;
  const acknowledged = step();
  assert.equal(acknowledged.accesses.at(-1)!.address, 0xc010);
  assert.equal(machine.keyboard.snapshot().strobe, false);
  assert.match(formatApple2Trace({ record: acknowledged, romMapped: true }, instructions, annotations.routines), /BIT \$C010.*Acknowledge key/s);
  assert.doesNotMatch(formatApple2Trace({ record: acknowledged, romMapped: false }, instructions, annotations.routines), /Acknowledge key/);
  runTo("STORADV");
  assert.deepEqual(step().instruction.bytes, [0xa4, 0x24]);
  const stored = step(), write = stored.accesses.find(access => access.kind === "write")!;
  assert.ok(write.address >= 0x400 && write.address < 0x800); assert.equal(write.value, 0xc1);
  runTo("KEYIN2"); assert.match(screen(), /\]A$/);
  assert.ok(rendered.some(text => /read \$C000 = \$C1/.test(text)));
  assert.match(formatApple2Trace({ record: poll, romMapped: true }, instructions, annotations.routines), /N 0→1/);
  session.reset(); assert.equal(session.pendingInput, 0);
  session.powerOn(); assert.equal(session.machine.cpu.snapshot().pc, 0xfa62);
});
