import type { MemoryRowWidth } from "./apple2-inspection.js";

/** Visible rows plus a small margin; the scrollbar always covers the complete 16-bit space. */
export function memoryViewport(scrollTop: number, height: number, rowWidth: MemoryRowWidth, lineHeight: number) {
  const totalRows = 0x10000 / rowWidth;
  const first = Math.max(0, Math.min(totalRows - 1, Math.floor(scrollTop / lineHeight)));
  const visibleRows = Math.max(1, Math.ceil(height / lineHeight));
  const startRow = Math.max(0, first - 2), endRow = Math.min(totalRows, first + visibleRows + 2);
  return { address: first * rowWidth, start: startRow * rowWidth, length: (endRow - startRow) * rowWidth,
    top: startRow * lineHeight, totalHeight: totalRows * lineHeight, visibleBytes: visibleRows * rowWidth };
}

/** A held inspector needs a detached image, including bytes scrolled into view later. */
export function captureMemory(read: (address: number) => number | undefined): Int16Array {
  return Int16Array.from({ length: 0x10000 }, (_, address) => read(address) ?? -1);
}
