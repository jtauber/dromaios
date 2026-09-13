# Z80 model contract

The Z80 model implements an instruction-level subset against flat 64 KiB
RAM. It adds a related processor to the initial three-architecture comparison,
with its own state and flags. The existing RAM setup and CPU runner work with
this model without adapters.

[Implementation](../../../src/components/cpus/z80.ts) ·
[CPU tests](../../../tests/components/cpus/z80.test.ts) ·
[Public type checks](../../../tests/types/z80.ts) ·
[Coverage](../coverage.md#z80) ·
[Arithmetic example](examples/arithmetic.md) ·
[Counted-loop example](examples/counted-loop.md)

Expected hardware behavior comes from the
[Zilog Z80 CPU User Manual, UM008011-0816](https://www.zilog.com/docs/z80/um0080.pdf):
the register description, CPU control and interrupt sections, and the individual
instruction descriptions. Undocumented behavior and variant-specific details
are outside the current model.

## Stored state and register views

`CpuZ80State` requires every stored field. TypeScript uses lowercase register
and flag names. The [machine language](../../machines/language.md) convention
uses uppercase register and flag names, with `PV` for the manual's P/V flag.

| State | Fields | Meaning |
| --- | --- | --- |
| Main register bank | A, B, C, D, E, H, L | Seven byte registers |
| Main flags | S, Z, H, PV, N, C | Sign, zero, half carry, parity/overflow, add/subtract, carry |
| Alternate bank | `alternate` with the same registers and flags | A′ through L′ and alternate flags, independent of the main bank |
| Word registers | IX, IY, PC, SP | Index registers, program counter, stack pointer |
| Special byte registers | I, R | Interrupt vector register and memory refresh register |
| Interrupt state | `iff1`, `iff2`, IM | Two Boolean interrupt-enable latches and mode 0, 1, or 2 |
| Halt state | `halted` | Whether instruction execution has halted |

Flags are Boolean fields in both banks. Only the six documented flag bits are
represented; undocumented F bits 3 and 5 are omitted. There is consequently no
raw F or AF field or view yet. The main and alternate H register and H flag
remain separate fields in their respective register and flag objects.

Snapshots derive readonly BC, DE, and HL views in each bank from its stored
bytes, high byte first. These pair views are not separate state and cannot be
initialized independently. No implemented instruction exchanges the banks or
uses the index registers, interrupt vector, or stack pointer yet; they can be
initialized and inspected and are preserved by this instruction subset.

## Construction and inspection

`new CpuZ80(ram, initialState)` requires exactly 64 KiB RAM and explicit state.
It copies declared fields from both banks and both flag objects, then validates
byte and word ranges, Boolean flags and latches, and integer IM in 0–2. Invalid
numeric fields throw `RangeError`; invalid Boolean fields throw `TypeError`.
Construction performs no reset, execution, or RAM accesses.

Each declared input property is read once; copying does not depend on property
enumerability. Extra metadata and derived views are ignored, so a snapshot can
also be used as initialization data. Caller objects, including initially shared
bank or flag objects, do not remain connected to internal state.

`snapshot()` returns detached main and alternate banks, flags, register views,
and control state without accessing RAM. Public types are recursively readonly.
Objects are ordinary JavaScript values, not frozen objects: even if a caller
bypasses readonly typing and edits one, it cannot alter CPU state or another
snapshot. The CPU keeps mutable private state and retains no record history.

## Instruction steps

`step()` attempts at most one instruction and returns `CpuZ80StepRecord`:

- `before` and `after`: independent complete snapshots.
- `instruction`: its starting address and the bytes actually fetched, in order;
  `null` only when already halted on entry.
- `accesses`: ordered byte reads and writes, each with `kind`, `address`, and
  the value read or written.
- `outcome`: `executed`, `halted`, or `unsupported`. Only `unsupported` carries
  `reason: "opcode"`.

Supported instructions advance PC while fetching bytes, wrapping at 16 bits.
The absolute store fetches its low address byte before its high address byte.
Stores record the write even when the value is unchanged, and never read the
destination to reconstruct an old value. Captured instruction bytes survive
stores that overwrite code. Subsequent steps fetch current RAM.

Each supported instruction increments the low seven bits of R once for its
opcode fetch, preserving bit 7. Operand reads and data accesses do not increment
R. For example, `7F` becomes `00`, and `FF` becomes `80`. This covers the current
unprefixed subset; future prefix support must account for its opcode fetches.

An unsupported opcode is read and recorded, but PC, R, all other CPU state,
and RAM remain unchanged. This atomic rejection is a model policy, including
the choice to leave R unchanged despite the recorded read. Prefix bytes CB,
DD, ED, and FD are currently rejected after that byte alone; no following byte
is fetched. Repeating an unsupported attempt repeats the same read.

HALT advances PC past its opcode, increments R once, sets `halted`, and reports
`outcome: "halted"` with the HALT instruction. Subsequent halted steps report
`instruction: null`, no accesses, and unchanged state, including R.

Physical HALT continues bus and refresh activity. Those cycles, clock timing,
dummy accesses, and interrupt delivery are outside this instruction-level
model. Neither interrupt-enable latch currently changes how a step executes.
There is no synthetic lesson-completion instruction or state; caller completion
belongs to the [runner](../../runtime/runner.md).

## Register operations and relative jumps

Immediate byte-register loads preserve all modeled flags. INC/DEC wrap at
eight bits and replace S/Z/H/PV/N while preserving C. P/V reports signed
overflow: INC sets it for `7F` → `80`, DEC for `80` → `7F`. H records a carry
from bit 3 for INC or a borrow from bit 4 for DEC. INC clears N; DEC sets it.
Pair views reflect the resulting bytes. The alternate bank remains unchanged.

JR supports an unconditional form and the NZ/Z/NC/C conditions. A taken jump
adds the signed operand byte to PC after both instruction bytes, with 16-bit
wrapping; an untaken jump continues at that following address. JR preserves
all flags. DJNZ first decrements B with eight-bit wrapping, then jumps if B
is nonzero, preserving all flags including Z. B = `00` becomes `FF` and takes
the jump; B = `01` becomes `00` and falls through.
See the [Zilog manual](https://www.zilog.com/docs/z80/um0080.pdf), printed
pages 72, 165–171, and 265–279.

At this model's instruction boundary, INC/DEC read only the opcode. Immediate
loads, JR, and DJNZ read the opcode followed by one operand, including on an
untaken path. No target or dummy reads are performed. R advances once on either
path, following the existing opcode-fetch rule. Subsequent steps fetch current
RAM and inspect current registers and flags. The
[counted-loop example](examples/counted-loop.md) specifies a full trace using
DJNZ, derived BC, refresh-register wrapping, a final store, and HALT.

## CPU reset

`reset()` returns `CpuZ80ResetRecord` with detached `before` and `after`
snapshots and an empty `accesses` array. Reset has no step outcome or instruction.

Reset clears PC, I, and R to zero, clears both interrupt-enable latches, selects
interrupt mode 0, and releases HALT. Both register banks and their flags, IX,
IY, SP, and RAM are preserved. Preserving registers whose values the documented
reset description does not specify is a deterministic model policy, not a
claim about physical power-on values. Repeated reset has the same defined
effects and produces fresh records without memory accesses.

Reset differs from restarting an example: reset preserves RAM and accumulator
data, whereas calling the example factory creates new components with the
original program and explicit initial state.

## Checks and limits

Tests cover all byte pairs for addition against an independent column-addition
and signed-range reference, every incoming flag pattern at selected boundaries,
all immediate-load bytes and flag patterns, exact memory accesses, PC and R
wrapping, overlapping stores, current RAM, and retained records. All unsupported
first bytes are checked, including prefixes. Construction, nested snapshots,
reset, and readonly public types have separate checks.

Register loads and INC/DEC cover every byte and all 64 incoming flag patterns,
including half carry/borrow, signed overflow, flag preservation, pair views,
and unchanged alternate state. JR conditions cover all flag patterns; DJNZ
covers every B value and flag pattern. Every relative displacement is checked
on each available path, including page/address-space crossings and instruction
overlap. All supported opcodes are checked with every R value. Further checks
cover live flags after ADD/INC, current operands, and retained records across
execution, reset, and caller edits.

Paired 8080/Z80 programs check common instruction bytes and data effects while
asserting each CPU's own flags. ADD uses P/V for signed overflow; 8080 ADI uses
P for even parity. The common bytes do not justify sharing their flag logic.
Further decoding or arithmetic helpers can be considered as related instruction
families develop; there is no shared CPU superclass.
