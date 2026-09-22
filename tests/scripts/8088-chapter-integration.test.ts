import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

test("8088 chapter edits reach public state, views, migrated and native bodies, and machine parsing", t => {
  const directory = mkdtempSync(join(tmpdir(), "dromaios-8088-chapter-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, "scripts"));
  for (const name of ["generate-cpu-chapters", "generate-cpu-semantics"]) cpSync(`scripts/${name}.ts`, join(directory, `scripts/${name}.ts`));
  cpSync("src/components", join(directory, "src/components"), { recursive: true });
  cpSync("src/machines", join(directory, "src/machines"), { recursive: true });
  const file = join(directory, "src/components/cpus/specifications/8088.md");
  // Deliberately incorrect hardware rules prove that no native copy remains authoritative.
  const chapter = readFileSync(file, "utf8")
    .replace("register AX: 16", "register SCRATCH: 8\n  register AX: 16")
    .replace("return lowByte(word)", "return highByte(word)")
    .replace("AX <- concat(highByte(preservedWord), byte)", "AX <- concat(lowByte(preservedWord), byte)")
    .replace("u32($FFFFF)", "u32($FFFF)")
    .replace('source baseBXSI "DS:BX+SI": 32 {\n  segment = register DS',
      'source baseBXSI "DS:BX+SI": 32 {\n  segment = register ES')
    .replace("high = memory(projectAddress(segment, add(offset, u16(1)), 4, 20))",
      "high = memory(projectAddress(segment, add(offset, u16(2)), 4, 20))")
    .replaceAll("ZF = zero(result)", "ZF = not(zero(result))")
    .replace("select(cf, u16($0001), u16(0))", "select(not(cf), u16($0001), u16(0))")
    .replace("CF = not(zero(and(status, u16($0001))))", "CF = zero(and(status, u16($0001)))");
  writeFileSync(file, chapter);
  const generated = spawnSync(process.execPath, [join(directory, "scripts/generate-cpu-semantics.ts")], { encoding: "utf8" });
  assert.equal(generated.status, 0, generated.stderr);
  const url = (path: string) => JSON.stringify(pathToFileURL(join(directory, path)).href);
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import { Cpu8088, cpu8088StateDescription } from ${url("src/components/cpus/8088.ts")};
    import { parseMachine } from ${url("src/machines/machine-language.ts")};
    const machine = ${JSON.stringify(readFileSync("src/machines/8088/example.machine", "utf8"))};
    assert.equal(cpu8088StateDescription.scratch.bits, 8);
    assert.throws(() => parseMachine(machine), /Missing fields.*SCRATCH/);
    assert.equal(parseMachine(machine.replace("cpu 8088 {", "cpu 8088 { SCRATCH = A5")).initialState.scratch, 0xa5);
    const initial = { ax: 0x1234, bx: 0x5678, cx: 0, dx: 0, sp: 0x8000, bp: 0, si: 0, di: 0,
      cs: 0x1234, ds: 0, ss: 0, es: 0, ip: 0x100, halted: false, waiting: false,
      interruptDeferred: false, recognitionDeferred: false, trapPending: false,
      flags: { cf: false, pf: false, af: false, zf: false, sf: false, tf: false, if: false, df: false, of: false } };
    for (const code of [[0xb0, 0x42], [0x04, 1], [0x00, 0xc3], [0x88, 0xc3], [0x9c], [0x9d]]) {
      const bytes = new Uint8Array(1048576); bytes.set(code, 0x12440);
      const ram = { size: bytes.length, read: address => bytes[address], write: (address, value) => { bytes[address] = value; } };
      assert.throws(() => new Cpu8088(ram, initial), RangeError);
      const cpu = new Cpu8088(ram, { ...initial, scratch: 0xa5 });
      assert.equal(cpu.snapshot().scratch, 0xa5); assert.equal(cpu.snapshot().al, 0x12);
      assert.equal(cpu.snapshot().pc, 0x2440);
      assert.equal(cpu.step().outcome, "executed");
      const after = cpu.snapshot();
      if (code[0] === 0xb0) assert.equal(after.ax, 0x3442);
      if (code[0] === 0x04) { assert.equal(after.ax, 0x3413); assert.equal(after.flags.zf, true); }
      if (code[0] === 0x00) { assert.equal(after.bx, 0x568a); assert.equal(after.flags.zf, true); }
      if (code[0] === 0x88) assert.equal(after.bx, 0x5612);
      if (code[0] === 0x9c) { assert.equal(bytes[0x7ffe], 3); assert.equal(bytes[0x7fff], 0xf0); }
      if (code[0] === 0x9d) assert.equal(after.flags.cf, true);
    }
    // The ModR/M source changes both migrated and still-native families. Segment
    // overrides keep their captured value, and native word reads reuse chapter memory16.
    for (const code of [[0x8b, 0x00], [0x3e, 0x8b, 0x00], [0xc5, 0x00], [0xff, 0x00]]) {
      const bytes = new Uint8Array(1048576); bytes.set(code, 0x12440);
      bytes.set([0x34, 0x12, 0x56, 0, 0x78], 0x2011);
      bytes.set([0xcd, 0xab, 0xef], 0x1011);
      const accesses = [];
      const ram = { size: bytes.length, read(address) { accesses.push(address); return bytes[address]; },
        write(address, value) { bytes[address] = value; } };
      const cpu = new Cpu8088(ram, { ...initial, scratch: 0, bx: 0x10, si: 1, ds: 0x100, es: 0x200 });
      assert.equal(cpu.step().outcome, "executed");
      const after = cpu.snapshot();
      if (code[0] === 0x3e) assert.equal(after.ax, 0xefcd);
      else if (code[0] === 0xff) {
        assert.equal(bytes[0x2011], 0x35); assert.equal(bytes[0x2012], 0x56);
      } else assert.equal(after.ax, 0x5634);
      if (code[0] === 0xc5) assert.equal(after.ds, 0x7856);
      assert.deepEqual(accesses.slice(code.length), code[0] === 0x3e ? [0x1011, 0x1013]
        : code[0] === 0xc5 ? [0x2011, 0x2013, 0x2013, 0x2015] : [0x2011, 0x2013]);
    }
  `], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});
