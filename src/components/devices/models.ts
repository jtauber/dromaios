import { deviceModels as generated } from "./generated/catalogue.ts";

/** Construction and wiring capabilities, independent of device execution. */
export const deviceModels = {
  "byte-input": { name: "ByteInput", module: "devices/byte-input", size: 2, reads: [0, 1], writes: [], output: false, selectors: [] },
  "byte-output": { name: "ByteOutput", module: "devices/byte-output", size: 1, reads: [], writes: [0], output: true, selectors: [] },
  "apple2-disk-ii": { name: "Apple2DiskII", module: "devices/apple2-disk-ii", size: 0x200,
    reads: [...Array.from({ length: 16 }, (_, i) => i), ...Array.from({ length: 256 }, (_, i) => 0x100 + i)],
    writes: Array.from({ length: 16 }, (_, i) => i), output: false, selectors: [] },
  ...generated,
} as const;

export type DeviceKind = keyof typeof deviceModels;
export function isDeviceKind(kind: string): kind is DeviceKind { return Object.hasOwn(deviceModels, kind); }
