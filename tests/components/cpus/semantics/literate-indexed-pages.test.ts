import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";

const markdown = `A page layout captures bytes before the final opcode.

\`\`\`cpu
cpu "probe"
state {
  register IX: 16
  register IY: 16
}
page first = $20
page second = $40
page nested = $30 on first {
  offset:8 = read
  opcode = read
}
page fetched = $30 on second {
  offset:8 = read
  opcode = fetch
}
\`\`\`

The selected register is read only after decoding finishes.

\`\`\`cpu
family adjust {
  encoding "0000 0001" on nested with i = register IX named "ADJUST {i}"
  encoding "0000 0001" on fetched with i = register IY named "ADJUST {i}"
  base = operand i
  operand i <- add(base, signExtend(offset, 16))
}
\`\`\``;
const compile = (text = markdown) => compileCpuChapter(text);
type State = { ix: number; iy: number };
type Context = { fetchByte(): number };
interface Generated {
  opcodeDecoder(state: State, additional?: { first?: readonly (readonly [number, (context: Context) => void])[] }): (opcode: number, nextByte: (opcodeFetch: boolean) => number) => {
    handler: ((context: Context) => void) | undefined; opcodeFetches: number;
  };
  opcodeEntries(state: State): readonly (readonly [number, (context: Context) => void | "unsupported"])[];
}
async function executable(text = markdown): Promise<Generated> {
  const chapter = compile(text);
  const code = generateInstructions("probe", Object.fromEntries(Object.values(chapter.families).flat()), { bindOpcodes: true, pages: chapter.pages });
  const javascript = stripTypeScriptTypes(code).replace('"../opcodes.ts"',
    JSON.stringify(new URL("../../../../src/components/cpus/opcodes.js", import.meta.url).href))
    .replace('"../alu.ts"', JSON.stringify(new URL("../../../../src/components/cpus/alu.js", import.meta.url).href));
  return import(`data:text/javascript,${encodeURIComponent(javascript)}`);
}

test("nested pages capture operands in order and defer every state effect until execution", async () => {
  const module = await executable(), failure = new Error("read failed");
  assert.deepEqual(Object.values(compile().families).flat().map(([opcode, body]) => [opcode, body.name, body.inputs]),
    [[0x203001, "ADJUST IX", { offset: 8 }], [0x403001, "ADJUST IY", { offset: 8 }]]);
  for (const prefix of [0x20, 0x40]) for (const opcode of [1, 2]) for (const failAt of [-1, 0, 1, 2]) {
    const state = { ix: 0, iy: 0 }, events: string[] = [], bytes = [0x30, 0xff, opcode];
    const observed = new Proxy(state, {
      get(target, key, receiver) { events.push(`get ${String(key)}`); return Reflect.get(target, key, receiver); },
      set(target, key, value) { events.push(`set ${String(key)}`); return Reflect.set(target, key, value); },
    });
    const decode = module.opcodeDecoder(observed); assert.equal(events.length, 0);
    let reads = 0;
    const run = () => decode(prefix, fetch => {
      events.push(fetch ? "fetch" : "read"); if (reads++ === failAt) throw failure;
      return bytes.shift()!;
    });
    if (failAt >= 0) {
      assert.throws(run, error => error === failure);
      assert.deepEqual(events, ["fetch", "read", prefix === 0x20 ? "read" : "fetch"].slice(0, failAt + 1));
    } else {
      const decoded = run();
      assert.equal(decoded.opcodeFetches, prefix === 0x20 ? 2 : 3);
      assert.deepEqual(events, ["fetch", "read", prefix === 0x20 ? "read" : "fetch"]);
      assert.equal(typeof decoded.handler, opcode === 1 ? "function" : "undefined");
      if (decoded.handler) {
        state.ix = state.iy = 0x8000;
        decoded.handler({ fetchByte() { assert.fail("The captured byte must not be fetched again"); } });
        const field = prefix === 0x20 ? "ix" : "iy";
        assert.deepEqual(events.slice(3), [`get ${field}`, `set ${field}`]);
        assert.equal(state[field], 0x7fff);
      }
    }
  }
  assert.throws(() => module.opcodeDecoder({ ix: 0, iy: 0 }, { first: [[0x30, () => {}]] }), /Duplicate opcode page prefix/);
  const handlers = Object.fromEntries(module.opcodeEntries({ ix: 0, iy: 0 }));
  const bytes = [0x30, 0xff, 1]; handlers[0x20]!({ fetchByte: () => bytes.shift()! });
  assert.deepEqual(bytes, []);
  const unknown = module.opcodeDecoder({ ix: 0, iy: 0 })(0x20, () => 0x31);
  assert.equal(unknown.handler, undefined); assert.equal(unknown.opcodeFetches, 2);
});

test("page captures use hygienic generated names and follow edited prefix declarations", async () => {
  const module = await executable(markdown.replaceAll("offset", "execute").replace("page first = $20", "page first = $50"));
  const state = { ix: 0, iy: 0 }, decode = module.opcodeDecoder(state);
  assert.equal(decode(0x20, () => assert.fail("Old prefix must not fetch")).handler, undefined);
  const bytes = [0x30, 0xff, 1], result = decode(0x50, () => bytes.shift()!);
  result.handler!({ fetchByte: () => assert.fail("No repeated fetch") }); assert.equal(state.ix, 0xffff);
});

test("nested page layouts reject ambiguous paths, captures, and bindings before generation", () => {
  for (const [from, to, diagnostic] of [
    ["on first", "on missing", /earlier.*root page/],
    ["on second", "on nested", /earlier.*root page/],
    ["on second", "on first", /Duplicate opcode page prefix/],
    ["offset:8", "offset:16", /Expected/],
    ["offset:8 = read", "offset:8 = fetch", /Expected "read"/],
    ["offset:8 = read", "offset:8 = read\n  offset:8 = read", /distinct identifiers/],
    ["offset:8 = read", "IX:8 = read", /shadow declarations/],
    ["opcode = read", "opcode = missing", /Expected "read"/],
    ["with i = register IX", "with offset = register IX", /must not shadow/],
  ] as const) assert.throws(() => compile(markdown.replace(from, to)), diagnostic);
  assert.throws(() => compile(markdown + '\nA colliding instruction.\n\n```cpu\nfamily collision "0011 0000" on first {\n}\n```'), /collides/);
  const chapter = compile(), definitions = Object.fromEntries(Object.values(chapter.families).flat());
  assert.throws(() => generateInstructions("probe", definitions, { bindOpcodes: true,
    pages: { first: 0x20, second: 0x40, nested: { prefix: 0x30, on: "first", operands: [], opcodeFetch: false } } }), /inputs must match|no declared page/);
});
