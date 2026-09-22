import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import { ChapterError } from "../../../../src/components/cpus/semantics/literate/document.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";
import { describeInstruction } from "../../../../src/components/cpus/semantics/describe.js";
import { literal, readSource, value } from "../../../../src/components/cpus/semantics/model.js";
import { defineInstruction } from "../../../../src/components/cpus/semantics/validate.js";

const compile = (body: string) => compileCpuChapter(`Numeric inputs preserve ordered effects and closed scopes.

\`\`\`cpu
cpu "probe"
state {
  register A: 8
  register B: 8
  register S: 16
  register P: 16
}
${body}
\`\`\``, {}, "inputs.md");
const javascript = (source: string) => stripTypeScriptTypes(source).replace('"../alu.ts"',
  JSON.stringify(new URL("../../../../src/components/cpus/alu.js", import.meta.url).href));
type State = { a: number; b: number; s: number; p: number };
type Context = { readByte(address: number): number; writeByte(address: number, byte: number): void };
const sources = `source projected "read a captured pointer" (segment: 16, offset: 16): 8 {
  byte = memory(projectAddress(segment, offset, 4, 20))
  return byte
}
source selected "select one byte" (selector: 8, segment: 16, offset: 16): 8 {
  byte = match selector: 8 {
    case "00000000" {
      captured = source projected(segment, offset)
      return captured
    }
    case "00000001" {
      captured = register A
      return captured
    }
    otherwise unsupported
  }
  return byte
}`;

test("numeric family and source inputs preserve scope, captured addresses, and standalone decoder arguments", async () => {
  const chapter = compile(`${sources}
family probe (selector: 8, segment: 16, offset: 16) "00000000" {
  byte = source selected(selector, segment, offset)
  second = source projected(segment, add(offset, u16(1)))
  A <- byte
  B <- second
}`);
  const definition = chapter.families.probe![0]![1];
  const source = generateInstructions("probe", { probe: definition }, { sources: {
    cpu: definition.cpu, groups: { pointers: chapter.sources },
  } });
  assert.match(source, /decoders\.decode/); // The matching source is hoisted; projected is inline.
  const module: {
    instructions: { probe(state: State, selector: number, segment: number, offset: number, context: Pick<Context, "readByte">): void | "unsupported" };
    sourceReaders(state: State): { pointers: {
      selected(selector: number, segment: number, offset: number, context: Pick<Context, "readByte">): number | "unsupported";
      projected(segment: number, offset: number, context: Pick<Context, "readByte">): number;
    } };
  } = await import(`data:text/javascript,${encodeURIComponent(javascript(source))}`);
  const state = { a: 0x12, b: 0x34, s: 0xffff, p: 0xffff }, addresses: number[] = [];
  module.instructions.probe(state, 0, state.s, state.p, { readByte(address) {
    addresses.push(address); state.s = 0; state.p = 0;
    return addresses.length === 1 ? 0xa5 : 0x5a;
  } });
  assert.deepEqual(addresses, [0xffef, 0xffff0]);
  assert.deepEqual(state, { a: 0xa5, b: 0x5a, s: 0, p: 0 });
  const readers = module.sourceReaders(state).pointers;
  assert.equal(readers.selected(1, 0, 0, { readByte() { assert.fail("Register selection must not read RAM"); } }), 0xa5);
  assert.equal(readers.projected(0xffff, 0x10, { readByte(address) { assert.equal(address, 0); return 0x42; } }), 0x42);
  const before = { ...state };
  assert.equal(module.instructions.probe(state, 2, 0, 0, { readByte() { assert.fail("Rejected selection must stop the caller"); } }), "unsupported");
  assert.deepEqual(state, before);
  assert.equal(readers.selected(2, 0, 0, { readByte() { assert.fail(); } }), "unsupported");
  assert.match(describeInstruction(definition), /selector:u8 := selector[\s\S]*segment:u16 := segment[\s\S]*offset:u16 := offset/);
  assert.throws(() => generateInstructions("probe", { 0: definition }, { bindOpcodes: true }), /inputs/);
});

