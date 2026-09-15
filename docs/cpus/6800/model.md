# 6800 model contract

The Motorola 6800 model implements all documented instructions at instruction
level with flat 64 KiB RAM. Instruction fetches and PC increments wrap at 16 bits; extended
addresses and the reset vector use the high byte first.

[Implementation](../../../src/components/cpus/6800.ts) ·
[CPU tests](../../../tests/components/cpus/6800.test.ts) ·
[Public type checks](../../../tests/types/6800.ts) ·
[Coverage](../coverage.md#6800) ·
[Arithmetic example](examples/arithmetic.md) ·
[Counted-loop example](examples/counted-loop.md) ·
[Stack example](examples/stack.md) ·
[Logic example](examples/logic.md) ·
[Addressing/carry example](examples/addressing.md) ·
[Word-transformation example](examples/word-transform.md) ·
[Decimal and stack-inspection example](examples/decimal.md)

Hardware references are Motorola's
[M6800 Programming Reference Manual, November 1976](https://manualzz.com/doc/1063126/motorola-m6800-microprocessor-programming-reference-manual),
sections 1, 3.2–3.5, 4.6–4.7 and Appendix A's ADD, ADC, SUB, SBC, CMP, LDA, STA, TAB, TBA,
INC, DEC, NEG, COM, ASL, ASR, LSR, ROL, ROR, TST, CLR, branch, LDS, PSH, PUL,
JSR, RTS, AND, BIT, EOR, ORA, CPX, DAA, LDX, STX, STS, TSX, TXS, TAP, TPA,
CLI, SEI, WAI, SWI, and RTI definitions; and the
[MC6800 data sheet in M6800 Systems Reference and Data Sheets](https://vtda.org/docs/computing/Motorola/M6800SystemsReferenceDataSheets_May75.pdf),
reset/interrupt descriptions and flow chart on pages 13–15 and instruction tables on pages 18–21.
The [MAME 6800 core](https://github.com/mamedev/mame/blob/master/src/devices/cpu/m6800/m6800.cpp)
also corroborates IRQ/NMI masking and reuse of the WAI frame.
The supported encodings are for the original 6800; later-family additions
and undocumented opcodes are outside this model.

## Stored state

`Cpu6800State` requires all these fields:

| Fields | Range | Meaning |
| --- | --- | --- |
| A, B | `00`–`FF` | Byte accumulators |
| X | `0000`–`FFFF` | Index register |
| SP | `0000`–`FFFF` | Stack pointer |
| PC | `0000`–`FFFF` | Program counter |
| H, I, N, Z, V, C in `flags` | Boolean | Half carry, interrupt mask, negative, zero, overflow, carry |
| waiting | Boolean | WAI has saved a frame and suspended instruction execution |

TypeScript fields are lowercase; `.machine` definitions conventionally use
uppercase register and flag names. Snapshots expose this same state. H/I/N/Z/V/C
correspond to condition-code bits 5–0. TPA packs those flags into A with bits
7–6 set; TAP replaces the flags from A's low six bits. The upper bits are not
mutable flags, and snapshots do not duplicate the flags in a packed field.
`waiting` is required, including `false` for an ordinary initial state. A snapshot
with `waiting: true` assumes its saved frame is already in the accompanying RAM;
construction neither creates nor validates that frame. External HALT remains
unmodeled and is distinct from this WAI latch.

## Construction and inspection

`new Cpu6800(ram, initialState)` requires exactly 64 KiB RAM. It copies declared
registers, flags, and the waiting latch, then validates numeric ranges and Boolean values.
Each declared field is read once, including non-enumerable properties; extra
metadata is ignored. Invalid register values or RAM size throw `RangeError`;
non-Boolean flags or waiting values throw `TypeError`. Construction neither resets the CPU nor
reads or writes RAM. All initial state must be supplied explicitly.

`snapshot()` returns detached registers and flags without RAM accesses. Public
snapshots are recursively readonly in TypeScript; bypassing that typing cannot
change the CPU or another snapshot. A snapshot can initialize a fresh CPU.
The CPU retains no execution history.

## Instruction steps

`step()` attempts one instruction and returns a `Cpu6800StepRecord` containing
independent `before` and `after` snapshots, the instruction's start address and
fetched bytes, ordered `accesses`, and an `outcome`: `executed`, `waiting`, or
`unsupported`. Only `unsupported` carries `reason: "opcode"`. WAI returns
`waiting` with its fetched instruction and frame writes. An already waiting CPU
returns `waiting` with `instruction: null`, no accesses, and unchanged state.
No ordinary instruction executes until an accepted interrupt or reset releases WAI.

Supported instructions fetch the opcode and then their operands, advancing PC
after each byte with wrap from `FFFF` to `0000`. Accumulator instructions use
the addressing forms below. Immediate forms fetch a value without a separate
data read; memory forms fetch their address bytes before reading or writing data.
Transfers and accumulator unary operations fetch only their opcode. Branches
always fetch a displacement byte, whether taken or untaken. Immediate word
operands and extended addresses are high byte first. Stack pushes,
pulls, and RTS fetch only their opcode; BSR fetches a displacement byte.
Stack data reads appear in `accesses`, but not in the fetched instruction
bytes, and do not advance PC. All instruction bytes are fetched before
stack reads or writes. STAA and STAB write the selected accumulator without
reading the destination. Writes are recorded even when the value is
unchanged. Stores can overwrite instruction or vector bytes; retained records
keep the values fetched at the time, while subsequent operations read current RAM.

Unsupported attempts read only the opcode and leave all CPU state and RAM
unchanged. Repeating the attempt repeats that read. Preserving PC despite a
recorded fetch is an explicit rejection policy of this model.

These records describe instruction-level accesses. Cycle counts, internal
cycles, dummy bus accesses, pin transitions, and electrical behavior are omitted.

## Addressing

Accumulator encodings use `1 r mm oooo`: `r=0` selects A, `r=1` selects B,
`mm` selects the addressing mode, and `oooo` selects the operation.

| mm | Mode | Operand bytes after opcode | Data address |
| --- | --- | --- | --- |
| `00` | Immediate | Value byte | No separate data address |
| `01` | Direct | Address byte | `0000`–`00FF`; independent of X |
| `10` | Indexed | Unsigned displacement byte | `(X + displacement) & FFFF` |
| `11` | Extended | Address high byte, then low byte | Full 16-bit address |

All four modes are implemented for A/B loads, ADD, ADC, SUB, SBC, CMP, AND,
BIT, EOR, and ORA, and for word LDS/LDX/CPX (two value bytes in immediate mode).
Stores support direct, indexed, and extended modes; the original 6800 has no
immediate accumulator or word store. Each byte memory source is read
once, including CMP and BIT. All accumulator instructions preserve X and SP.
Indexed displacement bytes `80`–`FF` add 128–255; X itself does not change.
Address addition wraps at 16 bits, independently of PC wrapping during fetch.

Word operands use the resolved address for the high byte and the next address
for the low byte. The second address wraps from `FFFF` to `0000`; a direct word
at `00FF` continues at `0100`. Loads/CPX read both bytes before changing state.
Stores write high then low, without destination reads. Indexed LDX/STX/CPX
resolve their address using the original X, and instruction bytes remain
captured when data overlaps code.

## Loads, stores, and addition

LDAA and LDAB load their operand into A or B respectively. STAA and STAB
store the named accumulator without changing it. All set N from bit 7 of the value and Z from
whether it is zero, clear V, and preserve H, I, and C.

LDS/LDX load SP/X; STS/STX store them. All set N from bit 15 and Z from whether
the entire word is zero, clear V, and preserve H/I/C. Stores preserve their
source register; loads preserve the other registers.

ADDA/ADDB add their byte operand to A/B without incoming carry; ADCA/ADCB
include the current C bit. Results wrap to a byte. Both families replace
H/N/Z/V/C: H indicates carry from bit 3, N the result's
sign bit, Z a zero result, V signed overflow, and C carry out of bit 7. I is
preserved. Instructions leave the other accumulator, X, and SP unchanged.
ABA applies the same addition to A + B, ignoring incoming C and retaining B.

## Subtraction and comparison

SUBA/SUBB subtract the operand from A/B; SBCA/SBCB also subtract the current
C bit as an incoming borrow. They replace N/Z/V/C from the binary subtraction,
with C set for unsigned underflow. An operand of `FF` plus an incoming borrow
still subtracts 256; it is not reduced to zero before testing the borrow.
H and I are unaffected, as specified for the original 6800.

CMPA/CMPB produce SUB's flags without changing either accumulator or memory.
They ignore incoming C. Addition and subtraction use the shared binary
arithmetic helpers; the CPU applies its own flag rules.
SBA and CBA apply SUB and CMP respectively to A and B, retaining B and
ignoring incoming C.

CPX preserves X and H/I/C. Z tests equality of the whole word. On the original
6800, N/V describe subtraction of the high bytes **without** a borrow from
the low bytes. For example, `0100` compared with `0101` gives N=0, Z=0,
V=0; it is not a full-width signed subtraction. Motorola cautions against
using N/V for CPX conditional branches. This differs from later-family CPX.

## Decimal adjustment

DAA adjusts A after ABA, ADDA, or ADCA on packed-BCD operands. It adds `06`
when the original low nibble exceeds nine or H is set, and `60` when the
original A exceeds `99` or C is set. Both decisions use the pre-adjustment
state. A wraps to a byte; N/Z describe that byte. C retains an incoming carry
or is set by adjustment overflow. H/I remain unchanged.

Motorola's Appendix A table defines results reachable from addition of two
valid BCD operands, including incoming carry. For other A/H/C combinations,
this model applies the same correction rules deterministically without
claiming a documented decimal result. The manual leaves V undefined; the
model clears it. DAA does not implement BCD subtraction or a decimal-mode latch.

## Condition-code transfers and controls

TAP copies A bits 5–0 into H/I/N/Z/V/C, ignoring the top two bits and preserving
A. TPA copies those flags to A with bits 7–6 set, preserving all flags.
CLC/SEC clear/set C; CLV/SEV clear/set V; CLI/SEI clear/set I. Other state is
unchanged, apart from the normal one-byte PC advance. The next explicit IRQ
offer observes the current I, including after TAP or RTI. Hardware look-ahead
and pin-sampling delays remain outside the instruction-level model.
NOP only advances PC.

## Accumulator logic

ANDA/ANDB replace the named accumulator with its bitwise AND with the operand;
ORAA/ORAB use inclusive OR, and EORA/EORB use exclusive OR. BITA/BITB form
the same result as AND for flag updates but leave both accumulators unchanged.
All eight forms set N from bit 7 of the logical result, set Z when that result
is zero, clear V, and preserve H/I/C. The other accumulator, X, and SP are
unchanged. In particular, BIT does not copy N or V from the operand: both N
and Z describe the AND result, and V is always cleared.

## Unary operations

`01 tt oooo` encodes A (`tt=00`), B (`01`), indexed memory (`10`), or extended
memory (`11`). There is no direct-page unary form. Indexed addresses use the
same unsigned displacement and wrapping rules as byte loads and stores.
The selected register or memory byte supplies the operand; every other
register is preserved. H/I are unaffected by all eleven operations.

| Operation | Result | N/Z | V | C |
| --- | --- | --- | --- | --- |
| NEG | Two's complement, modulo 256 | From result | Operand was `80` | Operand was nonzero |
| COM | Complement all bits | From result | Clear | Set |
| LSR | Shift right with a zero high bit | From result | N XOR C | Original bit 0 |
| ROR | Shift right with incoming C as bit 7 | From result | N XOR C | Original bit 0 |
| ASR | Shift right retaining the sign bit | From result | N XOR C | Original bit 0 |
| ASL | Shift left with a zero low bit | From result | N XOR C | Original bit 7 |
| ROL | Shift left with incoming C as bit 0 | From result | N XOR C | Original bit 7 |
| DEC | Subtract one, modulo 256 | From result | Operand was `80` | Preserve |
| INC | Add one, modulo 256 | From result | Operand was `7F` | Preserve |
| TST | Leave operand unchanged | From operand | Clear | Clear |
| CLR | Zero | N=0, Z=1 | Clear | Clear |

V for shifts and rotates uses N/C **after** the operation. In particular, the
6800 right shifts replace V and TST clears C. The 6809 preserves V for right
shifts and C for TST. The two CPUs share pure byte-shift calculations in the
[ALU helpers](../implementation.md#shared-arithmetic), keeping flag application
within each core.

Memory transforms fetch all address bytes, read the operand once, and write
the result once, even when it is unchanged. TST records a single operand read
and no write. At this instruction-level boundary CLR records a single zero
write; it does not need the old value. Extra hardware bus cycles remain outside
the model. These choices are explicit access-record policies, not a claim of
cycle accuracy. Code and data may overlap: records retain the original fetched
bytes, and subsequent steps use current RAM.

The [word-transformation example](examples/word-transform.md) composes ASR/ROR
across a signed word, then uses COM/INC and a branch on Z to negate the result.

## Accumulator operations and short branches

TAB copies A to B; TBA copies B to A. The source is unchanged. Both set N/Z
from the copied value, clear V, and preserve H/I/C. DECA/DECB and INCA/INCB
subtract or add one in the named accumulator, wrapping within a byte. They
set N/Z from the result and replace V: decrement overflows only from `80`
to `7F`, increment only from `7F` to `80`. H/I/C are preserved. These
instructions leave X, SP, and the other accumulator unchanged.

BRA and all fourteen short conditional branches are supported. BRA always
branches; the conditional pairs test current flags:

| Pair | First branch condition | Second branch condition |
| --- | --- | --- |
| BHI / BLS | C = 0 and Z = 0 | C = 1 or Z = 1 |
| BCC / BCS | C = 0 | C = 1 |
| BNE / BEQ | Z = 0 | Z = 1 |
| BVC / BVS | V = 0 | V = 1 |
| BPL / BMI | N = 0 | N = 1 |
| BGE / BLT | N = V | N ≠ V |
| BGT / BLE | Z = 0 and N = V | Z = 1 or N ≠ V |

The original 6800 leaves opcode `21` unused; the later 6809's BRN is not a
6800 instruction. Branches interpret their displacement as a signed byte
(`−128` through `+127`) added to PC after the two instruction bytes, wrapping
at 16 bits. Untaken branches leave PC at that fallthrough address. Neither
path prefetches a target instruction, writes RAM, or changes other registers
or flags. Subsequent instructions see current state and current RAM operands.

## Stack and subroutines

INX/DEX adjust X by one with 16-bit wrapping and replace **only Z**. INS/DES
adjust SP by one with 16-bit wrapping and preserve every flag. TSX copies
`SP + 1` to X; TXS copies `X - 1` to SP, both wrapping and preserving all
flags. These four stack-pointer instructions make no RAM data accesses.

SP points to the next free stack byte in the full 16-bit address space.
A push writes at SP, then decrements SP; a pull increments SP, then reads
at SP. Both wrap between `0000` and `FFFF`. PSHA/PSHB push the named
accumulator; PULA/PULB pull a byte into it. All four preserve every flag,
including N/Z on pulls, and leave the other accumulator and X unchanged.
Pulls do not clear memory.

BSR and indexed/extended JSR push the address immediately after the instruction,
low byte first and then high byte, using two stack bytes. BSR adds its signed
displacement to that return address, with the same 16-bit wrapping as short
branches. Extended JSR takes its target from the high-byte-first address
operand. RTS pulls the high byte and then the low byte and uses that return
address directly. Calls and returns preserve A/B/X and all flags; they do not
prefetch the target instruction. Indexed JSR adds its unsigned byte offset to
the original X and saves the address after its two instruction bytes. Indexed
and extended JMP replace PC with the resolved target without reading target
data or using the stack. JMP preserves all other state.

Stack accesses use ordinary current RAM and the current SP. Saved accumulator
values and return addresses share the same stack; there is no hidden call
history, frame type, depth limit, or underflow check. RTS can consume bytes
placed in RAM without a preceding call. Editing stack memory changes what
the next pull or return reads, and stack writes may overwrite code or vectors.

## Interrupt entry and return

SWI, IRQ, and NMI use a seven-byte frame on the ordinary RAM stack. Entry
writes PC low/high, X low/high, A, B, and packed CC in that order, decrementing
SP after each write and wrapping at 16 bits. CC has bits 7–6 set and retains
the pre-entry I. After saving the frame, entry sets I and reads its vector
high byte first; PC changes after both reads succeed.

| Entry | Saved PC | Vector |
| --- | --- | --- |
| SWI (`3F`) | Address after the one-byte instruction, wrapping at 16 bits | `FFFA` / `FFFB` |
| IRQ | Current PC at the offered boundary | `FFF8` / `FFF9` |
| NMI | Current PC at the offered boundary | `FFFC` / `FFFD` |

SWI executes regardless of I. All three preserve A/B/X and the other five
flags. Vector reads use current RAM after the writes, so overlapping stack
and vector locations affect the target. No handler instruction is prefetched.

RTI (`3B`) increments SP before each of seven reads, restoring CC, B, A,
X high/low, and PC high/low. It ignores CC bits 7–6 and replaces all six
flags. It returns to the saved PC without an extra increment and needs no
preceding interrupt: the frame may be supplied or edited by the caller.
Words replace X or PC after both bytes are read. All reads are stack data
accesses; the only fetched instruction byte is `3B`.

## Waiting and external interrupt delivery

WAI (`3E`) advances PC, saves the same frame, then sets `waiting: true`.
It preserves every flag, including I. A masked IRQ leaves it waiting; an
accepted IRQ or NMI reuses the existing frame, clears waiting, sets I, and
reads the selected vector without further pushes. RTI consequently restores
the state saved by WAI. Reset also releases waiting, without unwinding the frame.

`interrupt("irq" | "nmi")` offers a selected request at the current instruction
boundary. IRQ is ignored when current I is set; NMI is always accepted.
The caller owns pending IRQ levels, NMI edge detection, and priority when
multiple sources need service. Offers are neither queued nor sampled by
`step()`. A repeated NMI offer represents another selected event and can nest.
Hardware look-ahead, cycle timing, and pin-level recognition are unmodeled.

`Cpu6800InterruptRecord` contains detached `before`/`after` snapshots,
`source`, `instruction: null`, ordered memory `accesses`, and either
`outcome: "accepted"` or `outcome: "ignored", reason: "masked"`. Only IRQ can
be ignored; ignored entry makes no accesses or changes, including while waiting.
Invalid source values throw `RangeError` before accessing RAM or changing state.

The [runner](../../runtime/runner.md) returns `stopReason: "waiting"` as soon
as a step reports it. The caller delivers an interrupt separately and can run
again. A waiting snapshot plus its RAM can initialize a fresh CPU and resume
through the same delivery path, without hidden saved frames or pending signals.

## Transition boundaries and host failures

`step()`, `interrupt()`, and `reset()` share a per-instance execution guard.
RAM callbacks may inspect snapshots; nested mutating calls throw before they
access RAM or change state. The guard is released even when a transition throws.

A RAM error propagates without a result record or rollback. Completed accesses
and register changes remain visible: instruction fetch advances PC after a
successful read, a push decrements SP after a successful write, and a pull
increments SP before its read. RTI retains each completed byte register/flag
restore; a partly read word leaves X or PC unchanged. WAI sets waiting only
after the complete frame. Entry sets I and releases waiting before the vector
reads, retaining those changes if a read fails. Reset commits its PC/I/wait
changes only after both reads succeed.

This is host-error behavior, not a modeled hardware memory exception. A failed
transition has no automatic retry or continuation; callers can restore CPU/RAM
or reset explicitly.

## CPU reset

`reset()` reads `FFFE` followed by `FFFF`, loads their high-byte-first address
into PC, sets I, and clears waiting. It performs no instruction fetch or RAM write. A/B/X/SP,
the other five flags, and RAM are preserved. Preserving state for which the
reset specification does not establish values is a deterministic model policy;
it does not claim defined power-on values for those registers.

The `Cpu6800ResetRecord` has detached before/after snapshots and the two vector
reads, without an instruction or step outcome. Every reset rereads the current
vector. A later step executes from the resulting PC. Reset inside a subroutine
preserves the current SP and saved stack bytes; it does not unwind calls.

Reset does not restore an example's original registers or memory image.
Creating a fresh example performs that lesson restart. A caller completion
address belongs to the runner; the CPU itself does not stop at that address.

## Checks and limits

Independent CPU tests cover every addition operand pair, all incoming flags
at arithmetic boundaries, every load/store/transfer/increment/decrement byte
and flag pattern, every store destination, every PC, and every reset-vector
value. Literal branch truth tables cover every flag combination; displacement
checks cover every byte, taken and untaken paths, and boundary wrapping.
Unary tests cover every byte and incoming flag combination in all 44 forms,
using arithmetic ranges and bit-string shifts for independent expectations.
Addressing checks cover every indexed displacement, wrapping, overlapping
instruction bytes, unchanged-value writes, and the distinct TST/CLR records.
Complete records and observed RAM calls check byte order, preserved state,
unchanged-value writes, self-modifying code, unsupported attempts (including
`21`), repeated reset, and detached snapshots.

Stack checks cover every LDS word, accumulator byte and incoming flag pattern,
every push/pull SP, every BSR displacement, and every JSR/RTS target. Boundary
cases cover word-wide LDS flags, PC/SP wrapping, overlapping code and stack
bytes, low-first call writes, high-first return reads, unchanged flags, and
edited stack RAM without hidden return state.

Logic tests use independent per-bit truth tables for every operand pair in
both accumulators, with incoming flags all clear and all set. Further checks
cover all flag patterns at byte boundaries and with alternating-bit operands,
ordinary and wrapped PC, exact fetch records, BIT preserving its accumulator,
current operands, and resumption after replacing an unassigned opcode.

All eighty accumulator-read encodings have literal-opcode tests across all
incoming flag patterns and arithmetic boundaries. Independent signed-range
calculations check every immediate arithmetic operand pair in both accumulators,
including both incoming bits for ADC/SBC. The six stores check all byte values
and flag patterns. Address tests cover every direct address byte, every unsigned
indexed displacement at boundary X values, PC wrapping, and operands or stores
overlapping fetched instructions. Actual RAM calls verify complete fetch/data
ordering, preserved registers, and unchanged-value writes.

The generated arithmetic, counted-loop, stack, logic, and addressing examples check full initial/final
memory images, explicit state, complete execution records, bounded running,
caller completion, reset, and fresh restart. The loop also checks pause/resume
and an edited displacement that repeats BNE until the step budget expires.
The stack example nests BSR inside JSR, saves/restores both accumulators,
resumes from snapshots and RAM at different call depths, and checks residual
stack bytes and reset during a call.
The logic example exercises all eight immediate forms inside a subroutine,
branches on BIT results, preserves the caller's B on the stack, adds to A,
and stores the answer. It checks snapshot resumption after either bit test,
as well as edited masks that select the early-return and fallback paths.
The addressing example propagates carry and borrow across A/B, wraps indexed
addresses into page zero, and branches on a memory comparison. It checks
snapshot resumption across the arithmetic chain and an edited addend that
changes the borrow and selects the fallback path.
The word-transformation example checks the full trace and memory image,
the low-byte wrap path, resumption between ASR and ROR, and a bounded loop
after a code edit. Shared shift tests cover every byte and incoming bit;
the unchanged 6809 instruction tests verify its own flag policies.
Parser, generator, and type checks preserve CPU-specific state and record
contracts.

Word-transfer tests cover every loaded/stored word, all forms and flag patterns
at boundaries, every direct address and indexed offset, and data/code overlap.
CPX checks every high-byte pair with equal and unequal low bytes, including
low-byte borrowing. Pointer operations check every 16-bit value and all flags
at boundaries. TAP/TPA cover every A byte and flag pattern; subsequent arithmetic
checks that restored flags remain live. ABA/SBA/CBA cover every byte pair.
DAA checks every row of the adjustment table and every BCD operand pair after
ABA/ADDA/ADCA, plus explicit policies for undefined inputs and V. JMP/JSR tests
check target and stack wrapping, overlapping writes, and absence of target reads.
The [decimal example](examples/decimal.md) combines an indexed call, stack
inspection, decimal arithmetic, packed flags, and a word comparison. It verifies
complete records, RAM images, snapshot resumption, and a bounded failure loop.

Interrupt checks cover every flag pattern, all packed RTI status bytes,
stack/code/vector overlaps and wrapping, current-mask offers, masked waits,
frame reuse on wake, and live RAM edits. Failure injection checks each entry,
return, and reset access; callbacks check reentrancy and inspection. A runner
program combines WAI, IRQ, nested NMIs, RTI, and SWI, comparing complete traces
and RAM after resuming a waiting snapshot. Parser/generator/type checks include
the required waiting field and the waiting/interrupt record unions.

All 197 documented forms are complete; the opcode audit rejects the 59
undefined encodings. Mapped devices, external HALT, look-ahead, and cycle timing
remain deferred. The 6800 has no separate port-I/O instruction forms.
