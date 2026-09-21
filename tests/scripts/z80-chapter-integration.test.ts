import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import type { TestContext } from "node:test";

function editedChapter(t: TestContext, edit: (chapter: string) => string) {
  const directory = mkdtempSync(join(tmpdir(), "dromaios-z80-chapter-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, "scripts"));
  for (const name of ["generate-cpu-chapters", "generate-cpu-semantics"]) cpSync(`scripts/${name}.ts`, join(directory, `scripts/${name}.ts`));
  cpSync("src/components", join(directory, "src/components"), { recursive: true });
  cpSync("src/machines", join(directory, "src/machines"), { recursive: true });
  const file = join(directory, "src/components/cpus/specifications/z80.md");
  writeFileSync(file, edit(readFileSync(file, "utf8")));
  const generated = spawnSync(process.execPath, [join(directory, "scripts/generate-cpu-semantics.ts")], { encoding: "utf8" });
  assert.equal(generated.status, 0, generated.stderr);
  return (path: string) => JSON.stringify(pathToFileURL(join(directory, path)).href);
}

// Deliberately wrong hardware edits prove production reads chapter policy, including indexed instructions.
test("Z80 chapter edits reach construction, both snapshots, byte/word dispatch, branches, decimal flags, and stack actions", t => {
  const url = editedChapter(t, chapter => chapter.replace("register PC: 16", "register SCRATCH: 8\n  register PC: 16")
    .replaceAll("return concat(high, low)", "return concat(low, high)")
    .replace("  Z = zero(result)", "  Z = not(zero(result))")
    .replace("select(carry, u8($01)", "select(carry, u8($20)")
    .replace("C = not(zero(and(status, u8($01))))", "C = zero(and(status, u8($01)))")
    .replace("B <- highByte(word)\n  C <- lowByte(word)", "B <- lowByte(word)\n  C <- highByte(word)")
    .replace("PC <- add(pc, signExtend(offset, 16))", "PC <- add(add(pc, u16(1)), signExtend(offset, 16))")
    .replace("SP <- subtract(pointer, u16(1))", "SP <- subtract(pointer, u16(2))")
    .replace("C = or(not(borrow(original, u8($9A))), carry)", "C = 0"));
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import { CpuZ80, cpuZ80StateDescription } from ${url("src/components/cpus/z80.ts")};
    import { parseMachine } from ${url("src/machines/machine-language.ts")};
    const machine = ${JSON.stringify(readFileSync("src/machines/z80/example.machine", "utf8"))};
    assert.equal(cpuZ80StateDescription.scratch.bits, 8);
    assert.throws(() => parseMachine(machine), /Missing fields.*SCRATCH/);
    assert.equal(parseMachine(machine.replace("cpu z80 {", "cpu z80 { SCRATCH = A5")).initialState.scratch, 0xa5);
    const flags = { s: false, z: false, h: false, pv: false, n: false, c: true };
    const bank = { a: 1, b: 0x12, c: 0x34, d: 0x56, e: 0x78, h: 0x9a, l: 0xbc, flags };
    for (const code of [[0x80], [0xc6, 1], [0xdd, 0x86, 0], [0xfd, 0x86, 0], [0xf5], [0xf1], [0x7e], [0x01, 1, 2], [0xed, 0x4b, 4, 0], [0x03], [0x18, 1], [0xcd, 1, 2], [0x27]]) {
      const bytes = new Uint8Array(65536); bytes.set(code, 0x200); bytes[0x400] = 1; bytes[0xbc9a] = 0x7f;
      const ram = { size: bytes.length, read: address => bytes[address], write: (address, value) => { bytes[address] = value; } };
      const initial = { ...bank, alternate: { ...bank, b: 0x56, c: 0x78 }, ix: 0x400, iy: 0x400, pc: 0x200, sp: 0x600,
        i: 0, r: 0, iff1: false, iff2: false, im: 0, interruptDeferred: false, nmiDeferred: false, halted: false, scratch: 0xa5 };
      const missing = { ...initial }; delete missing.scratch;
      assert.throws(() => new CpuZ80(ram, missing), /scratch/);
      const cpu = new CpuZ80(ram, initial); initial.scratch = 0;
      const snapshot = cpu.snapshot(); snapshot.scratch = 0;
      assert.equal(cpu.snapshot().scratch, 0xa5); assert.equal(snapshot.bc, 0x3412); assert.equal(snapshot.alternate.bc, 0x7856);
      cpu.step(); const after = cpu.snapshot();
      if ([0x80, 0xc6, 0xdd, 0xfd].includes(code[0])) { assert.equal(after.flags.z, true); assert.ok(after.a > 1); }
      else if (code[0] === 0xf5) { assert.equal(bytes[0x5fc], 0x20); assert.equal(after.sp, 0x5fc); }
      else if (code[0] === 0xf1) assert.equal(after.flags.c, true);
      else if (code[0] === 0x7e) assert.equal(after.a, 0x7f);
      else if (code[0] === 0x01) { assert.equal(after.b, 2); assert.equal(after.c, 1); }
      else if (code[0] === 0xed) { assert.equal(after.b, 1); assert.equal(after.c, 0); }
      else if (code[0] === 0x03) { assert.equal(after.b, 0x13); assert.equal(after.c, 0x34); }
      else if (code[0] === 0x18) assert.equal(after.pc, 0x204);
      else if (code[0] === 0xcd) { assert.equal(after.pc, 0x0102); assert.equal(after.sp, 0x5fc); assert.equal(bytes[0x5fc], 3); }
      else if (code[0] === 0x27) { assert.equal(after.a, 0x61); assert.equal(after.flags.c, false); }
      assert.equal(after.scratch, 0xa5);
    }
  `], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});


test("Z80 CB prefix, policies, and masks reach ordinary, indexed, and interrupt-supplied execution", t => {
  const url = editedChapter(t, chapter => chapter
    // Remove DJNZ to free $10, then move CB there. The old prefix must no longer dispatch.
    .replace(/family DJNZ "00 010 000"[\s\S]*?\n}/, "")
    .replace("page CB = $CB", "page CB = $10")
    .replace('policy SHIFT "Z80 CB rotation and shift flags" (result: 8, carry: flag) {\n  S = negative(result)',
      'policy SHIFT "Z80 CB rotation and shift flags" (result: 8, carry: flag) {\n  S = 0')
    .replace('000 "0" = $01', '000 "0" = $02'));
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import { CpuZ80 } from ${url("src/components/cpus/z80.ts")};
    const bank = { a: 0, b: 0x40, c: 0, d: 0, e: 0, h: 4, l: 0,
      flags: { s: true, z: false, h: true, pv: false, n: true, c: true } };
    for (const prefix of [[0x10], [0xdd, 0xcb, 0], [0xfd, 0xcb, 0]]) {
      for (const opcode of prefix.length === 1 ? [0x00, 0x06, 0x46, 0x86, 0xc6, 0x36] : [0x06, 0x46, 0x86, 0xc6, 0x36]) {
        for (const supplied of [false, true]) {
          const code = [...prefix, opcode], bytes = new Uint8Array(65536); bytes.set(code, 0x200);
          bytes[0x400] = opcode < 0x40 ? 0x40 : 2;
          const state = { ...bank, alternate: structuredClone(bank), ix: 0x400, iy: 0x400, pc: 0x200, sp: 0x600,
            i: 0, r: 0xfe, iff1: true, iff2: true, im: 0, interruptDeferred: false, nmiDeferred: false, halted: false };
          const cpu = new CpuZ80({ size: bytes.length, read: address => bytes[address], write: (address, value) => { bytes[address] = value; } }, state);
          let acknowledgements = 0;
          const record = supplied ? cpu.interrupt("irq", () => code[acknowledgements++]) : cpu.step();
          const after = cpu.snapshot();
          assert.equal(record.outcome, opcode === 0x36 ? "unsupported" : "executed");
          assert.equal(after.pc, supplied || opcode === 0x36 ? 0x200 : 0x200 + code.length);
          assert.equal(after.r, supplied || opcode !== 0x36 ? 0x80 : 0xfe);
          assert.equal(acknowledgements, supplied ? code.length : 0);
          if (opcode === 0 || opcode === 6) { assert.equal(after.flags.s, false); assert.equal(opcode === 0 ? after.b : bytes[0x400], 0x80); }
          if (opcode === 0x46) assert.equal(after.flags.z, false);
          if (opcode === 0x86) assert.equal(bytes[0x400], 0);
          if (opcode === 0xc6) assert.equal(bytes[0x400], 2);
        }
      }
    }
    const state = { ...bank, alternate: structuredClone(bank), ix: 0, iy: 0, pc: 0, sp: 0,
      i: 0, r: 5, iff1: false, iff2: false, im: 0, interruptDeferred: false, nmiDeferred: false, halted: false };
    let reads = 0;
    const cpu = new CpuZ80({ size: 65536, read() { reads++; return 0xcb; }, write() { assert.fail(); } }, state);
    const record = cpu.step();
    assert.equal(record.outcome, "unsupported"); assert.equal(reads, 1);
    assert.equal(cpu.snapshot().pc, 0); assert.equal(cpu.snapshot().r, 5);
  `], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

test("Z80 ED prefix, word flags, block steps, ports, modes, and RETI notification are chapter-owned", t => {
  const url = editedChapter(t, chapter => chapter
    .replace(/family DJNZ "00 010 000"[\s\S]*?\n}/, "")
    .replace("page ED = $ED", "page ED = $10")
    .replace(/policy WORDADC([\s\S]*?)N = 0/, 'policy WORDADC$1N = 1')
    .replace('0 "I" = $0001', '0 "I" = $0003')
    .replace("PC <- subtract(pc, u16(2))", "PC <- subtract(pc, u16(3))")
    .replaceAll("shiftBits(memoryByte, right, 4)", "shiftBits(memoryByte, right, 3)")
    .replace(/policy INPUTFLAGS([\s\S]*?)PV = evenParity\(result\)/, 'policy INPUTFLAGS$1PV = not(evenParity(result))')
    .replace('family IM2 "01 0 11 110" on ED named "IM 2" {\n  IM <- 2', 'family IM2 "01 0 11 110" on ED named "IM 2" {\n  IM <- 1')
    .replace("  notify reti\n", ""));
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import { CpuZ80 } from ${url("src/components/cpus/z80.ts")};
    const bank = { a: 0xab, b: 0, c: 2, d: 5, e: 0, h: 4, l: 0,
      flags: { s: false, z: false, h: false, pv: false, n: false, c: true } };
    const initial = { ...bank, alternate: structuredClone(bank), ix: 0, iy: 0, pc: 0x200, sp: 0x600,
      i: 0x80, r: 0xfe, iff1: true, iff2: true, im: 0, interruptDeferred: false, nmiDeferred: false, halted: false };
    for (const opcode of [0x4a, 0x57, 0x6f, 0xb0, 0xb1, 0xb2, 0xb3, 0x40, 0x5e, 0x4d]) for (const supplied of [false, true]) {
      const code = [0x10, opcode], bytes = new Uint8Array(65536); bytes.set(code, 0x200);
      bytes[0x400] = 0xcd; bytes[0x600] = 0x34; bytes[0x601] = 0x12;
      let notifications = 0, acknowledgements = 0;
      const ports = [];
      const cpu = new CpuZ80({ size: bytes.length, read: address => bytes[address], write: (address, value) => { bytes[address] = value; } }, initial,
        { readPort(address) { ports.push(["read", address]); return 0x12; }, writePort(address, value) { ports.push(["write", address, value]); } },
        () => { notifications++; });
      const record = supplied ? cpu.interrupt("irq", () => code[acknowledgements++]) : cpu.step(), after = cpu.snapshot();
      assert.equal(record.outcome, "executed"); assert.equal(after.r, 0x80); assert.equal(acknowledgements, supplied ? 2 : 0);
      if (opcode === 0x4a) { assert.equal(after.hl, 0x403); assert.equal(after.flags.n, true); }
      if (opcode === 0x57) assert.equal(after.a, 0x80);
      if (opcode === 0x6f) { assert.equal(after.a, 0xb9); assert.equal(bytes[0x400], 0xdb); }
      if ([0xb0, 0xb1, 0xb2, 0xb3].includes(opcode)) { assert.equal(after.hl, 0x403); assert.equal(after.pc, supplied ? 0x1fd : 0x1ff); }
      if (opcode === 0xb0) { assert.equal(after.de, 0x503); assert.equal(bytes[0x500], 0xcd); assert.equal(after.bc, 1); }
      if (opcode === 0xb1) assert.equal(after.bc, 1);
      if (opcode === 0xb2) { assert.equal(bytes[0x400], 0x12); assert.deepEqual(ports, [["read", 2]]); }
      if (opcode === 0xb3) assert.deepEqual(ports, [["write", 0xff02, 0xcd]]);
      if (opcode === 0x40) { assert.equal(after.b, 0x12); assert.equal(after.flags.pv, false); }
      if (opcode === 0x5e) assert.equal(after.im, 1);
      if (opcode === 0x4d) { assert.equal(after.pc, 0x1234); assert.equal(after.sp, 0x602); assert.equal(notifications, 0); }
    }
    let reads = 0;
    const cpu = new CpuZ80({ size: 65536, read() { reads++; return 0xed; }, write() { assert.fail(); } }, initial);
    assert.equal(cpu.step().outcome, "unsupported"); assert.equal(reads, 1);
    assert.equal(cpu.snapshot().pc, 0x200); assert.equal(cpu.snapshot().r, 0xfe);
  `], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

// Prefix paths, displacement arithmetic, and opcode-fetch classification are chapter data.
test("Z80 indexed chapter edits control both prefix pages, addressing, and supplied refresh increments", t => {
  const url = editedChapter(t, chapter => chapter.replace(/family DJNZ[^]*?\n}\n/, "")
    .replace("page DD = $DD", "page DD = $10")
    .replace("page DDCB = $CB", "page DDCB = $ED")
    .replace("page FDCB = $CB", "page FDCB = $ED")
    .replaceAll("opcode = read", "opcode = fetch")
    .replaceAll("add(base, signExtend(displacement, 16))", "subtract(base, signExtend(displacement, 16))"));
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import { CpuZ80 } from ${url("src/components/cpus/z80.ts")};
    const flags = { s: false, z: false, h: false, pv: false, n: false, c: false };
    const bank = { a: 0, b: 0, c: 0, d: 0, e: 0, h: 0, l: 0, flags };
    const initial = { ...bank, alternate: bank, ix: 0xffff, iy: 0xffff, pc: 0x200, sp: 0x600,
      i: 0, r: 0x80, iff1: true, iff2: true, im: 0, interruptDeferred: false, nmiDeferred: false, halted: false };
    for (const prefix of [0x10, 0xfd]) for (const bits of [false, true]) for (const supplied of [false, true]) {
      const code = bits ? [prefix, 0xed, 0xff, 0x06] : [prefix, 0x36, 0xff, 0x42];
      const bytes = new Uint8Array(65536); bytes.set(code, 0x200); bytes[0] = 0x81;
      const ram = { size: bytes.length, read: address => bytes[address], write: (address, value) => { bytes[address] = value; } };
      const cpu = new CpuZ80(ram, initial), snapshots = [];
      const record = supplied ? cpu.interrupt("irq", () => { snapshots.push(cpu.snapshot()); return code.shift(); }) : cpu.step();
      assert.equal(record.outcome, "executed"); assert.equal(bytes[0], bits ? 3 : 0x42);
      assert.equal(cpu.snapshot().pc, supplied ? 0x200 : 0x204);
      assert.equal(cpu.snapshot().r, bits ? 0x83 : 0x82);
      if (supplied) assert.deepEqual(snapshots.map(state => state.r), bits ? [0x81, 0x82, 0x82, 0x83] : [0x81, 0x82, 0x82, 0x82]);
    }
    for (const code of [[0xdd, 0x36, 0, 1], [0x10, 0xcb], [0xfd, 0xcb]]) {
      const bytes = new Uint8Array(65536); bytes.set(code, 0x200);
      const cpu = new CpuZ80({ size: bytes.length, read: address => bytes[address], write() {} }, initial);
      const before = cpu.snapshot(), record = cpu.step();
      assert.equal(record.outcome, "unsupported"); assert.deepEqual(cpu.snapshot(), before);
    }
  `], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});
