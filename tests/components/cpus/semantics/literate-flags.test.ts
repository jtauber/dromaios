import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import { ChapterError } from "../../../../src/components/cpus/semantics/literate/document.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";
import { describeInstruction } from "../../../../src/components/cpus/semantics/describe.js";

const compile = (body: string) => compileCpuChapter(`Boolean values retain their type and read order.
\`\`\`cpu
cpu "probe"
state {
  register A: 8
  register OUT: 8
  flag C
  flag Z
}
${body}
\`\`\``, {}, "flags.md");
const javascript = (source: string) => stripTypeScriptTypes(source).replace('"../alu.ts"',
  JSON.stringify(new URL("../../../../src/components/cpus/alu.js", import.meta.url).href));
type State = { a: number; out: number; flags: { c: boolean; z: boolean } };
const decisions = `source decide "threshold or incoming carry" (byte: 8, forced: flag): flag {
  aboveNine: flag = not(lessThan(byte, u8(10), unsigned))
  decision = choose or(aboveNine, forced) : flag {
    then {
      return 1
    }
    else {
      incoming = flag C
      return incoming
    }
  }
  return decision
}
source invert "invert a captured decision" (input: flag): flag {
  return not(input)
}
policy CLEAR "clear carry" () {
  C = 0
}
action remember "remember a decision before clearing carry" (decision: flag, marker: 8) {
  apply CLEAR()
  OUT <- select(decision, marker, u8(0))
}`;

test("Boolean captures, source results, and arguments retain conditional reads and captured values", async () => {
  const chapter = compile(`${decisions}
family probe (forced: flag) "00000000" {
  OUT <- u8($11)
  original = register A
  decision = source decide(original, and(forced, 1))
  opposite = source invert(decision)
  marker: 8 = u8($A5)
  perform remember(not(opposite), marker)
}`);
  const definition = chapter.families.probe![0]![1];
  const source = generateInstructions("probe", { probe: definition }, { sources: {
    cpu: definition.cpu, groups: { decisions: chapter.sources },
  } });
  const module: {
    instructions: { probe(state: State, forced: boolean): void };
    sourceReaders(state: State): { decisions: { decide(byte: number, forced: boolean): boolean; invert(input: boolean): boolean } };
  } = await import(`data:text/javascript,${encodeURIComponent(javascript(source))}`);
  for (let byte = 0; byte < 256; byte++) for (const carry of [false, true]) for (const forced of [false, true]) {
    const flags = { c: carry, z: false }, reads: string[] = [];
    const state: State = { a: byte, out: 0, flags: new Proxy(flags, { get(target, key, receiver) {
      reads.push(String(key)); return Reflect.get(target, key, receiver);
    } }) };
    module.instructions.probe(state, forced);
    assert.equal(state.out, byte >= 10 || carry || forced ? 0xa5 : 0);
    assert.equal(flags.c, false);
    assert.deepEqual(reads, byte < 10 && !forced ? ["c"] : []);
    const readers = module.sourceReaders({ a: 0, out: 0, flags: { c: carry, z: false } }).decisions;
    assert.equal(readers.decide(byte, forced), byte >= 10 || carry || forced);
    assert.equal(readers.invert(carry), !carry);
  }
  const failure = Error("carry read failed"), state: State = { a: 0, out: 0, flags: {
    get c(): boolean { throw failure; }, z: false,
  } };
  assert.throws(() => module.instructions.probe(state, false), error => error === failure);
  assert.equal(state.out, 0x11);
  const description = describeInstruction(definition);
  assert.match(description, /aboveNine:flag :=/);
  assert.match(description, /forced:flag := input/);
  assert.match(description, /decision:flag :=/);
  assert.match(describeInstruction(chapter.actions.remember!), /decision:flag := input\nmarker:u8 := input/);
});

