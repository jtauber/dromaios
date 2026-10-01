import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { RomImage, romFromImage } from "../../src/machines/rom-image.js";

const identity = { size: 3, sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" };
const digest = async (bytes: Uint8Array): Promise<string> => createHash("sha256").update(bytes).digest("hex");

test("ROM verification owns its input before asynchronous hashing and produces independent immutable ROMs", async () => {
  const bytes = Uint8Array.of(97, 98, 99);
  let release!: () => void;
  const verifying = RomImage.verify(bytes, identity, input => {
    const hash = createHash("sha256").update(input).digest("hex");
    input.fill(0); // Even a host hash implementation cannot retain and alter the verified storage.
    return new Promise(resolve => { release = () => resolve(hash); });
  });
  bytes.fill(0);
  release();
  const image = await verifying;
  const rom = romFromImage(image, identity), other = romFromImage(image, identity, identity.sha256);
  assert.notEqual(rom, other);
  assert.equal(rom.read(0), 97);
  assert.equal(rom.write(0, 42), "bus-error");
  assert.equal(other.read(0), 97);
  assert.throws(() => romFromImage(image, { ...identity, size: 4 }), /does not match/);
  assert.throws(() => romFromImage(image, { ...identity, sha256: "0".repeat(64) }), /does not match/);
  assert.throws(() => romFromImage(image, identity, "0".repeat(64)), /Snapshot ROM identity/);
  assert.throws(() => romFromImage({} as never, identity), /verified ROM/);
  assert.throws(() => Reflect.construct(RomImage, [Uint8Array.of(97, 98, 99), identity.sha256]), /Use RomImage.verify/);
});

test("ROM verification rejects size and digest mismatches and propagates host hashing failures", async () => {
  await assert.rejects(RomImage.verify(new Uint8Array(4), identity, async () => assert.fail("Size must be checked first")), /3 bytes/);
  await assert.rejects(RomImage.verify(Uint8Array.of(97, 98, 100), identity, digest), /does not match/);
  for (const invalid of [{ ...identity, size: 0 }, { ...identity, sha256: "xyz" }]) {
    await assert.rejects(RomImage.verify(new Uint8Array(3), invalid, digest), TypeError);
  }
  const error = new Error("Hash failed");
  await assert.rejects(RomImage.verify(new Uint8Array(3), identity, async () => { throw error; }), value => value === error);
});
