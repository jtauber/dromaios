import { IbmEga, type IbmEgaSnapshot } from "../../src/components/devices/ibm-ega.js";
import { compareScreenFrames } from "./screen-comparison.js";
import { egaRgb, renderEgaGraphicsFrame, renderEgaTextFrame } from "../../src/machines/8088/pc-xt/video.js";

function monitorPalette(rgbi: boolean) {
  return Array.from({ length: 64 }, (_, pins) => egaRgb(pins, rgbi).reduce((rgb, byte) => (rgb << 8) | byte, 0));
}
const egaPalette = monitorPalette(false), egaRgbiPalette = monitorPalette(true);

export function egaMonitorFrame(ega: IbmEga) {
  if (!ega.videoEnabled || !(ega.textEnabled || ega.graphicsSupported)) return;
  const frame = ega.textEnabled ? renderEgaTextFrame(ega) : renderEgaGraphicsFrame(ega);
  return { ...frame, palette: ega.rgbiOutput ? egaRgbiPalette : egaPalette };
}

/** Reconstruct the saved adapter alone. Neither frame reads through the CPU aperture. */
export function compareXtEgaScreens(saved: IbmEgaSnapshot, current: IbmEga) {
  const before = egaMonitorFrame(new IbmEga(saved)), after = egaMonitorFrame(current);
  if (!before || !after) throw new Error("Both screens must show EGA text or mode 0Dh graphics.");
  return compareScreenFrames(before, after);
}
