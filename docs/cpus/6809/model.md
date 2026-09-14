# Motorola 6809 model

This document defines the model's state, execution records, and reset contract.
Current instruction support is tracked in [6809 implementation coverage](../coverage.md#6809).
The [examples](../../README.md#cpu-examples) specify concrete programs,
instruction behavior, and expected execution.

[Implementation](../../../src/components/cpus/6809.ts) ·
[CPU tests](../../../tests/components/cpus/6809.test.ts) ·
[Public type checks](../../../tests/types/6809.ts)

## Model boundary

`Cpu6809` models the original Motorola MC6809 instruction set, also used by
the MC6809E, connected to flat
[64 KiB RAM](../../machines/definitions.md#ram-and-cpu-ownership). Clock and
pin differences between those parts are outside this instruction-level model.
This is not an HD6309 model or a complete Color Computer.

One `step()` attempts one instruction. The caller owns any completion address
and execution budget; the CPU has no example-specific halt latch. Interrupt
inputs, timing, dummy bus accesses, devices, and browser controls are deferred.

## State and initialization

`Cpu6809State` contains `a`, `b`, `dp`, `x`, `y`, `s`, `u`, `pc`, and
`flags`. `Cpu6809Flags` contains eight booleans: `e`, `f`, `h`, `i`, `n`,
`z`, `v`, and `c`, corresponding to the condition-code register's bit order.

`new Cpu6809(ram, initialState: Omit<Cpu6809Snapshot, "d">)` requires exactly
64 KiB of RAM. A, B, and DP must be integers in `00`–`FF`; X, Y, S, U, and PC
must be integers in `0000`–`FFFF`. Invalid numeric values or RAM sizes throw
`RangeError`; non-boolean flags throw `TypeError`. The constructor copies only
declared stored fields, including inherited getters and non-enumerable fields,
once before validation. It retains neither the caller's state object nor its
nested flags object. Construction performs no reset, vector read, or
instruction fetch.

Initial registers and flags are explicit caller choices, not power-on or reset
defaults. Flags are supplied state, not inferred from the initial A value.
Values exposed in records are numbers; hexadecimal formatting belongs to
presentation. PC and operand fetches wrap to 16 bits, while RAM validates host
addresses and values instead of wrapping them.

F and I are stored interrupt-mask bits; E is a stored stacking indicator.
S is the hardware stack pointer used by calls and interrupts; U is a separate
programmer-controlled stack pointer. See the [register descriptions][model].
The [stack example](examples/stack.md#instruction-behavior) defines packing
and unpacking CC for stack transfers; CC is not separately stored public state.
Interrupt handling remains deferred.

## Register views

Motorola's [programming model][model] describes A and B as the two halves of D,
with A providing the high byte. Store A and B only. Each snapshot includes
a plain numeric `d` computed as `(a << 8) | b`, without retaining a third
mutable register or a getter linked to live CPU state:

```ts
export type Cpu6809Snapshot = Readonly<Omit<Cpu6809State, "flags">> & {
  readonly flags: Readonly<Cpu6809Flags>;
  readonly d: number;
};
```

D is not a separate initialization input. Passing an existing snapshot is
structurally permitted; its `d` is ignored and recomputed from the copied A
and B. Extra properties, including a supplied `d` getter, must not be read.
There is no public setter for D in this subset. Future instructions that write
D must update A and B.

## Snapshots and ownership

`snapshot()` returns a detached `Cpu6809Snapshot` without accessing RAM.
Before/after snapshots, instruction bytes, and access entries are recursively
readonly to TypeScript and independent of later CPU or RAM changes. JavaScript
edits to returned objects cannot affect live state or other records. No runtime
freezing is required. D is consistent with A/B when a snapshot is produced;
bypassing readonly checks does not make the returned copy a live register view.

Snapshots copy CPU state, not RAM.

## Step records

`Cpu6809MemoryAccess` has readonly `kind: "read" | "write"`, `address: number`,
and `value: number`. `Cpu6809Instruction` has readonly `address: number` and
`bytes: readonly number[]`. The step record is:

```ts
export type Cpu6809StepRecord = {
  readonly instruction: Cpu6809Instruction;
  readonly before: Cpu6809Snapshot;
  readonly after: Cpu6809Snapshot;
  readonly accesses: readonly Cpu6809MemoryAccess[];
} & (
  | { readonly outcome: "executed" }
  | { readonly outcome: "unsupported"; readonly reason: "opcode" }
);
```

Every attempt returns a non-null instruction. Executed records have no
`reason`; the CPU has no `halted` or `complete` outcome. It retains no record
history. Instruction bytes come from actual opcode and operand fetches; data
reads and writes appear only in `accesses`. Do not reread RAM to construct a
record.

These accesses describe the instruction-level model, not every electrical bus
operation or idle cycle. Records have no cycle-count or elapsed-time field.

## Accumulator operations and short branches

A/B loads, stores, AND, OR, EOR, BIT, and TST replace N/Z and clear V,
preserving E/F/H/I/C. BIT tests the AND result without writing the accumulator;
TST changes only flags. Snapshots always derive D from the resulting A:B.

ADD and ADC replace H/N/Z/V/C; only ADC includes incoming C. SUB, SBC, and CMP
replace N/Z/V/C, with C indicating a borrow; only SBC subtracts incoming C.
CMP leaves the accumulator unchanged. Arithmetic is binary, wraps to eight
bits, and uses signed overflow for V. Decimal adjustment is a separate,
unimplemented instruction.

Immediate operands are fetched from the instruction stream. Direct addresses
combine the current DP with a fetched byte; extended addresses fetch high then
low and bypass DP. Loads and binary operations perform one data read; stores
perform one write without reading the destination. Operand bytes are captured
before data accesses, including when code and data overlap. Indexed addressing
remains unsupported.

Unary NEG, COM, LSR, ROR, ASR, ASL/LSL, ROL, DEC, INC, TST, and CLR operate on
A, B, direct memory, or extended memory:

- NEG replaces N/Z/V/C, setting V only for `80` and C for any nonzero input.
  COM replaces N/Z, clears V, and sets C.
- LSR/ROR/ASR replace N/Z/C and **preserve V**. ROR shifts incoming C into bit 7;
  ASR retains the sign. C receives the original bit 0.
- ASL/LSL and ROL replace N/Z/V/C. ROL shifts incoming C into bit 0;
  C receives the original bit 7 and V is the original bit 6 XOR bit 7.
- INC/DEC replace N/Z/V and preserve C; V is set only when incrementing `7F`
  or decrementing `80`.
- CLR sets N=0, Z=1, V=0, C=0. **Memory CLR reads the byte before writing zero**,
  as specified in [Motorola's CLR entry][instructions]. Other memory transforms
  likewise read once then write once, even if the value is unchanged. TST only
  reads. These are data accesses, not an attempt to reproduce dummy bus cycles.

All these unary operations preserve E/F/I. The model preserves H except for
ADD/ADC: Motorola marks H undefined for SUB/SBC/CMP, NEG, ASL, and ASR;
preservation for those instructions is a deterministic model policy.

The short branches `20`–`2F` comprise BRA, BRN, and fourteen conditional forms.
Every form fetches an eight-bit displacement. Taken branches add its signed
value to PC after both bytes, wrapping to sixteen bits; untaken branches
continue at that following address. All preserve flags and registers other
than PC. BCC/BHS and BCS/BLO are aliases of the same encodings. The signed
conditions combine N/V, and sometimes Z, as specified in the
[branch entries][instructions].

In this model, inherent accumulator operations read only their opcode;
immediate byte operations and short branches read the opcode followed by the operand.
There are no target reads or dummy accesses, even for a taken branch or page
crossing. BRN consumes its operand and advances PC by two. Branches inspect
current flags, including after a stack pull replaces CC; the next step fetches
current RAM at the resulting PC. The [counted-loop example](examples/counted-loop.md)
combines B as a counter with A as a running sum and specifies the full trace.

## Jumps and subroutines

LBRA and LBSR fetch a signed 16-bit displacement, high byte first; BSR uses a
signed byte. Each displacement is relative to PC after the complete operand,
with 16-bit wrapping. Direct JMP/JSR use DP:offset and extended JMP/JSR fetch a
high/low target address. None reads or prefetches the target instruction.

BSR, LBSR, and JSR push that following PC on **S**, low byte first, decrementing
S before each write. RTS reads the high byte at S, increments S, reads the low
byte, increments again, and uses the word directly as PC. U is preserved.
All instruction bytes are fetched before call-stack writes, even if S overlaps
the opcode or operand. Each pointer update wraps across the full 16-bit address
space. These word transfers share the PSH/PUL byte-order rules.

Calls, returns, jumps, and NOP preserve all flags. The
[word-addition example](examples/word-addition.md) relies on a nested BSR
preserving carry between ADDB and ADCA, with both returns restoring S.

## Unsupported instructions and prefixes

For an unsupported first byte, record one opcode read and unchanged state and
RAM. A repeated attempt repeats the same read and leaves PC in place. The
[coverage tracker](../coverage.md#6809) lists the current supported forms.

**Prefix policy:** `10` and `11` select additional opcode pages in the
[hardware opcode map][opcodes]. This subset stops after reading the prefix
byte itself: bytes `[10]` or `[11]`, one read, reason `opcode`, unchanged PC.
It does not fetch the next byte or dispatch it as a base-page instruction.
These records are partial attempts, not decoded full prefixed instructions.
Supporting either page will require a separate change to this boundary.

The caller must stop on unsupported results and use a bounded instruction
budget when running programs.

## CPU reset

`reset()` returns a separate `Cpu6809ResetRecord` with readonly `before`,
`after`, and `accesses` using the same snapshot/access types and detached
ownership as step records. It has no instruction, outcome, or reason fields.

The model's reset operation:

1. Reads `FFFE`, then `FFFF`, combining high and low bytes into the new PC.
2. Sets DP to `00` and F/I to true.
3. Preserves A, B, X, Y, S, U, E, H, N, Z, V, C, and all RAM. D consequently
   remains unchanged. Neither stack pointer is initialized or decremented.

The vector, DP, and mask effects follow Motorola's
[RESTART entry][instructions]. Its `X1X1XXXX` CC notation does not specify
fixed values for the other bits. Preserving those bits and other supplied
register values is this model's deterministic reset policy, not a claim about
their power-on values. Reset and creating a fresh lesson are separate actions.

Only the two vector reads are performed and recorded, with no dummy cycles,
stack accesses, or opcode prefetch. Always use the current vector. Hardware
also inhibits NMI recognition after reset until S is loaded; that latch and its
arming rules are deferred together with interrupt handling, as described in
Motorola's [NMI discussion][model]. No NMI behavior is claimed by this subset.

Repeated resets have the same state effects; editing the vector changes the
destination. Restarting an example instead creates fresh CPU and RAM
components from its complete definition, without an additional reset. It
restores all initial values and memory, including the reset vector. See the
[machine definition guide](../../machines/definitions.md).

## Contract checks

The CPU and public type tests check every constructor field and RAM size,
copying declared fields only, and no construction accesses. Extra metadata
and D getters must not be evaluated. D is checked as A:B in fresh snapshots
and both sides of records, using nonzero A/B and boundary values. Old snapshots
remain fixed after either accumulator changes; caller edits cannot change the CPU or another
snapshot.

All supported unary forms and stores, plus immediate LDB, are checked across every
byte and all 256 CC values, including overflow, wrapping, preserved unrelated
state, derived D, and exact accesses. Branches are checked against independent
truth tables for every CC value and across all displacements, both paths,
page/address-space crossings, and instruction-byte overlap. Further checks
cover current operands, signed overflow after DECB, and flags replaced by PULS.

ADD/ADC/SUB/SBC/CMP are checked for every byte pair and incoming carry on both
accumulators against signed and unsigned range calculations. Literal operand
forms check all CC values, real accesses, preserved state, and wrapping.
Call/return and jump checks cover both byte orders, S and PC wrapping, fetched
operand overlap, all CC values, and snapshot resumption inside nested calls.

Unsupported first bytes are checked on repeated attempts, particularly
`10`/`11` followed by an otherwise supported byte, including a prefix at
`FFFF`. Reset checks cover ordered vector reads and DP/F/I changes across
mixed flags and nonzero registers, preservation of all other state and RAM,
repeated reset, changed vectors, and resumed execution at `0000`, `3456`,
and `FFFF`.

Records remain independent across execution, reset, restart, host RAM edits,
and caller edits. Public types enforce readonly fields and outcome/reason
relationships, including the distinction between reset and step records.

## Implementation notes

Private operation helpers compose with recorded operand/address access through
the opcode table, keeping byte order and flag behavior explicit. The short
branches use the shared [opcode definition experiment](../opcode-definitions.md)
to bind encoded conditions and polarity; their execution stays CPU-specific.
[Focused examples](../scope.md) inform further interfaces; the
[CoCo reference notes](reference-notes.md) record evidence from the earlier
implementation and ideas to revisit.

## References

- [Motorola MC6809–MC6809E programming manual, sections 1–3][model]: register
  relationships, reset, NMI arming, and vector byte order.
- [Motorola instruction details, Appendix A][instructions]: accumulator operations,
  branch conditions, RESTART, and calls.
- [Appendix F opcode map][opcodes]: prefixes and opcode pages.

These links are HTML transcriptions of the manufacturer manual. Explicit
initialization, preservation of unspecified state on reset, prefix rejection,
record ownership, and omitted accesses are deliberate model choices.

[model]: https://www.maddes.net/m6809pm/sections.htm
[instructions]: https://www.maddes.net/m6809pm/appendix_a.htm
[opcodes]: https://www.maddes.net/m6809pm/appendix_f.htm
