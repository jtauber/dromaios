import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import { ChapterError } from "../../../../src/components/cpus/semantics/literate/document.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";
import { instructions8008 } from "../../../../src/components/cpus/semantics/generated/catalogue.js";
import { opcodeEntries } from "../../../../src/components/cpus/generated/8008.js";
import type { Cpu8008StoredState } from "../../../../src/components/cpus/semantics/generated/state/8008.js";
import type { ByteInstructionContext } from "../../../../src/components/cpus/instruction-context.js";
import type { BytePorts } from "../../../../src/components/cpus/port-access.js";

const file = "src/components/cpus/specifications/8008.md", markdown = readFileSync(file, "utf8");
const cpu = { name: "8008" };
const compile = (text = markdown) => compileCpuChapter(text, cpu, file);
function state(): Cpu8008StoredState {
  return { a: 0x81, b: 2, c: 3, d: 4, e: 5, h: 6, l: 7,
    flags: { s: true, z: false, p: true, c: true }, addressStack: [1, 2, 3, 4, 5, 6, 7, 0x3fff], stackIndex: 7, halted: false };
}
const forbidden = () => { assert.fail("Unexpected memory, operand, or port access"); };
const noAccess = { fetchByte: forbidden, readByte: forbidden, writeByte: forbidden, readPort: forbidden, writePort: forbidden };

test("the complete 8008 chapter owns exactly 250 encodings, including 59 control and 32 port forms", () => {
  const chapter = compile(), definitions = Object.fromEntries(Object.values(chapter.families).flat());
  const expected = Array.from({ length: 256 }, (_, opcode) => opcode).filter(opcode => ![0x22, 0x2a, 0x32, 0x38, 0x39, 0x3a].includes(opcode));
  assert.deepEqual(Object.keys(definitions).map(Number), expected);
  assert.deepEqual(definitions, instructions8008);
  assert.deepEqual(opcodeEntries(state()).map(([opcode]) => opcode), expected);
  const control = {
    conditionalJump: [0x40, 0x48, 0x50, 0x58, 0x60, 0x68, 0x70, 0x78],
    conditionalCall: [0x42, 0x4a, 0x52, 0x5a, 0x62, 0x6a, 0x72, 0x7a],
    conditionalReturn: [0x03, 0x0b, 0x13, 0x1b, 0x23, 0x2b, 0x33, 0x3b],
    JMP: [0x44, 0x4c, 0x54, 0x5c, 0x64, 0x6c, 0x74, 0x7c],
    CAL: [0x46, 0x4e, 0x56, 0x5e, 0x66, 0x6e, 0x76, 0x7e],
    RET: [0x07, 0x0f, 0x17, 0x1f, 0x27, 0x2f, 0x37, 0x3f],
    RST: [0x05, 0x0d, 0x15, 0x1d, 0x25, 0x2d, 0x35, 0x3d], HLT: [0, 1, 0xff],
  };
  for (const [name, opcodes] of Object.entries(control)) assert.deepEqual(chapter.families[name]!.map(([opcode]) => opcode), opcodes);
  assert.equal(Object.values(control).flat().length, 59);
  for (let port = 0; port < 32; port++) assert.equal(definitions[0x41 + 2 * port]!.name, `${port < 8 ? "INP" : "OUT"} ${port}`);
  assert.equal(chapter.families.INP!.length, 8); assert.equal(chapter.families.OUT!.length, 24);
  for (const [index, suffix] of ["FC", "FZ", "FS", "FP", "TC", "TZ", "TS", "TP"].entries()) {
    assert.equal(definitions[0x40 + 8 * index]!.name, `J${suffix}`);
    assert.equal(definitions[0x42 + 8 * index]!.name, `C${suffix}`);
    assert.equal(definitions[0x03 + 8 * index]!.name, `R${suffix}`);
  }
});

