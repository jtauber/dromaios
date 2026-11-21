import type { EgaMemoryWrite, EgaPlaneByte, IbmEga } from "../../src/components/devices/ibm-ega.js";
import { egaRgb } from "../../src/machines/8088/pc-xt/video.js";
import type { XtBoundary } from "./xt-session.js";
import type { XtPaletteEntry } from "./xt-ega-palette.js";
import { xtHex } from "./8088-disassembly.js";
import { opcode8088Index } from "./8088-encoding.js";

/** Map a click on the stretched 4:3 picture to its native mode 0Dh raster. */
export function egaPixelAt(rect: { left: number; top: number; width: number; height: number }, clientX: number, clientY: number) {
  const x = Math.floor((clientX - rect.left) * 320 / rect.width);
  const y = Math.floor((clientY - rect.top) * 200 / rect.height);
  if (x >= 0 && x < 320 && y >= 0 && y < 200) return { x, y };
}

function monitorColour(ega: IbmEga, pins: number): string {
  return "#" + egaRgb(pins, ega.rgbiOutput).map(v => xtHex(v, 2)).join("");
}

/** Sample the same monitor output as the canvas without touching the EGA read latches. */
function sample(ega: IbmEga, x: number, y: number) {
  const dot = ega.inspectGraphicsPixel(x, y);
  if (!dot) return undefined;
  return { ...dot, colour: monitorColour(ega, dot.pins) };
}

type PixelSample = NonNullable<ReturnType<typeof sample>>;
type StoreOperand =
  | { readonly kind: "register"; readonly name: "AL" | "AH"; readonly value: number }
  | { readonly kind: "memory"; readonly segment: number; readonly offset: number; readonly address: number;
      readonly value: number; readonly planeByte?: EgaPlaneByte };

interface XtPixelStore {
  readonly write: EgaMemoryWrite;
  readonly source: "CPU" | "DMA2";
  readonly operand?: StoreOperand;
}
export interface XtPixelChange {
  readonly x: number;
  readonly y: number;
  readonly before: PixelSample;
  readonly after: PixelSample;
  readonly afterBlanking: boolean;
  readonly store?: XtPixelStore;
  readonly paletteWrite?: XtPaletteEntry;
  readonly record: XtBoundary;
}

export function describeXtPixel(dot: PixelSample): string {
  const bytes = dot.planeBytes.map(b => xtHex(b, 2)).join(" ");
  const bits = dot.planeBytes.map(b => b >> dot.bit & 1).join(" ");
  return `plane offset $${xtHex(dot.offset, 4)} · P0–P3: ${bytes} · bit ${dot.bit}: ${bits}`
    + ` · index ${dot.index} · palette[${dot.paletteIndex}] = $${xtHex(dot.pins, 2)} · ${dot.colour}`;
}

export function xtEgaPixelReadout(ega: IbmEga, x: number, y: number): string {
  const dot = sample(ega, x, y);
  return `Pixel (${x},${y}) · ${dot ? describeXtPixel(dot) : "waiting for an enabled mode 0Dh display."}`;
}

export function describeXtPixelStore({ write, source, operand }: XtPixelStore): string {
  const planes = [0, 1, 2, 3].filter(p => write.enabledPlanes & (1 << p)).map(p => `P${p}`).join(", ");
  const bytes = (values: readonly number[]) => values.map(b => xtHex(b, 2)).join(" ");
  const label = operand?.kind === "register" ? `${operand.name} =` : `${source} byte`;
  return `${label} $${xtHex(operand?.value ?? write.value, 2)} → $${xtHex(0xa0000 + write.address, 5)} · write mode ${write.writeMode}`
    + ` · enabled planes $${xtHex(write.enabledPlanes, 2)} (${planes}) · bit mask $${xtHex(write.bitMask, 2)}`
    + ` · P0–P3: ${bytes(write.before)} → ${bytes(write.after)}`;
}

