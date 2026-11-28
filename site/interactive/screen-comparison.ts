/** A captured raster and the monitor RGB colour of each pixel value. */
export interface MonitorFrame {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
  readonly palette: readonly number[];
}

export function pixelColour(frame: MonitorFrame, dot: number): number {
  return frame.palette[frame.pixels[dot]!]!;
}

export function compareScreenFrames(before: MonitorFrame, after: MonitorFrame) {
  if (before.width !== after.width || before.height !== after.height) {
    throw new Error(`The checkpoint is ${before.width} × ${before.height} and the current screen is ${after.width} × ${after.height}.`);
  }
  const changed: number[] = [];
  for (let dot = 0; dot < after.pixels.length; dot++) {
    if (pixelColour(before, dot) !== pixelColour(after, dot)) changed.push(dot);
  }
  return { before, after, changed };
}
export type ScreenComparison = ReturnType<typeof compareScreenFrames>;
