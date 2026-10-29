import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu6809 } from "../../src/components/cpus/generated/6809-cpu.js";
import { Ram } from "../../src/components/memory/ram.js";
import { instructionCatalogue6809 } from "../../site/6809-instruction-catalogue.js";
import { decode6809, disassemble6809Rows } from "../../site/interactive/6809-disassembly.js";
import { code6809Rows } from "../../site/interactive/6809-code.js";
import { testFlagCondition } from "../../site/interactive/instruction-shape.js";
import { catalogue6809 as catalogue, chapter6809, state6809 } from "./6809-inspection-fixture.js";

const decode = (bytes: readonly number[], start = 0x2000) => decode6809(address => bytes[(address - start) & 0xffff], start, catalogue);

test("all 268 chapter entries, including every postbyte, match the CPU's actual fetch lengths and support", () => {
  assert.equal(Object.keys(catalogue.instructions).length, 268);
  for (const [encoded, info] of Object.entries(catalogue.instructions)) {
    const opcode = Number(encoded), prefix = opcode > 255 ? [opcode >> 8, opcode & 255] : [opcode];
    const forms = typeof info!.shape === "number" ? [0, 255] : Array.from({ length: 256 }, (_, i) => i);
    for (const postbyte of forms) {
      const memory = new Ram(65536), bytes = [...prefix, postbyte, 0x44, 0x55];
      bytes.forEach((byte, index) => memory.write(0x2000 + index, byte));
      const cpu = new Cpu6809(memory, state6809());
      const row = decode(bytes), record = cpu.step(), label = `${info!.name} ${postbyte.toString(16)}`;
      assert.equal(row.bytes.length, record.instruction!.bytes.length, label);
      assert.equal(row.complete, record.outcome !== "unsupported", label);
    }
  }
});

test("Motorola indexed spellings, independent postbyte legality, prefixes and signed offsets", () => {
  for (let byte = 0; byte < 256; byte++) {
    const mode = byte & 15, indirect = !!(byte & 16);
    const valid = byte < 128 || [1, 3, 4, 5, 6, 8, 9, 11, 12, 13].includes(mode)
      || !indirect && [0, 2].includes(mode) || byte === 0x9f;
    for (const prefix of [[0xa6], [0x10, 0xae]]) {
      const row = decode([...prefix, byte, 0xfe, 0xdc]);
      assert.equal(row.complete, valid, byte.toString(16));
      const extra = !valid || byte < 128 ? 0 : [8, 12].includes(mode) ? 1 : [9, 13, 15].includes(mode) ? 2 : 0;
      assert.equal(row.bytes.length, prefix.length + 1 + extra);
    }
  }
  for (const [bytes, assembly] of [
    [[0xa6, 0x1f], "LDA -1,X"], [[0xa6, 0xa1], "LDA ,Y++"], [[0xa6, 0xf3], "LDA [,--S]"],
    [[0xa6, 0x88, 0x80], "LDA -128,X"], [[0xa6, 0x89, 0xff, 0xfe], "LDA -2,X"],
    [[0xa6, 0x9c, 0xfe], "LDA [-2,PCR]"], [[0xa6, 0x9f, 0x12, 0x34], "LDA [$1234]"],
    [[0x10, 0x8e, 0x12, 0x34], "LDY #$1234"], [[0x96, 0x20], "LDA <$20"],
    [[0x1f, 0x89], "TFR A,B"], [[0x34, 0xff], "PSHS CC,A,B,DP,X,Y,U,PC"], [[0x36, 0x40], "PSHU S"],
  ] as const) assert.equal(decode(bytes).assembly, assembly);
});

