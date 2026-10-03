import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { ExternalRom, RomImage, romFromImage } from "../../src/machines/rom-image.js";

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

test("an external ROM can be inspected empty and installed without replacing its connection", async () => {
  const expected = { ...identity }, rom = new ExternalRom(expected, null);
  expected.size = 1; expected.sha256 = "0".repeat(64); // Own the declared identity too.
  assert.equal(rom.size, 3); assert.equal(rom.loaded, false); assert.equal(rom.snapshot(), null);
  for (const address of [0, 1, 2]) assert.equal(rom.read(address), "bus-error");
  assert.equal(rom.write(0, 42), "bus-error");
  for (const address of [-1, 3, 1.5, NaN]) assert.throws(() => rom.read(address), RangeError);
  assert.throws(() => rom.write(0, 256), RangeError);
  const image = await RomImage.verify(Uint8Array.of(97, 98, 99), identity, digest);
  rom.install(image);
  assert.equal(rom.loaded, true); assert.equal(rom.snapshot(), identity.sha256);
  assert.equal(rom.read(0), 97); assert.equal(rom.read(2), 99);
  assert.equal(rom.write(0, 42), "bus-error"); assert.equal(rom.read(0), 97);
  const otherBytes = Uint8Array.of(0, 1, 2);
  const other = await RomImage.verify(otherBytes, { size: 3, sha256: await digest(otherBytes) }, digest);
  assert.throws(() => rom.install(other), /does not match/);
  assert.throws(() => rom.install({} as never), /verified ROM/);
  assert.equal(rom.read(0), 97); assert.equal(rom.snapshot(), identity.sha256);
});

test("external ROM restoration preserves absence and rejects both kinds of presence mismatch", async () => {
  const image = await RomImage.verify(Uint8Array.of(97, 98, 99), identity, digest);
  assert.equal(new ExternalRom(identity, null, null).loaded, false);
  assert.equal(new ExternalRom(identity, image, identity.sha256).read(1), 98);
  assert.throws(() => new ExternalRom(identity, null, identity.sha256), /Snapshot ROM identity/);
  assert.throws(() => new ExternalRom(identity, image, null), /Snapshot ROM identity/);
  assert.throws(() => new ExternalRom(identity, image, "0".repeat(64)), /Snapshot ROM identity/);
  assert.throws(() => new ExternalRom(identity, undefined as never), /verified ROM/);
  assert.throws(() => new ExternalRom({ ...identity, size: 0 }, null), TypeError);
  assert.throws(() => new ExternalRom({ ...identity, sha256: "xyz" }, null), TypeError);
});
