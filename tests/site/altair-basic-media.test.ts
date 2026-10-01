import assert from "node:assert/strict";
import { test } from "node:test";
import { describeBasicTape, readBasicTape } from "../../site/interactive/altair-basic-media.js";

// The standard SHA-256 test vector for ASCII "abc"; synthetic media is not a BASIC tape.
const identity = { bytes: 3, sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" };
const file = { name: "test.tap", size: 3, arrayBuffer: async () => Uint8Array.of(97, 98, 99).buffer };

test("tape verification checks size before reading, then requires the declared digest", async () => {
  const tape = await readBasicTape(file, identity);
  assert.equal(tape.name, "test.tap");
  assert.deepEqual([...tape.bytes], [97, 98, 99]);
  await assert.rejects(readBasicTape({ ...file, size: 4, arrayBuffer: async () => assert.fail("Do not read a wrong-sized file") }, identity), /3-byte/);
  await assert.rejects(readBasicTape({ ...file, arrayBuffer: async () => Uint8Array.of(97, 98, 100).buffer }, identity), /does not match/);
  const failure = new Error("Could not read local file");
  await assert.rejects(readBasicTape({ ...file, arrayBuffer: async () => { throw failure; } }, identity), error => error === failure);
  assert.deepEqual([...tape.bytes], [97, 98, 99]); // Failed later selections leave the verified media usable.
});

test("tape status distinguishes an absent file, attached tape, and the file retained after reset", async () => {
  const tape = await readBasicTape(file, identity);
  assert.equal(describeBasicTape(undefined, 0, 0), "No tape selected.");
  assert.equal(describeBasicTape(tape, 0, 3), "test.tap · 0 / 3 bytes offered");
  assert.equal(describeBasicTape(tape, 3, 3), "test.tap · 3 / 3 bytes offered");
  assert.equal(describeBasicTape(tape, 0, 0), "test.tap · tape ejected by reset. Reload tape to prepare a fresh boot.");
});
