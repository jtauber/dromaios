import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import { ChapterError } from "../../../../src/components/cpus/semantics/literate/document.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";
import type { Cpu6502State } from "../../../../src/components/cpus/semantics/generated/state/6502.js";

const file = "src/components/cpus/specifications/6502.md", markdown = readFileSync(file, "utf8");
interface Context { fetchByte(): number; readByte(address: number): number; writeByte(address: number, value: number): void }
async function probes(text: string, opcodes: readonly number[]) {
  const chapter = compileCpuChapter(text, { name: "6502" }, file);
  const definitions = Object.fromEntries(Object.values(chapter.families).flat());
  const source = generateInstructions("6502", Object.fromEntries(opcodes.map(code => [code, definitions[code]!])));
  const alu = new URL("../../../../src/components/cpus/alu.js", import.meta.url).href;
  const javascript = stripTypeScriptTypes(source).replace('"../alu.ts"', JSON.stringify(alu));
  const compiled: { instructions: Record<number, (state: Cpu6502State, context: Context) => void> } =
    await import(`data:text/javascript,${encodeURIComponent(javascript)}`);
  return compiled.instructions;
}
const state = (): Cpu6502State => ({ a: 0x45, x: 1, y: 2, sp: 0xff, pc: 0x200,
  flags: { n: false, v: true, d: true, i: false, z: false, c: true } });
const forbidden = () => { assert.fail("Unexpected memory access"); };

test("the chapter controls signed branches and tests live flags after fetching without reading untaken PC", async () => {
  for (const changed of [false, true]) {
    const execute = await probes(changed ? markdown.replace("PC <- add(pc, signExtend(offset, 16))", "PC <- add(pc, extend(offset, 16))") : markdown, [0xd0]);
    for (const taken of [false, true]) {
      const current = state(); let reads = 0, writes = 0;
      const observed = new Proxy(current, {
        get(target, key, receiver) { if (key === "pc") reads++; return Reflect.get(target, key, receiver); },
        set(target, key, value) { if (key === "pc") writes++; return Reflect.set(target, key, value); },
      });
      execute[0xd0]!(observed, { fetchByte() { current.flags.z = !taken; current.pc = 0; return 0xfe; },
        readByte: forbidden, writeByte: forbidden });
      assert.equal(current.pc, taken ? changed ? 0xfe : 0xfffe : 0);
      assert.equal(reads, Number(taken)); assert.equal(writes, Number(taken));
      assert.equal(current.flags.z, !taken);
    }
  }
});

test("moving JSR's final fetch in the chapter changes an overlapping stack/operand program", async () => {
  const changed = markdown.replace("  targetLow = fetch\n", "  targetLow = fetch\n  targetHigh = fetch\n")
    .replace("  targetHigh = fetch\n  PC <- concat(targetHigh, targetLow)", "  PC <- concat(targetHigh, targetLow)");
  for (const early of [false, true]) {
    const execute = await probes(early ? changed : markdown, [0x20]);
    const current = state(); current.pc = 0x100; current.sp = 1;
    const memory = new Map([[0x100, 0x34], [0x101, 0x12]]), writes: number[][] = [];
    execute[0x20]!(current, {
      fetchByte() { const byte = memory.get(current.pc)!; current.pc++; return byte; }, readByte: forbidden,
      writeByte(address, byte) { memory.set(address, byte); writes.push([address, byte]); },
    });
    assert.equal(current.pc, early ? 0x1234 : 0x0134); assert.equal(current.sp, 0xff);
    assert.deepEqual(writes, [[0x101, 1], [0x100, early ? 2 : 1]]);
    assert.deepEqual(current.flags, state().flags);
  }
});

test("indirect pointer wrapping, return increments, and the stacked B marker are chapter rules", async () => {
  const cases = [
    { opcode: 0x6c, before: "or(and(pointer, u16($FF00)), extend(add(lowByte(pointer), u8($01)), 16))",
      after: "add(pointer, u16($0001))", expected: [0x1234, 0x5634] },
    { opcode: 0x60, before: "PC <- add(returnPC, u16($0001))", after: "PC <- returnPC", expected: [0x1235, 0x1234] },
    { opcode: 0x08, before: "original = or(status, u8($10))", after: "original = status", expected: [0x79, 0x69] },
  ];
  for (const entry of cases) for (const changed of [false, true]) {
    assert.ok(markdown.includes(entry.before));
    const execute = await probes(changed ? markdown.replace(entry.before, entry.after) : markdown, [entry.opcode]);
    const current = state(), operand = [0xff, 0x30], written: number[] = [];
    const memory = new Map([[0x30ff, 0x34], [0x3000, 0x12], [0x3100, 0x56], [0x100, 0x34], [0x101, 0x12]]);
    execute[entry.opcode]!(current, { fetchByte: () => operand.shift()!, readByte: address => memory.get(address)!,
      writeByte(_address, byte) { written.push(byte); } });
    assert.equal(entry.opcode === 0x08 ? written[0] : current.pc, entry.expected[Number(changed)]);
  }
});

test("RTI's chapter restores flags before either PC byte, retaining flags and increments on later failure", async () => {
  const execute = await probes(markdown, [0x40]);
  for (const failedRead of [0, 1, 2]) {
    const current = state(), original = current.flags, failure = new Error("stack read failed");
    const reads: number[] = [];
    assert.throws(() => execute[0x40]!(current, { fetchByte: forbidden, writeByte: forbidden,
      readByte(address) {
        reads.push(address); const index = reads.length - 1;
        assert.equal(current.flags === original, index === 0);
        if (index === failedRead) throw failure;
        return [0xb6, 0x34, 0x12][index]!;
      },
    }), error => error === failure);
    assert.deepEqual(reads, [0x100, 0x101, 0x102].slice(0, failedRead + 1));
    assert.equal(current.sp, failedRead); assert.equal(current.pc, 0x200);
    assert.deepEqual(current.flags, failedRead === 0 ? original : { n: true, v: false, d: false, i: true, z: true, c: false });
  }
});

test("sign-extension and complete status restoration reject invalid chapter edits at their source lines", () => {
  for (const [before, after, message] of [
    ["PC <- add(pc, signExtend(offset, 16))", "PC <- add(pc, signExtend(offset, 8))", /extension|widen/],
    ["PC <- add(pc, signExtend(offset, 16))", "PC <- add(pc, signExtend(offset, 3))", /extension|widen/],
    ["PC <- add(pc, signExtend(offset, 16))", "PC <- add(pc, signExtend(missing, 16))", /has not been captured/],
    ["  replace STATUSFLAGS(status)", "  replace NZ(status)", /every|all|complete/],
  ] as const) {
    const text = markdown.replace(before, after);
    const line = markdown.slice(0, markdown.indexOf(before)).split("\n").length;
    assert.throws(() => compileCpuChapter(text, { name: "6502" }, file), (error: unknown) => {
      assert.ok(error instanceof ChapterError); assert.equal(error.line, line); assert.equal(error.file, file);
      assert.match(error.message, message); return true;
    });
  }
});
