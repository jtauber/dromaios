import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { before, test } from "node:test";
import { create8088PcXt, romImages } from "../../../../src/machines/generated/8088/pc-xt.js";
import { RomImage } from "../../../../src/machines/rom-image.js";
import { advanceXtOscillatorTicks, stepTimedXtCpu } from "../../../../src/machines/8088/pc-xt/interrupts.js";
import { renderXtTextFrame } from "../../../../src/machines/8088/pc-xt/video.js";

type Machine = ReturnType<typeof create8088PcXt>;
type StepRecord = ReturnType<typeof stepTimedXtCpu>["record"];
interface VideoCall { readonly ax: number; readonly bx?: number; readonly cx?: number; readonly dx?: number; }
const available = Boolean(process.env.XT_BIOS_ROM && process.env.XT_BASIC_ROM);
const optional = { skip: !available && "Set XT_BIOS_ROM and XT_BASIC_ROM to the selected original firmware." };
let bindings: Parameters<typeof create8088PcXt>[0];
let videoReady: ReturnType<Machine["snapshot"]>;

before(async () => {
  if (!available) return;
  const digest = async (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  bindings = {
    bios: await RomImage.verify(readFileSync(process.env.XT_BIOS_ROM!), romImages.bios, digest),
    basic: await RomImage.verify(readFileSync(process.env.XT_BASIC_ROM!), romImages.basic, digest),
    font: process.env.XT_CGA_ROM ? await RomImage.verify(readFileSync(process.env.XT_CGA_ROM), romImages.font, digest) : null,
  };
  const machine = create8088PcXt(bindings); machine.reset();
  for (let step = 0; step < 1600000; step++) {
    const { cs, ip } = machine.cpu.snapshot();
    if (cs === 0xf000 && ip === 0xe30a) { videoReady = machine.snapshot(); return; }
    const { record } = stepTimedXtCpu(machine);
    assert.ok(record.outcome === "executed" || record.outcome === "accepted");
  }
  assert.fail("Original POST did not reach its video-ready boundary.");
});

// Small RAM callers run after real video POST; no IVT, BIOS data, or screen bytes are seeded.
// MOV AX/BX/CX/DX, immediate; INT 10h. Literal encodings are independent of CPU builders.
function fixture(calls: readonly VideoCall[]) {
  const machine = create8088PcXt(bindings, { ...videoReady, cpu: { ...videoReady.cpu,
    cs: 0x1000, ip: 0, ss: 0, sp: 0x8000, ds: 0, es: 0,
    flags: { ...videoReady.cpu.flags, if: false, df: false },
  } });
  const code = calls.flatMap(({ ax, bx = 0, cx = 0, dx = 0 }) => [
    0xb8, ax & 255, ax >>> 8, 0xbb, bx & 255, bx >>> 8,
    0xb9, cx & 255, cx >>> 8, 0xba, dx & 255, dx >>> 8, 0xcd, 0x10,
  ]);
  [...code, 0xf4].forEach((byte, i) => machine.ram.write(0x10000 + i, byte));
  return { machine, end: code.length };
}
function at(machine: Machine, ip: number): boolean {
  const cpu = machine.cpu.snapshot(); return cpu.cs === 0x1000 && cpu.ip === ip;
}
function run(machine: Machine, end: number, inspect?: (record: StepRecord) => void): void {
  for (let step = 0; step < 1000000; step++) {
    if (at(machine, end)) return;
    const { record } = stepTimedXtCpu(machine);
    assert.equal(record.outcome, "executed", `INT 10h stopped at ${record.before.pc.toString(16)}`);
    inspect?.(record);
  }
  assert.fail("Original INT 10h did not return within the instruction budget.");
}
function text(value: string): VideoCall[] { return Array.from(value, c => ({ ax: 0x0e00 + c.charCodeAt(0) })); }
function cursor(row: number, column: number, page = 0): VideoCall { return { ax: 0x0200, bx: page << 8, dx: row * 256 + column }; }
function word(machine: Machine, address: number): number { return machine.ram.read(address) | machine.ram.read(address + 1) << 8; }
function cell(machine: Machine, row: number, column: number, columns = 80, base = 0): number {
  const address = base + (row * columns + column) * 2;
  return machine.video.read(address) | machine.video.read(address + 1) << 8;
}
function assertCursor(machine: Machine, row: number, column: number, columns = 80, page = 0): void {
  assert.equal(word(machine, 0x450 + page * 2), row * 256 + column);
  const crtc = machine.cga.snapshot().crtc;
  assert.equal(crtc[14]! * 256 + crtc[15]!, word(machine, 0x44e) / 2 + row * columns + column);
}

test("original BIOS teletype handles CR, LF, backspace and wrapping while retaining cell attributes", optional, () => {
  const { machine, end } = fixture([
    { ax: 0x0920, bx: 0x1e, cx: 80 }, ...text("\bAB\bC\rD\nE"),
    cursor(2, 79), ...text("XY"), { ax: 0x0300 },
  ]);
  let polls = 0, writes = 0;
  run(machine, end, record => {
    for (const access of record.accesses) {
      if (access.kind === "input" && access.port === 0x3da) polls++;
      if (access.kind === "write" && access.address >= 0xb8000 && access.address < 0xbc000) writes++;
    }
  });
  assert.ok(polls > 0); assert.ok(writes > 0);
  for (let row = 0; row < 25; row++) for (let column = 0; column < 80; column++) {
    const character = row === 0 && column === 0 ? "D" : row === 0 && column === 1 ? "C"
      : row === 1 && column === 1 ? "E" : row === 2 && column === 79 ? "X" : row === 3 && column === 0 ? "Y" : " ";
    assert.equal(cell(machine, row, column), (row === 0 ? 0x1e00 : 0x0700) + character.charCodeAt(0));
  }
  assertCursor(machine, 3, 1); assert.equal(machine.cpu.snapshot().dx, 0x0301);
  assert.equal(machine.cpu.snapshot().cx, 0x0607); // BIOS function 3 also returns the cursor shape.
});

test("original BIOS writes and reads character/attribute pairs without moving the cursor", optional, () => {
  const { machine, end } = fixture([
    cursor(4, 5), { ax: 0x0941, bx: 0x9e, cx: 3 }, { ax: 0x0a42, cx: 1 }, { ax: 0x0800 },
  ]);
  run(machine, end);
  assert.equal(machine.cpu.snapshot().ax, 0x9e42);
  assert.equal(cell(machine, 4, 5), 0x9e42); assert.equal(cell(machine, 4, 6), 0x9e41);
  assert.equal(cell(machine, 4, 7), 0x9e41); assert.equal(cell(machine, 4, 8), 0x0720);
  assertCursor(machine, 4, 5);
});

test("original BIOS modes 0–3 initialize text and scroll when teletype wraps at the bottom right", optional, () => {
  for (const mode of [0, 1, 2, 3]) {
    const columns = mode < 2 ? 40 : 80;
    const { machine, end } = fixture([{ ax: mode }, cursor(24, columns - 1), ...text("XY"), { ax: 0x0f00 }]);
    run(machine, end);
    assert.equal(machine.cpu.snapshot().al, mode); assert.equal(machine.cpu.snapshot().ah, columns);
    assert.equal(machine.cpu.snapshot().bh, 0); assert.equal(machine.ram.read(0x449), mode);
    assert.equal(word(machine, 0x44a), columns); assert.equal(word(machine, 0x44c), columns === 40 ? 2048 : 4096);
    assert.equal(machine.cga.textSupported(), true); assertCursor(machine, 24, 1, columns);
    for (let row = 0; row < 25; row++) for (let column = 0; column < columns; column++) {
      const character = row === 23 && column === columns - 1 ? "X" : row === 24 && column === 0 ? "Y" : " ";
      assert.equal(cell(machine, row, column, columns), 0x0700 + character.charCodeAt(0));
    }
    if (machine.font.loaded) assert.equal(renderXtTextFrame(machine).width, columns * 8);
  }
});

test("original BIOS window scrolls preserve borders, apply fill attributes, and leave the cursor still", optional, () => {
  const setup: VideoCall[] = [cursor(2, 2), { ax: 0x0958, bx: 0x70, cx: 1 }];
  for (let row = 2; row <= 5; row++) setup.push(cursor(row, 3), { ax: 0x0941 + row - 2, bx: row * 16 + 15, cx: 5 });
  setup.push(cursor(6, 3), { ax: 0x095a, bx: 0x17, cx: 1 });
  const { machine, end } = fixture([...setup,
    { ax: 0x0601, bx: 0x5e00, cx: 0x0203, dx: 0x0507 },
    { ax: 0x0701, bx: 0x6f00, cx: 0x0203, dx: 0x0507 },
    { ax: 0x0600, bx: 0x1a00, cx: 0x0203, dx: 0x0507 },
  ]);
  for (let stage = 1; stage <= 3; stage++) {
    run(machine, (setup.length + stage) * 14);
    for (let row = 0; row < 25; row++) for (let column = 0; column < 80; column++) {
      let expected = row === 2 && column === 2 ? 0x7058 : row === 6 && column === 3 ? 0x175a : 0x0720;
      if (row >= 2 && row <= 5 && column >= 3 && column <= 7) {
        if (stage === 3) expected = 0x1a20;
        else if (stage === 1 && row === 5) expected = 0x5e20;
        else if (stage === 2 && row === 2) expected = 0x6f20;
        else { const originalRow = stage === 1 ? row + 1 : row; expected = (originalRow * 16 + 15) * 256 + 0x41 + originalRow - 2; }
      }
      assert.equal(cell(machine, row, column), expected, `stage ${stage}, cell ${row},${column}`);
    }
    assertCursor(machine, 6, 3);
  }
  assert.ok(at(machine, end));
});

test("original BIOS keeps hidden-page text and cursors separate and selects every supported text page", optional, () => {
  for (const columns of [40, 80]) {
    const pageBytes = columns === 40 ? 2048 : 4096, pages = 16384 / pageBytes;
    const calls: VideoCall[] = [{ ax: columns === 40 ? 1 : 3 }];
    for (let page = 0; page < pages; page++) calls.push(cursor(24, columns - 1, page),
      { ax: 0x0930 + page, bx: page * 256 + 0x1e, cx: 1 });
    for (let page = 0; page < pages; page++) calls.push({ ax: 0x0500 + page }, cursor(0, 0, page),
      ...text("!"), { ax: 0x0300, bx: page << 8 });
    const { machine } = fixture(calls);
    run(machine, (1 + pages * 2) * 14);
    assert.equal(machine.ram.read(0x462), 0);
    assertCursor(machine, 24, columns - 1, columns);
    for (let page = 0; page < pages; page++) {
      assert.equal(cell(machine, 24, columns - 1, columns, page * pageBytes), 0x1e30 + page);
      run(machine, (1 + pages * 2 + (page + 1) * 4) * 14);
      assert.equal(machine.ram.read(0x462), page); assert.equal(word(machine, 0x44e), page * pageBytes);
      assertCursor(machine, 0, 1, columns, page);
      assert.equal(machine.cpu.snapshot().dx, 1);
      assert.equal(cell(machine, 0, 0, columns, page * pageBytes), 0x0721);
      // The board latches its new start at a frame boundary, not at the host's next render.
      advanceXtOscillatorTicks(machine, 912 * 262);
      assert.equal(machine.cga.characterAddress(0, 0), page * pageBytes / 2);
      if (machine.font.loaded) {
        const before = machine.snapshot(), frame = renderXtTextFrame(machine);
        assert.equal(frame.width, columns * 8); assert.deepEqual(machine.snapshot(), before);
      }
    }
  }
});

test("original BIOS character and cursor-shape services reach the rendered CGA pixels", {
  skip: !available || !process.env.XT_CGA_ROM ? "Set XT_BIOS_ROM, XT_BASIC_ROM and XT_CGA_ROM for the original-font check." : false,
}, () => {
  const glyphs = readFileSync(process.env.XT_CGA_ROM!);
  const { machine, end } = fixture([
    cursor(2, 3), { ax: 0x0941, bx: 0x1e, cx: 1 }, { ax: 0x0100, cx: 0x0406 }, { ax: 0x0300 },
    { ax: 0x0100, cx: 0x2607 },
  ]);
  run(machine, 4 * 14);
  assert.equal(machine.cpu.snapshot().cx, 0x0406); assert.equal(machine.cpu.snapshot().dx, 0x0203);
  for (let field = 0; field < 8 && (machine.cga.snapshot().fields & 8) !== 0; field++) advanceXtOscillatorTicks(machine, 912 * 262);
  assert.equal(machine.cga.snapshot().fields & 8, 0);
  for (const hidden of [false, true]) {
    if (hidden) run(machine, end);
    const before = machine.snapshot(), frame = renderXtTextFrame(machine);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const glyph = Boolean(glyphs[0x1800 + 65 * 8 + y]! & (0x80 >>> x));
      const cursorDot = !hidden && y >= 4 && y <= 6;
      assert.equal(frame.pixels[(16 + y) * 640 + 24 + x], glyph || cursorDot ? 14 : 1);
    }
    assert.deepEqual(machine.snapshot(), before);
  }
  assert.equal(machine.cga.snapshot().crtc[10], 0x26);
  assert.equal(machine.cga.snapshot().crtc[11], 7);
});

