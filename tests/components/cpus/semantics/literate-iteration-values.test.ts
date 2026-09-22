import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import { ChapterError } from "../../../../src/components/cpus/semantics/literate/document.js";
import { checkByteExecution } from "../../../../src/components/cpus/semantics/literate/execution.js";
import { checkSegmentedEffects } from "../../../../src/components/cpus/semantics/literate/segmented-execution.js";
import { usesMemory } from "../../../../src/components/cpus/semantics/literate/statements.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";

const compile = (body: string) => compileCpuChapter(`A different CPU exercises typed loop locals.

\`\`\`cpu
cpu "probe"
state {
  register A: 8
  register B: 8
  register COUNT: 8
  flag F
}
policy result "publish local flag" (bit: flag) {
  F = bit
}
${body}
\`\`\``, {}, "locals.md");
type State = { a: number; b: number; count: number; flags: { f: boolean } };
type Context = { writeByte(address: number, byte: number): void };
async function executable(body: string) {
  const chapter = compile(body), definitions = Object.fromEntries(Object.values(chapter.families).flat());
  const source = stripTypeScriptTypes(generateInstructions("probe", definitions))
    .replace('"../alu.ts"', JSON.stringify(new URL("../../../../src/components/cpus/alu.js", import.meta.url).href));
  const module: { instructions: Record<number, (state: State, context?: Context) => "stop" | void> } =
    await import(`data:text/javascript,${encodeURIComponent(source)}`);
  return { ...module, chapter };
}
const localLoop = `iterate(count) {
    left: 8 = u8(1)
    right: 8 = u8(2)
    bit: flag = 0
    step {
      next left = right
      next right = add(left, right)
      next bit = not(bit)
    }
  }`;
const family = `family run "00000000" {
  count = register COUNT
  ${localLoop}
  A <- left
  B <- right
  apply result(bit)
}`;

test("typed iteration updates numeric and flag locals together for zero through 255 steps", async () => {
  const { instructions, chapter } = await executable(family);
  const steps = chapter.families.run![0]![1].steps;
  checkByteExecution(steps); checkSegmentedEffects(steps, "stop");
  for (let count = 0; count < 256; count++) {
    let left = 1, right = 2;
    for (let i = 0; i < count; i++) [left, right] = [right, (left + right) % 256];
    const state = { a: 99, b: 99, count, flags: { f: true } }, events: string[] = [];
    const observed = new Proxy(state, { set(target, key, value) { events.push(String(key)); return Reflect.set(target, key, value); } });
    instructions[0]!(observed);
    assert.deepEqual(state, { a: left, b: right, count, flags: { f: count % 2 !== 0 } });
    assert.deepEqual(events, ["a", "b"], "loop locals do not write registers");
  }
});

const memoryLoop = `action repeat "ordered effects" (count: 8) using memory {
  iterate(count) {
    address: 16 = u16($FFFE)
    byte: 8 = u8($FE)
    step {
      next = add(byte, u8(1))
      memory(address) <- next
      A <- next
      next address = add(address, u16(1))
      next byte = next
    }
  }
  B <- byte
}
family run "00000000" {
  count = register COUNT
  perform repeat(count)
}`;

test("typed loop capabilities and failures retain completed effects and a captured count", async () => {
  const { instructions, chapter } = await executable(memoryLoop), writes: number[][] = [];
  assert.equal(usesMemory(chapter.actions.repeat!.steps), true);
  checkByteExecution(chapter.families.run![0]![1].steps);
  const state = { a: 77, b: 77, count: 4, flags: { f: false } };
  instructions[0]!(state, { writeByte(address, byte) { writes.push([address, byte]); state.count = 0; } });
  assert.deepEqual(writes, [[65534, 255], [65535, 0], [0, 1], [1, 2]]);
  assert.equal(state.a, 2); assert.equal(state.b, 2);
  const failure = Error("third write"); let accesses = 0;
  state.count = 4; state.a = 77; state.b = 77;
  assert.throws(() => instructions[0]!(state, { writeByte() { if (++accesses === 3) throw failure; } }), error => error === failure);
  assert.equal(state.a, 0); assert.equal(state.b, 77);
});

test("typed loops nest and named rejection exits the enclosing instruction", async () => {
  const nested = family.replace('next left = right', `inner = iterate(u8(2), left) {
        return add(inner, u8(1))
      }
      next left = inner`);
  const { instructions } = await executable(nested), state = { a: 0, b: 0, count: 2, flags: { f: false } };
  instructions[0]!(state); assert.equal(state.a, 5);
  const stopping = memoryLoop.replace('next = add(byte, u8(1))', 'reject "stop" if zero(byte)\n      next = add(byte, u8(1))')
    .replace('action repeat "ordered effects" (count: 8) using memory {', 'family run "00000000" {\n  count = register COUNT')
    .split('\nfamily run')[0]!;
  const compiled = await executable(stopping); state.count = 4; state.b = 99;
  assert.equal(compiled.instructions[0]!(state, { writeByte() {} }), "stop");
  assert.equal(state.a, 0); assert.equal(state.b, 99);
  const steps = compiled.chapter.families.run![0]![1].steps;
  assert.throws(() => checkByteExecution(steps), /does not support reject/);
  checkSegmentedEffects(steps, "stop");
  assert.throws(() => checkSegmentedEffects(steps, "another"), /declared segmented fault/);
});

test("typed iteration retains document locations for invalid locals, updates, scopes, and effects", () => {
  const invalid = [
    family.replace('iterate(count)', 'iterate(u16(1))'),
    'family noStep "00000000" {\n  iterate(u8(1)) {\n    local: 8 = u8(0)\n  }\n}',
    family.replace('next bit = not(bit)\n    }', 'next bit = not(bit)\n    }\n    A <- left'),
    family.replace('next bit = not(bit)\n    }', 'next bit = not(bit)\n    }\n    step {\n    }'),
    family.replace('left: 8 = u8(1)', 'left: 8 = u16(1)'),
    family.replace('left: 8 = u8(1)', 'left: 8 = right'),
    family.replace('left: 8 = u8(1)', 'left: 8 = left'),
    family.replace('right: 8 = u8(2)', 'left: 8 = u8(2)'),
    family.replace('left: 8 = u8(1)', 'count: 8 = u8(1)'),
    family.replace('left: 8 = u8(1)', 'left: 64 = u8(1)'),
    family.replace('bit: flag = 0', 'bit: flag = u8(0)'),
    family.replace('next left = right', 'next left = u16(1)'),
    family.replace('next bit = not(bit)', 'next bit = u8(1)'),
    family.replace('next left = right', 'next unknown = right'),
    family.replace('next left = right', ''),
    family.replace('next left = right', 'next left = right\n      next left = left'),
    family.replace('next left = right', 'temporary = right\n      next left = temporary').replace('A <- left', 'A <- temporary'),
    family.replace('next left = right', 'left = right\n      next left = left'),
    family.replace('next bit = not(bit)', 'next bit = not(bit)\n      A <- left'),
    memoryLoop.replace(' using memory', ''),
    memoryLoop.replace('memory(address) <- next', 'fetched = fetch'),
    `view bad "loop writes": 8 {\n  count = u8(0)\n  ${localLoop.replace('next left = right', 'A <- left\n      next left = right')}\n  return left\n}`,
    `family empty "00000000" {\n  iterate(u8(1)) {\n    step {\n    }\n  }\n}`,
  ];
  for (const body of invalid) assert.throws(() => compile(body), (error: unknown) => {
    assert.ok(error instanceof ChapterError); assert.equal(error.file, "locals.md"); assert.ok(error.line >= 14);
    return true;
  }, body);
});
