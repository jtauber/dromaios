import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import { ChapterError } from "../../../../src/components/cpus/semantics/literate/document.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";

const document = (body: string) => `Explicit widths share behavior without changing runtime types.

\`\`\`cpu
cpu "probe"
state {
  register A: 8
  flag C
  flag Z
  flag N
  flag P
}
${body}
\`\`\``;
const compile = (body: string) => compileCpuChapter(document(body), {}, "widths.md");
type State = { a: number; flags: { c: boolean; z: boolean; n: boolean; p: boolean } };
type Context = { writeByte(address: number, byte: number): void };
async function readers(body: string, state: State) {
  const chapter = compile(`${body}\nfamily noop "00000000" {\n}`);
  const instruction = chapter.families.noop![0]![1];
  const source = stripTypeScriptTypes(generateInstructions("probe", { noop: instruction }, {
    sources: { cpu: instruction.cpu, groups: { values: chapter.sources } },
  })).replace('"../alu.ts"', JSON.stringify(new URL("../../../../src/components/cpus/alu.js", import.meta.url).href));
  const module: { sourceReaders(state: State): { values: Record<string, (...args: (number | Context)[]) => number | "unsupported"> } } =
    await import(`data:text/javascript,${encodeURIComponent(source)}`);
  return { chapter, values: module.sourceReaders(state).values };
}
const initial = (): State => ({ a: 0, flags: { c: false, z: false, n: false, p: false } });
const arithmetic = `policy flags<bits: 8, 16, 32> "addition flags" (left: bits, right: bits, result: bits) {
  C = carry(left, right)
  Z = zero(result)
  N = negative(result)
  P = evenParity(lowByte(result))
}
source addValue<bits: 8, 16, 32> "add with flags" (left: bits, right: bits): bits {
  result: bits = add(left, right)
  apply flags<bits>(left, right, result)
  return result
}`;

test("width-specialized sources and policies generate callable readers with correct arithmetic and low-byte parity", async () => {
  const state = initial(), { chapter, values } = await readers(arithmetic, state);
  assert.deepEqual(Object.keys(chapter.sources), ["addValue<8>", "addValue<16>", "addValue<32>"]);
  for (const width of [8, 16, 32]) {
    const limit = 2 ** width;
    for (const [left, right] of [[0, 0], [limit - 1, 1], [limit / 2 - 1, 1], [limit / 2, limit / 2], [0x55, 0xab]]) {
      const result = (left! + right!) % limit;
      assert.equal(values[`addValue<${width}>`]!(left!, right!), result);
      assert.deepEqual(state.flags, { c: left! + right! >= limit, z: result === 0,
        n: result >= limit / 2, p: (result & 255).toString(2).replaceAll("0", "").length % 2 === 0 });
    }
  }
  const changed = await readers(arithmetic.replace("Z = zero(result)", "Z = not(zero(result))"), state);
  for (const width of [8, 16, 32]) {
    changed.values[`addValue<${width}>`]!(0, 0); assert.equal(state.flags.z, false);
  }
});

const nested = `${arithmetic}
source selected<bits: 8, 16, 32> "bits stays prose" (selector: 8, input: bits): bits {
  result = match selector: bits {
    case "00000000" {
      selected = choose zero(input): bits {
        then {
          return u<bits>(1)
        }
        else {
          return input
        }
      }
      iterate(u8(2)) {
        total: bits = selected
        step {
          incremented = source addValue<bits>(total, u<bits>(1))
          next total = incremented
        }
      }
      return total
    }
    otherwise unsupported
  }
  return result
}`;

test("width bindings survive nested matches, choices, loops, typed literals, and source calls", async () => {
  const state = initial(), { chapter, values } = await readers(nested, state);
  for (const width of [8, 16, 32]) {
    const read = values[`selected<${width}>`]!;
    assert.equal(chapter.sources[`selected<${width}>`]!.name, "bits stays prose");
    assert.equal(read(0, 0), 3); assert.equal(read(0, 2 ** width - 1), 1);
    const before = structuredClone(state);
    assert.equal(read(1, 0), "unsupported"); assert.deepEqual(state, before);
  }
});

test("specialized sources retain ordered effects when a later access fails", async () => {
  const state = initial(), { values } = await readers(`source store<bits: 8, 16> "ordered byte writes" (input: bits): bits {
  byte = lowByte(input)
  A <- byte
  memory(u16(0)) <- byte
  A <- u8(1)
  memory(u16(1)) <- byte
  A <- u8(2)
  return input
}`, state);
  for (const width of [8, 16]) for (const failAt of [0, 1, 2]) {
    const writes: number[][] = [], failure = Error("bus failure"); state.a = 99;
    const run = () => values[`store<${width}>`]!(width === 8 ? 0xab : 0x12ab, {
      writeByte(address, byte) { writes.push([address, byte]); if (address === failAt) throw failure; },
    });
    if (failAt < 2) assert.throws(run, error => error === failure);
    else assert.equal(run(), width === 8 ? 0xab : 0x12ab);
    assert.equal(state.a, [0xab, 1, 2][failAt]);
    assert.deepEqual(writes, [[0, 0xab], [1, 0xab]].slice(0, failAt + 1));
  }
});

