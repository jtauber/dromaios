import type { Apple2Video } from "../../src/components/devices/generated/apple2-video.js";
import { apple2LoresFrame, apple2TextFrame } from "./apple2-screen.js";

// Presentation palette from the pinned dromaios-apple2 video renderer.
// Hardware supplies colour indices; these RGB values do not simulate composite video.
const colours = [
  "#000000", "#d00030", "#000080", "#ff00ff", // black, magenta, dark blue, purple
  "#008000", "#808080", "#0000ff", "#60a0ff", // dark green, grey 1, medium blue, light blue
  "#805000", "#ff8000", "#c0c0c0", "#ff9080", // brown, orange, grey 2, pink
  "#00ff00", "#ffff00", "#40ff90", "#ffffff", // light green, yellow, aquamarine, white
] as const;

/** Scale decoded blocks behind selectable text, with no guest accesses or addressing rules. */
export function createApple2Screen(screen: HTMLElement) {
  const raster = document.createElement("div"); raster.className = "apple2-raster";
  const canvas = document.createElement("canvas"); canvas.width = 40; canvas.height = 48;
  canvas.setAttribute("role", "img"); canvas.setAttribute("aria-label", "Low-resolution graphics");
  const context = canvas.getContext("2d")!;
  raster.append(canvas);
  const cells = Array.from({ length: 24 }, () => {
    const row = document.createElement("div"); row.className = "apple2-row";
    const cells = Array.from({ length: 40 }, () => {
      const cell = document.createElement("span"); cell.textContent = " "; row.append(cell); return cell;
    });
    raster.append(row); return cells;
  });
  screen.replaceChildren(raster);
  canvas.hidden = true;

  return (ram: { read(address: number): number }, video: Apple2Video, flash: boolean): void => {
    const graphics = apple2LoresFrame(ram, video);
    canvas.hidden = graphics.every(row => row === undefined);
    context.clearRect(0, 0, 40, 48);
    graphics.forEach((row, y) => row?.forEach((colour, x) => {
      context.fillStyle = colours[colour]!;
      context.fillRect(x, y, 1, 1);
    }));
    const text = apple2TextFrame(ram, video, flash);
    text.forEach((row, y) => row.forEach((cell, x) => {
      const span = cells[y]![x]!;
      if (span.textContent !== cell.character) span.textContent = cell.character;
      span.classList.toggle("inverse", cell.inverse);
    }));
  };
}
