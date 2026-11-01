type MemoryRowWidth = 8 | 16;

/** Visible rows plus a small margin, with a scrollbar covering the complete address space. */
export function memoryViewport(scrollTop: number, height: number, rowWidth: MemoryRowWidth, lineHeight: number, size = 0x10000) {
  const totalRows = size / rowWidth;
  const first = Math.max(0, Math.min(totalRows - 1, Math.floor(scrollTop / lineHeight)));
  const visibleRows = Math.max(1, Math.ceil(height / lineHeight));
  const startRow = Math.max(0, first - 2), endRow = Math.min(totalRows, first + visibleRows + 2);
  return { address: first * rowWidth, start: startRow * rowWidth, length: (endRow - startRow) * rowWidth,
    top: startRow * lineHeight, totalHeight: totalRows * lineHeight, visibleBytes: visibleRows * rowWidth };
}

/** A held inspector needs a detached image, including bytes scrolled into view later. */
export function captureMemory(read: (address: number) => number | undefined, size = 0x10000): Int16Array {
  const image = new Int16Array(size);
  for (let address = 0; address < size; address++) image[address] = read(address) ?? -1;
  return image;
}

export function parseMemoryAddress(text: string, maximum = 0xffff): number {
  const value = text.trim().replace(/^\$|^0x/i, "");
  if (!/^[0-9a-f]+$/i.test(value) || value.length > maximum.toString(16).length || parseInt(value, 16) > maximum) {
    throw new RangeError("Enter a hexadecimal address from 0 to " + maximum.toString(16).toUpperCase() + ".");
  }
  return parseInt(value, 16);
}