test("flow separators derive from PC writes, including both RTI frames, stack masks and transfers", () => {
  for (const [encoded, info] of Object.entries(catalogue.instructions)) for (let byte = 0; byte < 256; byte++) {
    const opcode = Number(encoded), row = decode([...(opcode > 255 ? [opcode >> 8, opcode & 255] : [opcode]), byte, 0, 0]);
    if (!row.complete) continue;
    const name = info!.name.split(" ")[0]!;
    let expected = /^(L?BRA|L?BSR|JSR|JMP|RTS|RTI|SWI[23]?)$/.test(name) ? "unconditional"
      : /^L?B(HI|LS|CC|CS|NE|EQ|VC|VS|PL|MI|GE|LT|GT|LE)$/.test(name) ? "conditional" : "sequential";
    if (/^PUL[SU]$/.test(name) && (byte & 128) || name === "TFR" && (byte & 15) === 5
      || name === "EXG" && ((byte & 15) === 5 || (byte >> 4) === 5)) expected = "unconditional";
    assert.equal(row.shape?.controlFlow, expected, `${name} ${byte.toString(16)}`);
  }
});

test("chapter branch expressions match independent signed and unsigned branch truth tables", () => {
  for (let bits = 0; bits < 16; bits++) {
    const [n, z, v, c] = [8, 4, 2, 1].map(bit => !!(bits & bit)) as [boolean, boolean, boolean, boolean];
    const expected = [!c && !z, c || z, !c, c, !z, z, !v, v, !n, n, n === v, n !== v, !z && n === v, z || n !== v];
    for (let index = 0; index < expected.length; index++) for (const prefix of [[], [0x10]]) {
      const row = decode([...prefix, 0x22 + index, 0, 0]);
      assert.equal(testFlagCondition(row.shape!.condition!, { n, z, v, c }), expected[index]);
    }
  }
  const changed = structuredClone(chapter6809);
  for (const entries of Object.values(changed.families)) for (const [opcode, definition] of entries) if (opcode === 0x26) {
    (definition as { explanation: string }).explanation = "Changed authored explanation.";
  }
  assert.equal(instructionCatalogue6809(changed).instructions[0x26]?.explanation, "Changed authored explanation.");
});

test("disassembly handles wrap, missing bytes and unknown prefixed forms without reading data targets", () => {
  assert.equal(decode([0x26, 0xfe], 0xffff).assembly, "BNE $FFFF");
  assert.equal(decode([0x10, 0x26, 0xff, 0xfc], 0xffff).assembly, "LBNE $FFFF");
  assert.equal(decode([0x10, 0x10, 0x12]).assembly, ".byte $10, $10");
  for (const bytes of [[], [0x10], [0x10, 0x8e], [0xa6], [0xa6, 0x89, 0]]) assert.equal(decode(bytes).complete, false);
  const seen: number[] = [], bytes = [0xa6, 0x9f, 0xff, 0x00];
  const row = decode6809(address => { seen.push(address); return bytes[address - 0x2000]; }, 0x2000, catalogue);
  assert.equal(row.assembly, "LDA [$FF00]"); assert.deepEqual(seen, [0x2000, 0x2001, 0x2002, 0x2003]);
  assert.equal(disassemble6809Rows(() => 0x12, 0xffff, catalogue).length, 1);
});

test("execution history retains captured bytes and marks interrupt boundaries separately from code", () => {
  const memory = new Ram(65536); memory.write(0x2000, 0x12); memory.write(0x2001, 0x20); memory.write(0x2002, 0xfd);
  const cpu = new Cpu6809(memory, state6809()), records = [cpu.step(), cpu.step(), cpu.step(), cpu.step()];
  memory.write(0x2001, 0x39);
  const rows = code6809Rows(address => memory.read(address), cpu.snapshot().pc, catalogue, records);
  assert.deepEqual(rows.slice(0, 3).map(row => row.assembly), ["BRA $2000", "NOP", "BRA $2000"]);
  assert.equal(rows.length, 16); assert.equal(rows[3]?.executed, false);
  const irq = new Cpu6809(memory, state6809({ flags: { ...state6809().flags, i: false } }));
  const boundary = irq.interrupt("irq");
  assert.equal(code6809Rows(address => memory.read(address), boundary.after.pc, catalogue, [...records, boundary])[2]?.boundaryAfter, true);
});