test("byte matches in nested actions propagate rejection and preserve completed effects without caller writeback", async () => {
  const chapter = compile(`${sources}
action copy "copy a selected operand" (selector: 8, segment: 16, offset: 16) using memory {
  A <- u8($11)
  byte = source selected(selector, segment, offset)
  match selector {
    case "00000000" {
      memory(projectAddress(segment, offset, 4, 20)) <- byte
    }
    otherwise unsupported
  }
  B <- byte
}
action wrapper "compose copy" (selector: 8) using memory {
  perform copy(selector, u16($FFFF), u16($0010))
  A <- u8($22)
}
family probe (selector: 8) "00000000" {
  perform wrapper(selector)
  B <- u8($33)
}`);
  const source = generateInstructions("probe", { probe: chapter.families.probe![0]![1] });
  const module: { instructions: { probe(state: State, selector: number, context: Context): void | "unsupported" } } =
    await import(`data:text/javascript,${encodeURIComponent(javascript(source))}`);
  for (const selector of [0, 1, 2]) for (const failAt of [-1, 0, 1]) {
    const state = { a: 0, b: 0, s: 0, p: 0 }, events: string[] = [], failure = Error("bus failure");
    const event = (name: string) => { events.push(name); if (events.length - 1 === failAt) throw failure; };
    const run = () => module.instructions.probe(state, selector, {
      readByte(address) { assert.equal(address, 0); event("read"); return 0x42; },
      writeByte(address, byte) { assert.equal(address, 0); assert.equal(byte, 0x42); event("write"); },
    });
    if (selector === 0 && failAt >= 0) assert.throws(run, error => error === failure);
    else assert.equal(run(), selector === 0 ? undefined : "unsupported");
    assert.deepEqual(state, { a: selector === 0 && failAt < 0 ? 0x22 : 0x11,
      b: selector === 0 && failAt < 0 ? 0x33 : 0, s: 0, p: 0 });
    assert.deepEqual(events, selector === 0 ? ["read", "write"].slice(0, failAt < 0 ? 2 : failAt + 1) : []);
  }
});

const scalar = 'source scalar "identity" (byte: 8): 8 {\n return byte\n}\n';
for (const [name, body, error] of [
  ["missing source inputs", `${scalar}family p "00000000" {\n byte = source scalar\n A <- byte\n}`, /arguments must match/],
  ["empty source arguments", `${scalar}family p "00000000" {\n byte = source scalar()\n}`, /Expected/],
  ["extra source arguments", `${scalar}family p "00000000" {\n byte = source scalar(u8(1), u8(2))\n}`, /Expected/],
  ["wrong source width", `${scalar}family p "00000000" {\n byte = source scalar(u16(1))\n}`, /expected 8-bit/],
  ["duplicate source inputs", 'source p "p" (x: 8, x: 8): 8 {\n return x\n}', /Duplicate parameter/],
  ["duplicate family inputs", 'family p (x: 8, x: 16) "00000000" {\n}', /Duplicate parameter/],
  ["view inputs", 'view BYTE "p" (x: 8): 8 {\n return x\n}', /Views cannot require inputs/],
  ["caller locals leaking in", 'source p "p" (x: 8): 8 {\n return caller\n}', /caller has not been captured/],
  ["source locals leaking out", `${scalar}family p "00000000" {\n result = source scalar(u8(1))\n A <- byte\n}`, /byte has not been captured/],
  ["projected register values", 'family p "00000000" {\n P <- projectAddress(u16(0), u16(0), 4, 20)\n}', /Unknown numeric operation/],
  ["wrong projection width", 'family p "00000000" {\n byte = memory(projectAddress(u8(0), u16(0), 4, 20))\n}', /word base and offset/],
  ["invalid projection shift", 'family p "00000000" {\n byte = memory(projectAddress(u16(0), u16(0), 32, 20))\n}', /shift/],
  ["memory hidden in action match", `${sources}\naction p "p" (x: 8) {\n match x {\n case "00000000" {\n byte = source projected(u16(0), u16(0))\n }\n otherwise unsupported\n }\n}`, /without using memory/],
  ["rejecting match in view", 'view BYTE "p": 8 {\n x = register A\n result = match x: 8 {\n case "00000000" {\n return x\n }\n otherwise unsupported\n }\n return result\n}', /Views may only read/],
] as const) test(`numeric inputs reject ${name} with a chapter diagnostic`, () => {
  assert.throws(() => compile(body), (thrown: unknown) => {
    assert.ok(thrown instanceof ChapterError); assert.equal(thrown.file, "inputs.md");
    assert.match(thrown.message, error); return true;
  });
});

test("IR source inputs validate names and widths independently of chapter parsing", () => {
  const definition = compile(`${scalar}family p "00000000" {\n}`).families.p![0]![1];
  const source = { name: "identity", width: 8 as const, inputs: { byte: 8 as const }, steps: [], result: value("byte") };
  const check = (args: Parameters<typeof readSource>[2]) => defineInstruction({ ...definition, steps: [readSource("result", source, args)] });
  assert.doesNotThrow(() => check({ byte: literal(8, 1) }));
  assert.throws(() => check(undefined), /arguments must match/);
  assert.throws(() => check({ other: literal(8, 1) }), /arguments must match/);
  assert.throws(() => check({ byte: literal(16, 1) }), /expected 8-bit/);
});
