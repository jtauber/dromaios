# Motorola 68000 model

[Source](../../../src/components/cpus/68000.ts) ·
[Coverage](../coverage.md#68000) ·
[Arithmetic example](examples/arithmetic.md) ·
[Addressing example](examples/addressing.md) ·
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
Instruction words, word operands, and long operands require **even** addresses.
A long word at an address ending in `2` is valid. Byte accesses have no alignment restriction.

The shared runner compares `snapshot().pc`, retaining all 32 bits. Accordingly,
a machine file's `end` uses the full PC while its `memory` blocks use physical
addresses. Machine images must fit RAM; loading an image never wraps.

## Effective addresses

MOVE encodes `00 zz ddd mmm sss rrr`: size `zz` is `01` byte, `10` long,
`11` word. The destination encodes register before mode; the source encodes
mode before register. Both use this effective-address vocabulary:

| Mode | Register field | Operand | Extension |
| --- | --- | --- | --- |
| `000` | D0–D7 | Data register | None |
| `001` | A0–A7 | Address register | None |
| `010` | A0–A7 | `(An)` | None |
| `011` | A0–A7 | `(An)+` | None |
| `100` | A0–A7 | `-(An)` | None |
| `101` | A0–A7 | `(d16,An)` | Signed word displacement |
| `110` | A0–A7 | `(d8,An,Xn)` | Brief index word |
| `111` | `000` | `(xxx).W` | Sign-extended absolute word |
| `111` | `001` | `(xxx).L` | Absolute long |
| `111` | `010` | `(d16,PC)` | Signed word displacement |
| `111` | `011` | `(d8,PC,Xn)` | Brief index word |
| `111` | `100` | Immediate | Word for byte/word; long for long |

Byte transfers cannot use address-register direct. PC-relative and immediate
operands are source-only. Other mode-`111` selectors are unsupported.
Immediate bytes use the low byte of their extension word; its high byte is ignored.

All address arithmetic wraps at 32 bits before bus mapping. PC-relative modes
use the address of their own extension word as the base. A brief index word is
`t rrr w 000 dddddddd`: `t` selects Dn/An, `rrr` selects the register, `w`
selects sign-extended word/full long, and `d` is a signed byte displacement.
The original chip ignores bits 10–8; they do not enable scaling, full extensions,
or later-family memory-indirect modes.

Postincrement and predecrement change An by the operand size in bytes. For
byte operations A7 instead changes by two. A7 always selects the active stored
USP/SSP. The source is resolved and read before the destination is resolved;
a source auto-update is visible in destination base/index calculations. Both
updates are held locally until alignment checks pass. The destination register
write then wins over any auto-update to the same register, as in
`MOVEA.W (A0)+,A0`.

## Transfer behavior

MOVE.B/W writes only the selected low portion of a data register, preserving
its upper bits. MOVE.L replaces the whole register. All ordinary MOVE sizes
set N/Z from the transferred value, clear V/C, and preserve X and control state.
Self-transfers still update these flags.

An address-register destination selects MOVEA.W/L. MOVEA.W sign-extends its
source into the full 32-bit destination; MOVEA.L copies the long. Neither
changes flags. MOVEQ sign-extends its embedded byte into Dn and applies long
MOVE flags; bit 8 of its operation word must be zero. ADDI.L to Dn retains
its existing unsigned long result and X/N/Z/V/C behavior.

The [register-transfer example](examples/transfers.md) combines MOVEQ, long
transfers, and addition. The [addressing example](examples/addressing.md)
compares partial-register writes, MOVEA, auto-updates, and memory/stack transfers.

## Stepping and records

`step()` attempts one instruction using current RAM. The
[coverage tracker](../coverage.md#68000) lists the exact supported operation
words. Each successful instruction returns:

- `outcome: "executed"`;
- `instruction.address`: the full 32-bit starting PC;
- `instruction.bytes`: the fetched operation word and extension bytes, in order;
- detached `before` and `after` snapshots;
- `accesses`: ordered byte reads and writes with **physical** addresses and values.

MOVE fetches the operation word and source extensions, then reads the source.
It next fetches destination extensions and writes the destination. All
instruction bytes are therefore fetched before any store. Data reads/writes
use ascending byte addresses, high byte first, including predecrement stores.
These are instruction-level records, not physical bus-cycle traces; prefetch
and the chip's word-transfer scheduling are outside this model. Each access
reflects an actual RAM call, without synthetic destination reads or trace
reconstruction.

Unsupported attempts preserve all CPU state and RAM:

| Case | Outcome details | Accesses |
| --- | --- | --- |
| Unimplemented operation word | `reason: "opcode"`; two instruction bytes | Two fetch reads |
| Odd PC | `reason: "unaligned-address"`; `instruction: null`; `fault.operation: "fetch"` | None |
| Odd word/long source | `reason: "unaligned-address"`; `fault.operation: "read"` | Opcode and source extension fetches; no source data read or destination fetch |
| Odd word/long destination | `reason: "unaligned-address"`; `fault.operation: "write"` | All instruction fetches and any source data reads; no writes |

Alignment faults include the full rejected address in `fault.address`. A local
fetch cursor and pending address updates allow rejection without changing PC,
registers, or flags. Repeating a rejected step repeats its reads and leaves state unchanged. The runner stops
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
supplies ADDI, MOVE (4-116–4-118), and MOVEA (4-119–4-120) encodings and flags.
Addressing is defined in §§2.2.1–2.2.7 and §§2.2.11–2.2.18; §2.4 distinguishes
the original brief extension from later chips. Later-family additions are excluded.

[CPU tests](../../../tests/components/cpus/68000.test.ts) check state ownership,
validation, every unsupported operation word, arithmetic boundaries against a
BigInt oracle, every register pair and MOVEQ byte, every incoming flag pattern,
byte order, logical and physical wrapping, alignment rejection, reset, current
RAM, overlapping stores, and detached records. Transfer checks execute every
legal MOVE/MOVEA form with both active stacks, every index extension word,
every word displacement, source/destination aliasing, partial-register writes,
and all word/long memory modes' alignment rejection. The
[addressing example tests](../../../tests/machines/68000/addressing-example.test.ts)
check full traces and RAM images through bounded running, resumption, and reset.
[Public type checks](../../../tests/types/68000.ts) establish
readonly records, outcome narrowing, and concrete runner results.