test("a native BIOS scroll can resume mid-REP with identical memory, registers and display phase", optional, () => {
  const { machine, end } = fixture([
    cursor(1, 0), { ax: 0x0941, bx: 0x1e, cx: 80 }, cursor(2, 0), { ax: 0x0942, bx: 0x2f, cx: 80 },
    { ax: 0x0601, bx: 0x0700, cx: 0, dx: 0x184f },
  ]);
  run(machine, 4 * 14);
  let resumed: Machine | undefined;
  for (let step = 0; step < 10000; step++) {
    const { record } = stepTimedXtCpu(machine); assert.equal(record.outcome, "executed");
    if (record.instruction?.bytes.at(-1) === 0xa5 && record.after.ip === record.before.ip && record.after.cx > 0) {
      resumed = create8088PcXt(bindings, machine.snapshot()); break;
    }
  }
  assert.ok(resumed, "Expected a partially completed REP MOVSW in the original scroll routine.");
  run(machine, end); run(resumed, end);
  assert.deepEqual(resumed.snapshot(), machine.snapshot());
  for (let column = 0; column < 80; column++) {
    assert.equal(cell(machine, 0, column), 0x1e41); assert.equal(cell(machine, 1, column), 0x2f42);
    assert.equal(cell(machine, 24, column), 0x0720);
  }
  if (machine.font.loaded) assert.deepEqual(renderXtTextFrame(resumed), renderXtTextFrame(machine));
});
