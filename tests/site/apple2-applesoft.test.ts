import assert from "node:assert/strict";
import { test } from "node:test";
import { Ram } from "../../src/components/memory/ram.js";
import { applesoftArrayElement, applesoftArrays, applesoftCursor, applesoftVariables, createApplesoftListing, observeApplesoftListing } from "../../site/interactive/apple2-applesoft.js";

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
  assert.deepEqual(listing.lines, [{ number: 100, statements: [
    { address: start + 4, colonBefore: false, parts: [{ text: "DATA", tokenAddress: start + 4 }, { text: '":"〈$BA〉' }] },
    { address: start + 10, colonBefore: true, parts: [{ text: "PRINT", tokenAddress: start + 10 }, { text: '"〈$BA〉"' }] },
    { address: start + 15, colonBefore: true, parts: [{ text: "REM", tokenAddress: start + 15 }, { text: "〈$BA〉" }] },
  ] }]);
  ram.write(0x76, 0xff);
  assert.equal(applesoftCursor(ram), undefined);
  assert.equal(read(ram), listing);
  ram.write(start + 4, 0xb2);
  assert.equal(read(ram).lines[0]?.statements.length, 1, "REM absorbs the rest of the edited line, including colons");
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

test("the debugger listing follows in-place edits, deletion and TXTTAB relocation across dispatches", () => {
  const ram = new Ram(0xc000), program = observeApplesoftListing(ram, keywords);
  const line = (at: number, number: number) => {
    storeWord(ram, at, at + 6); storeWord(ram, at + 2, number); ram.write(at + 4, 0xba);
    storeWord(ram, 0x67, at); storeWord(ram, 0x69, at + 8);
  };
  assert.match(program.read().message!, /initialized/);
  line(0x801, 10);
  const original = program.read(); assert.equal(original.lines[0]?.number, 10);
  ram.write(0x900, 0x12); assert.equal(program.read(), original);
  ram.write(0x805, 0xb2); assert.equal(program.read().lines[0]?.statements[0]?.parts[0]?.text, "REM");
  line(0x4001, 20); assert.equal(program.read().lines[0]?.statements[0]?.address, 0x4005);
  storeWord(ram, 0x4001, 0); assert.match(program.read().message!, /empty/);
  program.detach();
});

test("IF highlights its dispatched consequent, but keeps a numeric THEN target with the condition", () => {
  const ram = new Ram(0xc000), start = 0x801;
  const tokens = [...keywords];
  tokens[0xad - 0x80] = "IF"; tokens[0xab - 0x80] = "GOTO"; tokens[0xc4 - 0x80] = "THEN";
  // IF X GOTO 20:IF X THEN  30:IF X THEN  PRINT
  const bytes = [0xad, 88, 0xab, 50, 48, 58, 0xad, 88, 0xc4, 32, 32, 51, 48, 58, 0xad, 88, 0xc4, 32, 32, 0xba];
  const end = start + 5 + bytes.length;
  storeWord(ram, 0x67, start); storeWord(ram, 0x69, end + 2); storeWord(ram, start, end);
  bytes.forEach((byte, i) => ram.write(start + 4 + i, byte));
  const [line] = createApplesoftListing(tokens)(ram).lines;
  assert.deepEqual(line!.statements.map(s => [s.address - start - 4, s.parts.map(p => p.text).join("")]), [
    [0, "IFX"], [2, "GOTO20"], [6, "IFXTHEN  30"], [14, "IFXTHEN"], [19, "  PRINT"],
  ]);
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

test("array headers bound every element and convert storage order to BASIC subscripts", () => {
  const ram = new Ram(0xc000), start = 0xa001;
  const header = [0xc1, 0x80, 35, 0, 3, 0, 3, 0, 2, 0, 2];
  storeWord(ram, 0x6b, start); storeWord(ram, 0x6d, start + 35);
  header.forEach((b, i) => ram.write(start + i, b));
  const [array] = applesoftArrays(ram).arrays;
  assert.ok(array);
  assert.deepEqual(array.dimensions, [2, 2, 3]);
  assert.equal(array.count, 12);
  const item = (i: number) => applesoftArrayElement(ram, array, i);
  assert.deepEqual([0, 1, 2, 4, 11].map(i => item(i).name), ["A%(0,0,0)", "A%(1,0,0)", "A%(0,1,0)", "A%(0,0,1)", "A%(1,1,2)"]);
  assert.equal(item(11).address, start + 33);
  for (const index of [-1, 12, 1.5]) assert.throws(() => item(index), RangeError);
  for (const [offset, value] of [[2, 0], [2, 34], [2, 36], [4, 0], [4, 255], [5, 0xff], [6, 0]] as const) {
    ram.write(start + offset, value);
    assert.match(applesoftArrays(ram).message!, /invalid/);
    ram.write(start + offset, header[offset]!);
  }
  storeWord(ram, 0x6b, 0xbffd); storeWord(ram, 0x6d, 0xc000);
  assert.match(applesoftArrays(ram).message!, /invalid/);
});
