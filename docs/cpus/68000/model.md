# Motorola 68000 model

[Source](../../../src/components/cpus/68000.ts) ·
[Coverage](../coverage.md#68000) ·
[Arithmetic example](examples/arithmetic.md) ·
[Addressing example](examples/addressing.md) ·
[Immediate ALU example](examples/alu.md) ·
[Control-flow example](examples/control-flow.md) ·
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
MOVE flags; bit 8 of its operation word must be zero.

The [register-transfer example](examples/transfers.md) combines MOVEQ, long
transfers, and addition. The [addressing example](examples/addressing.md)
compares partial-register writes, MOVEA, auto-updates, and memory/stack transfers.

## Immediate arithmetic and logic

The six immediate families encode `0000 ooo 0 ss mmm rrr`. Operation `ooo`
selects ORI (`000`), ANDI (`001`), SUBI (`010`), ADDI (`011`), EORI (`101`),
or CMPI (`110`). Size `ss` is `00` byte, `01` word, `10` long; `11` is reserved.
The destination uses the effective-address vocabulary above, restricted to
**data-alterable** operands: Dn, `(An)`, `(An)+`, `-(An)`, displacement/index,
or absolute word/long. An direct, PC-relative, and immediate destinations are
excluded. Later chips add CMPI modes; this model follows the original 68000.
The separate ORI/ANDI/EORI-to-CCR/SR forms remain unsupported.

Byte/word register results preserve the upper portion of Dn; long results
replace all 32 bits. Arithmetic wraps to the selected width. Incoming X and C
do not enter these calculations, and control state is preserved.

| Operation | Result and flags |
| --- | --- |
| ADDI | Destination + immediate; N/Z from result, V from signed overflow, X/C from unsigned carry |
| SUBI | Destination − immediate; N/Z from result, V from signed overflow, X/C from unsigned borrow |
| CMPI | Same subtraction flags as SUBI, but preserve X and perform no writeback |
| ANDI, ORI, EORI | Bitwise result; set N/Z, clear V/C, preserve X |

The immediate extension comes before destination extensions. The destination
is resolved once, read once at the selected width, then written back at the
same address. Postincrement/predecrement is committed once, including for
CMPI. Logic identity operations still write memory; comparison never does.
The [ALU example](examples/alu.md) demonstrates these rules in a RAM transformation.

## Control flow and subroutines

BRA, BSR, and Bcc encode `0110 cccc dddddddd`. Condition `cccc=0000`
selects BRA, `0001` selects BSR, and the other values select conditional
branches. All preserve X/N/Z/V/C and control state.

| `cccc` | Condition | Test |
| --- | --- | --- |
| `0000` | T | Always true; BRA in the branch family |
| `0001` | F | Always false; replaced by BSR in the branch family |
| `0010` / `0011` | HI / LS | Neither C nor Z / C or Z |
| `0100` / `0101` | CC (HS) / CS (LO) | C clear / C set |
| `0110` / `0111` | NE / EQ | Z clear / Z set |
| `1000` / `1001` | VC / VS | V clear / V set |
| `1010` / `1011` | PL / MI | N clear / N set |
| `1100` / `1101` | GE / LT | N equals V / N differs from V |
| `1110` / `1111` | GT / LE | Z clear and N equals V / Z set or N differs from V |

The displacement is a signed byte unless `dddddddd=00`, which fetches a
signed word. On the original 68000, `FF` is −1, not a long-displacement
prefix. The target base is the opcode address plus two, even when an extension
word follows. Untaken branches fetch that extension and fall through past it.
Targets and sequential addresses wrap at 32 bits; only RAM accesses mask to 24.

DBcc encodes `0101 cccc 11001 rrr`, followed by a signed word displacement
using the same opcode-plus-two base. A true condition ends the loop without
changing Dn. A false condition decrements its low word, preserving its upper
word, then branches unless the result is `FFFF`. Flags are unchanged even when
the counter wraps. DBF (also called DBRA) tests only the counter; DBT never
decrements or branches. Entering at the loop body with a counter of three
therefore permits four iterations.

BSR decrements active A7 by four and writes the full 32-bit return address;
this is the address after the complete two- or four-byte instruction. RTS
(`0100 1110 0111 0101`) reads that long word into PC and increments A7 by four.
Both use USP in user mode and SSP in supervisor mode, preserve the inactive
stack, and leave condition/control flags unchanged. Stack addresses need only
two-byte alignment; arithmetic wraps at 32 bits and individual accesses wrap
on the 24-bit bus. Stack reads/writes are high-byte-first and ascending, as for
other long operands in this instruction-level model.

Taken targets are checked before committing PC, a DBcc counter, or stack
changes. An odd target produces an unsupported `fetch` alignment fault in the
current instruction's record, with its instruction bytes present and no target
read. Untaken and expired-counter paths do not validate the unused target.
BSR checks stack alignment before target alignment and writes nothing on either
failure. RTS checks stack alignment before reading the return address; an odd
return target retains those four reads but leaves A7 and PC unchanged. These
atomic rejection rules are model policies, not exception/bus sequencing for
physical hardware. The [control-flow example](examples/control-flow.md)
exercises nested calls and both active stacks.

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

Immediate ALU instructions fetch the operation word, immediate, and destination
extensions, then read the destination and (except CMPI) write the result.
These reads and writes also use ascending byte addresses, high byte first.
Opcode `0000` is valid `ORI.B #n,D0`; four zero bytes execute `ORI.B #0,D0`.
Zero-filled memory does not signal completion. The runner's endpoint or step
budget determines when to stop.

Control-flow records fetch only the current instruction's bytes, followed by
BSR's four writes or RTS's four reads where applicable. They contain no fetch
from the target. DBcc's decrement produces no RAM access.

Unsupported attempts preserve all CPU state and RAM:

| Case | Outcome details | Accesses |
| --- | --- | --- |
| Unimplemented operation word | `reason: "opcode"`; two instruction bytes | Two fetch reads |
| Odd PC | `reason: "unaligned-address"`; `instruction: null`; `fault.operation: "fetch"` | None |
| Odd word/long MOVE source | `reason: "unaligned-address"`; `fault.operation: "read"` | Opcode and source extension fetches; no source data read or destination fetch |
| Odd word/long immediate-ALU operand | `reason: "unaligned-address"`; `fault.operation: "read"` | All instruction fetches; no operand reads or writes |
| Odd word/long MOVE destination | `reason: "unaligned-address"`; `fault.operation: "write"` | All instruction fetches and any source data reads; no writes |
| Odd BSR stack address | `reason: "unaligned-address"`; `fault.operation: "write"` | All instruction fetches; no writes |
| Odd RTS stack address | `reason: "unaligned-address"`; `fault.operation: "read"` | Two opcode fetches; no stack reads |
| Odd taken branch/return target | `reason: "unaligned-address"`; `fault.operation: "fetch"`; instruction present | Instruction fetches; RTS also reads four stack bytes; no writes or target reads |

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
supplies ADDI (4-9–4-10), ANDI (4-18–4-19), CMPI (4-79–4-80),
EORI (4-102–4-103), ORI (4-153–4-154), SUBI (4-179–4-180),
MOVE (4-116–4-118), and MOVEA (4-119–4-120) encodings and flags.
Control-flow references are Bcc (4-25–4-26), BRA (4-55), BSR (4-59–4-60),
DBcc (4-90–4-91), RTS (4-169), and condition table 3-19.
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
Immediate checks execute every legal size/address form and incoming flag
pattern, exhaust byte operand pairs, and check word/long boundaries, flags,
read/modify/write order, comparison auto-updates, and atomic alignment rejection.
The [ALU example tests](../../../tests/machines/68000/alu-example.test.ts)
check all six families together, including complete traces and RAM images.
Control-flow checks cover the full condition truth tables, displacement and
counter sweeps, both stacks, full return addresses, overlapping code/stack,
atomic alignment rejection, and retries. The
[control-flow example tests](../../../tests/machines/68000/control-flow-example.test.ts)
verify nested calls, loops, complete traces and RAM images, and snapshot resumption.
[Public type checks](../../../tests/types/68000.ts) establish
readonly records, outcome narrowing, and concrete runner results.
