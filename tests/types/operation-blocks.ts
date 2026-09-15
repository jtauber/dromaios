import { negativeZero, signZeroParity8 } from "../../src/components/cpus/flags.js";
import { motorolaArithmeticFlags } from "../../src/components/cpus/motorola.js";
import { modifyByte } from "../../src/components/cpus/memory-operations.js";
import { subtract } from "../../src/components/cpus/alu.js";
import type { ByteMemory } from "../../src/components/cpus/memory-access.js";

// Compiled, never called: helpers describe exactly their returned flag subset and required effects.
export function checkOperationBlocks(memory: ByteMemory): void {
  const nz: { n: boolean; z: boolean } = negativeZero(16, 0x8000);
  const szp: { s: boolean; z: boolean; p: boolean } = signZeroParity8(0x80);
  const nzvc: { n: boolean; z: boolean; v: boolean; c: boolean } = motorolaArithmeticFlags(32, subtract(32, 0, 1));
  // @ts-expect-error Result N/Z does not define carry.
  negativeZero(8, 0).c;
  // @ts-expect-error The Motorola arithmetic policy does not define X or H.
  motorolaArithmeticFlags(8, subtract(8, 0, 1)).x;
  // @ts-expect-error Widths are the supported unsigned arithmetic widths.
  negativeZero(12, 0);
  const result: number = modifyByte(0, value => value ^ 0xff, memory, "original-and-result");
  // @ts-expect-error Modification requires a writable memory interface.
  modifyByte(0, value => value, { readByte: memory.readByte });
  // @ts-expect-error A transform must return its result byte.
  modifyByte(0, () => {}, memory);
  // @ts-expect-error The only supported variation is the original-value write.
  modifyByte(0, value => value, memory, "write-only");
}
