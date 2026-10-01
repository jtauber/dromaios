import assert from "node:assert/strict";
import { test } from "node:test";
import { createSerialTerminal, terminalControlKey, terminalInput } from "../../site/interactive/serial-terminal.js";

test("terminal snapshots preserve cursor position, including CR without LF, and own their lines", () => {
  const original = createSerialTerminal();
  original.write([...Buffer.from("HELLO\rXY\t")]);
  const state = JSON.parse(JSON.stringify(original.snapshot()));
  const restored = createSerialTerminal(state);
  state.lines[0] = "CHANGED";
  for (const bytes of [[90, 13], [10], [65, 8, 66], [13, 67]]) {
    original.write(bytes); restored.write(bytes);
    assert.deepEqual(restored.snapshot(), original.snapshot());
  }
  for (const invalid of [{ ...state, column: -1 }, { ...state, received: NaN },
    { ...state, lines: [] }, { ...state, lines: ["\n"] }, { ...state, lines: ["A".repeat(133)] }]) {
    assert.throws(() => createSerialTerminal(invalid));
  }
});

test("printing terminal separates cursor controls from raw serial bytes", () => {
  const terminal = createSerialTerminal();
  terminal.write([...Buffer.from("AB\rZ\r\r\n")]);
  assert.equal(terminal.text, "ZB\n");
  terminal.write([0xc3, 68, 8, 69, 9, 70, 0, 7, 127]);
  assert.equal(terminal.text, "ZB\nCE      F");
  assert.equal(terminal.received, 16);
  terminal.write([...Buffer.from("\r\n<script>&\"</script>")]);
  assert.match(terminal.text, /<script>&"<\/script>$/);
  terminal.clear();
  assert.equal(terminal.text, ""); assert.equal(terminal.received, 0);
});

test("terminal storage is bounded across long lines, tabs, and endless newlines", () => {
  const terminal = createSerialTerminal();
  terminal.write(Array(300).fill(65));
  assert.deepEqual(terminal.text.split("\n").map(line => line.length), [132, 132, 36]);
  terminal.write(Array(300).fill(10));
  assert.equal(terminal.text.split("\n").length, 200);
  assert.equal(terminal.text.trim(), "");
  terminal.write(Array(300).fill(9)); terminal.write([66]);
  assert.ok(terminal.text.endsWith("\nB"));
  assert.equal(terminal.text.split("\n").length, 200);
});

test("keyboard encoding preserves ASCII, normalizes one final newline, and rejects multiline paste atomically", () => {
  assert.deepEqual(terminalInput("PRINT 40+2\r\n"), [...Buffer.from("PRINT 40+2\r")]);
  assert.deepEqual(terminalInput("abc_@ \n"), [...Buffer.from("abc_@ \r")]);
  assert.deepEqual(terminalInput("\n"), [13]);
  assert.deepEqual(terminalInput(""), []);
  for (const text of ["10 END\nRUN", "a\n\n", "hello\t", "é", "😀", "a\0", "\x7f", "a\r\rb"]) {
    assert.throws(() => terminalInput(text), /ASCII characters.*one line/);
  }
});

test("terminal keys send BASIC controls without consuming Tab, copy shortcuts, or composition", () => {
  const key = { key: "c", ctrlKey: false, metaKey: false, altKey: false, isComposing: false };
  assert.equal(terminalControlKey({ ...key, ctrlKey: true }), 3);
  assert.equal(terminalControlKey({ ...key, key: "C", ctrlKey: true }), 3);
  assert.equal(terminalControlKey({ ...key, key: "Enter" }), 13);
  assert.equal(terminalControlKey({ ...key, key: "Backspace" }), 95);
  for (const event of [key, { ...key, key: "Tab" }, { ...key, metaKey: true },
    { ...key, ctrlKey: true, isComposing: true }, { ...key, key: "Backspace", altKey: true },
    { ...key, key: "Enter", ctrlKey: true }]) {
    assert.equal(terminalControlKey(event), undefined);
  }
});
