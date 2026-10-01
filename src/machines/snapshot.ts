import type { Ram } from "../components/memory/ram.ts";
import { checkUnsigned } from "../components/validation.ts";

/** A restore supplies every mutable component; missing state must not silently reset a device. */
export function checkMachineSnapshot(value: unknown, fields: readonly string[]): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)
    || Object.keys(value).length !== fields.length
    || fields.some(field => !Object.hasOwn(value, field) || Reflect.get(value, field) === undefined)) {
    throw new TypeError(`Machine snapshot requires ${fields.join(", ")}.`);
  }
}

export function snapshotRam(ram: Ram): readonly number[] {
  return Array.from({ length: ram.size }, (_, address) => ram.read(address));
}

export function restoreRam(ram: Ram, bytes: readonly number[]): void {
  if (!Array.isArray(bytes) || bytes.length !== ram.size) throw new RangeError(`RAM snapshot requires ${ram.size} bytes.`);
  for (const byte of bytes) checkUnsigned("RAM snapshot byte", byte, 0xff);
  bytes.forEach((byte, address) => ram.write(address, byte));
}
