import assert from "node:assert/strict";
import { test } from "node:test";
import { Ram } from "../../src/components/memory/ram.js";
import { applesoftCursor, createApplesoftListing } from "../../site/interactive/apple2-applesoft.js";

const keywords: string[] = [];
keywords[0x83 - 0x80] = "DATA";
keywords[0xba - 0x80] = "PRINT";
keywords[0xb2 - 0x80] = "REM";

function storeWord(ram: Ram, at: number, value: number): void {
  ram.write(at, value & 0xff); ram.write(at + 1, value >> 8);
}

test("relocated Applesoft lines retain byte addresses and preserve quoted text, DATA and REM", () => {
  const ram = new Ram(0xc000), read = createApplesoftListing(keywords);
  const start = 0x4001;
  const text = [0x83, 0x22, 0x3a, 0x22, 0xba, 0x3a, 0xba, 0x22, 0xba, 0x22, 0x3a, 0xb2, 0xba];
  const end = start + 5 + text.length;
  storeWord(ram, 0x67, start); storeWord(ram, 0x69, end + 2);
  storeWord(ram, start, end); storeWord(ram, start + 2, 100);
  text.forEach((b, i) => ram.write(start + 4 + i, b));
  const listing = read(ram);
  assert.deepEqual(listing.lines, [{ number: 100, parts: [
    { text: "DATA", tokenAddress: start + 4 }, { text: '":"〈$BA〉:' },
    { text: "PRINT", tokenAddress: start + 10 }, { text: '"〈$BA〉":' },
    { text: "REM", tokenAddress: start + 15 }, { text: "〈$BA〉" },
  ] }]);
  ram.write(0x76, 0xff);
  assert.equal(applesoftCursor(ram), undefined);
  assert.equal(read(ram), listing);
  ram.write(start + 4, 0xb2);
  assert.equal(read(ram).lines[0]?.parts.length, 2, "An in-place edit changes how the rest of the line decodes");
  storeWord(ram, start, 0);
  assert.match(read(ram).message!, /empty/);
});

test("partially written links and out-of-range program pointers yield no navigable lines", () => {
  const ram = new Ram(0xc000), read = createApplesoftListing(keywords);
  assert.match(read(ram).message!, /initialized/);
  storeWord(ram, 0x67, 0x801); storeWord(ram, 0x69, 0x810);
  for (const link of [0x801, 0x804, 0x810, 0xc000]) {
    storeWord(ram, 0x801, link); assert.match(read(ram).message!, /invalid/);
  }
  storeWord(ram, 0x801, 0x808);
  ram.write(0x805, 0xba); ram.write(0x806, 0x31); ram.write(0x807, 0x31);
  assert.match(read(ram).message!, /invalid/);
  ram.write(0x807, 0); ram.write(0x805, 0);
  assert.match(read(ram).message!, /invalid/);
  storeWord(ram, 0x69, 0xc001);
  assert.match(read(ram).message!, /initialized/);
});
