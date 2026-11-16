import assert from "node:assert/strict";
import { gzipSync, gunzipSync } from "node:zlib";
import { test } from "node:test";
import { createXtSession } from "../../site/interactive/xt-session.js";
import { encodeXtCheckpoint } from "../../site/interactive/xt-checkpoint.js";
import { encodeStoredXtCheckpoint, decodeStoredXtCheckpoint } from "../../site/interactive/xt-checkpoint-storage.js";

test("stored XT checkpoints compress RAM and disk without dropping state, and still read plain saves", async () => {
  const session = createXtSession();
  const disk = Uint8Array.from({ length: 360 * 1024 }, (_, i) => (i * 13 + (i >>> 8)) & 255);
  session.insertDisk("test.img", disk, { writable: true });
  session.keyboard.paste("DIR\n"); session.machine.ram.write(0x7cff, 0x42);
  const state = session.snapshot(), plain = encodeXtCheckpoint(state), compressed = await encodeStoredXtCheckpoint(state);
  assert.ok(compressed.startsWith("gzip:")); assert.ok(compressed.length < plain.length / 10);
  assert.equal(gunzipSync(Buffer.from(compressed.slice(5), "base64")).toString(), plain);
  assert.deepEqual(await decodeStoredXtCheckpoint(compressed), state);
  assert.deepEqual(await decodeStoredXtCheckpoint(plain), state);
  const next = createXtSession(); next.restore(await decodeStoredXtCheckpoint(compressed));
  assert.deepEqual(next.snapshot(), state); assert.equal(next.machine.io.disketteWritable, true);
});

test("compressed browser data must pass size, stream and machine validation before restore", async () => {
  const packed = (text: string) => "gzip:" + gzipSync(text).toString("base64");
  await assert.rejects(decodeStoredXtCheckpoint("gzip:" + "a".repeat(2_000_000)), /too large/);
  await assert.rejects(decodeStoredXtCheckpoint(packed("x".repeat(2_000_001))), /too large/);
  await assert.rejects(decodeStoredXtCheckpoint("gzip:bad gzip"));
  await assert.rejects(decodeStoredXtCheckpoint(packed('{"machine":"wrong"}')), /different machine/);
  const saved = await encodeStoredXtCheckpoint(createXtSession().snapshot());
  await assert.rejects(decodeStoredXtCheckpoint(saved, true), /different machine/);
});