/** One MOVS/STOS step transfers one element. Use the position of the bus write to select its source byte. */
function stringStoreOperand(ega: IbmEga, record: XtBoundary, write: EgaMemoryWrite): StoreOperand | undefined {
  const bytes = record.instruction?.bytes;
  if (record.outcome !== "executed" || !bytes) return;
  const opcode = bytes[opcode8088Index(bytes)];
  const move = opcode === 0xa4 || opcode === 0xa5;
  if (!move && opcode !== 0xaa && opcode !== 0xab) return;

  const width = (opcode & 1) + 1;
  // After the opcode fetch, MOVS reads the entire source. Both instructions then write low byte first.
  const firstWrite = bytes.length + (move ? width : 0);
  const lane = record.accesses.slice(firstWrite, firstWrite + width).findIndex(access =>
    access.kind === "write" && access.address === 0xa0000 + write.address && access.value === write.value);
  if (lane < 0) return;
  if (!move) {
    return lane === 0 ? { kind: "register", name: "AL", value: record.before.al }
      : { kind: "register", name: "AH", value: record.before.ah };
  }

  const read = record.accesses[bytes.length + lane];
  if (read?.kind !== "read" || read.value !== write.value) return;
  const offset = (record.before.si + lane) & 0xffff;
  // Subtract the known offset from the observed 20-bit address to recover the actual segment, including overrides.
  const segment = ((read.address - offset) & 0xfffff) >>> 4;
  // MOVS cannot reprogram the EGA between the bus read and the end of this instruction.
  const planeByte = inVideoMemory(read.address) ? ega.readPlaneAddress(read.address - 0xa0000) : undefined;
  return { kind: "memory", address: read.address, segment, offset, value: read.value, ...(planeByte && { planeByte }) };
}

/** Attribute a visible change to the store that supplied its plane bits, including either byte of a word. */
function pixelStore(ega: IbmEga, writes: readonly EgaMemoryWrite[], record: XtBoundary, before: PixelSample, after: PixelSample): XtPixelStore | undefined {
  if (before.offset !== after.offset || before.bit !== after.bit || before.index === after.index) return;
  function colour(bytes: readonly number[]): string {
    const index = bytes.reduce((index, byte, p) => index | ((byte >> after.bit) & 1) << p, 0);
    return monitorColour(ega, ega.colour(ega.graphicsPaletteIndex(index)));
  }
  for (let i = writes.length - 1; i >= 0; i--) {
    const write = writes[i]!;
    if (colour(write.after) === after.colour && colour(write.before) !== after.colour) {
      // Channel 2 transfers its byte before the CPU runs, even if both write the same address.
      const dma = i === 0 && record.dma?.direction === "disk-to-memory" && record.dma.address === 0xa0000 + write.address;
      return dma ? { write, source: "DMA2" } : { write, source: "CPU", operand: stringStoreOperand(ega, record, write) };
    }
  }
}

const inVideoMemory = (address: number) => address >= 0xa0000 && address < 0xc0000;
export function dmaWritesXtVideo({ dma }: XtBoundary): boolean {
  return dma?.direction === "disk-to-memory" && inVideoMemory(dma.address);
}

export function watchXtEgaPixel(ega: IbmEga, x: number, y: number) {
  const initial = sample(ega, x, y);
  if (!initial) throw new Error("Select a visible dot in mode 0Dh first.");
  let previous = initial, blanked = false;
  let paletteWrite: XtPaletteEntry | undefined;
  const writes: EgaMemoryWrite[] = [];
  const onWrite = (write: EgaMemoryWrite) => { writes.push(write); };
  let detach = ega.observePlaneWrites(initial.offset, onWrite);
  function observe(record: XtBoundary): XtPixelChange | "mode-ended" | undefined {
    // Mode 0Dh has no blinking dots. Only this plane offset or a display register can change the sample.
    if (!writes.length && !record.accesses.some(a => a.kind === "output" && a.port >= 0x3b0 && a.port <= 0x3df)) return;
    if (!ega.graphicsSupported) return "mode-ended";
    const entry = record.paletteWrite;
    if (entry && entry.transfer.paletteIndex === previous.paletteIndex && entry.transfer.before !== entry.transfer.after) paletteWrite = entry;
    const next = sample(ega, x, y);
    // BIOS palette calls can blank video while programming the card. Compare the next visible dot.
    if (!next) { blanked = true; return; }
    if (next.colour !== previous.colour) {
      const linked = paletteWrite && previous.paletteIndex === next.paletteIndex && previous.pins !== next.pins
        && paletteWrite.transfer.after === next.pins;
      const store = pixelStore(ega, writes, record, previous, next);
      return { x, y, before: previous, after: next, afterBlanking: blanked, record, ...(linked && { paletteWrite }), ...(store && { store }) };
    }
    if (next.offset !== previous.offset) {
      detach(); detach = ega.observePlaneWrites(next.offset, onWrite);
    }
    previous = next; blanked = false; paletteWrite = undefined;
  }
  return { x, y, beginBoundary() { writes.length = 0; }, observe, dispose() { detach(); } };
}
