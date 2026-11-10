import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { TestContext } from "node:test";
import { compileMachine } from "../../../../scripts/generate-machines.js";
import { create6809Coco, romImages } from "../../../../src/machines/generated/6809/coco.js";
import { RomImage } from "../../../../src/machines/rom-image.js";

/** Exercise the actual literate composition, replacing only its ROM identity. */
export async function cocoTestRom(t: TestContext, bytes: Uint8Array) {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const firmware = await RomImage.verify(bytes, { size: bytes.length, sha256 }, async data => createHash("sha256").update(data).digest("hex"));
  const chapter = readFileSync("src/machines/6809/coco.md", "utf8").replace(romImages.firmware.sha256, sha256);
  const generated = compileMachine(chapter, "6809/coco.md").replace(/from "([^"]+)"/g,
    (_, path: string) => `from "${new URL(path, new URL("../../../../src/machines/generated/6809/coco.js", import.meta.url)).href}"`);
  const directory = mkdtempSync(join(tmpdir(), "dromaios-coco-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(join(directory, "package.json"), '{"type":"module"}');
  writeFileSync(join(directory, "machine.ts"), generated);
  const { create6809Coco: create } = await import(pathToFileURL(join(directory, "machine.ts")).href) as { create6809Coco: typeof create6809Coco };
  return { create, firmware, sha256 };
}
