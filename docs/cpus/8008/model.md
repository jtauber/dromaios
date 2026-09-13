# 8008 model contract

The Intel 8008 model implements an instruction-level subset with native 8008
encodings and flat 16 KiB RAM. Its PC is a view of an internal address register;
its memory addresses wrap at 14 bits.

[Implementation](../../../src/components/cpus/8008.ts) ·
[CPU tests](../../../tests/components/cpus/8008.test.ts) ·
[Public type checks](../../../tests/types/8008.ts) ·
[Coverage](../coverage.md#8008) ·
[Arithmetic example](examples/arithmetic.md) ·
[Nested-call example](examples/stack.md)

The hardware reference is Intel's
[8008 User's Manual, April 1972](https://www.bitsavers.org/components/intel/MCS8/Intel_8008_8-Bit_Parallel_Central_Processing_Unit_Rev1_Apr72.pdf)
([searchable copy](https://manuals.plus/m/c23aa03524a8348d87dbe05c0a002b2aef66f39578347a483393e89283fb0f96)).
Relevant sections are *Basic Functional Blocks*, *Basic Instruction Set*,
*Start-Up of the 8008*, and Appendix I's functional definitions.
The [November 1972 revision](https://manualzz.com/doc/10956006/intel-8008--8008-1-microprocessors-users-manual),
Appendix II, also describes PC increments before stack selection changes.
The tutorial's earlier teaching model uses 8080 encodings; this core implements
the hardware encoding described by Intel.

## Stored state and register views

`Cpu8008State` requires all of the following:

| Field | Range | Meaning |
| --- | --- | --- |
| A, B, C, D, E, H, L | `00`–`FF` | Seven byte registers |
| `flags` with S, Z, P, C | Boolean | Sign, zero, even parity, carry |
| `addressStack` | Eight values in `0000`–`3FFF` | Physical address registers, in slot order |
| `stackIndex` | `0`–`7` | Selector identifying the current PC slot |
| `halted` | Boolean | Whether execution is stopped |

TypeScript register and flag fields are lowercase. Machine definitions use
uppercase register and flag names and the descriptive names `addressStack`,
`stackIndex`, and `halted`.

Snapshots derive `pc = addressStack[stackIndex]` and the raw 16-bit `hl` pair.
Neither is separately stored or initialized. H remains an eight-bit register;
a memory access uses only its low six bits together with L. Thus H:L = `E677`
addresses RAM at `2677`, while the snapshot still shows HL = `E677`.

The selected slot holds PC; the other seven can hold return addresses. Calls
and returns change which slot is selected, as described below. There is no RAM
stack pointer, stack-depth counter, interrupt-enable latch, auxiliary carry,
or overflow flag in this state model.

## Construction and inspection

`new Cpu8008(ram, initialState)` requires exactly 16 KiB RAM. It copies declared
fields, flags, and all eight address slots, then validates register and address
ranges, the selector, and Boolean flags and halt state. Numeric violations throw
`RangeError`; malformed address arrays and non-Boolean flags or latches throw
`TypeError`. Sparse address arrays fail numeric validation. Construction does
not reset, execute instructions, or access RAM.

Each declared input field and array slot is read once, including non-enumerable
properties. Derived views and extra metadata are ignored. A snapshot can be
used to initialize a fresh CPU. `snapshot()` returns detached state without
reading RAM, and public snapshot types are recursively readonly. The values
are ordinary JavaScript objects: bypassing readonly typing cannot change the
CPU or another snapshot. The CPU retains no record history.

## Instruction steps

`step()` returns a `Cpu8008StepRecord` containing independent `before` and
`after` snapshots, the instruction address and fetched bytes, ordered byte
`accesses`, and an `outcome` of `executed`, `halted`, or `unsupported`.
Only unsupported records have `reason: "opcode"`. An already halted step has
`instruction: null`, no accesses, and unchanged state.

Supported fetches advance the selected address register, wrapping from `3FFF`
to `0000`. Immediate instructions fetch their operand after the opcode. LMA
fetches its opcode and writes A to RAM at the masked H:L address, without
reading the destination. Writes are recorded even if the value does not change.
Instruction bytes remain intact in records when a store overwrites code;
subsequent instructions read current RAM.

Unsupported attempts read only the opcode and preserve all state and RAM.
Repeating the attempt repeats that one read. Atomic rejection is a model
policy, including leaving PC unchanged despite the recorded fetch.

All three documented HLT encodings (`00`, `01`, `FF`) advance PC once and set
`halted`. Later stopped steps make no accesses. The model does not reproduce
ongoing internal refresh, pin activity, dummy accesses, or cycle timing.

## Loads and addition

LAI, LHI, and LLI load their immediate byte and preserve all flags. LMA also
preserves flags. ADI adds its operand to A without incoming carry, wraps the
result to a byte, and replaces all four flags: S is the result's high bit, Z
indicates zero, P indicates even parity, and C indicates a sum exceeding `FF`.
The other data registers and inactive address slots remain unchanged.

## Jumps, calls, and returns

JMP and CAL fetch a low address byte followed by a high byte. The high byte's
top two bits are ignored for addressing but retained in the instruction record.
All three fetches advance the caller's PC, including wrap at `3FFF`.

- JMP replaces the selected PC with the destination and preserves other slots.
- CAL leaves the address after its three bytes in the caller's slot, selects
  the next slot, and writes the destination there.
- RET advances the outgoing PC by one for its opcode fetch, then selects the
  preceding slot. The outgoing slot retains that advanced address.

Slot numbering is a model convention: CAL increments `stackIndex` modulo eight;
RET decrements it modulo eight. Seven calls can preserve all return addresses.
An eighth nested call overwrites the oldest; extra returns continue around the
same ring without a depth check or fault. No slot is cleared on return.

Each instruction has eight documented encodings: `01 xxx 100` for JMP,
`01 xxx 110` for CAL, and `00 xxx 111` for RET. The `xxx` bits are ignored.
All forms preserve data registers and flags. Their only RAM accesses are the
instruction bytes: there is no RAM stack access or destination prefetch.

## CPU reset

The 8008 has no dedicated reset input. Its documented power-on sequence clears
its internal memories and leaves it stopped; an interrupt starts execution.
`reset()` models the settled clearing-and-stop result at an instruction boundary:
it clears A/B/C/D/E/H/L and all eight address registers, selects slot zero,
and sets `halted = true`. It preserves RAM. Choosing selector zero and preserving
flags, whose values the startup description does not specify, are deterministic
model policies.

The reset record contains independent `before` and `after` snapshots and an
empty access list, with no instruction or step outcome. Repeating reset has
the same effects. No power transition, clock sequence, forced instruction, or
interrupt is simulated. This method is distinct from the 8008 RST instruction.

Since interrupt delivery is deferred, a reset CPU remains stopped. Example
factories explicitly initialize `halted = false`; creating a new example
restarts the lesson with fresh RAM and its original state. Construction never
implies physical power-on behavior.

## Checks and limits

CPU tests check all addition operand pairs against an independent arithmetic
and bit-count reference, every incoming flag pattern at arithmetic boundaries,
all load bytes and flag patterns, all H:L combinations, every PC, and each
address-stack selector. They compare complete records and actual RAM accesses,
including unchanged-value writes, self-modified code, unsupported attempts,
all three HLT encodings, reset, and detached records.

Control-flow checks cover all documented aliases, every encoded destination
including ignored high bits, every selector and flag pattern, wrapped fetches,
eight nested calls, overwritten return addresses, and unbalanced returns.

The generated examples check both factories, whole memory images, complete
traces, bounded running, caller completion, reset, and fresh restart. The
nested-call trace also checks inactive slot contents across returns.
Parser and generator tests cover address lists, ranges, RAM size, diagnostics,
and declaration order. Type checks preserve concrete CPU and runner records.

The remaining instruction set, interrupt delivery, I/O,
mapped devices, and timing remain outside this slice. Coverage counts only
the supported encodings, not the presence of unused stored registers.
