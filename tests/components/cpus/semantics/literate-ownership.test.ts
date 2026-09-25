import assert from "node:assert/strict";
import { test } from "node:test";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";

const body = `  byte = source accumulator
  perform store(byte)
  apply ZERO(byte)`;
const markdown = `Shared declarations retain their own scopes.
\`\`\`cpu
cpu "probe"
state {
  register A: 8
  flag Z
}
source accumulator "read accumulator": 8 {
  byte = register A
  return byte
}
policy ZERO "zero flag" (byte: 8) {
  Z = zero(byte)
}
action store "store byte" (byte: 8) {
  A <- byte
}
family first "00000000" {
${body}
}
family second "00000001" {
${body}
}
\`\`\``;

test("chapter instructions share owned declarations and action bodies, independently of later compilations", () => {
  const chapter = compileCpuChapter(markdown), again = compileCpuChapter(markdown);
  const first = chapter.families.first![0]![1], second = chapter.families.second![0]![1];
  assert.notEqual(first, second, "separate family declarations retain their definitions");
  assert.equal(first.cpu, second.cpu);
  assert.equal(first.cpu.state, chapter.state);
  assert.equal(first.cpu, chapter.actions.store!.cpu);
  for (const definition of [first, second]) {
    const [read, perform, apply] = definition.steps;
    assert.ok(read?.kind === "read-source" && perform?.kind === "perform" && apply?.kind === "update-flags");
    assert.equal(read.source, chapter.sources.accumulator);
    assert.equal(perform.action.steps, chapter.actions.store!.steps);
    assert.equal(apply.policy, chapter.policies.ZERO);
    assert.ok(Object.isFrozen(read.source.result));
    assert.ok(Object.isFrozen(apply.policy.updates));
    assert.throws(() => Object.assign(read.source.result, { name: "missing" }), TypeError);
    assert.throws(() => Object.assign(apply.policy.updates, { length: 0 }), TypeError);
  }
  assert.deepEqual(again, chapter);
  assert.notEqual(again.sources.accumulator, chapter.sources.accumulator);
  assert.notEqual(again.policies.ZERO, chapter.policies.ZERO);
  assert.notEqual(again.families.first![0]![1].cpu, first.cpu);
  assert.deepEqual(compileCpuChapter(markdown.replace("return byte", "return u8(9)")).sources.accumulator!.result,
    { kind: "literal", width: 8, value: 9 });
  assert.deepEqual(chapter.sources.accumulator!.result, { kind: "value", name: "byte" });
});