const identity = 'source identity<bits: 8, 16> "identity" (input: bits): bits {\n  return input\n}';
for (const [name, body, message] of [
  ["duplicate widths", identity.replace("8, 16", "8, 8"), /Duplicate width 8/],
  ["unsupported width", identity.replace("8, 16", "8, 24"), /width/],
  ["empty width list", identity.replace("8, 16", ""), /Expected/],
  ["reserved flag parameter", identity.replaceAll("bits", "flag"), /cannot be named flag/],
  ["unbound width", identity.replace("input: bits", "input: other"), /Expected/],
  ["multiple width parameters", identity.replace("8, 16", "8, other: 16"), /Expected/],
  ["unused invalid specialization", identity.replace("return input", "return u8(0)"), /expected 16-bit|result width/],
  ["unused invalid policy specialization", 'policy parity<bits: 8, 16> "byte parity" (result: bits) {\n  P = evenParity(result)\n}', /parity requires a byte/],
  ["invalid narrow literal", identity.replace("return input", "return u<bits>(256)"), /8-bit|fit/],
  ["duplicate base declaration", `${identity}\n${identity}`, /Duplicate declaration identity/],
  ["missing specialization", `${identity}\nsource p "p": 8 {\n  v = source identity(u8(1))\n  return v\n}`, /Unknown name identity;/],
  ["undeclared specialization", `${identity}\nsource p "p": 32 {\n  v = source identity<32>(u32(1))\n  return v\n}`, /Unknown name identity<32>/],
  ["wrong runtime argument width", `${identity}\nsource p "p": 8 {\n  v = source identity<8>(u16(1))\n  return v\n}`, /expected 8-bit/],
  ["recursive reference", identity.replace("return input", "v = source identity<bits>(input)\n  return v"), /Unknown name identity<8>/],
  ["forward reference", identity.replace("return input", "v = source later<bits>(input)\n  return v"), /Unknown name later<8>/],
  ["generic action", 'action p<bits: 8> "p" {\n}', /Only sources and policies/],
  ["generic view", 'view GENERIC<bits: 8> "p": bits {\n  return u<bits>(0)\n}', /Only sources and policies/],
] as const) test(`width parameters reject ${name}`, () => {
  assert.throws(() => compile(body), error => {
    assert.ok(error instanceof ChapterError); assert.equal(error.file, "widths.md");
    assert.match(error.message, message); return true;
  });
});

test("specialization errors preserve Markdown locations and identify the failing width", () => {
  const body = identity.replace("return input", "return u8(0)"), text = document(body);
  assert.throws(() => compile(body), error => {
    assert.ok(error instanceof ChapterError);
    assert.equal(error.line, text.split("\n").findIndex(line => line.includes("return u8(0)")) + 1);
    assert.equal(error.column, 1); assert.match(error.message, /with bits = 16/); return true;
  });
});

test("all numeric widths can specialize and lowByte accepts exactly widths of at least eight bits", async () => {
  const body = `source zeroValue<bits: 3, 8, 14, 16, 32> "zero": bits {
  return u<bits>(0)
}
source byte<bits: 8, 14, 16, 32> "low byte" (input: bits): 8 {
  return lowByte(input)
}`;
  const { values } = await readers(body, initial());
  for (const width of [3, 8, 14, 16, 32]) assert.equal(values[`zeroValue<${width}>`]!(), 0);
  for (const width of [8, 14, 16, 32]) assert.equal(values[`byte<${width}>`]!(2 ** width - 0x55), 0xab);
  assert.throws(() => compile(body.replace("byte<bits: 8", "byte<bits: 3")), /at least eight bits/);
});

test("specialized sources bind to families and operand catalogues, and policies support full replacement", () => {
  const chapter = compile(`source one<bits: 8, 16> "constant one": bits {
  return u<bits>(1)
}
policy allFlags<bits: 8, 16> "all status bits" (result: bits) {
  C = 0
  Z = zero(result)
  N = negative(result)
  P = evenParity(lowByte(result))
}
operands bytes {
  0 "one" = value one<8>
  1 "at one" = memory one<16>
}
family bound "00000000" with value = one<8> {
  byte = source value
  replace allFlags<8>(byte)
  A <- byte
}
family selected "0000001s" for s in bytes {
  byte = operand s
  A <- byte
}`);
  assert.deepEqual(chapter.families.selected!.map(([opcode]) => opcode), [2, 3]);
});