const invalid: readonly [string, string, string, RegExp][] = [
  ["wrong selector width", "register SELECTOR: 3", "register SELECTOR: 8", /index may exceed|expected 3-bit/],
  ["wrong array width", "ADDRESS: 14[8]", "ADDRESS: 16[8]", /source result width/],
  ["wrong array length", "ADDRESS: 14[8]", "ADDRESS: 14[7]", /index may exceed/],
  ["wrong latch kind", "latch STOPPED = halted", "latch STOPPED = a", /Duplicate stored field a/],
  ["duplicate state name", "latch STOPPED = halted", "latch SELECTOR = halted", /Duplicate declaration SELECTOR/],
  ["lowercase array", "array ADDRESS:", "array address:", /must be uppercase/],
  ["unknown condition flag", '000 "FC" = flag C', '000 "FC" = flag Q', /Unknown name Q/],
  ["nonliteral condition", '000 "FC" = flag C = 0', '000 "FC" = flag C = carry', /compare its flag with 0 or 1/],
  ["spelled-out condition", '000 "FC" = flag C = 0', '000 "FC" = flag C = false', /flag literals as 0 or 1/],
  ["out-of-order condition", '001 "FZ"', '010 "FZ"', /consecutive binary/],
  ["condition used as numeric source", "for c in branches named", "for c in branches.read named", /no numeric source view/],
  ["unknown selected condition", "  when test c", "  when test missing", /Unknown name missing/],
  ["operand used as a condition", "slot = register SELECTOR", "when test v {\n    }\n    slot = register SELECTOR", /Unknown name v/],
  ["condition used as an operand", "target = source targetAddress\n  when test c", "target = operand c\n  when test c", /Unknown name c/],
  ["numeric branch predicate", "  when test c", "  when target", /flag target has not been captured/],
  ["unknown target array", "ADDRESS[slot] <- target", "MISSING[slot] <- target", /Unknown array MISSING/],
  ["unbounded array index", "ADDRESS[slot] <- target", "ADDRESS[extend(slot, 8)] <- target", /index may exceed/],
  ["constant index out of bounds", "ADDRESS[slot] <- target", "ADDRESS[u8(8)] <- target", /index may exceed/],
  ["wrong array value width", "ADDRESS[slot] <- target", "ADDRESS[slot] <- extend(target, 16)", /expected 14-bit/],
  ["duplicate nested capture", "ADDRESS[slot] <- target", "slot = u3(0)\n    ADDRESS[slot] <- target", /duplicate capture slot/],
  ["missing nested capture", "ADDRESS[slot] <- target", "ADDRESS[slot] <- missing", /value missing has not been captured/],
  ["narrow port catalogue", "codes ports: 16", "codes ports: 3", /Encoded value must fit 3 bits/],
  ["out-of-range vector", '001 "08" = $08', '001 "08" = $4000', /Encoded value must fit 14 bits/],
  ["narrow port address", "result = port(selector)", "result = port(truncate(selector, 8))", /expected 16-bit/],
  ["wide output value", "port(selector) <- contents", "port(selector) <- extend(contents, 16)", /expected 8-bit/],
  ["spelled-out latch", "STOPPED <- 1", "STOPPED <- true", /flag literals as 0 or 1/],
];
for (const [name, before, after, message] of invalid) test(`8008 control chapter rejects ${name} with a document diagnostic`, () => {
  assert.ok(markdown.includes(before));
  assert.throws(() => compile(markdown.replace(before, after)), (error: unknown) => {
    assert.ok(error instanceof ChapterError); assert.equal(error.file, file);
    assert.match(error.message, message); assert.ok(error.line > 1); return true;
  });
});

test("nested errors point to their statement, with outer captures visible and inner captures confined", () => {
  const before = "    ADDRESS[slot] <- target", after = "    ADDRESS[slot] <- extend(target, 16)";
  const text = markdown.replace(before, after), line = text.split("\n").indexOf(after) + 1;
  assert.throws(() => compile(text), (error: unknown) => error instanceof ChapterError && error.line === line);
  const family = (body: string) => markdown + `\nA scope probe.\n\n\`\`\`cpu\nfamily probe "00 100 010" {\n${body}\n}\n\`\`\`\n`;
  const nested = '  outer = u8(1)\n  when 1 {\n    local = add(outer, u8(1))\n    when not(zero(local)) {\n      A <- local\n    }\n  }';
  assert.doesNotThrow(() => compile(family(nested)));
  assert.throws(() => compile(family(nested + '\n  A <- local')), /value local has not been captured/);
  assert.doesNotThrow(() => compile(family('  when 1 {\n    local = u8(1)\n  }\n  when 0 {\n    local = u8(2)\n  }')));
  assert.throws(() => compile(markdown.replace(before, before + '\n    when condition0 {\n    }')), /flag condition0 has not been captured/);
  assert.throws(() => compile(family('  when 1 {\n    A <- u8(1)')), /closing }/);
  assert.throws(() => compile(family('  when 1 {\n  } trailing')), /Unexpected trailing input/);
});

