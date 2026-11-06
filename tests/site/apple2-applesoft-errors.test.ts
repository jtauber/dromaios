import assert from "node:assert/strict";
import { test } from "node:test";
import { Ram } from "../../src/components/memory/ram.js";
import { createApplesoftListing } from "../../site/interactive/apple2-applesoft.js";
import { applesoftErrorName, applesoftErrorState } from "../../site/interactive/apple2-applesoft-errors.js";

test("ONERR source and restart links require saved positions that fit the current program", () => {
  const ram = new Ram(0xc000), words: string[] = [];
  for (const [byte, name] of [[0xa5, "ONERR"], [0xab, "GOTO"], [0xba, "PRINT"]] as const) words[byte - 0x80] = name;
  const decode = createApplesoftListing(words), state = () => applesoftErrorState(ram, decode(ram));
  const word = (at: number, value: number) => { ram.write(at, value & 0xff); ram.write(at + 1, value >> 8); };
  function program(start: number): void {
    let at = start;
    for (const [line, bytes] of [[10, [0xa5, 0xab, 49, 48, 48]], [20, [0xba, 49, 58, 32, 0xba, 50]], [100, [0xba, 51]]] as const) {
      const next = at + bytes.length + 5;
      word(at, next); word(at + 2, line);
      bytes.forEach((byte, i) => ram.write(at + 4 + i, byte)); ram.write(next - 1, 0); at = next;
    }
    word(at, 0); word(0x67, start); word(0x69, at + 2);
  }
  program(0x801);
  assert.equal(state().saved, undefined);
  ram.write(0xd8, 0x80); word(0xf4, 0x807); word(0xf6, 10);
  assert.equal(state().handler.source?.line, 10); assert.equal(state().handler.target, 100);
  assert.equal(state().handler.destination?.statement.address, 0x81a);
  word(0xda, 20); word(0xdc, 0x80a); ram.write(0xdf, 0xf8);
  assert.equal(state().saved?.code, 0, "Code zero is a real error when a restart has been saved");
  assert.equal(state().saved?.source?.index, 0, "The previous line's terminator precedes the next line header");
  word(0xdc, 0x811); assert.equal(state().saved?.source?.index, 1, "Skip spaces after the colon");
  for (const pointer of [0x80b, 0x80f, 0x810, 0x815, 0xc000, 0xffff]) {
    word(0xdc, pointer); assert.equal(state().saved?.source, undefined, `Invalid restart $${pointer.toString(16)}`);
  }
  word(0xda, 10); word(0xdc, 0x800); assert.equal(state().saved?.source?.line, 10);
  word(0xda, 0xff00); assert.equal(state().saved?.source, undefined, "Direct mode has no stored source link");
  word(0xda, 20); word(0xdc, 0x811);
  ram.write(0xd8, 0x40); assert.equal(state().enabled, false);
  assert.equal(state().handler.source, undefined); assert.equal(state().saved?.source, undefined);
  ram.write(0xd8, 0x80); ram.write(0x805, 0xba);
  assert.equal(state().handler.target, undefined, "Edited source cannot invent an installed ONERR");
  program(0x4001); assert.equal(state().handler.source, undefined); assert.equal(state().saved?.source, undefined);
  word(0xf4, 0x4007); word(0xdc, 0x4011);
  assert.equal(state().handler.target, 100); assert.equal(state().saved?.source?.statement.address, 0x4013);
  word(0x4018, 200); assert.equal(state().handler.destination, undefined, "An absent target has no link");
  assert.equal(state().handler.target, 100);
});

test("error names are read only at complete ROM message starts, including zero", () => {
  const bytes = new Uint8Array(0x350);
  for (const [offset, text] of [[0, "NEXT WITHOUT FOR"], [0x85, "DIVISION BY ZERO"]] as const) {
    bytes[0x260 + offset - 1] = 0x80;
    [...text].forEach((char, i) => bytes[0x260 + offset + i] = char.charCodeAt(0) | (i === text.length - 1 ? 0x80 : 0));
  }
  const firmware = { read: (offset: number) => bytes[offset]! };
  assert.equal(applesoftErrorName(firmware, 0), "NEXT WITHOUT FOR");
  assert.equal(applesoftErrorName(firmware, 0x85), "DIVISION BY ZERO");
  for (const code of [1, 0x86, 0xef, 0xf0, 0xff]) assert.equal(applesoftErrorName(firmware, code), undefined);
  assert.equal(applesoftErrorName({ read: () => "bus-error" }, 0), undefined);
});
