import { deviceModels as generated } from "./generated/catalogue.ts";

/** Construction and wiring capabilities, independent of device execution. */
export const deviceModels = {
  "byte-input": { name: "ByteInput", module: "devices/byte-input", size: 2, reads: [0, 1], writes: [], output: false },
  "byte-output": { name: "ByteOutput", module: "devices/byte-output", size: 1, reads: [], writes: [0], output: true },
  ...generated,
} as const;

export type DeviceKind = keyof typeof deviceModels;
export function isDeviceKind(kind: string): kind is DeviceKind { return Object.hasOwn(deviceModels, kind); }
