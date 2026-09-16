import { ByteInput } from "../../src/components/devices/byte-input.js";
import type { ByteInputSnapshot } from "../../src/components/devices/byte-input.js";
import type { MemoryConnection } from "../../src/components/memory/connection.js";
import { create8080EchoExample } from "../../src/machines/8080/echo-example.js";
import { create68000EchoExample } from "../../src/machines/68000/echo-example.js";

// Compiled, never called: pending state, host offers, and both concrete compositions.
export function checkByteInput(): void {
  const input = new ByteInput();
  const memory: MemoryConnection = input;
  const accepted: boolean = input.offer(0);
  const snapshot: ByteInputSnapshot = input.snapshot();
  new ByteInput(snapshot);
  // @ts-expect-error An empty latch is null.
  const byte: number = snapshot.pendingByte;
  // @ts-expect-error Snapshot fields are readonly.
  snapshot.pendingByte = 0;
  // @ts-expect-error Size is fixed.
  input.size = 3;
  // @ts-expect-error Pending state contains a byte or null.
  new ByteInput({ pendingByte: false });
  const ports = create8080EchoExample(() => {});
  const mapped = create68000EchoExample(() => {});
  const portInput: ByteInput = ports.input;
  const mappedInput: ByteInput = mapped.input;
  // @ts-expect-error Both machines require a host output callback.
  create8080EchoExample();
  // @ts-expect-error Both machines require a host output callback.
  create68000EchoExample();
}
