# Byte input

[Source](../../src/components/devices/byte-input.ts) ·
[Device tests](../../tests/components/devices/byte-input.test.ts) ·
[8080 echo](../cpus/8080/examples/echo.md) ·
[68000 echo](../cpus/68000/examples/echo.md)

`ByteInput` is a synthetic one-byte input latch. The host offers data; the CPU
polls readiness and reads the data when available. It implements
`MemoryConnection` and can also be connected through a machine's port routing.
There is no queue, character encoding, interrupt, or timing model.

## Host offers and bus registers

`new ByteInput()` starts empty. `offer(value)` accepts an integer byte and
returns `true` when the latch was empty. If already full, it returns `false`
without replacing the pending byte, even if the offered value is identical.
The host owns any remaining input and decides when to retry a rejected offer.
Invalid values throw `RangeError`, including when the latch is full.

The device has `size: 2`:

| Local address | Read | Write |
| --- | --- | --- |
| `0` | Status: `01` when full, `00` when empty; no state change | `"bus-error"` |
| `1` | Consume the pending byte and become empty; return `00` if already empty | `"bus-error"` |

A pending zero byte is ready data. Status distinguishes it from an empty data
read; neither the host nor the CPU should interpret zero as end of input.
Reading the data twice consumes it only on the first read; the second returns
the declared empty value. This behavior is a policy of this synthetic device.

All bus writes fail without consuming or replacing input. Invalid local
addresses or write values throw `RangeError` before any state change. The
map and CPU retain responsibility for address translation and access records.

## Inspection, reset, and restoration

`snapshot()` returns a detached, readonly-typed
`{ pendingByte: number | null }`. It consumes nothing and calls no host code.
Readiness is derived from this one stored value. An inspector should use the
snapshot rather than perform a data-register read.

`reset()` discards pending input and leaves the latch empty. It does not
alter the host's remaining input or any output transcript.
`new ByteInput(snapshot)` copies and validates the pending value without
consuming it. Restoring a snapshot deliberately restores that state; it does
not rewind the host or other components. CPU snapshots alone do not include
input state.

## Completed effects and failures

A successful data read consumes input immediately. If a later memory access,
instruction, or host output callback fails, that completed read stays consumed.
For example, a 68000 long read across status, data, and an unmapped address
can consume the byte before entering a bus-error handler. Likewise, echoing
a captured byte may fail after the input has already been consumed. Neither
case puts the byte back into the latch.

The example machines expose an explicit reset for the CPU and devices.
CPU-only reset preserves pending input. The 68000 also connects its RESET
instruction to device reset. These connections belong to the compositions.

## Checks

Unit tests cover every byte, repeated status reads, consumption, zero versus
empty, rejection while full, reset, detached restoration, failed writes,
and host validation. Both echo examples verify actual access order, snapshots,
input arriving after a status read, and a new byte arriving between consumption
and output. They exercise repeated bytes and stop only after echoing newline.
