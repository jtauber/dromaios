/** Translate a pointer on the scaled canvas into native raster coordinates. */
export function rasterPixelAt(rect: { left: number; top: number; width: number; height: number },
  clientX: number, clientY: number, width: number, height: number) {
  const x = Math.floor((clientX - rect.left) * width / rect.width);
  const y = Math.floor((clientY - rect.top) * height / rect.height);
  if (x >= 0 && x < width && y >= 0 && y < height) return { x, y };
}
