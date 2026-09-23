# Memory components and maps

[Definition guide](definitions.md) ·
[68000 ROM-boot example](../cpus/68000/examples/rom-boot.md) ·
[Memory connection](../../src/components/memory/connection.ts)

A memory map connects regions of an address space to separate components.
The map owns routing; RAM and ROM own their bytes. The CPU retains its native
address wrapping, alignment, access order, and fault delivery.

## Components

[`Ram(size)`](../../src/components/memory/ram.ts) owns `size` zero-filled bytes
with mutable contents. [`Rom(bytes)`](../../src/components/memory/rom.ts) copies
a nonempty array or `Uint8Array` into a private immutable image. Changing the
input afterward does not change ROM. Both expose `size`, `read(address)`, and
`write(address, value)`, with addresses local to the component.

ROM reads return the stored byte. Valid ROM writes return `"bus-error"` and
leave the image unchanged. This is an explicit write-protection policy for
this component, not a claim that every physical ROM circuit signals bus errors.
There is no writable loading phase: construct ROM from its final image.

Both components reject invalid host addresses and byte values with `RangeError`.
Bytes are integers from `00` through `FF`; addresses never wrap within a component.
ROM construction also rejects empty images, invalid bytes, and array holes,
rather than silently truncating or filling them.

Devices can implement the same connection. [Byte output](../devices/byte-output.md)
has one write-only register: writes notify the host, and reads return
`"bus-error"`. Its state and reset behavior belong to the device; routing
requires no device-specific map or CPU code.

## Fixed regions

[`MemoryMap(size, regions)`](../../src/components/memory/memory-map.ts) implements
the same connection. `size` is the address-space size, not allocated storage.
Each region is `{ start, memory }`, mapping the component's entire size:

```typescript
const rom = new Rom(image);
const ram = new Ram(0x1000);
const memory = new MemoryMap(0x1000000, [
  { start: 0, memory: rom },
  { start: 0x10000, memory: ram },
]);
```

A region covers `start <= address < start + memory.size`. The map subtracts
`start` before calling the component. For example, a CPU write at `010008`
calls RAM's `write(8, value)`. Every successful or failed delegated operation
makes exactly one component call, preserving its method receiver.

Regions can be supplied in any order and may be adjacent. Sizes must be positive
safe integers, starts must be nonnegative integers, and every region must fit
entirely inside the address space. Overlap is rejected, including containment
or duplicate starts; there is no implicit priority between regions. An empty
map is allowed. Construction validates and copies routing descriptors without
reading or writing component bytes or sorting the caller's array.

Connections themselves remain shared: writing the supplied RAM is visible
through the map. Changing the caller's region descriptors or region array
does not reroute it. Component sizes are captured during construction and must
remain stable. Regions cannot be replaced or resized in this first map.

## Unmapped accesses and errors

An in-range address outside every region returns `"bus-error"` on either
read or write, without allocating storage or calling a component. A mapped
component's `"bus-error"` result propagates. Thrown host errors also propagate
unchanged; the map never turns a thrown value into an emulated fault.

Out-of-range addresses and invalid write bytes throw `RangeError`, including
invalid writes into holes or ROM. The map validates these arguments before
calling a component. It does not mask addresses or truncate values. Connected
components remain responsible for returning valid bytes and reporting failure
before completing any transfer or device side effect.

The 68000 accepts this connection directly and records successful accesses at
physical map addresses. Its [bus-error contract](../../src/components/cpus/specifications/68000.md#bus-errors)
defines failed-byte metadata and exception delivery. Other CPU constructors
still accept `Ram`; this change does not generalize their memory APIs or invent
fault delivery for them.

Reads through a map are execution accesses. They are not a side-effect-free
inspection API for devices; use their snapshots. There is no bank switching, mirroring
syntax, device scheduler, or cycle timing in this component.

## Checks

[Map tests](../../tests/components/memory/memory-map.test.ts) check translation,
adjacent regions and gaps, ownership, validation, overlap, and propagation of
reported and thrown failures. [ROM tests](../../tests/components/memory/rom.test.ts)
check every byte value, image copying, immutable writes, and host bounds.
The [ROM-boot machine tests](../../tests/machines/68000/rom-boot-example.test.ts)
connect both components to a real CPU and verify reset, fault handling,
resumption, snapshots, exact access records, and complete memory images.
The [ROM-output example](../cpus/68000/examples/output.md) checks mapped device
writes, notifications, device reset, and output retained before a later fault.
