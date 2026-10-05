import assert from "node:assert/strict";
import { test } from "node:test";
import { apple2StackAddresses } from "../../site/interactive/apple2-memory-accesses.js";
import { apple2MemoryCharacter } from "../../site/interactive/apple2-memory-characters.js";

test("stack entries expose upcoming pushes and wrapped pulls without including unrelated fetches", () => {
  assert.deepEqual(apple2StackAddresses(0xff, new Map()), []);
  assert.deepEqual(apple2StackAddresses(0xff, new Map([[0x1ff, ["write"]], [0x1fe, ["write"]]])), [0x1ff, 0x1fe]);
  assert.deepEqual(apple2StackAddresses(0xff, new Map([[0x100, ["read"]], [0x101, ["read"]]])), [0x100, 0x101]);
  assert.deepEqual(apple2StackAddresses(0xfd, new Map([[0x100, ["fetch"]], [0x1fe, ["read"]], [0x200, ["write"]]])), [0x1fe, 0x1ff]);
  assert.deepEqual(apple2StackAddresses(0xfe, new Map([[0x1fe, ["write"]], [0x1ff, ["fetch", "write"]]])), [0x1fe, 0x1ff]);
});

test("memory text interprets every Apple II byte with inverse and flashing attributes, preserving unavailable storage", () => {
  const characters = "@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_ !\"#$%&'()*+,-./0123456789:;<=>?";
  for (let byte = 0; byte < 256; byte++) {
    assert.deepEqual(apple2MemoryCharacter(byte), { character: characters[byte % 64], inverse: byte < 64, flashing: byte >= 64 && byte < 128 });
  }
  assert.equal(apple2MemoryCharacter(undefined), undefined);
  assert.equal(apple2MemoryCharacter(0x00)?.character, "@", "Zero is an inverse @, not missing data");
});
