import assert from "node:assert/strict";
import { test } from "node:test";
import { Ram } from "../../src/components/memory/ram.js";
import { createApplesoftListing } from "../../site/interactive/apple2-applesoft.js";
import { applesoftContinuation } from "../../site/interactive/apple2-applesoft-continuation.js";

test("CONT resolves delimiters, skips empty slots, and distinguishes missing, damaged and final cursors", () => {
  const ram = new Ram(0xc000), words: string[] = [];
  for (const [byte, name] of [[0x80, "END"], [0xb3, "STOP"], [0xba, "PRINT"]] as const) words[byte - 0x80] = name;
  const decode = createApplesoftListing(words), state = () => applesoftContinuation(ram, decode(ram));
  const word = (at: number, value: number) => { ram.write(at, value & 0xff); ram.write(at + 1, value >> 8); };
  function program(start: number): void {
    let at = start;
    for (const [line, bytes] of [
      [10, [0xb3, 58, 58, 32, 0xba, 34, 88, 58, 89, 34, 58]], // STOP:: PRINT "X:Y":
      [20, [0x80]],
    ] as const) {
      const next = at + bytes.length + 5;
      word(at, next); word(at + 2, line);
      bytes.forEach((byte, i) => ram.write(at + 4 + i, byte)); ram.write(next - 1, 0); at = next;
    }
    word(at, 0); word(0x67, start); word(0x69, at + 2);
  }
  program(0x801); word(0x77, 10);
  for (const pointer of [0, 0x3c, 0xff]) {
    word(0x79, pointer); assert.equal(state().kind, "unavailable"); assert.equal(state().destination, undefined);
  }
  for (const pointer of [0x806, 0x807]) {
    word(0x79, pointer); assert.equal(state().kind, "statement");
    assert.equal(state().destination?.index, 2); assert.equal(state().destination?.statement.address, 0x809);
  }
  for (const pointer of [0x80f, 0x810]) {
    word(0x79, pointer); assert.equal(state().destination?.line, 20); assert.equal(state().destination?.statement.address, 0x815);
  }
  for (const pointer of [0x805, 0x809, 0x80c, 0xc000, 0xffff]) {
    word(0x79, pointer); assert.equal(state().kind, "unresolved"); assert.equal(state().destination, undefined);
  }
  word(0x79, 0x806); word(0x77, 99); assert.equal(state().kind, "unresolved", "A same-line continuation requires the saved line to match");
  word(0x79, 0x810); assert.equal(state().destination?.line, 20, "A new line header replaces the saved line");
  word(0x79, 0x816); assert.equal(state().kind, "end", "The final terminator has no destination even with stale OLDIN");
  word(0x77, 10); word(0x79, 0x806); program(0x4001);
  assert.equal(state().kind, "unresolved", "Moving the source cannot relocate a saved cursor");
  word(0x79, 0x4006); assert.equal(state().destination?.statement.address, 0x4009);
  const point = state().destination;
  ram.write(0x4001, 0xff); assert.equal(state().kind, "unresolved"); assert.equal(state().destination, undefined);
  assert.ok(point, "A previously inspected destination does not mutate with the source");
});
