# MOS 6502 model

This document defines the model's state, execution records, and reset contract.
Current instruction support is tracked in [6502 implementation coverage](../coverage.md#6502).
The [examples](../../README.md#cpu-examples) specify concrete programs,
instruction behavior, and expected execution.

[Implementation](../../../src/components/cpus/6502.ts) ·
[CPU tests](../../../tests/components/cpus/6502.test.ts) ·
[Public type checks](../../../tests/types/6502.ts)

## Model boundary

`Cpu6502` models the original MOS 6502 (NMOS), connected to flat
[64 KiB RAM](../../machines/definitions.md#ram-and-cpu-ownership). This is not
a 65C02 or the NES's Ricoh 2A03 variant.

One `step()` attempts one instruction. The CPU has no example-completion
address or synthetic halted latch; the caller decides when to stop stepping.
Records are instruction-level. Timing, dummy bus reads, interrupt inputs,
undocumented opcodes, devices, and browser controls remain outside this model.

## State and initialization

`Cpu6502State` contains `a`, `x`, `y`, `sp`, `pc`, and `flags`.
`Cpu6502Flags` contains booleans `n`, `v`, `d`, `i`, `z`, and `c`.
I is the interrupt-disable flag, with the opposite sense to the 8080's
interrupt-enable latch. The six flags are stored individually; the
[status stack](#status-stack) encodes and restores them as a byte. B and the
unused status bit are not stored fields or new snapshot properties.

`new Cpu6502(ram, initialState: Cpu6502Snapshot)` requires exactly 64 KiB of RAM
and copies only declared state fields, including flags, into CPU-owned storage.
It performs no reset, vector reads, or instruction fetches. A, X, Y, and SP
must be integers in `00`–`FF`; PC must be an integer in `0000`–`FFFF`. Invalid
numeric values or RAM size throw `RangeError`; non-boolean flags throw `TypeError`. Extra input
properties are ignored. Declared fields may be supplied through getters,
including inherited and non-enumerable fields; each is copied once before
validation.

Initial registers and flags are explicit caller choices, not power-on or reset
defaults. SP is an 8-bit offset within page `01`. Flags are stored state:
supplying A = `00` does not implicitly set Z.

Values exposed in records are numbers; hexadecimal formatting belongs to
presentation. PC and operand fetching wrap at 16 bits. RAM's host API validates
addresses and values instead of wrapping them.

## Snapshots and ownership

`snapshot()` returns a detached `Cpu6502Snapshot` with recursively readonly
TypeScript fields. Records have the same ownership guarantees: later CPU or
RAM changes cannot alter them, and edits made by JavaScript to returned values
cannot change live state. Readonly typing does not require runtime freezing.
Snapshots copy CPU state, not RAM, and inspection performs no RAM accesses.

## Step records

The CPU-specific `Cpu6502StepRecord` has these fields:

| Field | Meaning |
| --- | --- |
| `instruction` | Non-null `{ address, bytes }` from the attempted instruction |
| `before`, `after` | Complete detached CPU snapshots |
| `accesses` | Ordered `{ kind, address, value }` entries, with kind `read` or `write` |
| `outcome` | `executed` or `unsupported` |
| `reason` | Present only with `unsupported`: `opcode` |

The outcome/reason relationship is a discriminated union. All public record
fields, nested snapshots, byte arrays, and access entries are readonly. There
is no `halted` or `complete` CPU outcome in this subset, and no null instruction.

Instruction bytes come from the actual opcode and operand reads. Data reads
and writes appear only in `accesses`. Record the actual accesses during execution,
without rereading an instruction or the old contents of a write destination.
These records omit dummy reads and carry no cycle-count claim.

## Register operations and relative branches

Register loads, transfers between A and X/Y, and index increments/decrements
replace N/Z from their result and preserve V/D/I/C. Index arithmetic wraps
within eight bits. Transfers preserve their source register.

TSX copies the eight-bit SP offset to X and updates N/Z like other register
loads. TXS copies X to SP and preserves every flag. Neither instruction
accesses stack memory; later pushes, pulls, and calls use the new SP. This
follows sections 8.8–8.9 of the [manufacturer manual][1]; its Appendix B
incorrectly marks N/Z as affected by TXS.

The eight conditional branches test the stored N, V, C, or Z flag for its
specified set/clear value. Every branch fetches its signed eight-bit displacement,
including when untaken. A taken target is relative to PC after both bytes,
with 16-bit wrapping; otherwise PC stays at that following address. Branches
preserve all registers other than PC and all flags. See the
[manufacturer manual][1], sections 4.1 and 7, and Appendix B.

At this model's instruction boundary, register-only steps read just the opcode;
immediate loads and branches read the opcode then the operand. There are no
target or dummy reads, including on a taken branch or page crossing. Subsequent
steps fetch current RAM at the resulting PC. The
[counted-loop example](examples/counted-loop.md) specifies a complete trace
combining register updates, arithmetic, branching, and a final store.

## Memory operands, logic, and comparison

Operand readers separate address resolution from instruction behavior. Immediate
operands come from the instruction stream. Memory forms fetch their address
bytes, read any pointer, then read the effective address once. Stores resolve
that same address and write once, without reading the destination first.

Zero-page indexing discards carry beyond bit 7. Absolute indexing wraps at 16
bits. Indexed indirect `(zp,X)` adds X to the operand within page zero, then
reads a low/high pointer there. Indirect indexed `(zp),Y` reads the operand's
low/high pointer first, then adds Y to that 16-bit address. Both pointer reads
stay within page zero: the high byte following `00FF` comes from `0000`.
LDX/STX use Y for their indexed forms; LDY/STY use X.

All data and pointer reads use current RAM and appear only in `accesses`.
When an effective address overlaps a pointer byte, both reads are retained.
A store can replace its own operand or pointer after those bytes were captured;
subsequent instructions see the replacement. There are no dummy reads or page
crossing cycle penalties at this instruction-level boundary.

ORA, AND, and EOR combine the operand with A, replacing A and N/Z while
preserving V/D/I/C. CMP, CPX, and CPY preserve all registers, replace N/Z from
the eight-bit result of A, X, or Y minus the operand, and set C when that
register is at least the operand (no borrow). Comparisons preserve V/D/I and
ignore incoming C. CPX/CPY have immediate, zero-page, and absolute forms.

BIT leaves A unchanged, copies memory bits 7/6 into N/V, and sets Z when
A AND memory is zero. N/V describe the memory byte, independently of the
masked result; C/D/I are preserved. Only zero-page and absolute BIT exist on
this CPU. D does not alter logic, comparison, bit-test, or load/store behavior.
See the [manufacturer manual][1], sections 2.2.4, 4.2.1–4.2.2, 6.1–6.5, 7,
and Appendix B.

The [buffer-processing example](examples/buffer.md) combines these memory
forms and operations with arithmetic, branches, and subroutine calls.

## Flag controls and NOP

CLC/SEC clear/set C, CLV clears V, and CLD/SED clear/set D. Each preserves
every other flag and register except PC. NOP (`EA`) changes only PC. These
one-byte instructions read only their opcode at this instruction boundary;
undocumented NOP encodings remain unsupported. See [manual][1], chapter 3
and Appendix B. Interrupt-specific CLI/SEI remain deferred.

CLD selects binary ADC/SBC; SED selects
[NMOS decimal arithmetic](#arithmetic-and-decimal-mode). D does not change
the behavior of other instructions. The
[comparison/flag example](examples/flags.md) combines these controls with
BIT, index comparisons, branches, and a stack slot selected by TXS.

## Shifts and memory modification

ASL/LSR insert zero while shifting one bit left/right. ROL/ROR insert the
incoming C at the vacated end. All four put the outgoing bit in C, replace
N/Z from the result, and preserve V/D/I. Accumulator forms replace only A
and those flags, reading just the opcode. Memory forms leave A/X/Y/SP alone.
ROR follows the documented behavior available after June 1976; the early
NMOS ROR defect is outside this model. See [manual][1], sections 10.1–10.5.

INC/DEC change the addressed byte by one with eight-bit wrapping, replace
N/Z, and preserve V/D/I/C. They have no accumulator forms on this CPU.
All six operations use zero page, absolute, zero page X, and absolute X;
index/address wrapping follows the existing address helpers.

A memory-modifying instruction captures its effective address, reads the
original byte, writes that original byte back, then writes the result to the
same address. Both writes are performed and recorded, even when their values
agree. Instruction bytes already fetched remain intact in the record if the
destination overlaps an opcode or operand. Later instructions use current RAM.
The operation does not reread memory between writes or recalculate the address.
N/Z describe the modified result, rather than the preserved accumulator.

The two writes follow the NMOS sequence in [manual][1], section 10.6;
sections 10.7–10.8 describe INC/DEC. The original-byte write was also checked
against all 10,000 independent [ASL zero-page reference cases][3], comparing
modeled state, final RAM, and ordered accesses. This is a supplementary check;
the repository's tests remain self-contained and require no downloaded data.
Dummy reads and next-instruction prefetches remain omitted, including indexed
forms with or without a page crossing. No cycle-accuracy claim is implied.

The [shift example](examples/shifts.md) passes carry between a two-byte word's
halves and uses INC/DEC counters to control a loop, with D set throughout.

## Jumps and subroutines

Absolute JMP fetches a low/high target and replaces PC. Indirect JMP fetches
a low/high pointer, then reads the target's low and high bytes from RAM.
The pointer increment wraps within its page on this NMOS CPU: `JMP ($30FF)`
reads target low at `30FF` and target high at `3000`, not `3100`. A pointer
at `FFFF` reads its high byte at `FF00`. Instruction fetching still wraps
at 16 bits. See [manual][1], section 9.8.1 and example 9.6.

JMP captures both instruction operands before reading the pointer. Every
pointer read uses current RAM and remains separate in the access log even
when it overlaps an opcode or operand. There is no target prefetch; the
next step reads current RAM at the resulting PC. The page-wrapped pointer
reader is shared with zero-page indirection, whose input is always in page zero.

JSR saves the address of its last operand byte on the page-one stack, high
byte first. RTS pulls low then high and adds one, wrapping at 16 bits. Both
JMP forms, JSR, and RTS preserve flags. JSR decrements SP twice and RTS
increments it twice, wrapping within page one.

JSR interleaves instruction fetches and stack writes: opcode, target low,
saved-PC high, saved-PC low, target high. Its final operand fetch observes
any overlapping stack write; earlier captured instruction bytes remain intact.
RTS reads current stack RAM even without a preceding call, retains those
bytes, and does not maintain a separate call stack or check nesting depth.
See the [manufacturer manual][1], sections 4.0.2 and 8.1–8.3.

Records retain this meaningful access order but omit discarded bus reads and
next-instruction prefetches. The [subroutine example](examples/subroutines.md)
checks nested calls, saved accumulator data, and stack wrapping together.

## Status stack

PHP pushes the current status byte at `0100 + SP`, then decrements SP with
eight-bit wrapping. Its byte layout from bit 7 to bit 0 is **N V 1 1 D I Z C**.
Bits 5 and 4 are always set in a PHP write; bit 4 is the stacked B marker,
not a stored flag. PHP preserves all six flags and A/X/Y.

PLP increments SP with eight-bit wrapping, reads the byte at `0100 + SP`,
and restores N/V/D/I/Z/C from their corresponding positions. Bits 5 and 4
are ignored. N/Z come from the saved flags, independently of A or the value
of the stacked byte as a whole. A/X/Y stay unchanged. PLP uses current RAM
even without a preceding PHP, and leaves the raw byte in memory. A subsequent
PHP regenerates bits 5/4 as ones regardless of what PLP read.

Both instructions reuse the page-one stack used by PHA/PLA and JSR/RTS.
Each records only the opcode fetch and its stack write/read; dummy reads
are omitted. Code/stack overlap follows that access order, with fetched
opcode bytes retained in records. See [manual][1], sections 8.10–8.12.

PLP restores D and I in the after-state. D immediately selects the
arithmetic mode for ADC/SBC; I remains stored state without interrupt delivery or polling
timing. BRK/RTI/CLI/SEI remain deferred with interrupts.

All 10,000 independent cases for each of [PHP][4], [PLP][5], and
[indirect JMP][6] were checked against modeled state, final RAM, and ordered
accesses. The PHP/PLP comparisons omit their discarded bus reads; indirect
JMP records all five reads. These supplementary checks establish the pushed
bits and NMOS pointer wrap as well as ordinary cases. Repository tests remain
self-contained; no reference data is required to build or test.

The [status/dispatch example](examples/status.md) saves flags around an
indirectly dispatched subroutine, then uses restored Z to branch while
retaining the subroutine's accumulator result.

## Arithmetic and decimal mode

ADC adds A, the operand, and incoming C. SBC subtracts the operand and the
incoming borrow (`1 - C`) from A. Both support immediate, zero page, zero
page X, absolute, absolute X/Y, `(zp,X)`, and `(zp),Y` addressing. They change
A and N/V/Z/C, preserve X/Y/SP/D/I, and read operands through the same
address resolvers as other accumulator operations. Neither writes memory.

With D clear, A receives the low eight bits. N reflects result bit 7, Z
indicates a zero byte, and V indicates signed overflow. ADC sets C for
an unsigned carry; SBC sets C when no borrow is needed. Thus C can pass
between successive low/high-byte operations, with CLC starting addition
and SEC starting subtraction without an incoming borrow.

With D set, each nibble represents a decimal digit. ADC corrects digit sums
above nine; SBC corrects digits that borrow. Each low digit passes at most
one carry or borrow to the high digit, including for invalid BCD nibbles
`A`–`F`. A receives the corrected byte. NMOS flag sources differ:

| Flag | Decimal ADC | Decimal SBC |
| --- | --- | --- |
| N | Bit 7 after correcting the low digit, before correcting the high digit | Bit 7 of the binary subtraction result |
| V | Signed overflow at that same ADC intermediate stage | Signed overflow of binary subtraction |
| Z | Whether the binary sum's low byte is zero | Whether the binary difference's low byte is zero |
| C | Decimal carry out of the high digit | No borrow from binary subtraction |

For example, decimal `99 + 01` with C clear produces A = `00`, C = 1,
N = 1, and Z = 0. Decimal `79 + 00` with C set produces A = `80` and
V = 1, despite binary addition producing `7A` without overflow. Decimal
`00 - 01` with C set produces A = `99` and C = 0. These are NMOS rules;
do not update N/Z from the final corrected byte as a 65C02 would.

The [manufacturer manual][1], sections 2.2.1–2.2.2, 3.3 and Appendix B,
defines decimal arithmetic but does not promise usable decimal N/V/Z.
This model also reproduces the NMOS intermediate flags and invalid-digit
results described by [Bruce Clark's decimal test predictions][7]. All
10,000 [SingleStepTests cases][8] for each of the sixteen ADC/SBC encodings
were checked against final CPU state, RAM, fetched bytes, and ordered
meaningful accesses (160,000 cases total). Discarded bus reads were omitted
in accordance with this model's instruction-level boundary. These are
independent emulator reference cases, not a claim of hardware testing here.

The [decimal example](examples/decimal.md) adds and subtracts packed-decimal
values across two bytes. Repository tests exhaust all byte pairs and carry
inputs in both modes, including invalid BCD digits, and separately compare
valid BCD results with base-100 arithmetic. Tests remain self-contained.

## Unsupported instructions

Opcodes outside the [coverage inventory](../coverage.md#6502) return
`unsupported` with reason `opcode`, read only the opcode, and leave CPU state
and RAM unchanged. Repeating the call repeats that read; it does not advance
past the limitation. The caller must stop on unsupported results and use a
bounded instruction budget when running programs.

## CPU reset

`reset()` returns a separate `Cpu6502ResetRecord` containing `before`,
`after`, and `accesses`, with the same detached, readonly ownership guarantees
as step records. It has no instruction, outcome, or reason fields. The CPU
does not retain either kind of record.

The model's reset operation:

1. Reads `FFFC` and then `FFFD`, combining low and high bytes into the new PC.
2. Sets I to true and changes SP to `(oldSp - 3) & 0xff`.
3. Preserves A, X, Y, N, V, D, Z, C, and all RAM.

This captures the NMOS reset state effects, including the stack-pointer
decrement; it does not set SP to a fixed reset constant. See the
[manufacturer manual][1] and [Visual6502 reset analysis][2]. At this
instruction-level boundary, only the two vector reads are performed and
recorded. The model omits the dummy instruction and stack reads shown in
that analysis and does not prefetch an instruction at the reset target.

Reset always uses the current vector. Each reset decrements the current SP by
three, wrapping within eight bits; it does not cache the startup address or
restore the initial SP. Restarting an example instead creates fresh CPU and
RAM components with the complete initial state and memory image, without an
additional reset. See the [machine definition guide](../../machines/definitions.md).

## Contract checks

The CPU and public type tests check every constructor field and RAM size,
copying declared fields only, no construction or inspection accesses, detached
snapshots and records, and readonly fields and outcome/reason relationships.

Register checks cover every byte and incoming flag combination, preserving
unrelated state and checking exact accesses. Branch checks cover each condition
with all flag combinations, every displacement, both paths, page and address-space
crossings, instruction-byte overlap, live flags after arithmetic and register
updates, current operands, and retained records.

Logic and comparison checks cover every accumulator/operand pair with both
D values, plus every incoming flag combination through all eight modes.
CPX/CPY and BIT likewise exhaust register/operand pairs and check their
forms with every incoming flag pattern, live operands, PC wrapping, and
instruction/data overlap. BIT checks distinguish memory N/V from the AND result.
TSX/TXS check every source byte and flag combination without memory access
beyond the opcode. Flag controls and NOP check exact preservation, repeated
execution, and PC wrapping. SED/CLD select the next ADC/SBC mode, PLP restores
D/C, and reset preserves decimal mode and the carry between operations.
Examples check live flags and SP across instruction sequences and snapshot
resumption.
Memory checks cover every X/Y load and A/X/Y store value, index selection,
zero-page and 16-bit wrapping, low/high pointer order, overlap, current RAM,
unchanged-value stores, and retained records. Opcode/operand reads are checked
separately from pointer/data accesses, including when PC crosses FFFF.

All shift/rotate and memory INC/DEC forms are checked with every byte and
incoming flag combination, including unchanged-value writes, register/flag
preservation, address and PC wrapping, full RAM preservation outside the
destination, live data/index/carry inputs, and captured self-modifying operands.

Jump and subroutine checks cover every target or stacked return pointer, all
SP values and flag patterns, PC/SP wrapping, unchanged-value pushes, and
code/stack overlap. They verify ordered RAM calls, JSR's late high-byte fetch,
RTS's increment, edited stack contents, and subsequent execution at the target.

Indirect JMP checks every pointer address and target, including wrapping
within every page, all incoming flag patterns, instruction fetching across
FFFF, and overlapping instruction/pointer reads. PHP checks every flag
combination and SP, including unchanged writes; PLP checks every stacked
byte against every incoming flag pattern with SP values spanning the page.
Further checks cover ignored bits, PHP after PLP, code/stack overlap, and
restored D/C affecting ADC/SBC. The status/dispatch example checks complete
records, RAM images, current pointers, snapshot resumption, and reset.

Unsupported opcodes are checked on repeated attempts, with no
operand read or state changes. Reset checks cover ordered reads of the current
vector, SP wrapping and repeated decrements, preservation of RAM and unrelated
state including D, and resumed execution at the new PC. Records remain
independent across execution, reset, restart, host RAM edits, and caller edits.

## Implementation notes

Reuse RAM and small opcode handlers composing operand access with CPU-specific
operations. Operations that consume data accept values; handlers obtain them
through recorded operand or data reads. Store handlers resolve a destination
and write without first reading its contents.

Keep flags, addressing, reset, and records specific to this CPU while
[focused examples across the initial three CPUs](../scope.md) inform shared interfaces.
The [reference notes](reference-notes.md) record ideas from applepy and
dromaios-apple2, including captured-step explanations and side-effect-free
previews, opcode metadata, lesson annotations, addressing, and timing.

## References

- [Synertek/MOS MCS6500 Programming Manual][1], sections 2.1–2.2, 3, 4, 6.1–6.5, 7,
  8.1–8.3, 8.8–8.12, 9.1–9.4, 9.8.1, 10.1–10.8, and Appendix B: registers, flags, control flow,
  stack access order, memory addressing/modification, shifts, reset, and encodings.
  Its startup discussion is supplemented by the transistor-level analysis below.
- [Michael Steil's Visual6502 analysis of BRK/IRQ/NMI/RESET][2]: reset vector
  order, discarded stack reads, and the three stack-pointer decrements.
- [SingleStepTests 6502 ASL zero-page cases][3]: independently generated state
  and bus expectations used to cross-check the intermediate write.
- SingleStepTests [PHP][4], [PLP][5], and [indirect JMP][6] cases: stacked status
  bits, page wrapping, and state/access expectations.
- [Arithmetic example](examples/arithmetic.md#references): instruction
  semantics and encodings.

Explicit initialization, unsupported-opcode reporting, record shapes, and
omitted bus accesses are deliberate choices for this model.

[1]: https://syncopate.us/books/Synertek6502ProgrammingManual.html
[2]: https://www.pagetable.com/?p=410

[3]: https://github.com/SingleStepTests/65x02/blob/main/6502/v1/06.json
[4]: https://github.com/SingleStepTests/65x02/blob/main/6502/v1/08.json
[5]: https://github.com/SingleStepTests/65x02/blob/main/6502/v1/28.json
[6]: https://github.com/SingleStepTests/65x02/blob/main/6502/v1/6c.json

[7]: https://github.com/Klaus2m5/6502_65C02_functional_tests/blob/master/6502_decimal_test.a65
[8]: https://github.com/SingleStepTests/65x02/tree/main/6502/v1
