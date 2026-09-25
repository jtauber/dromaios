import assert from "node:assert/strict";
import { test } from "node:test";
import { chapterBody, ChapterError, ChapterTokens } from "../../../../src/components/cpus/semantics/literate/document.js";
import { expression } from "../../../../src/components/cpus/semantics/literate/expressions.js";

test("replayed lines have independent positions and retain quoted braces, escapes, and comments", () => {
  const text = '  word "a \\"quote\\" } // still quoted" { // trailing }';
  const tokens = new ChapterTokens({ text, line: 17 }, "tokens.md");
  assert.equal(tokens.word(), "word");
  const first = tokens.replay(), second = tokens.replay();
  assert.equal(first.column, 3);
  assert.equal(first.word(), "word");
  assert.equal(first.quoted(), 'a "quote" } // still quoted');
  assert.equal(first.opensBlock, true);
  first.expect("{"); first.end();
  assert.equal(first.column, text.length + 1);
  assert.equal(second.word(), "word");
  assert.equal(second.column, 8);
  assert.equal(tokens.column, 8);
  assert.equal(tokens.quoted(), 'a "quote" } // still quoted');
  assert.equal(second.quoted(), 'a "quote" } // still quoted');
  assert.equal(first.next, undefined);
  assert.equal(first.replay().word(), "word");
});

test("specialization resumes a header while body replay starts over and keeps its width binding", () => {
  const tokens = new ChapterTokens({ text: "  return u<bits>(3)", line: 23 }, "widths.md");
  tokens.expect("return");
  const byte = tokens.specialize({ name: "bits", value: 8 });
  const word = tokens.specialize({ name: "bits", value: 16 });
  assert.deepEqual(expression(byte), { kind: "literal", width: 8, value: 3 });
  assert.equal(tokens.next, "u"); assert.equal(word.next, "u");
  assert.deepEqual(expression(word), { kind: "literal", width: 16, value: 3 });
  byte.end(); word.end();
  for (const [copy, width] of [[byte.replay(), 8], [word.replay(), 16], [byte.replay({ name: "bits", value: 32 }), 32]] as const) {
    assert.equal(copy.file, "widths.md"); assert.equal(copy.source.line, 23);
    copy.expect("return");
    assert.deepEqual(expression(copy), { kind: "literal", width, value: 3 }); copy.end();
  }
  assert.equal(tokens.widthParameter, undefined);
  assert.equal(byte.widthParameter!.value, 8); assert.equal(word.widthParameter!.value, 16);
});

test("consumed nested block boundaries can be replayed without consuming the original or another expansion", () => {
  const texts = ["outer {", "  when 1 {", "    A <- u8(1)", "  }", "}"];
  const lines = texts.map((text, index) => new ChapterTokens({ text, line: index + 10 }, "blocks.md"));
  const outer = chapterBody(lines, 0); // Consumes the outer closing brace.
  const inner = chapterBody(outer.body, 0); // Consumes the inner closing brace.
  assert.equal(inner.body.length, 1); assert.equal(outer.end, 4);
  for (let repeat = 0; repeat < 2; repeat++) {
    const replay = lines.map(line => line.replay());
    const nested = chapterBody(chapterBody(replay, 0).body, 0);
    assert.equal(nested.body[0]!.word(), "A");
  }
  assert.equal(lines[2]!.next, "A");
  assert.equal(lines[3]!.next, undefined); assert.equal(lines[4]!.next, undefined);
});

test("replayed diagnostics keep the original file, token column, and active specialization", () => {
  const tokens = new ChapterTokens({ text: "  read missing", line: 42 }, "diagnostics.md");
  tokens.expect("read");
  const unbound = tokens.replay(), bound = tokens.specialize({ name: "bits", value: 16 });
  unbound.expect("read");
  for (const [copy, suffix] of [[unbound, ""], [bound, " (with bits = 16)"]] as const) {
    assert.throws(() => copy.lookup(new Map()), error => {
      assert.ok(error instanceof ChapterError);
      assert.deepEqual([error.file, error.line, error.column], ["diagnostics.md", 42, 8]);
      assert.equal(error.message, `diagnostics.md:42:8: Unknown name missing; declare it before use.${suffix}`);
      return true;
    });
  }
  assert.equal(tokens.next, "missing");
});

test("new source lines are tokenized independently and retain lexical error locations", () => {
  const first = new ChapterTokens({ text: "original", line: 1 }, "same.md");
  const second = new ChapterTokens({ text: "changed", line: 1 }, "same.md");
  assert.equal(first.replay().word(), "original"); assert.equal(second.replay().word(), "changed");
  for (const binding of [undefined, { name: "bits", value: 8 } as const]) {
    assert.throws(() => new ChapterTokens({ text: "  A <- @", line: 31 }, "bad.md", binding), error => {
      assert.ok(error instanceof ChapterError);
      assert.deepEqual([error.file, error.line, error.column], ["bad.md", 31, 8]);
      assert.equal(error.message, `bad.md:31:8: Unexpected character.${binding ? " (with bits = 8)" : ""}`);
      return true;
    });
  }
});
