import assert from "node:assert/strict";
import { test } from "node:test";
import { Ram } from "../../src/components/memory/ram.js";
import { applesoftCursor, applesoftVariables, createApplesoftListing } from "../../site/interactive/apple2-applesoft.js";

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

test("scalar records stop at ARYTAB and keep string descriptors separate from their character storage", () => {
  const ram = new Ram(0xc000), start = 0x2000;
  const records = [
    [0x58, 0, 0, 0xff, 0xff, 0xff, 0xff], // X = 0, regardless of the remaining mantissa bytes
    [0x52, 0x32, 0x80, 0x80, 0, 0, 0],   // R2 = -.5
    [0x45, 0, 0xa2, 0, 0, 0, 0],         // E = 2**33
    [0xce, 0xb1, 0x80, 0, 0, 0, 0],      // N1% = -32768
    [0xc6, 0, 1, 2, 3, 4, 5],             // DEF FN F
    [0x41, 0x80, 2, 0xfe, 0xbf, 0, 0],   // A$ ends at the last byte of RAM
    [0x42, 0x80, 0, 0xff, 0xff, 0, 0],   // Empty B$ has no character link
    [0x43, 0x80, 2, 0xff, 0xbf, 0, 0],   // C$ extends outside RAM
  ];
  storeWord(ram, 0x69, start);
  storeWord(ram, 0x6b, start + records.length * 7);
  records.flat().forEach((b, i) => ram.write(start + i, b));
  ram.write(0xbffe, 0x48); ram.write(0xbfff, 0x0d);
  const entries = () => applesoftVariables(ram).variables;
  assert.deepEqual(entries().map(v => [v.name, v.value, v.contentsAddress]), [
    ["X", "0", undefined], ["R2", "-.5", undefined], ["E", "8.58993459E+09", undefined],
    ["N1%", "-32768", undefined], ["A$", '"H〈$0D〉"', 0xbffe], ["B$", '""', undefined], ["C$", "Outside main RAM", undefined],
  ]);
  ram.write(0xbffe, 0x49);
  assert.equal(entries()[4]?.value, '"I〈$0D〉"');
  for (const end of [start - 7, start + 8, 0xc001]) {
    storeWord(ram, 0x6b, end);
    assert.match(applesoftVariables(ram).message!, /invalid/);
    assert.deepEqual(entries(), []);
  }
});
