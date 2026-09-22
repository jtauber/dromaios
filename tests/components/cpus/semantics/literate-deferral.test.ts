import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";

const compile = (body: string, cpu = "8088") => compileCpuChapter(`Deferral requests stay ordered and retire through the CPU boundary.

\`\`\`cpu
cpu "${cpu}"
state {
  register A: 8
}
${body}
\`\`\``, {}, "deferral.md");

test("8088 chapter deferral preserves scope, callback order, and failed partial effects", async () => {
  for (const scope of ["intr", "all"] as const) {
    const chapter = compile(`family enable "00000000" {
  A <- u8(1)
  defer ${scope}
  A <- u8(2)
}`);
    const source = generateInstructions("8088", { enable: chapter.families.enable![0]![1] });
    assert.match(source, /Pick<ByteInstructionContext & InterruptDeferralContext, "deferInterrupt">/);
    const javascript = stripTypeScriptTypes(source).replace('"../alu.ts"',
      JSON.stringify(new URL("../../../../src/components/cpus/alu.js", import.meta.url).href));
    const module: { instructions: { enable(state: { a: number }, context: { deferInterrupt(scope: "intr" | "all"): void }): void } } =
      await import(`data:text/javascript,${encodeURIComponent(javascript)}`);
    for (const fails of [false, true]) {
      const state = { a: 0 }, requests: string[] = [], failure = new Error("callback failed");
      const run = () => module.instructions.enable(state, { deferInterrupt(request) {
        assert.equal(state.a, 1); requests.push(request);
        if (fails) throw failure;
      } });
      if (fails) assert.throws(run, error => error === failure); else run();
      assert.deepEqual(requests, [scope]); assert.equal(state.a, fails ? 1 : 2);
    }
  }
});

test("deferral scopes require the matching CPU boundary", () => {
  const family = (scope: string) => `family enable "00000000" {\n  defer ${scope}\n}`;
  assert.throws(() => compile(family("nmi")), /deferral.md.*Expected irq, intr, or all/s);
  assert.throws(() => compile(family("irq")), /8088 interrupt deferral scope must be intr or all/);
  for (const scope of ["intr", "all"]) for (const cpu of ["8080", "probe"]) {
    assert.throws(() => compile(family(scope), cpu), /IRQ deferral needs a declared retirement destination/);
  }
});

test("8088 deferral remains unavailable to state actions and views, including untaken paths", () => {
  for (const scope of ["intr", "all"]) for (const hidden of [false, true]) {
    const body = hidden ? `when 0 {\n    defer ${scope}\n  }` : `defer ${scope}`;
    for (const [opening, ending] of [
      ['action enable "enable" {', ""], ['action enable "enable" using memory {', ""],
      ['view BYTE "byte" : 8 {', "\n  return u8(0)"],
    ]) assert.throws(() => compile(`${opening}\n  ${body}${ending}\n}`), /CPU boundaries/);
  }
});