async function probes(text: string, opcodes: readonly number[]) {
  const definitions = Object.fromEntries(Object.values(compile(text).families).flat());
  const source = generateInstructions("8008", Object.fromEntries(opcodes.map(code => [code, definitions[code]!])));
  const alu = new URL("../../../../src/components/cpus/alu.js", import.meta.url).href;
  const javascript = stripTypeScriptTypes(source).replace('"../alu.ts"', JSON.stringify(alu));
  const compiled: { instructions: Readonly<Record<number, (state: Cpu8008StoredState, context: ByteInstructionContext & BytePorts) => void>> } =
    await import(`data:text/javascript,${encodeURIComponent(javascript)}`);
  return compiled.instructions;
}

test("editing one condition changes jump, call, and return execution at their explicit flag-read point", async () => {
  const execute = await probes(markdown.replace('000 "FC" = flag C = 0', '000 "FC" = flag Z = 0'), [0x40, 0x42, 0x03]);
  for (const opcode of [0x40, 0x42, 0x03]) {
    const current = state(), untouched = [...current.addressStack]; let fetched = 0;
    const flags = current.flags;
    current.flags = new Proxy(flags, { get(target, key) { assert.equal(key, "z"); assert.equal(fetched, opcode === 3 ? 0 : 2); return target.z; } });
    if (opcode !== 3) flags.z = true;
    execute[opcode]!(current, { ...noAccess, fetchByte() {
      fetched++; if (fetched === 2) flags.z = false;
      return fetched === 1 ? 0x34 : 0xd2;
    } });
    const expected = [...untouched];
    if (opcode !== 3) expected[opcode === 0x40 ? 7 : 0] = 0x1234;
    assert.deepEqual(current.addressStack, expected);
    assert.equal(current.stackIndex, opcode === 0x40 ? 7 : opcode === 0x42 ? 0 : 6);
  }
});

test("formal vector, port, and latch edits change execution without hidden fetches or reads", async () => {
  const edited = markdown.replace('001 "08" = $08', '001 "08" = $3FFF')
    .replace('00000 "0"', '00000 "0" = $1234').replace('encoding "11 111 111"\n  STOPPED <- 1', 'encoding "11 111 111"\n  STOPPED <- 0');
  const execute = await probes(edited, [0x0d, 0x41, 0x00, 0x01, 0xff]);
  const current = state();
  execute[0x0d]!(current, noAccess); assert.equal(current.stackIndex, 0); assert.equal(current.addressStack[0], 0x3fff);
  execute[0x41]!(current, { ...noAccess, readPort(port) { assert.equal(port, 0x1234); return 0x42; } });
  assert.equal(current.a, 0x42);
  for (const code of [0, 1, 0xff]) { current.halted = true; execute[code]!(current, noAccess); assert.equal(current.halted, false); }
});

test("nested conditions, array reads, and latch reads retain lexical values and infer only the required port effect", async () => {
  const text = markdown + '\nAn ordered read probe.\n\n```cpu\nfamily probe "00 100 010" {\n'
    + '  slot = register SELECTOR\n  address = array ADDRESS[slot]\n  stopped = latch STOPPED\n  when not(stopped) {\n'
    + '    when not(zero(address)) {\n      port(extend(address, 16)) <- u8($42)\n    }\n  }\n}\n```\n';
  const execute = await probes(text, [0x22]);
  for (const stopped of [false, true]) for (const address of [0, 0x3fff]) {
    const current = state(), output: number[][] = []; current.halted = stopped; current.addressStack[7] = address;
    execute[0x22]!(current, { ...noAccess, writePort(port, byte) { output.push([port, byte]); } });
    assert.deepEqual(output, !stopped && address !== 0 ? [[address, 0x42]] : []);
  }
});
