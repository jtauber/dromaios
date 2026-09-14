# Motorola 68000 model

[Source](../../../src/components/cpus/68000.ts) ·
[Coverage](../coverage.md#68000) ·
[Arithmetic example](examples/arithmetic.md) ·
[Reference review](reference-notes.md)

This is an instruction-level model of the original Motorola 68000. It uses
flat RAM, explicit initial state, detached snapshots, and records of actual
byte accesses. Later 680x0 instructions and status bits are outside its scope.

## Stored state and inspection

`new Cpu68000(ram, initialState)` requires exactly 16 MiB of RAM and all these
stored fields:

| Fields | Constraint |
| --- | --- |
| `d0`–`d7` | Unsigned 32-bit data registers |
| `a0`–`a6` | Unsigned 32-bit address registers |
| `usp`, `ssp` | Unsigned 32-bit user and supervisor stack pointers |
| `pc` | Unsigned 32-bit program counter |
| `interruptMask` | Integer from 0 through 7 |
| `flags.x/n/z/v/c` | Boolean extend, negative, zero, overflow, and carry |
| `flags.t/s` | Boolean trace and supervisor bits |

The original status register has X/N/Z/V/C at bits 4–0, interrupt mask at
10–8, S at 13, and T at 15. There is no master-mode bit or second trace bit.
Packed SR/CCR values and a stopped latch are not exposed yet. Interrupt and
trace delivery are deferred; storing T or the interrupt mask does not enable
exception handling.

The exported `cpu68000StateDescription` owns field names and constraints.
Construction reads each declared field once, validates it, and owns a copy.
Numeric errors throw `RangeError`; missing or invalid flag groups and Boolean
fields throw `TypeError`. Extra metadata and derived views are ignored.
Construction does not read RAM, reset, or execute.

`snapshot()` owns a detached copy with readonly TypeScript types. It adds:

- `a7`: `ssp` when S is set, otherwise `usp`. The active pointer is a view,
  so switching modes cannot leave a duplicate A7 value out of sync.
- `physicalPc`: the low 24 bits of `pc`.

Snapshots can initialize another CPU. Neither inspection nor snapshot copying
accesses RAM. Mutating caller state or an earlier snapshot cannot alter the CPU.

## Logical and physical addresses

Registers retain all 32 bits, including PC and both stack pointers. Sequential
instruction fetching advances PC modulo 2³². RAM access uses the low 24 bits
of an address, matching the original processor's physical address space.
For example, PC `AB001000` reads its first byte at physical `001000`.

Words and long words are big-endian. A long word contains its most significant
word first, and each word contains its most significant byte first. Data
accesses continue across the physical `FFFFFF` boundary at `000000`.
Instruction words and long operands require **even** addresses; a long word
at an address ending in `2` is valid. Byte accesses have no alignment restriction.

The shared runner compares `snapshot().pc`, retaining all 32 bits. Accordingly,
a machine file's `end` uses the full PC while its `memory` blocks use physical
addresses. Machine images must fit RAM; loading an image never wraps.

## Stepping and records

`step()` attempts one instruction using current RAM. The
[coverage tracker](../coverage.md#68000) lists the exact supported operation
words. Each successful instruction returns:

- `outcome: "executed"`;
- `instruction.address`: the full 32-bit starting PC;
- `instruction.bytes`: the fetched operation word and extension bytes, in order;
- detached `before` and `after` snapshots;
- `accesses`: ordered byte reads and writes with **physical** addresses and values.

All instruction bytes are fetched before a store writes data. Stores use
ascending byte addresses, high byte first. Each access reflects an actual RAM
call; there are no synthetic data reads or subsequent trace reconstruction.

Unsupported attempts preserve all CPU state and RAM:

| Case | Outcome details | Accesses |
| --- | --- | --- |
| Unimplemented operation word | `reason: "opcode"`; two instruction bytes | Two fetch reads |
| Odd PC | `reason: "unaligned-address"`; `instruction: null`; `fault.operation: "fetch"` | None |
| Odd store destination | `reason: "unaligned-address"`; all six instruction bytes; `fault.operation: "write"` | Six fetch reads, no writes |

Alignment faults include the full rejected address in `fault.address`. A local
fetch cursor allows operand rejection without advancing the stored PC. Repeating
a rejected step repeats its reads and leaves state unchanged. The runner stops
on the first unsupported attempt.

These are explicit model policies. A physical 68000 enters an address-error
exception on an unaligned word access; this model reports the missing behavior
instead. It does not generate exception stack frames or emulate partial bus
activity during a fault. Unimplemented operation words likewise do not deliver
illegal-instruction or line-A/line-F exceptions.

Records own their snapshots, bytes, accesses, and fault details; the CPU retains
no history. They describe instruction-level activity, without cycles, word bus
transactions, function codes, prefetch, speculative reads, or device activity.

## External reset

`reset()` models external reset, independently of stepping:

1. Read bytes `000000`–`000003` into SSP, high byte first.
2. Read bytes `000004`–`000007` into PC, high byte first.
3. Set S, clear T, and set `interruptMask` to 7.

Both vectors retain all 32 bits. A7 now exposes the new SSP. D0–D7, A0–A6,
USP, X/N/Z/V/C, and RAM are preserved. Preserving registers and condition codes
whose reset values are unspecified is a deterministic model policy, not a
hardware guarantee.

The reset record has detached `before`/`after` snapshots and exactly eight
reads, with no instruction or step outcome. Reset does not fetch the next
instruction. An odd vector PC is retained and rejected by the next `step()`;
reset fault sequencing is deferred. Reset differs from restarting an example,
which creates fresh CPU state and RAM.

The **RESET instruction** resets external devices without reinitializing the
CPU; it remains unsupported. `reset()` is not its implementation.

## References and checks

Motorola's [MC68000 User's Manual, ninth edition](https://www.nxp.com/docs/en/reference-manual/MC68000UM.pdf)
defines the programmer's model and data organization in chapter 2, external
reset in §6.3.1, and address errors in §6.3.10. The
[M68000 Family Programmer's Reference Manual](https://www.nxp.com/docs/en/reference-manual/M68000PRM.pdf)
supplies ADDI and MOVE encodings and flag behavior; later-family additions
in that manual are excluded.

[CPU tests](../../../tests/components/cpus/68000.test.ts) check state ownership,
validation, every unsupported operation word, arithmetic boundaries against a
BigInt oracle, every incoming flag pattern, byte order, logical and physical
wrapping, alignment rejection, reset, current RAM, overlapping stores, and
detached records. [Public type checks](../../../tests/types/68000.ts) establish
readonly records, outcome narrowing, and concrete runner results.
