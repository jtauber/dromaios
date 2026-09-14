# 6800 model contract

The Motorola 6800 model implements an instruction-level subset with flat
64 KiB RAM. Instruction fetches and PC increments wrap at 16 bits; extended
addresses and the reset vector use the high byte first.

[Implementation](../../../src/components/cpus/6800.ts) ·
[CPU tests](../../../tests/components/cpus/6800.test.ts) ·
[Public type checks](../../../tests/types/6800.ts) ·
[Coverage](../coverage.md#6800) ·
[Arithmetic example](examples/arithmetic.md) ·
[Counted-loop example](examples/counted-loop.md) ·
[Stack example](examples/stack.md) ·
[Logic example](examples/logic.md)

Hardware references are Motorola's
[M6800 Programming Reference Manual, November 1976](https://manualzz.com/doc/1063126/motorola-m6800-microprocessor-programming-reference-manual),
sections 1, 3.3.1, and 3.4–3.5 and Appendix A's ADD, LDA, STA, TAB, TBA,
INC, DEC, branch, LDS, PSH, PUL, JSR, RTS, AND, BIT, EOR, and ORA definitions; and the
[MC6800 data sheet in M6800 Systems Reference and Data Sheets](https://vtda.org/docs/computing/Motorola/M6800SystemsReferenceDataSheets_May75.pdf),
reset description on pages 13–14 and instruction tables on pages 18–21.
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

TypeScript fields are lowercase; `.machine` definitions conventionally use
uppercase register and flag names. Snapshots expose this same state. H/I/N/Z/V/C
correspond to condition-code bits 5–0. The two fixed upper bits are not mutable
flags, and this slice does not expose a packed condition-code view.
Interrupt and external halt inputs are deferred; there is no halt or wait latch.

## Construction and inspection

`new Cpu6800(ram, initialState)` requires exactly 64 KiB RAM. It copies declared
registers and flags, then validates numeric ranges and Boolean flag values.
Each declared field is read once, including non-enumerable properties; extra
metadata is ignored. Invalid register values or RAM size throw `RangeError`;
non-Boolean flags throw `TypeError`. Construction neither resets the CPU nor
reads or writes RAM. All initial state must be supplied explicitly.

`snapshot()` returns detached registers and flags without RAM accesses. Public
snapshots are recursively readonly in TypeScript; bypassing that typing cannot
change the CPU or another snapshot. A snapshot can initialize a fresh CPU.
The CPU retains no execution history.

## Instruction steps

`step()` attempts one instruction and returns a `Cpu6800StepRecord` containing
independent `before` and `after` snapshots, the instruction's start address and
fetched bytes, ordered `accesses`, and an `outcome`. The outcome is `executed`
or `unsupported`; only the latter carries `reason: "opcode"`.

Supported instructions fetch the opcode and then their operands, advancing PC
after each byte with wrap from `FFFF` to `0000`. LDAA, LDAB, and ADDA fetch one
immediate byte. ANDA/ANDB, BITA/BITB, EORA/EORB, and ORAA/ORAB likewise
fetch one immediate byte and perform no data-memory access.
Transfers and accumulator increments/decrements fetch only
their opcode. Branches always fetch a displacement byte, whether taken or
untaken. LDS and extended JSR fetch a high-byte-first word. Stack pushes,
pulls, and RTS fetch only their opcode; BSR fetches a displacement byte.
Stack data reads appear in `accesses`, but not in the fetched instruction
bytes, and do not advance PC. All instruction bytes are fetched before
stack reads or writes. STAA fetches the high and low address bytes, then writes A
without reading the destination. Writes are recorded even when the value is
unchanged. Stores can overwrite instruction or vector bytes; retained records
keep the values fetched at the time, while subsequent operations read current RAM.

Unsupported attempts read only the opcode and leave all CPU state and RAM
unchanged. Repeating the attempt repeats that read. Preserving PC despite a
recorded fetch is an explicit rejection policy of this model.

These records describe instruction-level accesses. Cycle counts, internal
cycles, dummy bus accesses, pin transitions, and electrical behavior are omitted.

## Loads, stores, and addition

LDAA and LDAB load their immediate operand into A or B respectively. STAA
stores A without changing it. All set N from bit 7 of the value and Z from
whether it is zero, clear V, and preserve H, I, and C.

LDS loads its immediate word into SP. It sets N from bit 15 and Z from whether
the entire word is zero, clears V, and preserves H/I/C. A/B/X are unchanged.

ADDA adds the immediate byte to A without incoming carry and wraps the result
to a byte. It replaces H/N/Z/V/C: H indicates carry from bit 3, N the result's
sign bit, Z a zero result, V signed overflow, and C carry out of bit 7. I is
preserved. Instructions leave the other accumulator, X, and SP unchanged.

## Immediate logic

ANDA/ANDB replace the named accumulator with its bitwise AND with the operand;
ORAA/ORAB use inclusive OR, and EORA/EORB use exclusive OR. BITA/BITB form
the same result as AND for flag updates but leave both accumulators unchanged.
All eight forms set N from bit 7 of the logical result, set Z when that result
is zero, clear V, and preserve H/I/C. The other accumulator, X, and SP are
unchanged. In particular, BIT does not copy N or V from the operand: both N
and Z describe the AND result, and V is always cleared.

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

SP points to the next free stack byte in the full 16-bit address space.
A push writes at SP, then decrements SP; a pull increments SP, then reads
at SP. Both wrap between `0000` and `FFFF`. PSHA/PSHB push the named
accumulator; PULA/PULB pull a byte into it. All four preserve every flag,
including N/Z on pulls, and leave the other accumulator and X unchanged.
Pulls do not clear memory.

BSR and extended JSR push the address immediately after the instruction,
low byte first and then high byte, using two stack bytes. BSR adds its signed
displacement to that return address, with the same 16-bit wrapping as short
branches. Extended JSR takes its target from the high-byte-first address
operand. RTS pulls the high byte and then the low byte and uses that return
address directly. Calls and returns preserve A/B/X and all flags; they do not
prefetch the target instruction. Indexed JSR remains unsupported.

Stack accesses use ordinary current RAM and the current SP. Saved accumulator
values and return addresses share the same stack; there is no hidden call
history, frame type, depth limit, or underflow check. RTS can consume bytes
placed in RAM without a preceding call. Editing stack memory changes what
the next pull or return reads, and stack writes may overwrite code or vectors.

## CPU reset

`reset()` reads `FFFE` followed by `FFFF`, loads their high-byte-first address
into PC, and sets I. It performs no instruction fetch or RAM write. A/B/X/SP,
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
current operands, and resumption after replacing an unsupported addressing form.

The generated arithmetic, counted-loop, stack, and logic examples check full initial/final
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
Parser, generator, and type checks preserve CPU-specific state and record
contracts.

Other instruction forms, jumps, remaining stack operations, interrupt delivery,
interrupt-control instructions, mapped devices, and timing remain deferred.
Only complete implemented forms contribute to the coverage percentage.
