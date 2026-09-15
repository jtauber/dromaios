# Motorola 68000 model

[Source](../../../src/components/cpus/68000.ts) ·
[Coverage](../coverage.md#68000) ·
[Arithmetic example](examples/arithmetic.md) ·
[Addressing example](examples/addressing.md) ·
[Immediate ALU example](examples/alu.md) ·
[Control-flow example](examples/control-flow.md) ·
[Stack-frame example](examples/stack-frame.md) ·
[Unary and quick example](examples/unary.md) ·
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

Byte transfers cannot use address-register direct. In MOVE, PC-relative and
immediate operands are source-only. Other mode-`111` selectors are unsupported.
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

## Register and address arithmetic

ADD/SUB encode `oooo rrr d ss mmm eee`: `oooo` is `1101`/`1001`, `rrr`
selects Dn, and `ss` is byte/word/long (`00`/`01`/`10`). Direction `d=0`
reads an EA into arithmetic on Dn; `d=1` reads/modifies/writes memory. Sources
allow all EAs except byte An direct. Memory destinations exclude Dn, An,
PC-relative, and immediate forms. The excluded register encodings in direction
1 belong to ADDX/SUBX. CMP uses `1011 rrr 0 ss mmm eee` with the same source
choices, updating NZVC from Dn minus source without writeback or changes to X.
ADD/SUB update XNZVC; X and C report carry/borrow. Byte/word writes preserve
Dn's upper bits, and all operations preserve control state.

ADDA/SUBA/CMPA use `oooo rrr s11 mmm eee`, with An selected by `rrr` and
word/long source selected by `s=0`/`1`. All source EAs are allowed. Word sources
are sign-extended; the operation always uses the full 32-bit An. ADDA/SUBA
preserve every flag. CMPA changes NZVC and preserves X, without result writeback.

Source auto-updates precede reading the destination An: `ADDA.W (A0)+,A0`
adds the sign-extended word to the incremented pointer. CMPA also compares
against the updated pointer and retains that update. Active A7 selects USP/SSP.
The [word-sum example](examples/word-sum.md) combines all six families.

## Register and memory logic

AND/OR use `oooo rrr d ss mmm eee`, with `oooo=1100`/`1000` and the same
size/direction fields as ADD/SUB. Their sources exclude An in every size;
memory destinations use the same alterable set as ADD/SUB. EOR uses
`1011 rrr 1 ss mmm eee`: Dn is always the source, and its destination may be
Dn or alterable memory. PC-relative and immediate destinations are excluded.

All three set N/Z from the selected result width, clear V/C, and preserve X
and control state. Byte/word Dn results retain the upper bits. Long results
remain unsigned, including values with bit 31 set. Register aliases work
normally: `EOR.L D0,D0` clears D0 while preserving X.

The same resolved-operand execution paths handle arithmetic and logic. Memory
destinations are read and written once at the selected width, even when the
result is unchanged; address auto-updates occur once. Word/long alignment
faults preserve all state and RAM. The [masked-merge example](examples/logic.md)
combines register and memory logic with a loop, checksum, and bit summary.

## Bit operations

BTST, BCHG, BCLR, and BSET use `0000 1000 oo mmm rrr` with an immediate
bit number, or `0000 bbb 1 oo mmm rrr` with the number in Dbbb. The `oo`
field selects test (`00`), change (`01`), clear (`10`), or set (`11`).
Register operands always use all 32 bits and reduce the bit number modulo
32; other operands use a byte and reduce it modulo 8. Bit zero is the
least significant bit. There is no separately encoded size field.

All four operations set Z if the **original** bit was zero, otherwise clear
Z. Every other flag and control field is preserved. BCHG toggles the selected
bit; BCLR clears it; BSET sets it. Unselected bits remain unchanged, and long
register results stay unsigned even when bit 31 is set. BTST does no writeback.

BCHG/BCLR/BSET permit the 50 data-alterable EAs. BTST also permits both
PC-relative modes; its dynamic form additionally accepts an immediate tested
byte. Static BTST does not accept an immediate tested operand. An direct is
excluded throughout; dynamic mode `001` belongs to MOVEP, still unsupported.

The static form fetches a complete bit-number word before any EA extensions.
Its low byte holds the bit number; the model ignores the upper byte. A
PC-relative base is therefore the address of the EA extension word, after
that bit-number word. The dynamic form captures Dbbb before resolving or
changing the operand, including source/destination and source/index aliases.
An immediate tested byte is fetched as instruction data, with no extra data
read. All byte memory addresses are allowed, including odd addresses.

Memory operands are resolved once and read once. Modifying operations write
once, even if the selected bit already has the requested value; BTST performs
no write. Auto-updates occur once for all four operations, with A7 stepping
by two for bytes. Invalid operation words stop after the opcode fetch,
without fetching the bit number or any EA extension. The
[bits example](examples/bits.md) compares long-register bitmaps with byte
bitmaps and uses the old-bit Z result to classify requests.

## Quick arithmetic, unary operations, and condition bytes

ADDQ/SUBQ encode `0101 qqq d ss mmm rrr`: `qqq=000` means eight, otherwise
it encodes one through seven; `d=0` adds and `d=1` subtracts. Size `ss` is
`00` byte, `01` word, or `10` long. Data-register and memory destinations
follow the existing ADD/SUB result and XNZVC rules. Byte/word writes preserve
the upper bits of Dn. Address-register destinations allow only word/long
encodings, but both operate on **all 32 bits** and preserve every flag.
All destinations must be alterable; PC-relative and immediate forms are excluded.

Unary instructions encode `0100 oooo ss mmm rrr`, using the same size field
and the 50 data-alterable EAs. An, PC-relative, and immediate modes are excluded,
including for TST on the original chip. Size `11` belongs to other instruction
groups and does not select a unary operation.

| `oooo` | Operation | Result and flags |
| --- | --- | --- |
| `0000` | NEGX | Zero minus operand minus incoming X; set X/C from borrow and N/V from the result; clear Z for nonzero, otherwise preserve Z |
| `0010` | CLR | Write zero; set Z, clear N/V/C, preserve X |
| `0100` | NEG | Zero minus operand; set XNZVC as subtraction |
| `0110` | NOT | Complement within the selected width; set NZ, clear VC, preserve X |
| `1010` | TST | Set NZ from the operand, clear VC, preserve X; no writeback |

NEGX's cumulative Z supports multi-precision negation from the least significant
part upward. For example, negating `FFFFFFFF 00000001` as two longs produces
`00000000 FFFFFFFF`: the final long is zero, but Z remains clear because the
whole result is nonzero. An incoming X of one and an all-ones operand produce
zero with borrow set. Control state is preserved by every operation.

When `ss=11` in the quick encoding group, bits 11–8 instead select the condition:
`0101 cccc 11 mmm rrr` is Scc. It writes a byte of `FF` if the condition is true
or `00` otherwise, preserving all flags and the upper 24 bits of a Dn destination.
All sixteen conditions are available, including ST and SF. Scc permits the same
50 data-alterable EAs; mode `001` instead belongs to DBcc, described below.

These instructions use the existing read/modify/write path: resolve the EA
once, fetch all extensions, read the selected operand, and write the result
unless the instruction is TST. On the original 68000, **CLR and Scc also read
their memory destinations before writing**, even though the old value does
not affect the result. Unchanged writes are recorded. Auto-updates occur once,
including TST's updates without a write; byte A7 steps by two. Odd word/long
operands are rejected before data access or state changes. The
[unary example](examples/unary.md) combines all eight families.

## Shifts and rotates

ASL/ASR, LSL/LSR, ROXL/ROXR, and ROL/ROR support byte, word, and long
register operands and word memory operands. Register encoding
`1110 ccc d ss i tt rrr` selects direction (`d=0` right, `1` left), size
(`ss=00/01/10` byte/word/long), kind (`tt=00` arithmetic, `01` logical,
`10` rotate through X, `11` rotate), and destination Dn (`rrr`). When
`i=0`, `ccc` gives an immediate count of 1–8, with zero encoding eight.
When `i=1`, Dccc's low six bits give a count of 0–63. The count is read
before writeback, including when source and destination are the same register.
Byte/word writes preserve the rest of Dn.

Memory encoding `1110 0 tt d 11 mmm rrr` permits only the 42 memory-alterable
EAs and always shifts a word once. Extensions are fetched before reading and
writing the resolved operand. Auto-updates occur once; unchanged results are
still written. Odd addresses reject the attempt before data access or state
changes. Later-chip bit-field encodings with bit 11 set remain unsupported.

| Family | Incoming bit | X | V | C with zero count |
| --- | --- | --- | --- | --- |
| ASL/ASR | Zero left; sign bit right | Last bit shifted out; unchanged at zero count | Any sign change during ASL; cleared for ASR | Clear |
| LSL/LSR | Zero | Last bit shifted out; unchanged at zero count | Clear | Clear |
| ROXL/ROXR | Previous X | Last bit rotated out; unchanged at zero count | Clear | Copy X |
| ROL/ROR | Bit leaving the opposite end | Preserved | Clear | Clear |

Every operation replaces N/Z from the selected-width result, even at count
zero. At nonzero counts C is the last outgoing bit. ASL's overflow remains
set if an intermediate sign changed, even when the final sign matches the
original. Counts at or beyond the operand width retain the documented carry
and extend behavior; they are not reduced modulo the operand width. Control
state is preserved.

The [shifts example](examples/shifts.md) unpacks signed samples and chains
memory shifts through X across two words.

## Address calculations and register lists

LEA (`0100 aaa 111 mmm rrr`) writes the computed 32-bit address into An,
selected by `aaa`. PEA (`0100 1000 01 mmm rrr`) pushes that address as a long
through active A7. Neither reads data at the computed address. Both allow only
the 28 control EAs: `(An)`, displacement/index from An, absolute word/long,
and PC displacement/index. These exclude register-direct, auto-update, and
immediate modes. Odd computed addresses are valid; PEA's stack write must
still be aligned. Computing an EA precedes changing its destination or A7.
Both instructions preserve every flag.

MOVEM (`0100 1 d 00 1 s mmm rrr`) transfers a register list. Direction `d=0`
stores registers to memory; `d=1` loads memory into registers. Size `s=0` is
word and `s=1` is long. Stores allow 26 control-alterable EAs plus the eight
predecrement forms; loads allow all 28 control EAs plus eight postincrement
forms. PC-relative stores, postincrement stores, and predecrement loads are
excluded.

The word immediately after the opcode is a register mask, fetched before any
EA extensions. Thus a PC-relative MOVEM uses the opcode address plus four as
its displacement/index base. Mask bits normally select D0–D7 then A0–A7 from
bit 0 to bit 15. Selected registers transfer in that order at increasing
addresses. Predecrement stores reverse the mask correspondence and transfer
order: bit 0 selects A7, bit 15 selects D0, and each selected register decrements
the address before its store.

Word stores use the low 16 bits. Word loads sign-extend into the entire 32-bit
register, including Dn; long transfers use all 32 bits. MOVEM preserves every
flag, even when loading a zero or negative value. A7 always refers to the
active stack pointer.

The EA is resolved once, before transferring any registers. On the original
68000, a predecrement base included in the list stores its **original** value;
later processors differ. A postincrement base included in a load list discards
its loaded value in favor of the final transfer address. Other base/index
registers included in a load list retain their loaded values without changing
the already resolved transfer addresses.

An empty mask fetches all instruction extensions but performs no data accesses
or register updates, and imposes no data alignment requirement in this model.
A nonempty list validates its first transfer address before any state change
or data access; advancing by words/longs preserves alignment for the whole
list. Register addresses wrap at 32 bits and each byte access maps to 24 bits.
Within each word/long, bytes remain high-first and ascending, including
predecrement stores. This is the model's instruction-level access convention,
not the hardware's word bus-transfer order.

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

JMP (`0100 1110 11 mmm rrr`) and JSR (`0100 1110 10 mmm rrr`) use the same
28 control EAs as LEA/PEA. They compute the target without reading it as an
operand. JSR captures its target before changing A7, including when A7 supplies
the base or index.

BSR and JSR decrement active A7 by four and write the full 32-bit return address;
this is the address after the complete instruction, including extensions. RTS
(`0100 1110 0111 0101`) reads that long word into PC and increments A7 by four.
All use USP in user mode and SSP in supervisor mode, preserve the inactive
stack, and leave condition/control flags unchanged. Stack addresses need only
two-byte alignment; arithmetic wraps at 32 bits and individual accesses wrap
on the 24-bit bus. Stack reads/writes are high-byte-first and ascending, as for
other long operands in this instruction-level model.

Taken targets are checked before committing PC, a DBcc counter, or stack
changes. An odd target produces an unsupported `fetch` alignment fault in the
current instruction's record, with its instruction bytes present and no target
read. Untaken and expired-counter paths do not validate the unused target.
BSR/JSR check stack alignment before target alignment and write nothing on either
failure. RTS checks stack alignment before reading the return address; an odd
return target retains those four reads but leaves A7 and PC unchanged. These
atomic rejection rules are model policies, not exception/bus sequencing for
physical hardware. The [control-flow example](examples/control-flow.md)
exercises nested calls and both active stacks.

## Stack frames

LINK (`0100 1110 0101 0 rrr`) fetches a signed word displacement, pushes An
as a long, sets An to the resulting SP, then adds the displacement to SP.
Negative displacements reserve local storage; zero and positive displacements
are also valid. LINK A7 saves the decremented SP itself, then applies the
allocation. The long-displacement LINK of later processors is excluded.

UNLK (`0100 1110 0101 1 rrr`) reads the saved long at An, sets SP to An plus
four, then restores An. For UNLK A7, the popped value is the final SP.
An unaligned frame read or push preserves all state and RAM. An odd pointer
produced by LINK's allocation or popped by UNLK is permitted until an
instruction attempts a word/long access through it.

Both preserve all flags and the inactive stack. The
[stack-frame example](examples/stack-frame.md) combines LINK/UNLK with
LEA/PEA, JSR/JMP, MOVEM saves/restores, and signed word-array loads.

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

Register/address arithmetic and logic fetch the opcode and EA extensions, then read
the memory operand if present. A memory destination is resolved once and read
before its result is written to the same address. CMP/CMPA perform no writes;
predecrement/postincrement still takes effect. All alignment checks precede
state changes, including flags and pending An updates.

Control-flow records fetch only the current instruction's bytes, followed by
BSR/JSR's four writes or RTS's four reads where applicable. They contain no
fetch from the target. DBcc's decrement produces no RAM access.
PEA and LINK append four stack writes after all instruction fetches; UNLK
appends four frame reads. MOVEM fetches the mask and EA extensions before any
data transfer, then records the selected registers in transfer order.

Unsupported attempts preserve all CPU state and RAM:

| Case | Outcome details | Accesses |
| --- | --- | --- |
| Unimplemented operation word | `reason: "opcode"`; two instruction bytes | Two fetch reads |
| Odd PC | `reason: "unaligned-address"`; `instruction: null`; `fault.operation: "fetch"` | None |
| Odd word/long MOVE source | `reason: "unaligned-address"`; `fault.operation: "read"` | Opcode and source extension fetches; no source data read or destination fetch |
| Odd word/long ALU operand | `reason: "unaligned-address"`; `fault.operation: "read"` | All instruction fetches; no operand reads or writes |
| Odd word/long MOVE destination | `reason: "unaligned-address"`; `fault.operation: "write"` | All instruction fetches and any source data reads; no writes |
| Odd BSR/JSR/PEA/LINK stack address | `reason: "unaligned-address"`; `fault.operation: "write"` | All instruction fetches; no writes |
| Odd RTS stack address | `reason: "unaligned-address"`; `fault.operation: "read"` | Two opcode fetches; no stack reads |
| Odd UNLK frame address | `reason: "unaligned-address"`; `fault.operation: "read"` | Two opcode fetches; no frame reads |
| Odd nonempty MOVEM transfer | `reason: "unaligned-address"`; `fault.operation: "read"` or `"write"` | All instruction fetches; no data transfers |
| Odd taken branch/jump/return target | `reason: "unaligned-address"`; `fault.operation: "fetch"`; instruction present | Instruction fetches; RTS also reads four stack bytes; no writes or target reads |

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
Address, register-list, and frame references are JMP (4-108), JSR (4-109),
LEA (4-110), LINK (4-111–4-112), MOVEM (4-128–4-130), PEA (4-159), and
UNLK (4-194). The [reference notes](reference-notes.md#addresses-register-lists-and-stack-frames)
record the source cross-checks for base-register and A7 aliases.
Register/address arithmetic uses ADD (4-4–4-6), ADDA (4-7–4-8),
CMP (4-75–4-76), CMPA (4-77–4-78), SUB (4-174–4-176), and SUBA (4-177–4-178).
Register/memory logic uses AND (4-15–4-17), OR (4-150–4-152), and EOR (4-100–4-101).
Quick/unary references are ADDQ (4-11–4-12), SUBQ (4-181–4-182), CLR
(4-73–4-74), NEG (4-143–4-144), NEGX (4-145–4-146), NOT (4-148–4-149),
TST (4-192–4-193), and Scc (4-172–4-173). CLR and Scc's final notes specify
their original-68000 memory reads. The [reference notes](reference-notes.md#quick-arithmetic-unary-operations-and-condition-bytes)
distinguish those accesses from the existing emulators' behavior.
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
Register/address arithmetic checks all 9,144 forms in both modes, every byte
operand pair, every sign-extended word, word/long boundaries with every incoming
flag pattern, pointer aliases, wrapped and overlapping operands, and atomic
alignment rejection. The [word-sum tests](../../../tests/machines/68000/word-sum-example.test.ts)
check all six families together with literal traces and complete RAM images.
Logic checks execute all 5,760 forms, exhaust byte operand pairs against bit
truth tables, and cover every result bit and incoming flag pattern, partial
Dn writes, register aliases, unchanged memory writes, wrapping, and alignment
rejection. The [logic example tests](../../../tests/machines/68000/logic-example.test.ts)
check complete merge/checksum traces and RAM images, resumption, and live masks.
Address/frame checks exercise all 464 added forms, every MOVEM mask in both
sizes/directions, every sign-extended word and LINK displacement, flag
preservation, base/index aliases, both stacks, empty lists, wrapping, overlapping
code/data, and atomic rejection. The
[stack-frame example tests](../../../tests/machines/68000/stack-frame-example.test.ts)
check all seven families together with complete records and RAM images,
bounded execution, snapshot resumption, changed input, and reset.
[Public type checks](../../../tests/types/68000.ts) establish
readonly records, outcome narrowing, and concrete runner results.

Quick/unary checks execute all 1,882 added forms, every quick operand, every
byte with all incoming flags for the five unary operations, and every Scc
condition/EA with all flags. Independent arithmetic checks cover each word/long
bit boundary, every NEGX word with both X/Z inputs, and full-width quick An
arithmetic. Memory checks include actual reads for CLR/Scc, TST without writes,
unchanged writes, both stacks, wrapping, code overlap, and atomic faults.
The [unary example tests](../../../tests/machines/68000/unary-example.test.ts)
check complete records and RAM images for a signed-word loop and two-long
negation, including snapshot resumption between NEGX instructions.

Shift checks enumerate all 2,064 forms, all eight immediate counts, every
count/destination register pair, and every byte with counts 0–63 and both X
inputs. Independent BigInt arithmetic and bit-string rotations check word/long
boundaries, all count values, all incoming flag patterns, full rotations,
and ASL's intermediate overflow. Memory checks include all legal EAs, both
stacks, unchanged writes, wrapping, code overlap, and atomic rejection.
The [shifts example tests](../../../tests/machines/68000/shifts-example.test.ts)
check all eight operations together, complete records and RAM images, live
inputs, reset preservation, and restoration between carry-dependent words.

Bit checks enumerate all 1,826 forms, every memory byte and bit-number byte,
every bit-number extension word, each long bit with all incoming flags, and
source/destination/index aliases. Their bit-string oracle is independent of
the core's numeric masks. Exact records check PC-relative bases, immediate
tested bytes, unchanged writes, BTST without writes, both stacks, odd and
wrapped addresses, code overlap, live registers, and retained old-bit Z.
The [bits example tests](../../../tests/machines/68000/bits-example.test.ts)
check complete records and RAM images in both modes, live input, reset,
and restoration between a modifying bit operation and a conditional write.
