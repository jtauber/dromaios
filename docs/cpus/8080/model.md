# Intel 8080 model

This document defines the model's state, execution records, and reset contract.
Current instruction support is tracked in [8080 implementation coverage](../coverage.md#8080).
The [examples](../../README.md#cpu-examples) specify concrete programs,
instruction behavior, and expected execution.

[Implementation](../../../src/components/cpus/8080.ts) ·
[CPU tests](../../../tests/components/cpus/8080.test.ts) ·
[Public type checks](../../../tests/types/8080.ts)

## Model boundary

`Cpu8080` models an Intel 8080 connected to flat
[64 KiB RAM](../../machines/definitions.md#ram-and-cpu-ownership).
One call to `step()` executes at most one instruction. Execution and access
records are instruction-level; timing, electrical bus activity, interrupts,
devices, and browser controls are outside this model.

The interrupt-enable latch is stored state. There are no interrupt inputs or
instructions that enable interrupts in the current implementation. Initial
registers, flags, and control latches are supplied explicitly by the caller;
example values are not claims about hardware power-on state.

## State and initialization

The TypeScript state fields are `a`, `b`, `c`, `d`, `e`, `h`, `l`, `pc`, `sp`,
`flags`, `interruptEnabled`, and `halted`. `Cpu8080Flags` contains `s`, `z`,
`ac`, `p`, and `cy`. Flags are stored state; initializing A to zero does not
itself set Z or P.

The constructor is
`new Cpu8080(ram, initialState: Omit<Cpu8080Snapshot, "bc" | "de" | "hl">)`.
It requires exactly 64 KiB of RAM and copies only declared stored fields into
new plain objects before validation. Declared fields may be supplied through
getters, including inherited and non-enumerable fields; each is read once.
Extra properties are ignored. The CPU retains neither the caller's state
object nor its nested flags object. Construction performs no reset or RAM access.

A, B, C, D, E, H, and L must be integers in `00`–`FF`; PC and SP must be
integers in `0000`–`FFFF`. Invalid numeric values or RAM size throw `RangeError`.
Flags and control latches must be booleans, otherwise construction throws
`TypeError`.

Values exposed in records are numbers. Hexadecimal formatting belongs to
presentation. CPU arithmetic and PC advancement wrap to their hardware widths;
RAM's host API rejects invalid addresses and values instead of wrapping them.

## Register views

The CPU stores B, C, D, E, H, and L as individual bytes. Its snapshots also
contain these derived numeric views:

| Snapshot field | High byte | Low byte |
| --- | --- | --- |
| `bc` | B | C |
| `de` | D | E |
| `hl` | H | L |

For example, H = `12` and L = `FF` give HL = `12FF`. SP is a separately
stored 16-bit register. Intel assembly names the pairs `B`, `D`, and `H`;
the snapshot names `bc`, `de`, and `hl` show both component registers.

`Cpu8080State` describes stored state. Construction accepts those
fields without requiring pair values. `Cpu8080Snapshot` adds readonly `bc`,
`de`, and `hl`, including in step and reset records. Pair values supplied by
a JavaScript caller or an existing snapshot are ignored when constructing a
CPU; only the stored bytes are copied and validated. Extra pair getters are
never evaluated.

Each snapshot owns plain numeric values, as with the [6809's D view](../6809/model.md#register-views).
Later execution leaves those values unchanged. Deliberately bypassing
TypeScript readonly checks to edit snapshot bytes does not recalculate that
snapshot's pair fields or affect the CPU. Inspection performs no RAM accesses.

## Snapshots and ownership

`snapshot()` returns an independent `Cpu8080Snapshot` without accessing RAM.
The CPU retains no execution history.

The CPU snapshots do not copy RAM. Each record owns detached snapshots, byte
arrays, and access entries, independent of live state and other records. Later
execution or restart cannot change an earlier record, and modifying a returned
record cannot mutate the CPU or RAM.
Inspecting state outside execution must not add accesses to a step record.

Public snapshots and records are readonly in TypeScript, including nested
flags, instruction bytes, access arrays, and their entries. `Cpu8080State`
remains the mutable state shape for initialization and the CPU's internal
storage; `Cpu8080Snapshot` is its readonly public view with derived pair fields.
Readonly is a compiler check, not runtime freezing. Copies still provide
isolation if JavaScript code or a deliberate type-check bypass edits a returned
value.

## Step records

`step()` updates the model and returns one record with the following fields.
These types are specific to the 8080; shared CPU interfaces remain provisional.

| Field | Meaning |
| --- | --- |
| `instruction` | Object with `address` and `bytes`, or null if already halted |
| `before` | Complete CPU snapshot, including derived BC, DE, and HL |
| `after` | Snapshot of the same state after this call |
| `accesses` | Ordered list of `{ kind, address, value }` entries; kind is `read` or `write` |
| `outcome` | `executed`, `halted`, or `unsupported` |
| `reason` | `opcode` for unsupported records; absent for other outcomes |

Instruction bytes and read values come from the actual reads made during the
step. A write entry contains the value written. Capturing a record must not
perform extra memory reads; in particular, it does not read the old value of a
write destination just to report it. Both opcode and operand reads are included.
Only those fetches supply instruction bytes; data reads and writes appear in
`accesses` without being added to the instruction.

`Cpu8080StepRecord` is a discriminated union on `outcome`. Executed and
unsupported records always contain an instruction. Halted records permit
null for an already halted CPU, or an instruction when executing `HLT`.
Each call to `step()` returns a complete record.

These entries describe the accesses required by this instruction-level model.
They do not claim to reproduce every electrical bus operation or idle cycle.
Records have no cycle-count or elapsed-time field.

### Control-flow accesses

Jumps and calls with immediate targets fetch both address bytes, low then high,
even when a condition is false. Untaken forms advance PC past those operands
without touching the stack. PCHL fetches only its opcode and uses current HL.

Taken CALL fetches its complete instruction before writing the return address,
so overlapping stack writes cannot alter the fetched target. The return address
is PC after the operands. A program-memory RST instead saves PC after its
single opcode. Both push high then low, decrementing SP before each write.
Taken returns read low then high, incrementing SP after each read; untaken
returns fetch only their opcode. PC and stack operations wrap at 16 bits.

No transfer reads the destination instruction in the same step. Branches,
calls, RST, and returns report `executed`; transferring to a completion address
or HLT opcode does not itself halt the CPU. Their only state changes are PC
and, for taken calls, RST, and taken returns, SP. RST from program memory preserves
interrupt enable and does not implement external interrupt delivery.
The [control-flow example](examples/control-flow.md) specifies a loop with calls
and independently checked records.

## Halt and unsupported opcodes

Calling `step()` when already halted returns `outcome: halted`,
`instruction: null`, equal before/after snapshots, and an empty access list.
It performs no fetch and does not advance PC.

Interrupt inputs are outside this model. Setting the initial interrupt-enable
latch to true does not itself resume a halted CPU; `reset()` clears the halted
state, and restarting the lesson creates a fresh CPU.

For any opcode outside the [coverage inventory](../coverage.md#8080), return
`outcome: unsupported` with `reason: opcode`.
The instruction field contains the attempted address and the single opcode byte;
the access list contains just that opcode read. PC and all other CPU state,
and all RAM, remain unchanged. No operands are fetched and no instruction is
silently skipped. A caller running repeatedly must stop on this outcome.

Repeating an unsupported attempt repeats the same opcode read and result.
It reports an implementation limitation, not a hardware fault or a latched
CPU halt.

Invalid calls to the host RAM API are programming errors and are separate
from the guest's `unsupported` outcome.

## CPU reset

CPU reset affects the CPU's modeled reset state: PC becomes `0000`, interrupt
enable becomes false, and halted becomes false. It preserves A, B, C, D, E,
H, L, SP, and the arithmetic flags. It does not read, clear, or reload RAM.
This follows the 8080 reset distinction in the [Intel hardware reference][reset].

`reset()` returns a `Cpu8080ResetRecord` with detached `before` and `after`
snapshots and an empty `accesses` list. It has the same readonly and ownership
guarantees as step records, but no `instruction`, `outcome`, or `reason`.
Repeated resets leave the reset state unchanged and return fresh records.

Restarting an example creates fresh CPU and RAM components from its complete
definition. It restores the example's initial state and memory image, while
previous components and records remain available to their caller. This setup
operation is described in the [machine definition guide](../../machines/definitions.md).

## Contract checks

The CPU and public type tests check constructor validation, copying declared
fields only, ignored pair getters, independent snapshots and records, and
readonly public views. Pair values are checked for byte order and unsigned
range, including construction from an existing snapshot and caller edits.

Unsupported opcodes preserve CPU state and RAM and record only the opcode
read. Already halted steps do not access RAM. Reset preserves data registers,
SP, flags, and RAM, returns fresh records, and allows execution to resume at
`0000`. Example tests check reset and restart against each program's final state.

## References

- [Intel Intellec 8/MOD 80 Reference Manual, February 1975][reset]: 8080
  functional pin definitions, especially RESET and INTE.
- [Register-pair example](examples/register-pairs.md#instruction-behavior): Intel's
  register-pair instruction descriptions.
- [Arithmetic example](examples/arithmetic.md#references): instruction
  encodings, arithmetic flags, and HLT semantics.

Record ownership, unsupported-opcode reporting, and explicit initialization
are choices for this model.

[reset]: https://bitsavers.org/components/intel/MCS80/Intellec_8_Mod_80/Intel_Intellec_8_Mod_80_Reference_Manual_Feb75.pdf
