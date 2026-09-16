# Byte output

[Source](../../src/components/devices/byte-output.ts) ·
[Device tests](../../tests/components/devices/byte-output.test.ts) ·
[8080 example](../cpus/8080/examples/output.md) ·
[68000 example](../cpus/68000/examples/output.md) ·
[Memory-map contract](../machines/memory-map.md)

`ByteOutput` is a synthetic write-only byte register. It implements
`MemoryConnection`, so a machine can place it in a memory map without adding
device-specific behavior to its CPU. It models immediate output, with no
character encoding, buffering, ready bit, interrupt, or transmission timing.

## Writes and host output

```typescript
const bytes: number[] = [];
const output = new ByteOutput(value => { bytes.push(value); });
const memory = new MemoryMap(0x1000000, [
  { start: 0x20000, memory: output },
]);
```

The device has `size: 1` and accepts writes at local address zero. Each valid
write stores the byte and calls the required host callback synchronously,
exactly once. Consecutive writes of the same value remain separate events.
The callback sees the updated latch if it takes a snapshot. Its return value
is ignored; it cannot report an emulated bus error.

The host owns the output stream. It can collect bytes, display characters,
or forward them elsewhere. The component retains only its last byte, so
running a machine does not accumulate an unbounded history inside the device.

## Port connections

A machine can also route port writes to this register. The
[8080 example](../cpus/8080/examples/output.md) connects output port `01` to
`output.write(0, value)` through the CPU's existing `BytePorts` interface.
It rejects all inputs and other output ports before contacting the device.
The component needs no knowledge of port numbers or CPU instructions.

The 8080 and 68000 examples use the same device implementation and produce
the same host bytes. Their CPU records retain the native access kind:
`output` with a port number on the 8080, `write` with a physical memory
address on the 68000. Routing and reset wiring belong to each composition.

## Inspection, reset, and restoration

`snapshot()` returns a detached, readonly-typed `{ lastByte: number | null }`.
The latch starts at `null`. Inspection never emits output or performs a bus
read. `reset()` clears the latch to `null` without calling the callback or
altering the host's transcript.

`new ByteOutput(callback, snapshot)` restores the latch without replaying any
output. The constructor copies and validates the supplied value; later
changes to that object do not affect the device. CPU snapshots, device
snapshots, memory contents, and host output have separate owners. Restoring
the device does not rewind the host stream.

## Reads and failures

A bus read at local address zero returns `"bus-error"`, without changing state
or notifying the host. Invalid local addresses and invalid byte values throw
`RangeError`. The only valid address is zero; bytes are integers from `00`
through `FF`. Initial state accepts a valid byte or `null`.

A thrown host callback value propagates unchanged. The byte is already
stored, and any host effects already performed remain visible. Neither the
device nor the memory map retries the callback or converts its throw into an
emulated bus error. Such a failure is not a completed CPU step; callers must
not assume it is safe to replay. An explicit restart can produce new output.

## Checks

Tests cover every byte, repeated writes, callback-time inspection, detached
snapshots, silent restoration/reset, invalid input, and host throws. The
[machine tests](../../tests/machines/68000/output-example.test.ts) additionally
check exact CPU access records, pause/resume, RESET wiring, and partial output
before a later byte of a word transfer faults.
The [8080 machine tests](../../tests/machines/8080/output-example.test.ts)
verify port routing, separate CPU/device reset, callback failures, and the
same output from both CPU compositions.
