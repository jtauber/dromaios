# Motorola 6809 model

This document defines the model's state, execution records, and reset contract.
Current instruction support is tracked in [6809 implementation coverage](../coverage.md#6809).
The [examples](../../README.md#cpu-examples) specify concrete programs,
instruction behavior, and expected execution.

[Implementation](../../../src/components/cpus/6809.ts) ·
[CPU tests](../../../tests/components/cpus/6809.test.ts) ·
[Public type checks](../../../tests/types/6809.ts)

The [executable chapter](../../../src/components/cpus/specifications/6809.md)
owns the stored-state declaration and D/CC read/write rules, consumed by both
chapter-authored operand families and the remaining TypeScript model. This
document retains the wider API, lifecycle, and hardware contract during migration.

## Model boundary

`Cpu6809` models the original Motorola MC6809 instruction set, also used by
the MC6809E, connected to flat
[64 KiB RAM](../../machines/definitions.md#ram-and-cpu-ownership). Clock and
pin differences between those parts are outside this instruction-level model.
This is not an HD6309 model or a complete Color Computer.

One `step()` attempts one instruction or reports an existing wait without
fetching. The caller owns completion addresses and execution budgets. All 268
documented forms are implemented, including SYNC, CWAI, RTI, and SWI/SWI2/SWI3.
External IRQ/FIRQ/NMI requests are explicit instruction-boundary offers.
Timing, pin sampling, dummy bus accesses, devices, and browser controls remain
outside the model. The 6809 has no separate port-I/O instructions.

## State and initialization

`Cpu6809State` contains `a`, `b`, `dp`, `x`, `y`, `s`, `u`, `pc`, and
`flags`, `waitMode`, and `nmiArmed`. `Cpu6809Flags` contains eight booleans: `e`, `f`, `h`, `i`, `n`,
`z`, `v`, and `c`, corresponding to the condition-code register's bit order.

`new Cpu6809(ram, initialState: Omit<Cpu6809Snapshot, "d">)` requires exactly
64 KiB of RAM. A, B, and DP must be integers in `00`–`FF`; X, Y, S, U, and PC
must be integers in `0000`–`FFFF`. Invalid numeric values or RAM sizes throw
`RangeError`; non-boolean flags or `nmiArmed` throw `TypeError`.
`waitMode` must be exactly `"none"`, `"sync"`, or `"cwai"`; other values throw
`RangeError`. Both control fields are required and copied into snapshots. The constructor copies only
declared stored fields, including inherited getters and non-enumerable fields,
once before validation. It retains neither the caller's state object nor its
nested flags object. Construction performs no reset, vector read, or
instruction fetch.

Initial registers and flags are explicit caller choices, not power-on or reset
defaults. Flags are supplied state, not inferred from the initial A value.
Register values exposed in records are numbers; hexadecimal formatting belongs to
presentation. PC and operand fetches wrap to 16 bits, while RAM validates host
addresses and values instead of wrapping them.

F and I are stored interrupt-mask bits; E is a stored stacking indicator.
S is the hardware stack pointer used by calls and interrupts; U is a separate
programmer-controlled stack pointer. See the [register descriptions][model].
The [stack example](examples/stack.md#instruction-behavior) defines packing
and unpacking CC for stack transfers; CC is not separately stored public state.
NMI arming is separate from S's numeric value; see [NMI arming](#nmi-arming).

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
There is no public setter for D. Word arithmetic, LDD, MUL, and register
transfers update A/B together; STD reads the combined word without storing
another copy.

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
export type Cpu6809StepRecord =
  | InstructionStep<Cpu6809Snapshot>
  | WaitingStep<Cpu6809Snapshot>;
```

The [shared record types](../../../src/components/cpus/execution-records.ts)
provide readonly `before`, `after`, `instruction`, and `accesses` fields.
An executed or unsupported attempt has a non-null instruction; unsupported
records also carry `reason: "opcode"`. Executing SYNC or CWAI returns
`outcome: "waiting"` with its fetched instruction and accesses. Later `step()`
calls while waiting return `waiting`, a null instruction, no accesses, and
unchanged state. Executed and waiting records have no reason.

The CPU has no `halted` or `complete` outcome and retains no record history.
Instruction bytes come from actual opcode and operand fetches; data reads and
writes appear only in `accesses`. Do not reread RAM to construct a record.

These accesses describe the instruction-level model, not every electrical bus
operation or idle cycle. Records have no cycle-count or elapsed-time field.

## Accumulator operations and short branches

A/B loads, stores, AND, OR, EOR, BIT, and TST replace N/Z and clear V,
preserving E/F/H/I/C. BIT tests the AND result without writing the accumulator;
TST changes only flags. Snapshots always derive D from the resulting A:B.

ADD and ADC replace H/N/Z/V/C; only ADC includes incoming C. SUB, SBC, and CMP
replace N/Z/V/C, with C indicating a borrow; only SBC subtracts incoming C.
CMP leaves the accumulator unchanged. Arithmetic is binary, wraps to eight
bits, and uses signed overflow for V. Decimal adjustment is a separate DAA
instruction, described below.

Immediate operands are fetched from the instruction stream. Direct addresses
combine the current DP with a fetched byte; extended addresses fetch high then
low and bypass DP. Loads and binary operations perform one data read; stores
perform one write without reading the destination. Operand bytes are captured
before data accesses, including when code and data overlap. Indexed forms use
the shared address decoder described below.

Unary NEG, COM, LSR, ROR, ASR, ASL/LSL, ROL, DEC, INC, TST, and CLR operate on
A, B, direct, indexed, or extended memory:

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

## Indexed addressing and word transfers

All supported indexed opcodes use one decoder for Motorola's
[Table 2-1][model]. `0 rr nnnnn` adds a signed five-bit offset to the selected
register: `rr=00/01/10/11` selects X/Y/U/S. For `1 rr i mmmm`, `i=1` requests
indirection and `mmmm` selects:

| mmmm | Address calculation | Indirect form |
| --- | --- | --- |
| `0000` / `0001` | Postincrement register by 1 / 2 | Only increment by 2 |
| `0010` / `0011` | Predecrement register by 1 / 2 | Only decrement by 2 |
| `0100` | Register without offset | Yes |
| `0101` / `0110` / `1011` | Signed B / A / D offset | Yes |
| `1000` / `1001` | Signed byte / word instruction operand offset | Yes |
| `1100` / `1101` | Signed byte / word offset from PC after the operand; rr ignored | Yes |
| `1111` | Absolute pointer address fetched from the instruction | Exactly postbyte `9F` |

The remaining combinations are undefined. The decoder accepts 217 postbytes
and rejects 39. Address arithmetic, auto-updates, pointer reads, and word data
wrap across `FFFF` to `0000`. Indirection reads a pointer high byte then low
before any final data access. Pointer and data reads appear only in `accesses`;
postbytes and offset/address extension bytes also appear in `instruction.bytes`.

LDD/LDX/LDY/LDU/LDS and STD/STX/STY/STU/STS transfer words high byte first.
Y/S loads and stores use opcode-page prefix `10`. The second byte
uses the next address in the full 16-bit space, including direct-page transfers
starting at `DP:FF`. Loads/stores set N from bit 15 and Z from the entire word,
clear V, and preserve E/F/H/I/C. Stores do not read the destination first.

Address resolution completes before the operation: `STX ,X++` stores the
updated X at its original address, while `LDX ,X++` replaces the updated X
with the loaded word. Accumulator offsets use A/B/D before a load changes
them. An indirect pointer is fully read before a store can overwrite it.
These rules also apply when operands overlap the instruction stream.

The [indexed-copy example](examples/indexed-copy.md) copies words through a
zero sentinel using X/U postincrement, then saves the final pointers.

## Word arithmetic and comparisons

ADDD and SUBD add/subtract a full word to/from D, ignoring incoming C.
CMPD/CMPX/CMPY/CMPU/CMPS compare the named word without replacing it.
All use immediate, direct, indexed, and extended operands, high byte first.
CMPD/CMPY use page `10`; CMPU/CMPS use page `11`.

These instructions replace N/Z/V/C and preserve E/F/H/I. N uses bit 15,
Z tests the complete result, V reports signed overflow, and C records carry
for addition or borrow for subtraction/comparison. Results wrap to 16 bits.
Unlike the original 6800 CPX, these comparisons include low-byte borrowing
and replace C. Address resolution precedes reading the compared register:
`CMPX ,X++` compares the updated X with the word at its original address.

## Effective addresses and register transfers

LEAX/LEAY/LEAS/LEAU calculate any documented indexed address and copy it to
the named register. Indirect forms read the pointer, but LEA does not read
data at the final address. LEAX/LEAY replace only Z; LEAS/LEAU preserve all
flags. A destination also used as the index receives the final effective
address after auto-update: `LEAX ,X++` consequently leaves X unchanged.
ABX adds unsigned B to X with 16-bit wrapping and preserves all flags.

TFR/EXG use postbyte `ssss dddd`. Word selectors `0`–`5` name D/X/Y/U/S/PC;
byte selectors `8`–`B` name A/B/CC/DP. Only same-width pairs are documented,
including a register paired with itself. Reserved or mixed-width pairs are
rejected before either register changes. TFR copies source to destination;
EXG exchanges their original values. PC means the address after the postbyte,
and writing PC transfers control without a target read. D reads/writes A:B;
CC reads/writes all eight flags. Other registers and flags remain unchanged.

ANDCC/ORCC combine the immediate byte with packed CC and replace all eight
flags. These and TFR/EXG are ordinary status operations even when they change
interrupt-mask bits; the next explicit offer uses their current values. Later
arithmetic reads the replaced flags, while older snapshots remain detached.

## Multiply, sign extension, and decimal adjustment

MUL multiplies unsigned A by unsigned B into D. Only Z and C change: Z tests
the entire product; C copies product bit 7, allowing a subsequent ADCA #0
to round the high byte. C does not indicate multiplication overflow.
SEX extends signed B into D by setting A to `00` or `FF`; it replaces N/Z
and preserves E/F/H/I/V/C, including V as specified in Appendix A.

DAA corrects A after ADDA/ADCA on packed-BCD operands. Each correction is
chosen from the original state: add `06` if the low nibble exceeds nine or
H is set; add `60` if the high nibble exceeds nine, or if it is nine with a
low nibble above nine, or if C is set. A wraps to a byte. N/Z describe that
byte; C retains incoming carry or reports adjustment overflow. E/F/H/I are
preserved. Appendix A leaves V undefined (Appendix D shows zero); this model
clears it. The same correction rules apply deterministically to other A/H/C
combinations, without claiming valid decimal arithmetic for invalid BCD inputs.
The 6800 and 6809 share this adjustment helper and explicit V policy.

The [sum-of-squares example](examples/sum-of-squares.md) combines word
arithmetic, multiplication, register exchange, stack locals, and long branches.

## Jumps and subroutines

LBRA and LBSR fetch a signed 16-bit displacement, high byte first; BSR uses a
signed byte. Each displacement is relative to PC after the complete operand,
with 16-bit wrapping. Page `10` adds LBRN and fourteen long conditional
branches (`10 21`–`10 2F`): they fetch both displacement bytes on every path
and test the same flags as their short equivalents. There is no `10 20`
LBRA alias; LBRA retains base opcode `16`. Direct JMP/JSR use DP:offset and extended JMP/JSR fetch a
high/low target address. Indexed JMP/JSR use the resolved effective address,
including indirection and auto-updates. None reads or prefetches the target
instruction.

BSR, LBSR, and JSR push that following PC on **S**, low byte first, decrementing
S before each write. RTS reads the high byte at S, increments S, reads the low
byte, increments again, and uses the word directly as PC. Calls preserve U
unless their indexed operand explicitly auto-updates it. An S-indexed JSR
resolves its address and updates S before stacking the return PC.
All instruction bytes are fetched before call-stack writes, even if S overlaps
the opcode or operand. Each pointer update wraps across the full 16-bit address
space. These word transfers share the PSH/PUL byte-order rules.

Calls, returns, jumps, and NOP preserve all flags. The
[word-addition example](examples/word-addition.md) relies on a nested BSR
preserving carry between ADDB and ADCA, with both returns restoring S.

## Interrupt entry and return

Each vector contains the destination PC high byte first. Entry performs stack
writes before vector reads, so overlapping stack writes can change the vector.
There is no opcode fetch or prefetch for an external offer.

| Source | Vector | Frame | Masks set after saving CC |
| --- | --- | --- | --- |
| SWI3 (`11 3F`) | `FFF2` | Entire | None |
| SWI2 (`10 3F`) | `FFF4` | Entire | None |
| FIRQ | `FFF6` | Short, except after CWAI | F and I |
| IRQ | `FFF8` | Entire | I |
| SWI (`3F`) | `FFFA` | Entire | F and I |
| NMI | `FFFC` | Entire | F and I |

An entire frame sets E and predecrements S for twelve writes: PC low/high,
U low/high, Y low/high, X low/high, DP, B, A, and CC. A short frame clears E
and writes only PC low/high and CC. The saved CC contains the entry-selected
E and the original F/I masks. Software entries save PC after the opcode
(including its prefix); external entries save the current boundary PC.

RTI (`3B`) pulls CC first. If the restored E is set, it then pulls A, B, DP,
X high/low, Y high/low, U high/low, and PC high/low. Otherwise it pulls only
PC high/low. Each successful byte read increments S with 16-bit wrapping.
RTI neither adds to PC nor changes the restored CC. E describes the saved
frame; interrupt entry/return need not preserve the pre-entry E value.
There is no hidden frame stack: edited or caller-created RAM frames determine
return behavior. Restoring a snapshot requires the corresponding RAM too.

## Waiting and external interrupt delivery

SYNC (`13`) advances PC and sets `waitMode` to `"sync"`, preserving registers
and flags and making no stack accesses. An accepted request stacks its native
frame and enters its vector. A masked IRQ or FIRQ releases SYNC without stack
or vector accesses, leaving PC at the following instruction. An unarmed NMI
is ignored and does not release it.

CWAI (`3C mask`) first ANDs CC with its immediate byte, forces E, saves the
entire frame, then sets `waitMode` to `"cwai"`. Only an accepted request wakes
it. Entry reuses that frame, sets the source's masks, releases the wait, and
reads the vector. This includes FIRQ: E stays set and RTI restores the entire
CWAI frame. Masked IRQ/FIRQ and unarmed NMI leave CWAI waiting.

`interrupt(source: "irq" | "firq" | "nmi")` offers one request at the current
boundary. IRQ checks I, FIRQ checks F, and NMI checks `nmiArmed`. It returns a
`Cpu6809InterruptRecord` with detached `before`/`after` snapshots, a null
`instruction`, ordered `accesses`, `source`, and one of:

- `accepted`, with no reason, after entry;
- `resumed`, with reason `masked`, for IRQ/FIRQ releasing SYNC;
- `ignored`, with reason `masked` for IRQ/FIRQ or `unarmed` for NMI.

Ignored and resumed offers make no memory accesses. Invalid source names throw
`RangeError` without changing state. `step()` does not deliver queued requests:
the caller owns pending signals, NMI edges, and selection among simultaneous
sources (hardware priority is NMI, FIRQ, then IRQ). Unarmed or masked offers
are not retained; the caller must offer a request again when appropriate.
Pin sampling, pulse lengths, recognition delays, and interrupt latching are
outside this API. This is an explicit boundary policy, not cycle-accurate
interrupt recognition. The [runner](../../runtime/runner.md) stops on `waiting`;
a caller may offer an interrupt and run again.

## NMI arming

Reset clears `nmiArmed`, regardless of S. Construction instead uses the explicit
supplied latch, allowing a snapshot of initialized execution to resume.
Instruction effects are checked against Motorola's S-initialization discussion
and [XRoar's MC6809 core][xroar] (version 1.12.1):

- LDS, LEAS, TFR to S, and EXG involving S arm NMI, even when the value is unchanged.
- PULU arms when it successfully restores S; nonempty PSHS/PULS and completed
  RTI also arm NMI.
- Indexed increment/decrement of S arms NMI when that address update occurs.
- Merely reading S, empty stack masks, implicit call/RTS stack updates, and
  interrupt/CWAI stacking do not arm it. Rejected encodings do not arm it.

The latch stays armed until reset. An interrupted load cannot arm before the
value is complete; an indexed S update already performed survives a later
memory failure. An explicit request after the arming instruction can be
accepted; a prior unarmed offer is not automatically redelivered.

## Host failures and reentrancy

RAM errors propagate immediately, without a fabricated record or transaction
rollback. Completed fetches advance PC, completed reads/writes retain their
effects, and S predecrements before each attempted push. A failed pull does
not increment S; a word register changes only after both bytes are read.
Entry selects E before stacking and applies masks/releases a wait only after
its frame is complete. CWAI applies its CC mask before stacking and enters its
wait only after all writes succeed. RTI exposes successfully restored registers
even if a later read fails. Vector PC commits only after both reads; reset
commits all of its state changes at that point.

A shared execution guard rejects nested `step()`, `reset()`, or `interrupt()`
calls during any of those transitions, including calls through RAM callbacks.
`snapshot()` remains available to inspect the current partial state. The guard
is released on success or failure. After a host error the caller must inspect
or restore state before deciding how to continue; repeating the operation is
not an automatic retry of an atomic instruction.

## Unsupported instructions and prefixes

For an unsupported first byte, record one opcode read and unchanged state and
RAM. A repeated attempt repeats the same read and leaves PC in place. The
[coverage tracker](../coverage.md#6809) lists the current supported forms.

For an undefined indexed or transfer/exchange postbyte, record the opcode
(including its prefix, if present) and postbyte reads,
return reason `opcode`, and leave all state (including PC) and RAM unchanged.
Do not fetch offset bytes, read an indirect pointer, update an index register,
or execute the operation. Replacing the postbyte in RAM allows the next attempt
to proceed normally. Rejection is a model boundary, not an emulation of the
hardware's undefined behavior.

**Prefix policy:** `10` and `11` select additional opcode pages in the
[hardware opcode map][opcodes]. A step fetches the prefix and exactly one
following opcode, then any operands of that page's supported instruction.
Unsupported page entries record `[prefix, opcode]`, reason `opcode`, and
unchanged state/RAM, with PC restored to the prefix. They fetch no operands.
Repeated prefixes do not nest or fall back to the base page. Fetching can
wrap at `FFFF`; each attempt consults current RAM and retains no prefix latch.

The caller must stop on unsupported results and use a bounded instruction
budget when running programs.

## CPU reset

`reset()` returns a separate `Cpu6809ResetRecord` with readonly `before`,
`after`, and `accesses` using the same snapshot/access types and detached
ownership as step records. It has no instruction, outcome, or reason fields.

The model's reset operation:

1. Reads `FFFE`, then `FFFF`, combining high and low bytes into the new PC.
2. Sets DP to `00`, F/I to true, `waitMode` to `"none"`, and `nmiArmed` to false.
3. Preserves A, B, X, Y, S, U, E, H, N, Z, V, C, and all RAM. D consequently
   remains unchanged. Neither stack pointer is initialized or decremented.

The vector, DP, and mask effects follow Motorola's
[RESTART entry][instructions]. Its `X1X1XXXX` CC notation does not specify
fixed values for the other bits. Preserving those bits and other supplied
register values is this model's deterministic reset policy, not a claim about
their power-on values. Reset and creating a fresh lesson are separate actions.

Only the two vector reads are performed and recorded, with no dummy cycles,
stack accesses, or opcode prefetch. Always use the current vector. NMI remains
inhibited until one of the [arming instructions](#nmi-arming) initializes it.

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

Indexed checks exhaust the documented postbyte encodings and exercise signed
boundary offsets, all four pointer registers, auto-updates, PC-relative aliases,
and instruction/pointer overlap. Every indexed opcode is checked against every
undefined postbyte, including repeated rejection and resumption. Word transfers
check all forms and CC values, every possible LDD result, word boundary accesses,
and load/store aliasing with updated index registers. Indexed JSR checks S
wrapping and indirect pointer reads before return-address writes.

All three opcode pages are audited against literal independent encoding sets:
221 base forms, 38 page-2 forms, and nine page-3 forms. Undefined entries and
repeated prefixes remain unsupported.
All 56 indexed forms reject all 39 undefined postbytes; valid indexed modes
also test auto-update, indirection, and overlap with code/data.

New word forms check all CC values at word boundaries and every immediate
word against independent signed/unsigned arithmetic. LEA checks all indexed
postbytes, self-updates, and flag preservation. TFR/EXG check all 52 valid
same-width pairs, every CC value, PC/D/CC interactions, and all 204 invalid
postbytes. ANDCC/ORCC check every CC/immediate pair. MUL checks every byte
pair; SEX and DAA check every byte/CC combination, with decimal additions
also checked against base-ten sums. Long branches check every flag pattern,
wrap boundaries, and every word displacement on taken and untaken paths.
The sum-of-squares example checks 48 complete records, a complete memory
image, actual RAM calls, resumption inside a stack frame, and bounded failure.

Unsupported first bytes and prefixed opcodes are checked on repeated
attempts, including a prefix at `FFFF`. Reset checks cover ordered vector reads and DP/F/I changes across
mixed flags and nonzero registers, preservation of all other state and RAM,
repeated reset, changed vectors, and resumed execution at `0000`, `3456`,
and `FFFF`.

Records remain independent across execution, reset, restart, host RAM edits,
and caller edits. Public types enforce readonly fields and outcome/reason
relationships, including the distinction between reset and step records.

Interrupt checks cover all CC values, full/short frames, software prefix wrapping,
vector overlap, all CWAI masks, masked SYNC wakeups, NMI arming, edited RTI
frames, snapshot restoration, every memory failure position, and reentrancy.
A runner program combines both waits, nested IRQ/FIRQ/NMI, and SWI2, comparing
complete traces and RAM after reconstruction.

## Implementation notes

Private operation helpers compose with recorded operand/address access through
the opcode table, keeping byte order and flag behavior explicit. All three
pages share word-operation/addressing builders. Short and long branches use the shared [opcode definition experiment](../opcode-definitions.md)
to bind encoded conditions and polarity; their execution stays CPU-specific.
[Focused examples](../scope.md) inform further interfaces; the
[CoCo reference notes](reference-notes.md) record evidence from the earlier
implementation and ideas to revisit.

## References

- [Motorola MC6809–MC6809E programming manual, sections 1–3][model]: register
  relationships, reset, NMI arming, and vector byte order.
- [Motorola instruction details, Appendix A][instructions]: accumulator operations,
  word arithmetic, addressing, register transfers, decimal adjustment, multiply,
  sign extension, branch conditions, RESTART, and calls.
- [Appendix F opcode map][opcodes]: prefixes and opcode pages.
- [XRoar source release 1.12.1][xroar], `src/mc6809/mc6809.c`: cross-check
  for the instruction-specific NMI arming effects, including stack and indexed
  updates beyond the manual's explicit LDS/TFR/EXG examples.

These links are HTML transcriptions of the manufacturer manual. Explicit
initialization, preservation of unspecified state on reset, prefix rejection,
record ownership, and omitted accesses are deliberate model choices.

[model]: https://www.maddes.net/m6809pm/sections.htm
[instructions]: https://www.maddes.net/m6809pm/appendix_a.htm
[opcodes]: https://www.maddes.net/m6809pm/appendix_f.htm

[xroar]: https://www.6809.org.uk/xroar/dl/xroar-1.12.1.tar.gz
