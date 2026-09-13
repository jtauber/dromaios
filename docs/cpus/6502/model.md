# NMOS MOS 6502 model

This document defines the model's state, execution records, and reset contract.
Current instruction support is tracked in [6502 implementation coverage](../coverage.md#6502).
The [examples](../../README.md#cpu-examples) specify concrete programs,
instruction behavior, and expected execution.

[Implementation](../../../src/components/cpus/6502.ts) ·
[CPU tests](../../../tests/components/cpus/6502.test.ts) ·
[Public type checks](../../../tests/types/6502.ts)

## Model boundary

`Cpu6502` models the original NMOS MOS 6502, connected to flat
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
interrupt-enable latch. This subset exposes the six flags it models;
packed status bytes and their B/unused-bit conventions
will be specified with status stack and interrupt instructions.

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
| `reason` | Present only with `unsupported`: `opcode` or `decimal-mode` |

The outcome/reason relationship is a discriminated union. All public record
fields, nested snapshots, byte arrays, and access entries are readonly. There
is no `halted` or `complete` CPU outcome in this subset, and no null instruction.

Instruction bytes come from the actual opcode and operand reads. Data reads
and writes appear only in `accesses`. Record the actual accesses during execution,
without rereading an instruction or the old contents of a write destination.
These records omit dummy bus accesses and carry no cycle-count claim.

## Unsupported instructions and modes

Opcodes outside the [coverage inventory](../coverage.md#6502) return
`unsupported` with reason `opcode`, read only the opcode, and leave CPU state
and RAM unchanged. Repeating the call repeats that read; it does not advance
past the limitation. The caller must stop on unsupported results and use a
bounded instruction budget when running programs.

**Decimal arithmetic is deferred, and must never silently use binary ADC.**
The constructor accepts either D value. If opcode `69` is encountered with D
true, `step()` returns `unsupported` with reason `decimal-mode`: one opcode
read, no operand read, and unchanged CPU state and RAM. Check this limitation
before advancing PC or reading the operand. This restriction does not block other supported
instructions. It is an implementation limitation, not an illegal hardware
operation.

Reset preserves D, so resetting a D = true CPU does not remove this limitation.
Supporting NMOS decimal ADC, including its flag behavior, will require a
separate reviewed change.

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

Unsupported opcodes and decimal ADC are checked on repeated attempts, with no
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

- [Synertek/MOS MCS6500 Programming Manual][1], sections 2.1–2.2 and 3:
  registers, flags, and reset. Its startup discussion is supplemented by the
  transistor-level analysis below.
- [Michael Steil's Visual6502 analysis of BRK/IRQ/NMI/RESET][2]: reset vector
  order, discarded stack reads, and the three stack-pointer decrements.
- [Arithmetic example](examples/arithmetic.md#references): instruction
  semantics and encodings.

Explicit initialization, unsupported-mode reporting, record shapes, and
omitted bus accesses are deliberate choices for this model.

[1]: https://syncopate.us/books/Synertek6502ProgrammingManual.html
[2]: https://www.pagetable.com/?p=410
