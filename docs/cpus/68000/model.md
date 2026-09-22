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
an explicit memory connection, initial state, detached snapshots, and records
of completed byte accesses. Plain `Ram` remains a valid connection. Later 680x0 instructions and status bits are outside its scope.

## Stored state and inspection

The chapter owns the [stored schema](../../../src/components/cpus/specifications/68000.md#stored-state),
[construction and inspection contract](../../../src/components/cpus/specifications/68000.md#construction-and-inspection),
and [A7/status views](../../../src/components/cpus/specifications/68000.md#a7-and-physical-addresses).
Its [normal execution contract](../../../src/components/cpus/specifications/68000.md#fetching-dispatch-and-retirement)
also owns fetches, dispatch, stopping, retirement, and trace scheduling.
This document retains the native memory and exception-entry contracts
while those parts of the model are migrated.

## Memory connection

[MemoryConnection](../../../src/components/memory/connection.ts) describes
`size`, `read(address)`, and `write(address, value)`. Addresses reaching it are
physical 24-bit addresses. A successful read returns an integer byte; a
successful write returns nothing. Either operation can return `"bus-error"`
to report a failed transfer. The connection must report failure **without
completing that byte**, including any device side effect. `size` describes
the address space, so unmapped regions need not allocate RAM.

For example, a machine can expose a small RAM region on the full address bus:

```typescript
const memory: MemoryConnection = {
  size: 0x1000000,
  read: address => address < ram.size ? ram.read(address) : "bus-error",
  write: (address, value) => address < ram.size ? ram.write(address, value) : "bus-error",
};
```

Only this explicit result signals an emulated bus error. Thrown host values,
even the string `"bus-error"`, propagate unchanged. Invalid successful read
values throw `RangeError`; a write returning another value throws `TypeError`.
The shared recorder logs a byte only after its transfer succeeds. The failed
byte appears in fault metadata, while earlier successful bytes remain in order.

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

The executable chapter owns [effective-address decoding](../../../src/components/cpus/specifications/68000.md#effective-address-decoding),
including mode and extension formats, bank selection, signed offsets, and staged
register updates. Its [MOVE/MOVEA families](../../../src/components/cpus/specifications/68000.md#move-and-movea-families)
state operand legality, source/destination ordering, alignment checks, and commit
points alongside the definitions used by execution.

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
The destination uses the effective-address vocabulary linked above, restricted to
**data-alterable** operands: Dn, `(An)`, `(An)+`, `-(An)`, displacement/index,
or absolute word/long. An direct, PC-relative, and immediate destinations are
excluded. Later chips add CMPI modes; this model follows the original 68000.
The separate ORI/ANDI/EORI-to-CCR/SR forms use the status-control rules below.

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

## Extended arithmetic and memory comparison

ADDX/SUBX encode `oooo ddd 1 ss 00 m rrr`, with `oooo=1101`/`1001`,
destination `ddd`, and source `rrr`. Size `ss=00/01/10` means byte/word/long;
`m=0` selects Dn,Dn and `m=1` selects predecrement memory operands
`-(An),-(An)`. Size `11` belongs to ordinary address arithmetic. Each
instruction occupies one operation word, without extensions.

ADDX computes destination + source + X; SUBX computes destination − source − X.
Both set X/C from carry or borrow, N from the result's sign, and V from signed
overflow. Z is **cumulative**: a nonzero result clears it, while a zero result
preserves its previous value. Initializing X=0 and Z=1 allows a sequence of
low-to-high parts to report whether the complete result is zero. Control fields
are preserved. Byte/word Dn writes retain upper bits; long results stay unsigned.
Register aliases read the original operand twice before writing the result.
NEGX uses the same extended subtraction with a zero left operand.

CMPM encodes `1011 ddd 1 ss 001 rrr` and always uses postincrement memory
operands `(An)+,(An)+`. It compares destination minus source, replacing NZVC
and preserving X and control state. Unlike ADDX/SUBX, its Z describes only
the current comparison. CMPM never writes memory.

Memory source resolution and reading precede destination resolution and
reading. When both operands select the same An, its source update determines
the destination address: ADDX/SUBX access successive lower locations, while
CMPM accesses successive higher locations. Each operand updates its pointer
once, even when both pointers name the same register. Active A7 selects USP/SSP
and steps by two for bytes; other byte pointers step by one. All pointer
arithmetic wraps at 32 bits before each byte's physical-bus mapping.

Modifying forms write the resolved destination once at the selected width,
including unchanged results. The instruction-level trace reads source bytes,
then destination bytes, then writes destination bytes, each in increasing
address order. Alignment failures preserve operand state, including X/Z
and pending pointer updates, before entering vector 3. A source fault records only the opcode fetch;
a destination fault also records the completed source read. Both report a
`read` fault because the destination must be read before any modification.
This follows the staged operand policy below; it does not model bus-cycle
ordering or hardware prefetch effects.

The [extended arithmetic example](examples/extended.md) adds and restores a
64-bit memory value, adjusts its register copy, and compares the restored
buffer with a reference. It resumes between low and high parts using saved X/Z.

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
faults preserve pending operand state, then enter vector 3. The [masked-merge example](examples/logic.md)
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
excluded throughout; dynamic mode `001` instead selects MOVEP.

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
operands fault before data access or operand-state changes, then enter vector 3. The
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
changes. Later-chip bit-field encodings with bit 11 set enter vector 4.

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
changes. An odd target enters vector 3 with a `fetch` alignment fault in the
current instruction's record, with its instruction bytes present and no target
read. Untaken and expired-counter paths do not validate the unused target.
BSR/JSR check stack alignment before target alignment and write nothing on either
failure before address-error entry. RTS checks stack alignment before reading
the return address; an odd target retains those four reads but does not commit
the return's A7/PC changes. Vector-3 entry follows these staged operand rules;
hardware partial effects and prefetch sequencing are outside this contract. The [control-flow example](examples/control-flow.md)
exercises nested calls and both active stacks.

## Stack frames

LINK (`0100 1110 0101 0 rrr`) fetches a signed word displacement, pushes An
as a long, sets An to the resulting SP, then adds the displacement to SP.
Negative displacements reserve local storage; zero and positive displacements
are also valid. LINK A7 saves the decremented SP itself, then applies the
allocation. The long-displacement LINK of later processors is excluded.

UNLK (`0100 1110 0101 1 rrr`) reads the saved long at An, sets SP to An plus
four, then restores An. For UNLK A7, the popped value is the final SP.
An unaligned frame read or push enters vector 3 before committing the
instruction's stack changes. An odd pointer
produced by LINK's allocation or popped by UNLK is permitted until an
instruction attempts a word/long access through it.

Both preserve all flags and the inactive stack. The
[stack-frame example](examples/stack-frame.md) combines LINK/UNLK with
LEA/PEA, JSR/JMP, MOVEM saves/restores, and signed word-array loads.

## Decimal arithmetic

ABCD and SBCD operate on packed decimal bytes in Dn pairs or predecrement
memory pairs; NBCD subtracts a byte and X from decimal zero. Every instruction
sets both X and C from decimal carry/borrow and retains Z only if it was
already set and the result is zero. N and V are undefined by the manual and
are preserved by this model. Byte writes retain the upper 24 bits of Dn.

Predecrement pairs read the source first, then decrement/read/write the
destination. Selecting the same An uses successive addresses. A7 decrements
by two for each byte, using the active stack. Unchanged results still write.

Valid packed digits implement decimal arithmetic modulo 100. Non-BCD inputs
have a deterministic model policy: process low then high nibble, propagating
one carry/borrow, with one correction of +6 for a digit above 9 (addition)
or −6 for a negative digit (subtraction), then retain four bits per digit.
This defines reproducible results without claiming undocumented silicon flags.

## Multiply, divide, and bounds checks

MULU/MULS multiply EA.W by Dn.W and replace all of Dn with the unsigned/signed
32-bit product. They set N/Z from the full result, clear V/C, and preserve X.
DIVU/DIVS divide unsigned/signed Dn.L by EA.W, placing the remainder in Dn's
high word and quotient in its low word. Signed division truncates toward zero;
the remainder has the dividend's sign. N/Z describe the 16-bit quotient, V/C
clear on success, and X is preserved. Source EAs exclude An and otherwise
include all data sources, including PC-relative and immediate.

An unsigned quotient must fit 0..65535; a signed quotient must fit
−32768..32767. Overflow is a successful instruction: Dn is unchanged, V is
set, C clears, and the source's auto-update commits. Undefined N/Z are
preserved. A zero divisor enters vector 5 after reading its source and
committing source auto-updates. Dn and X remain unchanged; C clears and
undefined N/Z/V retain their supplied values. The saved PC follows all
instruction extensions. These flag effects are included in the stacked SR.

CHK.W interprets both Dn.W and the bound EA.W as signed values and accepts
`0 <= Dn.W <= bound`. High Dn bits are ignored. A successful check preserves
X and, by model policy, undefined N/Z/V/C. A failed check enters vector 6
after committing source auto-updates. N is set for a negative Dn.W and
cleared for a nonnegative value above the bound. Undefined Z/V/C retain
their supplied values. The stacked SR includes these effects and the saved
PC follows the instruction.

## Additional transfers and byte tests

- MOVEP.W/L transfers between Dn and a signed displacement from An. The
  high byte transfers first, then subsequent bytes at offsets 2, 4, and 6.
  Odd addresses are valid, each byte wraps on the physical bus, and no address
  register or flag changes. Word loads preserve Dn's high word. This RAM
  operation requires no peripheral model despite the instruction's name.
- EXG exchanges full longs between Dn/Dn, An/An, or Dn/An. A7 resolves to the
  active stack; self-exchanges and all flags are preserved.
- EXT.W sign-extends Dn.B into its low word; EXT.L sign-extends Dn.W into all
  32 bits. SWAP exchanges Dn's words. Each sets N/Z at its result width,
  clears V/C, and preserves X. Later-chip EXTB.L is excluded.
- TAS reads a data-alterable byte, sets N/Z from its original value, clears
  V/C, preserves X, and writes the byte with bit 7 set. It records read then
  write even if the high bit was already set. Bus arbitration is not modeled.

## Status, stack selection, and stopping

MOVE to CCR reads a word but stores only bits 4..0. MOVE to SR accepts only
bits `A71F`: T, S, interrupt mask, and X/N/Z/V/C. ORI/ANDI/EORI to CCR or SR
fetch an immediate word and affect only the defined destination bits. CCR
operations preserve all system fields. MOVE from SR writes a word with unused
bits clear, preserving flags; the original 68000 permits it in user mode and
reads memory destinations before writing them.

MOVE to SR, immediate SR logic, MOVE An/USP in either direction, STOP, RESET,
and RTE are privileged. In user mode they enter vector 8 immediately after the
opcode fetch, before reading any extension or operand. The saved PC points
to the privileged instruction, allowing a handler to correct or skip it.
USP transfers preserve all flags; An=7 selects SSP because execution requires
supervisor mode. Updating S immediately switches the A7 view. A source such
as `MOVE (A7)+,SR` still increments the stack pointer resolved before S changes.

RTR reads a word and a long through active A7, restores only the five CCR
bits, sets the full 32-bit PC, and advances that stack by six. It preserves
S/T/interrupt mask, is unprivileged, and validates stack/target alignment
before committing either flags or stack updates. NOP advances PC by two.

STOP loads its immediate SR, advances PC by four, and sets `halted`. If it
began with T clear, it returns `outcome: "halted"`. Later stopped steps return
`halted`, `instruction: null`, unchanged state, and no accesses, even with an
odd PC. If it began with T set, it instead reports `executed` with both
`halted` and `tracePending` set, allowing the runner to deliver trace on its
next step. Accepted interrupt entry, trace entry, and external reset clear STOP.
A masked interrupt leaves it stopped. The immediate SR's new mask controls
which ordinary interrupt levels may wake it; its new S can select USP.

All documented original-68000 instruction forms are implemented within this
instruction-level contract, including the bus/address-error delivery below.
Concrete devices, timing, and prefetch remain outside it. Words outside the instruction inventory
deliver illegal-instruction or line-A/line-F exceptions as described below.

## Synchronous exception entry and return

`step()` includes the triggering instruction and its synchronous exception in
one transition. It reports `outcome: "executed"` on successful delivery and
adds `exception: { source, vector, returnPc }` to the record. This lets the
runner continue through a handler. No handler opcode is fetched during entry.

The chapter's [exception declarations](../../../src/components/cpus/specifications/68000.md#fetching-dispatch-and-retirement)
select vectors, saved PCs, and instruction completion. Restarting exceptions save
the full faulting address: RTE with an unchanged frame retries that word. A
software emulator must adjust the saved PC to resume after it. Each successful
entry remains an executed step, so the runner continues through the handler
using its normal step budget.

TRAPV with V=0 advances PC without entering an exception. TRAP, TRAPV, ILLEGAL,
other illegal encodings, emulator lines, and privilege violations preserve all
condition codes. CHK and division apply the flag and completed-source effects
described above before saving SR.

Entry uses SSP even when the instruction ran in user mode:

1. Capture SR, set S, clear T, and reserve six bytes by subtracting six from SSP,
   after completed operand updates. Clear STOP and the pending-trace latch;
   the interrupt mask is unchanged.
2. Check the first stack write's alignment.
3. Write the return PC's low word at old SSP−2, SR at old SSP−6, and PC's high
   word at old SSP−4. Each word writes its high byte first.
4. Read a full 32-bit handler PC from `vector × 4`, high byte first, and commit it.

The resulting frame contains SR at new SSP and the full return PC at SSP+2.
The original 68000 has no extra format/vector word. SSP arithmetic wraps at
32 bits; every bus access masks to 24 bits. Writes precede vector reads, so an
overlapping frame can overwrite the vector. An odd handler PC triggers
address-error delivery in the same boundary, after the completed frame writes
and vector reads; an aborted entry owes no trace.

RTE requires supervisor mode. It reads PC high at SSP+2, SR at SSP, then PC low
at SSP+4, all through the original supervisor stack. It validates the restored
PC, advances SSP by six, and restores PC plus the defined SR bits (`A71F`).
An S=0 return then exposes USP as A7; it cannot redirect the frame reads.
Nested exceptions consume separate frames, and snapshots taken inside handlers
can initialize another CPU. RTE samples incoming T like other executed
instructions; restoring T=1 enables tracing of the following instruction,
without retroactively tracing an RTE that began with T=0.

### Delivery failures and callbacks

An odd exception SSP starts address-error delivery and faults again on the
same odd stack, producing a terminal halt. Completed instruction effects remain
visible. The [address-error contract](#address-errors) defines frame reservation,
metadata, handler-fetch failures, and reset recovery.

An odd RTE stack faults before frame reads; an odd restored PC faults after all
six reads. The return's register/SR updates remain staged in either case, then
vector-3 entry applies its own state and memory effects.

`step()`, `reset()`, and `interrupt()` share a per-instance execution guard.
RAM and device callbacks may inspect `snapshot()`; nested mutations throw
before any nested CPU changes.
The guard clears on success or failure. A host memory exception propagates without
a record or fabricated bus-error delivery. Completed writes are not rolled back.
During entry S/T and reserved SSP are visible before the first frame write;
PC changes only after all vector bytes arrive. During RTE the stack/PC/SR
return state changes only after all frame reads and target validation; IR
already holds `4E73`. During reset, SSP commits after four vector bytes;
PC follows the remaining four. Reset control flags are applied after the vectors
succeed or explicitly report a bus fault; a thrown host error preserves the
control flags it interrupted. These are instruction-level commit points.

## Trace recognition

The chapter owns [trace sampling and scheduling](../../../src/components/cpus/specifications/68000.md#fetching-dispatch-and-retirement),
including precedence over STOP and alignment, and traces owed after synchronous
exceptions. Delivery uses a separate six-byte entry to vector 9 with
`instruction: null` and `{ source: "trace", vector: 9, returnPc }`.
The saved PC and SR are the current post-instruction state, including a taken
branch or exception handler target. No instruction is fetched. Trace entry
clears STOP, T, and `tracePending`.

An odd trace stack terminally halts through failed address-error entry, with
no RAM accesses, cleared STOP/trace latches, and 20 reserved stack bytes.
Host callback failures retain cleared latches and reserved SSP, as for other entries. External reset
clears an owed trace after reading both reset vectors. T and `tracePending`
are intentionally independent: setting T during an instruction or restoring a
snapshot with T=1 does not itself request an immediate trace entry.

## External interrupt delivery

`interrupt(level, acknowledge)` offers one selected request at an instruction
boundary. `level` is 1..7. The caller owns pending requests, priority selection,
and physical level transitions; there is no internal signal queue or scheduler.
Levels 1..6 are accepted only when greater than `interruptMask`. A level-7
offer represents a newly detected transition from a lower level to 7, or a
held level 7 when the current mask is below 7. It is accepted even at mask 7.
**Do not repeatedly offer a held level 7 at mask 7**; each such call would
represent another selected edge. Ignored requests remain caller-owned.

A terminal halt returns `outcome: "ignored", reason: "faulted"`. Otherwise an
owed trace returns `outcome: "ignored", reason: "trace-pending"` before
masking or acknowledgement. Deliver that trace with `step()` and reoffer the
selected interrupt before executing handler code. Otherwise a masked request
returns `outcome: "ignored", reason: "masked"`. Neither calls the device,
reads RAM, changes state, nor wakes STOP. Invalid levels throw before mutation;
an acknowledgement callback is required only for an eligible request.

Accepted delivery captures the old SR, selects
supervisor mode, clears T/STOP, reserves six frame bytes, and sets the mask to
the selected level. It then calls `acknowledge()` once:

| Result | Vector |
| --- | --- |
| Integer byte 0..255 | The supplied vector number |
| `"autovector"` | 24 + level (25..31) |
| `"spurious"` | 24 |

An uninitialized peripheral may supply vector 15. A zero handler address is
valid and is not implicitly redirected to vector 15. A host exception is not a
spurious hardware acknowledgement; use the explicit `"spurious"` response.
Invalid results throw after entry preparation, without frame/vector accesses.
The reserved SSP, changed mask, cleared T, and released STOP remain visible;
completed host/device effects are not rolled back.

Following acknowledgement, the common entry path writes PC low, the saved
pre-interrupt SR, and PC high, then reads the vector. The return PC is the
full address of the instruction that would otherwise execute. Frame/vector
overlap and address wrapping follow the synchronous entry contract. An odd
SSP starts address-error delivery before acknowledgement and terminally halts
on the same odd stack. An odd loaded handler PC instead enters vector 3 after
acknowledgement and frame writes. Such records use `outcome: "executed"` or
`"halted"` and carry address-error metadata.

The separate interrupt record contains `level`, a null instruction, detached
snapshots, and ordered accesses. Accepted records add `vector` and `returnPc`.
Their first access is `{ kind: "acknowledge", level, value }`, followed by six
frame writes and four vector reads. RTE restores the previous mask, flags,
stack selection, and return PC; the caller can then reoffer an eligible held
request. Snapshots preserve all CPU-owned recognition state; device state and
pending external requests stay with the caller.

These are instruction-boundary offers, not sampled IPL pins. Mid-instruction
sampling, prefetch-related recognition delays, acknowledge bus/function codes,
cycle timing, and electrical edge detection are not emulated.

## RESET device connection

The optional third constructor argument is a `Cpu68000Connections` object with
`resetDevices(): void`. The privileged RESET instruction (`4E70`) calls that
method once after fetching its opcode, then records `{ kind: "reset" }` and
advances PC by two. It preserves registers, flags, and the interrupt mask;
normal trace retirement still applies. The connection owns device state and
is supplied again when constructing a CPU from a snapshot.

An absent connection throws only when a supervisor-mode RESET uses it. A
user-mode attempt enters the privilege vector without calling the device.
A throwing callback leaves PC at the instruction boundary and IR at `4E70`,
returns no record, and does not undo device effects. The execution guard still
clears. No synthetic memory transfer or cycle count represents RESET's output.
The physical chip's 124-clock reset pulse is not timed here.

## Stepping and records

The chapter owns the [step and record contract](../../../src/components/cpus/specifications/68000.md#fetching-dispatch-and-retirement).
The following details describe operand-transfer ordering within those records.

MOVE fetches the operation word and source extensions, then reads the source.
It next fetches destination extensions and writes the destination. All
instruction bytes are therefore fetched before any store. Ordinary data reads/writes
use ascending byte addresses, high byte first, including predecrement stores.
MOVEP advances by two between bytes, leaving the intervening locations untouched.
These are instruction-level records, not physical bus-cycle traces; prefetch
and general word-transfer scheduling are outside this model. Exception frames
and RTE use the explicit word order above, checked against the reference corpus.
Each access reflects a completed memory call, without synthetic destination reads or trace
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
predecrement/postincrement still takes effect. Operand alignment checks precede
operand-state changes, including flags and pending An updates; IR has already
been fetched, and an alignment fault then enters vector 3.

Control-flow records fetch only the current instruction's bytes, followed by
BSR/JSR's four writes or RTS's four reads where applicable. They contain no
fetch from the target. DBcc's decrement produces no RAM access.
PEA and LINK append four stack writes after all instruction fetches; UNLK
appends four frame reads. MOVEM fetches the mask and EA extensions before any
data transfer, then records the selected registers in transfer order.

## Address errors

Odd instruction fetches and word/long operand accesses enter **vector 3** in
the detecting boundary. The odd access itself makes no RAM call. Byte operands
and MOVEP's separate byte transfers remain valid at odd addresses. Entry selects
SSP, clears T, STOP, and owed trace, preserves the interrupt mask, and reserves
14 bytes. It writes seven words from the old SSP downwards, high byte first
within each word, then reads the vector at physical `00000C`–`00000F`.

| Offset from new SSP | Contents |
| --- | --- |
| +0 | Special status word (SSW) |
| +2 | Full 32-bit fault address |
| +6 | Instruction register |
| +8 | Saved SR |
| +10 | Saved 32-bit PC |

SSW bit 4 is 1 for read/fetch and 0 for write. Bit 3 is 0 during instruction
processing (including group-2 traps) and 1 during group-0/group-1 exceptions,
trace, or interrupts. Bits 2–0 are the faulting access's function code:
user data/program = 1/2; supervisor data/program = 5/6. PC-relative data
operands use program space. Other bits are zero by model policy. Function codes
appear in the fault metadata and SSW, not on the ordinary byte-access records.

The saved PC is the local fetch cursor: the instruction start for a rejected
initial opcode fetch, or the address following the completely fetched opcode
and extensions for an operand or taken-target fault. For example, an odd
`MOVE.W (A0),D0` operand saves start+2; an odd absolute-long source saves
start+6. A failed branch saves its sequential cursor, with the attempted target
recorded separately as the fault address. A fault on an exception handler's
initial fetch saves that exception's vector address.

**This is an instruction-level recovery contract.** Hardware prefetch can
advance the saved PC differently and can expose different partial register
effects. Pending An updates, result writes, condition-code changes, return
frame consumption, and call pushes still wait for their existing alignment
checks. Already completed source reads remain in the record. Completed
DIV/CHK source updates and flags remain visible if their exception entry
fails. There is no rollback of completed RAM calls or earlier exception work.
Handlers must choose a recovery PC; this core does not restart arbitrary
faulting instructions automatically.

The original 68000 has no frame-format word. **RTE consumes only the ordinary
six-byte SR/PC frame**. A bus/address-error handler must remove the first eight
bytes itself (for example, `ADDQ.L #8,A7`) before RTE. It can edit the saved PC
first to retry or skip the faulting instruction.

A successful entry returns `outcome: "executed"` and `exception.source:
"address-error"`; the shared runner can execute the handler next. Exception
metadata contains vector 3, `returnPc`, and a `fault` with operation, full
address, instruction register, function code, and `processingInstruction`.
`instruction` is null for an initial odd-PC fault or failed trace entry.

A bus or address error during either vector-2 or vector-3 entry
sets `faulted`. The record returns `outcome: "halted"` and adds `entryFault`.
No recursive frame is attempted. Frame reservation precedes the first write;
thus an odd SSP reserves 14 bytes without writing, or 20 bytes in total when
a six-byte exception entry failed first. Completed writes/vector reads stay
visible. Subsequent `step()` calls return halted with no accesses; all interrupt
offers return ignored with reason `"faulted"`, including level 7. Snapshots
preserve this latch. External reset can release it; a reset vector with an odd
PC leaves it set. An odd SSP alone is harmless until a stack access needs it.

## Bus errors

A connection's `"bus-error"` result enters **vector 2**, read from physical
`000008`–`00000B`. Bus and address errors share the seven-word frame and
function-code rules above. This applies to instruction fetches, operands,
call/return stacks, ordinary exception frames, and vector reads. The fault
address identifies the exact failed byte, retaining its full logical address.
`exception.source` is `"bus-error"`; the remaining metadata matches address errors.

The saved PC follows the sequential fetch cursor after the last completely
fetched word. A failed opcode fetch leaves `instruction: null` and the old IR;
a failed extension leaves the completed opcode/extension words in
`instruction.bytes`. A successfully read first byte of an incomplete word
still appears in `accesses`. Failed calls save the sequential cursor even
when their target was already selected. Failures during vector reads or the
first handler fetch instead save the interrupted exception's vector address.

Completed effects are retained according to the existing instruction helpers:

| Interrupted work | Effects retained before vector-2 entry |
| --- | --- |
| MOVE source read | Earlier bytes read; pending An updates and destination remain unchanged |
| MOVE destination write | Pending source/destination An updates and earlier written bytes; MOVE flags wait for the whole write |
| ALU destination read/write | An updates precede the read; result flags precede the write |
| MOVEM | Completed register loads/stores; its final base update waits for the entire list |
| BSR/JSR, PEA, LINK | Earlier stack bytes written; the stack-pointer update waits for the complete push |
| RTS/RTR/RTE | Earlier frame reads; return PC, flags, and stack consumption remain staged |
| Ordinary exception entry | Reserved six-byte frame, supervisor/trace changes, completed bytes, and any acknowledged interrupt/mask update |

These commit points deliberately describe this instruction-level model.
They do not reproduce the original processor's internal partial execution or
prefetch advancement. Hardware bus transactions are word-sized; this connection
can stop between their two modeled bytes. Recovery software must choose the
saved PC and account for retained effects; automatic instruction restart is
not provided.

Any bus/address error during bus/address-error entry terminally halts, including
its first opcode fetch. A failed transfer while writing the frame or reading
the vector appears as `exception.entryFault`, with `source: "bus-error"` for a
bus failure. A failed initial handler fetch happens in the next `step()`:
it returns `outcome: "halted"`, a top-level `fault`, and no new `exception` or
frame. Reset's first opcode fetch follows the same terminal-halt rule. The
stored `entry` context makes these decisions reproducible after restoration.
A successful complete handler opcode clears that context; subsequent operand
or extension faults belong to the handler instruction itself.

Host exceptions return no record and retain completed effects, as described
under [delivery failures](#delivery-failures-and-callbacks). They never set the
terminal-halt latch merely because a callback threw.

Records own their snapshots, bytes, accesses, fault details, and exception
metadata; the CPU retains no history. They describe instruction-level activity, without cycles, word bus
transactions, ordinary-access function codes, prefetch, or speculative reads. Device-reset
events and interrupt acknowledgements represent the explicit connections above.

## External reset

The [executable chapter](../../../src/components/cpus/specifications/68000.md#external-reset)
owns the complete reset contract: ordered supervisor-program vector reads,
independent long commits, alignment and bus-fault completion, preserved state,
records, and host-failure behavior. Its generated reset binding runs between
the native boundary's guarded snapshots and recorded accesses.

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
validation, exception delivery for every word outside the instruction inventory,
arithmetic boundaries against a BigInt oracle, every register pair and MOVEQ
byte, every incoming flag pattern,
byte order, logical and physical wrapping, alignment faults, reset, current
RAM, overlapping stores, and detached records. Transfer checks execute every
legal MOVE/MOVEA form with both active stacks, every index extension word,
every word displacement, source/destination aliasing, partial-register writes,
and alignment faults in every word/long memory mode. The
[addressing example tests](../../../tests/machines/68000/addressing-example.test.ts)
check full traces and RAM images through bounded running, resumption, and reset.
Immediate checks execute every legal size/address form and incoming flag
pattern, exhaust byte operand pairs, and check word/long boundaries, flags,
read/modify/write order, comparison auto-updates, and staged operand updates on alignment faults.
The [ALU example tests](../../../tests/machines/68000/alu-example.test.ts)
check all six families together, including complete traces and RAM images.
Control-flow checks cover the full condition truth tables, displacement and
counter sweeps, both stacks, full return addresses, overlapping code/stack,
staged operand updates on alignment faults, and retries. The
[control-flow example tests](../../../tests/machines/68000/control-flow-example.test.ts)
verify nested calls, loops, complete traces and RAM images, and snapshot resumption.
Register/address arithmetic checks all 9,144 forms in both modes, every byte
operand pair, every sign-extended word, word/long boundaries with every incoming
flag pattern, pointer aliases, wrapped and overlapping operands, and atomic
alignment faults. The [word-sum tests](../../../tests/machines/68000/word-sum-example.test.ts)
check all six families together with literal traces and complete RAM images.
Logic checks execute all 5,760 forms, exhaust byte operand pairs against bit
truth tables, and cover every result bit and incoming flag pattern, partial
Dn writes, register aliases, unchanged memory writes, wrapping, and alignment
rejection. The [logic example tests](../../../tests/machines/68000/logic-example.test.ts)
check complete merge/checksum traces and RAM images, resumption, and live masks.
Address/frame checks exercise all 464 added forms, every MOVEM mask in both
sizes/directions, every sign-extended word and LINK displacement, flag
preservation, base/index aliases, both stacks, empty lists, wrapping, overlapping
code/data, and staged operand updates on faults. The
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
stacks, unchanged writes, wrapping, code overlap, and staged operand updates on faults.
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

Paired arithmetic checks enumerate all 960 forms with every incoming flag
pattern, exhaust byte operand pairs with all four X/Z combinations, and
check word/long boundaries against independent BigInt signed ranges. Exact
records cover every register pair, partial-register preservation, both stacks,
same-An updates, wrapping, overlapping code/data, unchanged writes, alignment
rejection at either operand, and retrying a rejected instruction as bytes.
The [extended example tests](../../../tests/machines/68000/extended-example.test.ts)
check 29 complete records and RAM images in both modes, live addends and
comparison data, reset preservation, and four carry/borrow snapshot boundaries.

The ordinary-completion checks cover all remaining legal EA/register forms,
packed-decimal combinations, word operands against independent BigInt
arithmetic, every status word and MOVEP displacement, privilege/alignment
rejection, division limits and retry, CHK signed bounds, and stopped snapshot
resumption. The [decimal pipeline](examples/decimal-pipeline.md) combines the
new families, checks complete records, and resumes at every instruction boundary.

The [synchronous-exception review](reference-notes.md#synchronous-exception-delivery)
checks six-byte frames, saved-PC distinctions, transfer order, and the corpus's
limits. Tests exhaust TRAP vectors/status combinations and all 65,536 RTE
status words, cover CHK and zero divisors across every source form, and verify
privilege checks before operand reads, nesting, restored snapshots, wrapping,
overlapping vectors, alignment boundaries, and RAM-callback failures. The
[decimal pipeline](examples/decimal-pipeline.md) also runs a divide-by-zero
handler and RTE through the shared runner.

The [illegal/emulator-line review](reference-notes.md#illegal-and-emulator-line-exceptions)
checks all 19,720 words outside the instruction inventory, all status combinations,
trace suppression, PC/stack wrapping, frame/vector overlap, zero and odd targets,
RTE retry, detached records, and failures at each opcode/frame/vector byte.
A [combined program](../../../tests/machines/68000/emulator-lines.test.ts) handles
all three classes by advancing the stacked PC and returning through RTE,
with a restored CPU snapshot at every instruction boundary.

The [interrupt/control review](reference-notes.md#interrupts-trace-and-reset)
checks priority, trace sampling, level-7 edges, vector responses, RESET, and
independent-corpus limits. [Combined program tests](../../../tests/machines/68000/interrupts.test.ts)
exercise trap → trace → interrupt → RESET → three RTEs, restoring snapshots
between entries/returns, plus STOP wakeup through an interrupt and RTE.

The [address-error tests](../../../tests/components/cpus/68000.test.ts) check
literal seven-word frames and function codes in both modes, saved cursors,
IR retention, group-1/group-2 entry faults, trace and interrupt handler faults,
frame/vector overlap, 24/32-bit wrapping, terminal halt and reset recovery,
snapshot restoration, and host failures at every frame/vector byte. The
[runner recovery test](../../../tests/machines/68000/example.test.ts) removes
the eight extra bytes before RTE. See the [reference discussion](reference-notes.md#address-error-delivery)
for the limits of these checks.

The [bus-error tests](../../../tests/components/cpus/68000/bus-errors.test.ts)
inject explicit faults at each byte of representative instruction, operand,
stack, exception, vector, and reset transfers. They also cover program-space
operands, partial MOVEM/ALU effects, nested faults, first-handler-fetch context,
frame/vector overlap, restored snapshots, RTE recovery, and host-error isolation.
See the [reference discussion](reference-notes.md#bus-error-delivery).
