import { deviceModels as generated } from "./generated/catalogue.ts";

const xtIo = {
  module: "../machines/8088/pc-xt/io", size: 0x100,
  reads: [...generated.i8237a.reads, 0x20, 0x21, 0x40, 0x41, 0x42, 0x60, 0x61, 0x62, 0xf4, 0xf5],
  writes: [...generated.i8237a.writes, 0x20, 0x21, 0x40, 0x41, 0x42, 0x43, 0x60, 0x61, 0x62, 0x63, 0x81, 0xa0, 0xf2, 0xf5],
  output: false, selectors: [],
} as const;

/** Construction and wiring capabilities, independent of device execution. */
export const deviceModels = {
  "i8253": { name: "I8253", module: "devices/i8253", size: 4,
    reads: [0, 1, 2], writes: [0, 1, 2, 3], output: false, selectors: [] },
  "xt-io": { ...xtIo, name: "XtIo" },
  "xt-ega-io": { ...xtIo, name: "XtEgaIo" },
  "ibm-ega": { name: "IbmEga", module: "devices/ibm-ega", size: 0x20000, separatePorts: true,
    reads: [0x3ba, 0x3c2, 0x3da, 0x3b5, 0x3d5],
    writes: [0x3b4, 0x3b5, 0x3c0, 0x3c1, 0x3c2, 0x3c4, 0x3c5, 0x3ce, 0x3cf, 0x3d4, 0x3d5],
    output: false, selectors: [] },
  "coco-pias": { name: "CocoPias", module: "../machines/6809/coco/pias", size: 0x40,
    reads: Array.from({ length: 0x40 }, (_, i) => i), writes: Array.from({ length: 0x40 }, (_, i) => i), output: false, selectors: [] },
  "byte-input": { name: "ByteInput", module: "devices/byte-input", size: 2, reads: [0, 1], writes: [], output: false, selectors: [] },
  "byte-output": { name: "ByteOutput", module: "devices/byte-output", size: 1, reads: [], writes: [0], output: true, selectors: [] },
  "apple2-disk-ii": { name: "Apple2DiskII", module: "devices/apple2-disk-ii", size: 0x200,
    reads: [...Array.from({ length: 16 }, (_, i) => i), ...Array.from({ length: 256 }, (_, i) => 0x100 + i)],
    writes: Array.from({ length: 16 }, (_, i) => i), output: false, selectors: [] },
  ...generated,
} as const;

export type DeviceKind = keyof typeof deviceModels;
export function isDeviceKind(kind: string): kind is DeviceKind { return Object.hasOwn(deviceModels, kind); }
