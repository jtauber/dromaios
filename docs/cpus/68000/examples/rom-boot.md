# 68000 ROM boot and mapped memory

[Model contract](../model.md) ·
[Machine composition](../../../../src/machines/68000/rom-boot-example.ts) ·
[Example tests](../../../../tests/machines/68000/rom-boot-example.test.ts) ·
[Memory-map contract](../../../machines/memory-map.md)

This synthetic machine boots from ROM, writes separate RAM, handles an
unmapped read, and resumes before stopping. It demonstrates component wiring
and the CPU's instruction-level bus-error recovery contract. It does not model
a particular historical computer.

## Memory and construction

| Physical addresses | Component | Behavior |
| --- | --- | --- |
| `000000`–`0003FF` | 1 KiB ROM | Immutable vectors and code; writes report bus errors |
| `000400`–`00FFFF` | Unmapped | Reads and writes report bus errors |
| `010000`–`010FFF` | 4 KiB RAM | Initially zero; local RAM addresses `000`–`FFF` |
| `011000`–`FFFFFF` | Unmapped | Reads and writes report bus errors |

The 16 MiB address space allocates only these small images. ROM bytes not listed
below are zero. All initial CPU registers and the interrupt mask are zero;
all flags and latches are false; `entry` is `{ kind: "none", vector: 0 }`.
These supplied values are deterministic example state, not hardware power-on
guarantees. The factory neither resets nor executes.

```typescript
const machine = create68000RomBootExample();
const reset = machine.cpu.reset();
const run = runCpu(machine.cpu, { maxSteps: 10 });
```

The factory returns the concrete `cpu`, `memory`, `rom`, and `ram` components.
This first mapped composition uses TypeScript wiring. Existing `.machine`
definitions continue to describe flat-RAM examples.

## Vectors and reset

| ROM address | Bytes | Meaning |
| --- | --- | --- |
| `000000` | `00 01 10 00` | Initial SSP `00011000`, immediately above RAM |
| `000004` | `00 00 01 00` | Initial PC `00000100` |
| `000008` | `00 00 02 00` | Bus-error vector 2 targets `00000200` |

External reset reads the first eight bytes, sets S, clears T, and sets the
interrupt mask to 7. A7 exposes SSP. The first instruction fetch retains reset
entry context until the operation word is completely fetched. No instruction
is included in the reset record.

## Program

| PC | Bytes | Instruction |
| --- | --- | --- |
| `000100` | `20 3C 12 34 56 78` | `MOVE.L #12345678,D0` |
| `000106` | `23 C0 00 01 00 00` | `MOVE.L D0,(010000).L` |
| `00010C` | `22 39 00 02 00 00` | `MOVE.L (020000).L,D1` — unmapped source |
| `000112` | `23 C0 00 01 00 04` | `MOVE.L D0,(010004).L` — reached after recovery |
| `000118` | `4E 72 27 00` | `STOP #2700` |

The unmapped read fails at its first byte, leaving D1 unchanged. The record
contains the completed instruction-byte reads, fourteen frame writes in RAM,
and four vector reads in ROM. There is no successful read at `020000` in
`accesses`; that address instead appears in the bus-error metadata.

Vector-2 entry leaves SSP at `00010FF2` and creates this frame:

| Address | Value | Meaning |
| --- | --- | --- |
| `010FF2` | `0015` | SSW: supervisor data read during instruction processing |
| `010FF4` | `00020000` | Failed logical address |
| `010FF8` | `2239` | Instruction register |
| `010FFA` | `2700` | Saved SR |
| `010FFC` | `00000112` | Saved fetch cursor |

## Handler and resumption

| PC | Bytes | Instruction |
| --- | --- | --- |
| `000200` | `24 2F 00 02` | `MOVE.L 2(A7),D2` — read the stacked fault address |
| `000204` | `23 C2 00 01 00 08` | `MOVE.L D2,(010008).L` — record it in RAM |
| `00020A` | `72 01` | `MOVEQ #1,D1` — mark the fault handled |
| `00020C` | `50 8F` | `ADDQ.L #8,A7` — remove the extended-frame prefix |
| `00020E` | `4E 73` | `RTE` — restore SR/PC and the original SSP |

The handler uses the saved cursor to skip the failed load. That cursor is an
explicit [instruction-level model policy](../model.md#bus-errors); hardware
prefetch can produce a different saved PC. This is not an automatically
restartable instruction or a portable hardware bus-error handler.

After RTE, the program writes the second result and stops. The complete run
contains ten steps, including the faulting instruction, and returns
`stopReason: "halted"`. Final state has PC `0000011C`, SSP/A7 `00011000`,
D0 `12345678`, D1 `00000001`, D2 `00020000`, SR `2700`, and `halted: true`.
`faulted` and `tracePending` remain false, and `entry` is back to `none`.

RAM contains `12345678` at `010000`, the same value at `010004` as evidence of
resumption, and fault address `00020000` at `010008`. The released exception
frame remains in bytes `010FF2`–`010FFF`; no other RAM bytes change. ROM remains
identical to its initial image.

## Reset, restart, and checks

Reset wakes STOP and reloads the ROM vectors without clearing RAM or the
unspecified data registers. The program can run again. Calling the factory
creates independent initial CPU state, fresh zero-filled RAM, and a separate
owned ROM image.

Tests independently specify every complete state transition and ordered
physical access, compare those records with actual map and local component
calls, and check all ROM/RAM bytes. They pause and reconstruct the CPU from
its snapshot at every instruction boundary, including bus-error entry, while
retaining the same mapped components. CPU snapshots alone do not copy memory.
A separate CPU test within this composition attempts to write ROM and verifies
vector-2 delivery without modifying its code bytes.
