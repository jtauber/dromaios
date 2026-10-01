import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { readRomFile } from "../../site/interactive/rom-file.js";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const expected = { size: 3, sha256: hash("abc") };
const container = { bytes: 4, offset: 1, sha256: hash("xabc") };
function file(text: string) {
  const buffer = new TextEncoder().encode(text).buffer;
  return { name: "firmware.rom", size: buffer.byteLength, async arrayBuffer() { return buffer; } };
}

test("ROM file loading checks direct images and the complete container before extraction", async () => {
  const direct = await readRomFile(file("abc"), expected, container);
  const wrapped = await readRomFile(file("xabc"), expected, container);
  assert.equal(direct.name, "firmware.rom");
  assert.deepEqual([0, 1, 2].map(address => direct.image.createRom(expected).read(address)), [97, 98, 99]);
  assert.deepEqual([0, 1, 2].map(address => wrapped.image.createRom(expected).read(address)), [97, 98, 99]);
  await assert.rejects(readRomFile(file("xbc"), expected, container), /SHA-256/);
  await assert.rejects(readRomFile(file("yabc"), expected, container), /SHA-256/); // Valid suffix, wrong container.
  await assert.rejects(readRomFile(file("xabc"), { size: 3, sha256: hash("xyz") }, container), /SHA-256/);
});

test("ROM file validation rejects size, layout, and read errors before hardware replacement", async () => {
  let read = false;
  await assert.rejects(readRomFile({ name: "large", size: 100000, async arrayBuffer() {
    read = true; return new ArrayBuffer(0);
  } }, expected, container), /Choose/);
  assert.equal(read, false);
  await assert.rejects(readRomFile({ ...file("abc"), size: 4 }, expected, container), /size changed/);
  await assert.rejects(readRomFile(file("xabc"), expected, { ...container, offset: 2 }), /layout/);
  await assert.rejects(readRomFile({ ...file("abc"), async arrayBuffer() { throw new Error("unreadable"); } }, expected), /unreadable/);
});
