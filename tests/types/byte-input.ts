import { ByteInput } from "../../src/components/devices/byte-input.js";
import type { ByteInputSnapshot } from "../../src/components/devices/byte-input.js";
import type { MemoryConnection } from "../../src/components/memory/connection.js";
import { create8080EchoExample } from "../../src/machines/generated/8080/echo-example.js";
import { create68000EchoExample } from "../../src/machines/generated/68000/echo-example.js";

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
  const ports = create8080EchoExample({ output: () => {} });
  const mapped = create68000EchoExample({ output: () => {} });
  const portInput: ByteInput = ports.input;
  const mappedInput: ByteInput = mapped.input;
  // @ts-expect-error The named output binding is required, not just an options object.
  create8080EchoExample({});
  // @ts-expect-error Bindings are callbacks, not device objects.
  create68000EchoExample({ output: input });
  // @ts-expect-error A host callback receives a number, not a string.
  create8080EchoExample({ output: (value: string) => {} });
  // @ts-expect-error Both machines require a host output callback.
  create8080EchoExample();
  // @ts-expect-error Both machines require a host output callback.
  create68000EchoExample();
}