test("Boolean matching sources distinguish false from unsupported and preserve partial effects", async () => {
  const chapter = compile(`source decode "one-bit decision" (invert: flag): flag {
  selector = fetch
  result = match selector: flag {
    case "00000000" {
      incoming = flag C
      return xor(incoming, invert)
    }
    case "00000001" {
      return not(invert)
    }
    otherwise unsupported
  }
  return result
}
family probe "00000000" {
  OUT <- u8($11)
  decision = source decode(0)
  OUT <- select(decision, u8($A5), u8(0))
}`);
  const definition = chapter.families.probe![0]![1];
  const source = generateInstructions("probe", { probe: definition }, { sources: {
    cpu: definition.cpu, groups: { decisions: chapter.sources },
  } });
  assert.match(source, /decoders\.decode/);
  type Context = { fetchByte(): number };
  const module: {
    instructions: { probe(state: State, context: Context): void | "unsupported" };
    sourceReaders(state: State): { decisions: { decode(invert: boolean, context: Context): boolean | "unsupported" } };
  } = await import(`data:text/javascript,${encodeURIComponent(javascript(source))}`);
  for (const selector of [0, 1, 2]) for (const carry of [false, true]) {
    const state: State = { a: 0, out: 0, flags: { c: carry, z: false } }, context = { fetchByte: () => selector };
    assert.equal(module.instructions.probe(state, context), selector > 1 ? "unsupported" : undefined);
    assert.equal(state.out, selector > 1 ? 0x11 : selector === 1 || carry ? 0xa5 : 0);
    for (const invert of [false, true]) assert.equal(module.sourceReaders(state).decisions.decode(invert, context),
      selector > 1 ? "unsupported" : (selector === 1 || carry) !== invert);
  }
  const state: State = { a: 0, out: 0, flags: { c: false, z: false } }, failure = Error("fetch failed");
  assert.throws(() => module.instructions.probe(state, { fetchByte() { throw failure; } }), error => error === failure);
  assert.equal(state.out, 0x11);
});

test("typed captures retain contextual names instead of being parsed as effect statements", () => {
  const chapter = compile(`family probe "00000000" {
  exchange: flag = 1
  stage: flag = not(exchange)
  notify: 8 = select(stage, u8(0), u8(1))
  OUT <- notify
}`);
  assert.match(describeInstruction(chapter.families.probe![0]![1]), /stage:flag := not\(exchange\)/);
});

const identity = 'source identity "Boolean identity" (input: flag): flag {\n return input\n}\n';
for (const [name, body, expected] of [
  ["numeric Boolean capture", 'family p "00000000" {\n decision: flag = u8(1)\n}', /flag|Boolean/],
  ["Boolean numeric capture", 'family p "00000000" {\n decision: 8 = equal(u8(0), u8(0))\n}', /numeric|not a number/],
  ["wrong annotated width", 'family p "00000000" {\n count: 8 = u16(1)\n}', /capture width/],
  ["duplicate typed capture", 'family p "00000000" {\n decision: flag = 0\n decision: flag = 1\n}', /duplicate capture/],
  ["numeric Boolean argument", `${identity}family p "00000000" {\n decision = source identity(u8(1))\n}`, /flag|Boolean/],
  ["missing Boolean argument", `${identity}family p "00000000" {\n decision = source identity\n}`, /arguments must match/],
  ["numeric Boolean return", 'source p "p": flag {\n byte = register A\n return byte\n}', /flag byte/],
  ["Boolean numeric return", 'source p "p": 8 {\n decision = flag C\n return decision\n}', /numeric|not a number/],
  ["Boolean register write", `${identity}family p "00000000" {\n decision = source identity(0)\n A <- decision\n}`, /numeric|not a number/],
  ["Boolean address", `${identity}family p "00000000" {\n decision = source identity(0)\n byte = memory(decision)\n}`, /numeric|not a number/],
  ["caller scope in source", 'source p "p": flag {\n return decision\n}', /not been captured/],
  ["source scope in caller", `${identity}family p "00000000" {\n decision = source identity(0)\n escaped: flag = input\n}`, /not been captured/],
  ["wrong conditional branch", 'family p "00000000" {\n decision = choose 1 : flag {\n then {\n return 1\n }\n else {\n byte = register A\n return byte\n }\n }\n}', /flag byte/],
  ["wrong match branch", 'family p "00000000" {\n decision = match u8(0): flag {\n case "00000000" {\n byte = register A\n return byte\n }\n otherwise unsupported\n }\n}', /flag byte/],
] as const) test(`Boolean values reject ${name} with a chapter diagnostic`, () => {
  assert.throws(() => compile(body), (error: unknown) => {
    assert.ok(error instanceof ChapterError); assert.equal(error.file, "flags.md"); assert.ok(error.line > 0);
    assert.match(error.message, expected); return true;
  });
});
