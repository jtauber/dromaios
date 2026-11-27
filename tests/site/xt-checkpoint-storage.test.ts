import assert from "node:assert/strict";
import { gzipSync, gunzipSync } from "node:zlib";
import { memoryStorage } from "../helpers/browser-storage.js";
import { test } from "node:test";
import { createXtEgaSession, createXtSession } from "../../site/interactive/xt-session.js";
import { encodeXtCheckpoint, xtCheckpointKey } from "../../site/interactive/xt-checkpoint.js";
import { encodeStoredXtCheckpoint, decodeStoredXtCheckpoint, xtSavedCheckpoints } from "../../site/interactive/xt-checkpoint-storage.js";

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

test("named XT checkpoints preserve the single-slot save in place and restore each profile’s own disk", async () => {
  const memory = memoryStorage();
  const cga = xtSavedCheckpoints(() => memory, false), ega = xtSavedCheckpoints(() => memory, true);
  const previous = "Previous checkpoint", session = createXtEgaSession();
  const legacy = await encodeStoredXtCheckpoint(session.snapshot());
  memory.setItem(xtCheckpointKey + ":ega", legacy);
  memory.setItem(xtCheckpointKey, encodeXtCheckpoint(createXtSession().snapshot()));
  assert.deepEqual(ega.names(), [previous]);
  assert.equal((await cga.restore(previous)).diskName, null);

  for (const [index, name] of ["Program disk exchange", "Iolo’s hut"].entries()) {
    session.insertDisk(name + ".img", new Uint8Array(360 * 1024).fill(index), { writable: index === 1 });
    await ega.save(name, session.snapshot());
  }
  await cga.save("Iolo’s hut", createXtSession().snapshot());
  const fresh = xtSavedCheckpoints(() => memory, true);
  assert.deepEqual(fresh.names(), ["Iolo’s hut", previous, "Program disk exchange"]);
  assert.deepEqual(cga.names(), ["Iolo’s hut", previous]);
  for (const [index, name] of ["Program disk exchange", "Iolo’s hut"].entries()) {
    session.restore(await fresh.restore(name));
    assert.equal(session.diskName, name + ".img");
    assert.equal(session.machine.io.disketteWritable, index === 1);
    assert.deepEqual(session.machine.io.exportDiskette(), new Uint8Array(360 * 1024).fill(index));
  }

  await assert.rejects(fresh.save(previous, session.snapshot()), /already saved/);
  assert.equal(memory.getItem(xtCheckpointKey + ":ega"), legacy);
  session.restore(await fresh.restore(previous));
  assert.equal(session.diskName, null);
  fresh.remove("Iolo’s hut");
  await assert.rejects(fresh.restore("Iolo’s hut"), /no longer saved/);
  fresh.remove(previous);
  assert.deepEqual(fresh.names(), ["Program disk exchange"]);
  assert.deepEqual(cga.names(), ["Iolo’s hut", previous]);
});
