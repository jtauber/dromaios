/** Independently authored Disk BASIC directory/FAT and ASCII file, never exported by this controller. */
export function answerDisk(): Uint8Array {
  const image = new Uint8Array(35 * 18 * 256).fill(0xff), program = Buffer.from("10 PRINT 42\r20 END\r");
  image.set(program, 0); // Granule 0 begins at track 0, sector 1.
  image[(17 * 18 + 1) * 256] = 0xc1; // FAT: last granule, one used sector.
  const entry = (17 * 18 + 2) * 256; // Directory: track 17, sector 3.
  image.fill(0, entry, entry + 32); image.set(Buffer.from("ANSWER  BAS"), entry);
  image[entry + 12] = 0xff; // ASCII BASIC; first granule and high byte count are zero.
  image[entry + 15] = program.length;
  return image;
}
