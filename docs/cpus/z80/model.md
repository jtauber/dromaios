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
[Counted-loop example](examples/counted-loop.md) ·
[Transfer example](examples/transfers.md) ·
[Checksum example](examples/checksum.md) ·
[Bit-count and nested-call example](examples/bit-count.md)

Expected hardware behavior comes from the
[Zilog Z80 CPU User Manual, UM008011-0816](https://www.zilog.com/docs/z80/um0080.pdf):
the register description, CPU control and interrupt sections, and the individual
instruction descriptions. Undocumented instructions and F bits 3/5 are outside
the current model. Where the manual leaves a modeled flag unspecified, the
behavior selected below is checked against an independent reference emulator.

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
public raw F or AF field or view. Stack operations pack and unpack the modeled
flags as described below. The main and alternate H register and H flag
remain separate fields in their respective register and flag objects.

Snapshots derive readonly BC, DE, and HL views in each bank from its stored
bytes, high byte first. These pair views are not separate state and cannot be
initialized independently. Immediate pair loads update the stored bytes of BC,
DE, or HL, or replace SP. No implemented instruction exchanges the banks or
uses the index registers or interrupt vector yet; they can be initialized and
inspected and are preserved by this instruction subset. PUSH/POP update SP
and transfer BC, DE, HL, or AF; calls and returns use the same memory stack.

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
Word operands, including immediate pair loads and the absolute store address,
are fetched low byte first.
Stores record the write even when the value is unchanged, and never read the
destination to reconstruct an old value. Captured instruction bytes survive
stores that overwrite code. Subsequent steps fetch current RAM.

Each supported instruction increments the low seven bits of R for each opcode
fetch, preserving bit 7: once for an unprefixed instruction and twice for a CB
instruction. Operand reads and data accesses do not increment R. For example,
unprefixed `7F` becomes `00`, while CB `FF` becomes `81`. PC and R are advanced
only after the complete supported encoding has been identified.

An unsupported opcode is read and recorded, but PC, R, all other CPU state,
and RAM remain unchanged. This atomic rejection is a model policy, including
the choice to leave R unchanged despite the recorded reads. DD, ED, and FD are
rejected after that byte alone. CB fetches a second byte, wrapping at FFFF;
undocumented SLL encodings (`CB 30`–`CB 37`) are rejected with both bytes and
reads retained, without a data access. Repeating an unsupported attempt reads
the encoding again from current RAM and preserves all CPU state and RAM.

HALT advances PC past its opcode, increments R once, sets `halted`, and reports
`outcome: "halted"` with the HALT instruction. Subsequent halted steps report
`instruction: null`, no accesses, and unchanged state, including R.

Physical HALT continues bus and refresh activity. Those cycles, clock timing,
dummy accesses, and interrupt delivery are outside this instruction-level
model. Neither interrupt-enable latch currently changes how a step executes.
There is no synthetic lesson-completion instruction or state; caller completion
belongs to the [runner](../../runtime/runner.md).

## Loads and register operations

Byte loads transfer between main registers, read or write RAM through HL, or
fetch an immediate byte. A data read through HL precedes any destination change,
including loads into H or L. Register self-transfers perform no data accesses.
`LD (HL),n` fetches its immediate before writing, including when HL points at
the opcode or operand. `LD dd,nn` loads BC, DE, HL, or SP, low byte first.
All these loads preserve all modeled flags and the alternate bank.

The `01 ddd sss` load matrix uses B/C/D/E/H/L/(HL)/A in both fields. Its 63
transfers share operand reading and writing; `01 110 110` selects HALT during
table construction and performs no data access through HL. The opcode patterns
keep this exception beside the family definition. See the
[Zilog manual](https://www.zilog.com/docs/z80/um0080.pdf), printed pages
71–74, 79–80, 85, and 99, and the [transfer example](examples/transfers.md).

INC/DEC wrap at eight bits and replace S/Z/H/PV/N while preserving C. P/V reports signed
overflow: INC sets it for `7F` → `80`, DEC for `80` → `7F`. H records a carry
from bit 3 for INC or a borrow from bit 4 for DEC. INC clears N; DEC sets it.
Pair views reflect the resulting bytes. The alternate bank remains unchanged.

## Arithmetic and logic

ADD, ADC, SUB, SBC, AND, XOR, OR, and CP support every unprefixed byte form:
B/C/D/E/H/L/A, memory through HL, and an immediate byte. The operation field
`ooo` has the same meaning in `10 ooo rrr` and `11 ooo 110`; `rrr` selects
B/C/D/E/H/L/(HL)/A. Indexed byte ALU forms remain unsupported.

All eight operations replace S/Z/H/PV/N/C. CP preserves A; the others replace
it with the low byte of the result. S reflects result bit 7 and Z tests the
result for zero, including the discarded subtraction result for CP.

| Operation | Result used for flags | H | P/V | N | C |
| --- | --- | --- | --- | --- | --- |
| ADD | A + operand | Carry from bit 3 | Signed overflow | 0 | Carry out |
| ADC | A + operand + incoming C | Carry from bit 3 | Signed overflow | 0 | Carry out |
| SUB / CP | A - operand | Borrow from bit 4 | Signed overflow | 1 | Borrow out |
| SBC | A - operand - incoming C | Borrow from bit 4 | Signed overflow | 1 | Borrow out |
| AND | A AND operand | 1 | Even parity | 0 | 0 |
| XOR / OR | A XOR/OR operand | 0 | Even parity | 0 | 0 |

ADC/SBC consume the current C; the other operations ignore it. SBC uses
C = 1 as an incoming borrow. CP changes flags without changing A, including
`CP A`, which sets Z and N and clears S/H/PV/C. `SBC A,A` instead produces
`00` or `FF` depending on incoming C.

Each operation reads its source before replacing A. Register forms fetch only
their opcode, `(HL)` forms additionally read the current data address, and
immediate forms fetch one operand byte. Repeated reads remain separate if HL
points at the opcode itself. RAM, byte registers other than A, the alternate
bank, index registers, SP, I, and interrupt state are preserved. PC wraps at 16 bits
and R increments once, following the ordinary instruction-step contract.

The [Zilog manual](https://www.zilog.com/docs/z80/um0080.pdf), printed pages
66–69 and 145–164, defines these operations. Its flag overview specifies
arithmetic overflow and logical parity; the P/V lines on the individual
SBC and AND pages (156 and 158) contain contradictory typographical errors.
Independent checks below confirm the overview's behavior for the modeled flags.

The implementation reuses operand readers and the shared binary adder/parity
helpers. For subtraction, complementing the operand gives adder carry outputs
that mean *no borrow*; both are inverted for Z80 H/C. These flag rules stay
inside the Z80. In particular, the 8080 retains a different subtraction AC
rule and does not always set AC for AND.

The [checksum example](examples/checksum.md) passes ADD's carry into ADC
through intervening loads, stores the two-byte result, and branches on CP.

## CB rotates, shifts, and bit operations

The CB page implements every documented second-byte encoding, using the same
B/C/D/E/H/L/(HL)/A operand selector as the load and ALU families. Both encoding
bytes are captured before any data access; `(HL)` reads follow them. A modifying
operation writes once, even if the result equals the old byte. BIT reads without
writing. Register operands cause no data accesses, and H/L modifications update
the derived HL view. Overlaps with either instruction byte retain the original
fetched bytes and every separate read and write.

RLC/RRC feed the outgoing bit back into the other end of the byte; RL/RR feed
incoming C instead. SLA shifts in zero, SRA repeats the sign bit, and SRL shifts
in zero from the left. Each moves the outgoing bit into C, sets S/Z from the
result and P/V from even parity, and clears H/N. These flag rules apply to the
CB accumulator forms too; the separate unprefixed accumulator rotates remain
unsupported. The source table makes the inserted bit explicit beside each
encoding and shares left/right shift behavior across the operand forms.

BIT sets Z when the selected bit is zero, sets H, clears N, and preserves C.
The Zilog manual leaves S/PV unspecified for BIT. This model sets PV equal to Z
and sets S only when testing bit 7 and finding it set, matching the independent
reference cases. RES clears the selected bit and SET sets it; both preserve all
flags. SLL's undocumented selector slot remains unsupported and earns no
coverage credit. DD/FD indexed forms are a separate future page.

See the [Zilog manual](https://www.zilog.com/docs/z80/um0080.pdf), printed pages
213–237 and 243–264, and the reference comparison under [checks](#checks-and-limits).

## Stack, calls, and returns

The memory stack grows downward with 16-bit wrapping. PUSH first decrements SP
and writes the high byte, then decrements SP and writes the low byte. POP reads
low at SP, increments SP, reads high, and increments SP again. POP leaves RAM
intact. BC, DE, HL, and AF use pair selector `qq` in that order, with AF occupying
the slot used by SP in immediate pair loads. PUSH preserves all flags; POP
preserves them except when restoring AF.

AF packs A as the high byte and `S Z 0 H 0 PV N C` as the low byte. PUSH AF writes
zero for the unmodeled F bits 5/3, and POP AF ignores those incoming bits. This
is a deterministic projection of the existing six-flag state, not a claim that
hardware fixes those bits to zero. It also means a POP/PUSH round trip can change
those two memory bits. The six modeled flags and A round trip exactly, and
snapshots retain everything needed to resume these instructions. No new stored
state or public raw AF view is introduced.

CALL fetches the entire low-first target word before writing the return address
(the following instruction's PC) to the stack, then selects the target. RET pops
the next PC low byte first, without the increment used by some other CPUs.
Conditional calls and returns use NZ/Z/NC/C/PO/PE/P/M. PO/PE test PV regardless of
whether the preceding instruction gave it a parity, overflow, or BIT result;
P/M test S. A false CALL still fetches both target bytes but makes no stack
access; a false RET fetches only its opcode. None changes flags, and either
path increments R once. Targets are not read until the next step.

Instruction and data addresses may overlap. A call captures its target before
stack writes can overwrite it; a return reads the current RAM, including when
SP points into code. Stack writes remain in the access record even when their
values match RAM. Interrupt returns, interrupt delivery, and I/O remain deferred.

See the [Zilog manual](https://www.zilog.com/docs/z80/um0080.pdf), printed pages
115–120 and 281–287. The [bit-count example](examples/bit-count.md) combines three
levels of calls with saved registers, CB shifts, and conditional counting. It
satisfies the stack/call/return part of the
[CPU-only checkpoint](../../../ROADMAP.md#cpu-only-checkpoint).

## Relative jumps

JR supports an unconditional form and the NZ/Z/NC/C conditions. A taken jump
adds the signed operand byte to PC after both instruction bytes, with 16-bit
wrapping; an untaken jump continues at that following address. JR preserves
all flags. DJNZ first decrements B with eight-bit wrapping, then jumps if B
is nonzero, preserving all flags including Z. B = `00` becomes `FF` and takes
the jump; B = `01` becomes `00` and falls through.
See the [Zilog manual](https://www.zilog.com/docs/z80/um0080.pdf), printed
pages 72, 165–171, and 265–279.

At this model's instruction boundary, register INC/DEC read only the opcode.
JR and DJNZ read the opcode followed by one operand, including on an
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

Tests exhaust all byte pairs and both carry inputs for all eight ALU operations
against independent signed/unsigned arithmetic, low-digit carries/borrows,
and binary-string parity. Every operand form also checks all incoming flag
patterns, including A as its own source, unchanged CP results, and H/L operands.
Other checks cover
all immediate-load bytes and flag patterns, exact memory accesses, PC and R
wrapping, overlapping stores, current RAM, and retained records. All unsupported
first bytes are checked, including DD/ED/FD; CB rejects its eight SLL encodings
after the second byte. Construction, nested snapshots,
reset, and readonly public types have separate checks.

Register loads and INC/DEC cover every byte and all 64 incoming flag patterns,
including half carry/borrow, signed overflow, flag preservation, pair views,
and unchanged alternate state. The transfer matrix checks every encoding and
byte, cycling through all incoming flag patterns; memory cases also check
address-space boundaries, opcode overlap, and H/L destination aliasing. Pair
loads check each selector with boundary words, all flag patterns, and wrapped
operand fetches. JR conditions cover all flag patterns; DJNZ
covers every B value and flag pattern. Every relative displacement is checked
on each available path, including page/address-space crossings and instruction
overlap. All supported opcodes are checked with every R value. Further checks
cover live arithmetic flags, current registers/pointers/operands, and retained records across
execution, reset, and caller edits.

Paired 8080/Z80 programs check common instruction bytes and data effects while
asserting each CPU's own flags: arithmetic overflow versus parity, subtraction
half-borrow versus AC, and AND's distinct half-carry behavior. The checksum
example checks 38 complete records, actual RAM calls, carry propagation,
both comparison failure paths, bounded running, snapshot resumption,
reset, full memory images, and fresh factories.

All 1,000 [SingleStepTests Z80 cases](https://github.com/SingleStepTests/z80/tree/main/v1)
for each of the 72 unprefixed ALU forms were also checked (72,000 cases total).
These supplementary checks compare every modeled field, final RAM, fetched
bytes, and ordered memory accesses. Undocumented F bits 3/5 and internal
latches are omitted; bus samples are reduced to memory transactions, excluding
refresh activity. This is an independent emulator comparison, not a claim
of hardware or cycle-accuracy testing. Repository tests remain self-contained.

CB tests cover all 248 encodings with every byte and both incoming carry values,
checking complete state and actual RAM calls. A further run exhausts all byte
and raw F combinations for each CB operation/bit through POP AF; expected bit
results use character movement independently of the core's shifts and masks.
Checks include all R values, memory read/write overlap with either opcode byte,
wrapped fetches, same-value writes, live HL and RAM, and atomic unsupported CB
attempts. PUSH/POP cover every flag pattern, boundary words and SP wrapping;
CALL/RET cover every condition and flag pattern with wrapped PC/SP and code
aliasing. Every new unprefixed encoding checks all R values. The bit-count
example checks all 151 records, full RAM, three nested call levels, fresh
factories, reset preservation, and resumption from every instruction boundary.

All 1,000 SingleStepTests cases for each new form also passed: 248 CB forms and
26 unprefixed stack/call/return forms, **274,000 cases** in total. Comparison
covers every modeled state field, final RAM, fetched bytes, and ordered memory
transactions. For PUSH AF only, the expected written F byte is projected to the
same six modeled bits; its omitted bits 5/3 are checked as zero in repository
tests. The earlier ALU comparison and these checks use the same exclusions for
internal latches and bus refresh activity. They do not establish cycle accuracy.
