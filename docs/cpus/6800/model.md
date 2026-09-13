# 6800 model contract

The Motorola 6800 model implements an instruction-level subset with flat
64 KiB RAM. Instruction fetches and PC increments wrap at 16 bits; extended
addresses and the reset vector use the high byte first.

[Implementation](../../../src/components/cpus/6800.ts) ·
[CPU tests](../../../tests/components/cpus/6800.test.ts) ·
[Public type checks](../../../tests/types/6800.ts) ·
[Coverage](../coverage.md#6800) ·
[Arithmetic example](examples/arithmetic.md)

Hardware references are Motorola's
[M6800 Programming Reference Manual, November 1976](https://manualzz.com/doc/1063126/motorola-m6800-microprocessor-programming-reference-manual),
sections 1 and 3.3.1 and Appendix A's ADD, LDA, and STA definitions; and the
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
after each byte with wrap from `FFFF` to `0000`. LDAA and ADDA fetch one
immediate byte. STAA fetches the high and low address bytes, then writes A
without reading the destination. Writes are recorded even when the value is
unchanged. Stores can overwrite instruction or vector bytes; retained records
keep the values fetched at the time, while subsequent operations read current RAM.

Unsupported attempts read only the opcode and leave all CPU state and RAM
unchanged. Repeating the attempt repeats that read. Preserving PC despite a
recorded fetch is an explicit rejection policy of this model.

These records describe instruction-level accesses. Cycle counts, internal
cycles, dummy bus accesses, pin transitions, and electrical behavior are omitted.

## Loads, stores, and addition

LDAA loads its operand into A. STAA stores A without changing it. Both set N
from bit 7 of the value and Z from whether it is zero, clear V, and preserve
H, I, and C.

ADDA adds the immediate byte to A without incoming carry and wraps the result
to a byte. It replaces H/N/Z/V/C: H indicates carry from bit 3, N the result's
sign bit, Z a zero result, V signed overflow, and C carry out of bit 7. I is
preserved. All three instructions leave B, X, and SP unchanged.

## CPU reset

`reset()` reads `FFFE` followed by `FFFF`, loads their high-byte-first address
into PC, and sets I. It performs no instruction fetch or RAM write. A/B/X/SP,
the other five flags, and RAM are preserved. Preserving state for which the
reset specification does not establish values is a deterministic model policy;
it does not claim defined power-on values for those registers.

The `Cpu6800ResetRecord` has detached before/after snapshots and the two vector
reads, without an instruction or step outcome. Every reset rereads the current
vector. A later step executes from the resulting PC.

Reset does not restore an example's original registers or memory image.
Creating a fresh example performs that lesson restart. A caller completion
address belongs to the runner; the CPU itself does not stop at that address.

## Checks and limits

Independent CPU tests cover every addition operand pair, all incoming flags
at arithmetic boundaries, every load/store byte and flag pattern, every store
destination, every PC, and every reset-vector value. Complete records and
observed RAM calls check byte order, wrapping, preserved state, unchanged-value
writes, self-modifying code, unsupported attempts, repeated reset, and detached
snapshots.

The generated example checks both full memory images, explicit state, all
three execution records, bounded running, caller completion, reset, and fresh
restart. Parser, generator, and type checks preserve CPU-specific state and
record contracts.

Other instruction forms, branches, stack operations, interrupt delivery,
interrupt-control instructions, mapped devices, and timing remain deferred.
Only complete implemented forms contribute to the coverage percentage.
