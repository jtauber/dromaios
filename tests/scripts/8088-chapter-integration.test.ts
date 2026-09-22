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
    .replaceAll("shifted = iterate(count, originalOperand)", "shifted = iterate(add(count, u8(1)), originalOperand)")
    .replace('reject "divide-error" if zero(xor(quotient, u8($80)))', 'reject "divide-error" if zero(xor(quotient, u8($81)))')
    .replace("SP <- subtract(pointer, u16(2))", "SP <- subtract(pointer, u16(4))")
    .replace("SP <- add(pointer, u16(2))", "SP <- add(pointer, u16(4))")
    .replace("IP <- add(position, offset)", "IP <- add(add(position, offset), u16(1))")
    .replace("return xor(positive, and(condition, u8(1)))", "return xor(positive, xor(and(condition, u8(1)), u8(1)))")
    .replaceAll("defer all", "defer intr")
    .replaceAll("port(add(selector, u16(1)))", "port(add(selector, u16(2)))")
    .replace("size = add(extend(width, 16), u16(1))", "size = add(extend(width, 16), u16(2))")
    .replace("CX <- subtract(count, u16(1))", "CX <- subtract(count, u16(2))")
    .replace("WAITING <- high", "WAITING <- not(high)")
    .replace("shiftBits(highOpcode, left, 3)", "shiftBits(highOpcode, left, 2)")
    .replace("shiftBits(extend(vector, 16), left, 2)", "shiftBits(extend(vector, 16), left, 3)")
    .replace("select(cf, u16($0001), u16(0))", "select(not(cf), u16($0001), u16(0))")
    .replace("CF = not(zero(and(status, u16($0001))))", "CF = zero(and(status, u16($0001)))");
  writeFileSync(file, chapter);
  const generated = spawnSync(process.execPath, [join(directory, "scripts/generate-cpu-semantics.ts")], { encoding: "utf8" });
  assert.equal(generated.status, 0, generated.stderr);
  const url = (path: string) => JSON.stringify(pathToFileURL(join(directory, path)).href);
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import { Cpu8088, cpu8088StateDescription } from ${url("src/components/cpus/generated/8088-cpu.ts")};
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
      if (code[0] === 0x9c) { assert.equal(after.sp, 0x7ffc); assert.equal(bytes[0x7ffc], 3); assert.equal(bytes[0x7ffd], 0xf0); }
      if (code[0] === 0x9d) assert.equal(after.flags.cf, true);
    }
    // ModR/M families share address sources and word reads. Segment overrides
    // retain their captured value instead of reading the changed default segment.
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
    // Formal loop bounds, chip-specific divide limits, and stack ordering own
    // public execution, rather than the removed native arithmetic/group modules.
    for (const code of [[0xd0, 0xe1], [0xf6, 0xf9], [0xff, 0xd0]]) {
      const bytes = new Uint8Array(1048576); bytes.set(code, 0x12440);
      const ram = { size: bytes.length, read: address => bytes[address], write: (address, value) => { bytes[address] = value; } };
      const cpu = new Cpu8088(ram, { ...initial, scratch: 0, ax: code[0] === 0xf6 ? 0xff80 : 0x1234, cx: 1 });
      const record = cpu.step();
      assert.equal(record.outcome, "executed"); assert.equal(record.interrupt, undefined);
      if (code[0] === 0xd0) assert.equal(record.after.cx, 4);
      if (code[0] === 0xf6) assert.equal(record.after.ax, 0x0080);
      if (code[0] === 0xff) {
        assert.equal(record.after.ip, 0x1234); assert.equal(record.after.sp, 0x7ffc);
        assert.deepEqual([...bytes.slice(0x7ffc, 0x7ffe)], [2, 1]);
      }
    }
    // Native software entry and IRET consume chapter stack rules too. Conditional
    // branches and segment loads also follow their changed formal definitions.
    for (const code of [[0xcc], [0xcf], [0xeb, 0], [0x74, 0], [0x8e, 0xd8]]) {
      const bytes = new Uint8Array(1048576); bytes.set(code, 0x12440);
      bytes[0x8000] = 0x34; bytes[0x8002] = 0x12;
      bytes[0x8004] = 0x78; bytes[0x8006] = 0x56;
      bytes[0x800a] = 2;
      const ram = { size: bytes.length, read: address => bytes[address], write: (address, value) => { bytes[address] = value; } };
      const cpu = new Cpu8088(ram, { ...initial, scratch: 0 });
      const record = cpu.step(), after = record.after;
      assert.equal(record.outcome, "executed");
      if (code[0] === 0xcc) {
        assert.deepEqual(record.interrupt, { source: "software", vector: 3 });
        assert.equal(after.sp, 0x7ff4);
        assert.deepEqual([...bytes.slice(0x7ff4, 0x7ff6)], [1, 1]);
        assert.deepEqual([...bytes.slice(0x7ff8, 0x7ffa)], [0x34, 0x12]);
        assert.deepEqual([...bytes.slice(0x7ffc, 0x7ffe)], [3, 0xf0]);
      } else if (code[0] === 0xcf) {
        assert.equal(after.ip, 0x1234); assert.equal(after.cs, 0x5678); assert.equal(after.sp, 0x800c);
        assert.equal(after.flags.if, true); assert.equal(after.interruptDeferred, true);
      } else if (code[0] === 0x8e) {
        assert.equal(after.ds, 0x1234); assert.equal(after.interruptDeferred, true);
        assert.equal(after.recognitionDeferred, false);
      } else assert.equal(after.ip, 0x103);
    }
    // The last instruction families also follow formal edits: word port stride,
    // repeat count/indices, WAIT polarity, ESC encoding, and shared vector entry.
    for (const code of [[0xe5, 0x40], [0xe7, 0x40], [0xf3, 0xa5], [0x9b], [0xdf, 0xc7], [0xdf, 6, 0, 2]]) {
      const bytes = new Uint8Array(1048576); bytes.set(code, 0x12440);
      bytes[0x200] = 0xab; bytes[0x202] = 0xcd;
      const ports = [], escapes = [];
      const ram = { size: bytes.length, read: address => bytes[address], write: (address, value) => { bytes[address] = value; } };
      const cpu = new Cpu8088(ram, { ...initial, scratch: 0, cx: 3, si: 0x200, di: 0x300 }, {
        ports: { readPort(address) { ports.push(address); return address === 0x40 ? 0x56 : 0x78; },
          writePort(address, byte) { ports.push([address, byte]); } },
        test: () => false, escape(request) { escapes.push(request); },
      });
      const record = cpu.step(), after = record.after;
      if (code[0] === 0xe5) { assert.deepEqual(ports, [0x40, 0x42]); assert.equal(after.ax, 0x7856); }
      if (code[0] === 0xe7) assert.deepEqual(ports, [[0x40, 0x34], [0x42, 0x12]]);
      if (code[0] === 0xf3) {
        assert.deepEqual([...bytes.slice(0x300, 0x302)], [0xab, 0xcd]);
        assert.equal(after.si, 0x203); assert.equal(after.di, 0x303);
        assert.equal(after.cx, 1); assert.equal(after.ip, initial.ip);
      }
      if (code[0] === 0x9b) {
        assert.equal(record.outcome, "waiting"); assert.equal(after.waiting, true);
        const resumed = cpu.step(); assert.equal(resumed.after.ip, 0x102);
        assert.equal(resumed.instruction, null); assert.equal(resumed.after.waiting, true);
      }
      if (code[0] === 0xdf) assert.deepEqual(escapes, [{ opcode: 28, modRM: code[1],
        memory: code[1] === 0xc7 ? null : { segment: 0, offset: 0x200, address: 0x200, value: 0xcdab } }]);
    }
    for (const external of [false, true]) {
      const bytes = new Uint8Array(1048576); bytes.set([0xcd, 3], 0x12440);
      bytes[24] = 0x44; bytes[26] = 0x33; bytes[28] = 0x22;
      const ram = { size: bytes.length, read: address => bytes[address], write: (address, value) => { bytes[address] = value; } };
      const cpu = new Cpu8088(ram, { ...initial, scratch: 0, flags: { ...initial.flags, if: true } });
      const record = external ? cpu.interrupt("intr", () => 3) : cpu.step();
      assert.equal(record.after.ip, 0x3344); assert.equal(record.after.cs, 0x2233);
    }
  `], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

test("8088 lifecycle chapter edits reach public reset, fetching, prefixes, retirement, and trap/fault delivery", t => {
  const directory = mkdtempSync(join(tmpdir(), "dromaios-8088-lifecycle-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, "scripts"));
  for (const name of ["generate-cpu-chapters", "generate-cpu-semantics"]) cpSync(`scripts/${name}.ts`, join(directory, `scripts/${name}.ts`));
  cpSync("src/components", join(directory, "src/components"), { recursive: true });
  const file = join(directory, "src/components/cpus/specifications/8088.md");
  writeFileSync(file, readFileSync(file, "utf8")
    .replace('CS <- u16($FFFF)', 'CS <- u16($4444)').replace('memory 20', 'memory 21')
    .replace('segment CS shift 4', 'segment DS shift 4').replace('IP <- add(offset, u16(1))', 'IP <- add(offset, u16(2))')
    .replace('segment $26 ES', 'segment $26 SS').replace('prefixes limit 65536', 'prefixes limit 2')
    .replace('"trap" vector 1', '"trap" vector 3').replace('"divide-error" vector 0', '"divide-error" vector 4')
    .replace('sampling flag TF, latch TRAPPENDING', 'sampling flag CF, latch TRAPPENDING')
    .replace('interface Cpu8088 ', 'interface CpuChanged8088 '));
  const generated = spawnSync(process.execPath, [join(directory, "scripts/generate-cpu-semantics.ts")], { encoding: "utf8" });
  assert.equal(generated.status, 0, generated.stderr);
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import { CpuChanged8088 as Cpu8088 } from ${JSON.stringify(pathToFileURL(join(directory, "src/components/cpus/generated/8088-cpu.ts")).href)};
    import { cpuModels } from ${JSON.stringify(pathToFileURL(join(directory, "src/components/cpus/models.ts")).href)};
    assert.equal(cpuModels["8088"].name, "CpuChanged8088");
    assert.equal(cpuModels["8088"].module, "generated/8088-cpu");
    assert.equal(cpuModels["8088"].ramSize, 0x200000);
    assert.equal(cpuModels["8088"].maximumPc, 0x1fffff);
    const initial = { ax: 0x1234, bx: 0, cx: 0, dx: 0, sp: 0x8000, bp: 0, si: 0, di: 0,
      cs: 0x100, ds: 0x200, es: 0x300, ss: 0x400, ip: 0, halted: false, waiting: false,
      interruptDeferred: false, recognitionDeferred: false, trapPending: false,
      flags: { cf: false, pf: false, af: false, zf: false, sf: false, tf: false, if: false, df: false, of: false } };
    for (const code of [[0x90], [0xb8, 0x78, 0x56], [0x26, 0xa0, 0, 2], [0x26, 0xf0, 0x90], [0xf6, 0xf1]]) {
      const bytes = new Uint8Array(0x200000);
      code.forEach((byte, i) => { bytes[0x2000 + 2*i] = byte; });
      bytes[0x3200] = 0x55; bytes[0x4200] = 0x99; bytes[16] = 0x60;
      const ram = { size: bytes.length, read: address => bytes[address], write: (address, byte) => { bytes[address] = byte; } };
      assert.throws(() => new Cpu8088({ ...ram, size: 0x100000 }, initial), /2 MiB/);
      const cpu = new Cpu8088(ram, initial), record = cpu.step();
      assert.equal(record.instruction.address, 0x1000);
      assert.equal(record.accesses[0].address, 0x2000);
      if (code[0] === 0x90) assert.equal(record.after.ip, 2);
      if (code[0] === 0xb8) { assert.equal(record.after.ax, 0x5678); assert.equal(record.after.ip, 6); }
      if (code[1] === 0xa0) { assert.equal(record.after.al, 0x99); assert.equal(record.after.ip, 8); }
      if (code[1] === 0xf0) { assert.equal(record.outcome, "unsupported"); assert.equal(record.after.ip, 0); assert.equal(record.instruction.bytes.length, 2); }
      if (code[0] === 0xf6) { assert.deepEqual(record.interrupt, { source: "divide-error", vector: 4 }); assert.equal(record.after.ip, 0x60); }
      const reset = cpu.reset(); assert.equal(reset.after.cs, 0x4444); assert.equal(reset.after.ax, record.after.ax); assert.deepEqual(reset.accesses, []);
    }
    const bytes = new Uint8Array(0x200000); bytes[0x2000] = 0x90; bytes[12] = 0x50;
    const ram = { size: bytes.length, read: address => bytes[address], write: (address, byte) => { bytes[address] = byte; } };
    const cpu = new Cpu8088(ram, { ...initial, flags: { ...initial.flags, cf: true } });
    assert.equal(cpu.step().after.trapPending, true);
    const trap = cpu.step(); assert.equal(trap.instruction, null);
    assert.deepEqual(trap.interrupt, { source: "trap", vector: 3 }); assert.equal(trap.after.ip, 0x50);
  `], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});
