# Z80 model contract

The Z80 model implements every documented instruction form except I/O and
interrupt controls/returns against flat 64 KiB RAM. It uses instruction-level
execution records, with one iteration per step for repeating block instructions.
The existing RAM setup and CPU runner work with this model without adapters.

[Implementation](../../../src/components/cpus/z80.ts) ·
[CPU tests](../../../tests/components/cpus/z80.test.ts) ·
[Public type checks](../../../tests/types/z80.ts) ·
[Coverage](../coverage.md#z80) ·
[Arithmetic example](examples/arithmetic.md) ·
[Counted-loop example](examples/counted-loop.md) ·
[Transfer example](examples/transfers.md) ·
[Checksum example](examples/checksum.md) ·
[Bit-count and nested-call example](examples/bit-count.md) ·
[Indexed buffer and block-search example](examples/indexed-buffer.md)

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
DE, or HL, or replace SP. EX AF,AF′ exchanges A and the six flags; EXX exchanges
BC, DE, and HL while preserving both accumulators and flag sets. IX/IY supply
indexed operands and word operations; I/R have transfers to and from A.
PUSH/POP update SP and transfer BC, DE, HL, AF, IX, or IY; calls, returns,
and RST use the same memory stack.

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

`step()` attempts one instruction, or one block iteration, and returns `CpuZ80StepRecord`:

- `before` and `after`: independent complete snapshots.
- `instruction`: its starting address and the bytes actually fetched, in order;
  `null` only when already halted on entry.
- `accesses`: ordered byte reads and writes, each with `kind`, `address`, and
  the value read or written.
- `outcome`: `executed`, `halted`, or `unsupported`. Only `unsupported` carries
  `reason: "opcode"`.

Supported instructions advance PC while fetching bytes, wrapping at 16 bits.
Word operands, including immediate pair loads and absolute addresses, are
fetched low byte first. NOP changes only PC and R under these ordinary rules.
Stores record the write even when the value is unchanged, and never read the
destination to reconstruct an old value. Captured instruction bytes survive
stores that overwrite code. Subsequent steps fetch current RAM.

Each supported instruction increments the low seven bits of R for each opcode
fetch, preserving bit 7: once for an unprefixed instruction and twice for every
supported prefixed form. In `DD/FD CB d op`, only the first two bytes are M1
opcode fetches; neither the displacement nor the final opcode increments R.
Operand reads and data accesses do not increment R. For example, unprefixed
`7F` becomes `00`, while prefixed `FF` becomes `81`. PC and R are advanced only
after the complete supported encoding has been identified. LD A,R observes
this increment; LD R,A then replaces all eight bits with A.

An unsupported opcode is read and recorded, but PC, R, all other CPU state,
and RAM remain unchanged. This atomic rejection is a model policy, including
the choice to leave R unchanged despite the recorded reads. CB, ED, DD, and FD
fetch a second byte, wrapping at FFFF. An unsupported entry retains both reads
without fetching operands. DD/FD CB additionally fetch displacement and final
opcode before rejecting an unsupported entry, retaining all four reads. SLL,
index half-register operations, indexed-CB register destinations, repeated
prefixes, ignored-prefix encodings, and undocumented ED aliases are unsupported.
Repeating an unsupported attempt reads current RAM again and preserves all state.

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
A also supports loads/stores through BC or DE and absolute loads/stores.
`LD HL,(nn)` reads low then high; `LD (nn),HL` writes low then high without
reading the destination. Both data addresses wrap at 16 bits, and the complete
address operand is fetched before data access. `LD SP,HL` copies HL without
accessing RAM. All these loads preserve all modeled flags and the alternate bank.

The `01 ddd sss` load matrix uses B/C/D/E/H/L/(HL)/A in both fields. Its 63
transfers share operand reading and writing; `01 110 110` selects HALT during
table construction and performs no data access through HL. The opcode patterns
keep this exception beside the family definition. See the
[Zilog manual](https://www.zilog.com/docs/z80/um0080.pdf), printed pages
71–74, 79–80, 85, and 99, and the [transfer example](examples/transfers.md).

Byte INC/DEC wrap at eight bits and replace S/Z/H/PV/N while preserving C. P/V reports signed
overflow: INC sets it for `7F` → `80`, DEC for `80` → `7F`. H records a carry
from bit 3 for INC or a borrow from bit 4 for DEC. INC clears N; DEC sets it.
Pair views reflect the resulting bytes. `(HL)` forms read once and write once.
Register and memory forms share byte operations and operand access helpers.
Word INC/DEC on BC/DE/HL/SP instead wrap at 16 bits and preserve
every flag. The alternate bank remains
unchanged.

ED word loads/stores add BC, DE, and SP to absolute word transfers. The
documented ED 63/6B forms also transfer HL, with the same behavior as 22/2A
and an additional prefix fetch. All capture the complete address before reading
or writing low then high, wrapping at FFFF, and preserve flags.

LD I,A and LD R,A copy all eight A bits and preserve every flag. LD A,I and
LD A,R set S/Z from the transferred byte, clear H/N, copy IFF2 into P/V, and
preserve C. IFF1 does not select this flag result. Interrupt-time quirks of
these transfers are outside the current model. See the
[Zilog manual](https://www.zilog.com/docs/z80/um0080.pdf), printed pages 94–97
and 106–109.

## Indexed operands

DD selects IX and FD selects IY. The pages share documented behavior and
encoding patterns, with their word operations substituting IX/IY for HL.
ADD IX/IY,ss selects BC, DE, the same index, or SP and follows ADD HL's flag
rules. Word INC/DEC, immediate/absolute loads, PUSH/POP, EX (SP),IX/IY,
JP (IX/IY), and LD SP,IX/IY preserve flags. JP takes the index itself as its
target, with no displacement or data read. Stack operations keep the byte
order described below; EX reads low/high then writes high/low without moving SP.

Byte memory operands use the live index plus a signed eight-bit displacement,
with 16-bit address wrapping. Loads transfer to/from all seven ordinary byte
registers, including H and L themselves. `LD (IX/IY+d),n` fetches d before n
and captures both before writing. INC/DEC and all eight byte ALU operations use
the same flag behavior as their `(HL)` counterparts.

Indexed-CB encodings are `DD/FD CB d op`. Only documented memory forms, whose
final `rrr` field is `110`, are supported: seven rotates/shifts and eight each
of BIT/RES/SET. They share the ordinary CB operations and flags, capture all
four encoding bytes before reading data, and leave every byte register intact.
BIT reads once without writing; other forms read then write once, including
unchanged results. See the [Zilog manual](https://www.zilog.com/docs/z80/um0080.pdf),
its IX/IY instruction entries, and the [indexed-buffer example](examples/indexed-buffer.md).

## Register exchanges

EX AF,AF′ swaps only A and flags between the banks. EXX swaps only B/C/D/E/H/L,
leaving both A values and flag objects untouched. Derived pair views follow
the resulting stored bytes. EX DE,HL swaps the two main pairs, preserving all
other registers and flags. Applying any exchange twice restores its operands.

EX (SP),HL reads low at SP and high at SP+1 before writing the original H to
SP+1 and original L to SP, then replaces HL with the word read. Addresses wrap
at 16 bits; SP and all flags stay fixed. Its high-then-low writes differ from
the low-then-high writes of LD (nn),HL. Instruction/data overlap and same-value
writes remain visible in the record. Bank exchanges perform no data accesses.
The [Zilog manual](https://www.zilog.com/docs/z80/um0080.pdf) defines these
register exchanges; the independent cases below also check the memory order.

## Arithmetic and logic

ADD, ADC, SUB, SBC, AND, XOR, OR, and CP support every unprefixed byte form:
B/C/D/E/H/L/A, memory through HL, and an immediate byte. The operation field
`ooo` has the same meaning in `10 ooo rrr` and `11 ooo 110`; `rrr` selects
B/C/D/E/H/L/(HL)/A. DD/FD replace the memory source with `(IX/IY+d)`.

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
and R increments once for the unprefixed forms, twice for indexed forms.

The [Zilog manual](https://www.zilog.com/docs/z80/um0080.pdf), printed pages
66–69 and 145–164, defines these operations. Its flag overview specifies
arithmetic overflow and logical parity; the P/V lines on the individual
SBC and AND pages (156 and 158) contain contradictory typographical errors.
Independent checks below confirm the overview's behavior for the modeled flags.

The implementation reuses operand readers and the shared addition, subtraction,
and parity helpers. Subtraction supplies borrow and half-borrow directly for
Z80 C/H. These flag rules stay inside the Z80. In particular, the 8080 retains
a different subtraction AC rule and does not always set AC for AND.

ADD HL,ss adds BC, DE, HL, or SP to the original HL and wraps at 16 bits.
It replaces H with carry from bit 11 into bit 12 and C with carry from bit 15,
clears N, and preserves S/Z/PV even when the resulting word is zero or changes
sign. The shared addition helper supplies the word result and carry; its
low-nibble half-carry does not describe this instruction's bit-11 boundary.

ED ADC/SBC HL,ss accept BC/DE/HL/SP and incoming C. Both replace all six flags:
S is result bit 15, Z tests the whole word, H reports carry/borrow across bit 11,
P/V reports signed 16-bit overflow, N selects subtraction, and C reports the
word carry/borrow. The original source is captured even for HL as both operands.
NEG computes zero minus A, setting the byte subtraction flags; only A=`80`
overflows, and only A=`00` leaves C clear. See the
[Zilog manual](https://www.zilog.com/docs/z80/um0080.pdf), printed pages 182 and 190–193.

The [checksum example](examples/checksum.md) passes ADD's carry into ADC
through intervening loads, stores the two-byte result, and branches on CP.

## Decimal and accumulator operations

DAA adjusts A using its incoming value, H, N, and C. It selects a correction
of `06` when H is set or the low nibble exceeds 9, and `60` when C is set or
A exceeds `99`. N selects subtraction or addition of that correction and is
preserved. The result wraps to a byte; S/Z reflect that result, P/V is even
parity, H records whether bit 4 changed, and C records selection of the `60`
correction. Thus decimal carry can be passed to later arithmetic or tested by
a conditional instruction.

The [Zilog manual](https://www.zilog.com/docs/z80/um0080.pdf), printed pages
173–174, describes valid packed-decimal adjustment cases. Explicit snapshots
can also supply arbitrary A/H/N/C combinations. This model applies the above
thresholds in both addition and subtraction mode, matching the independent
reference cases for those additional states. Repository tests separately
check all valid decimal operand pairs against decimal arithmetic.

RLCA/RRCA rotate A's outgoing bit into the other end; RLA/RRA insert incoming
C instead. All four put the outgoing bit in C, clear H/N, and preserve S/Z/PV.
They use the same shared bit movement as CB rotates, with different flag rules.
CPL complements A, sets H/N, and preserves S/Z/PV/C. SCF sets C and clears H/N;
CCF copies incoming C into H, inverts C, and clears N. Both preserve S/Z/PV.
None accesses data memory or changes the alternate bank.

The [decimal-total example](examples/decimal-total.md) combines DAA with bank
exchanges, ADD HL, conditional absolute jumps, and RST subroutine calls while
preserving the caller's main registers and flags.

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
CB accumulator forms too; unprefixed accumulator rotates instead preserve
S/Z/PV. The source table makes the inserted bit explicit beside each
encoding and shares left/right shift behavior across the operand forms.

BIT sets Z when the selected bit is zero, sets H, clears N, and preserves C.
The Zilog manual leaves S/PV unspecified for BIT. This model sets PV equal to Z
and sets S only when testing bit 7 and finding it set, matching the independent
reference cases. RES clears the selected bit and SET sets it; both preserve all
flags. SLL's undocumented selector slot remains unsupported and earns no
coverage credit. The indexed pages reuse these same operations and flag rules.

See the [Zilog manual](https://www.zilog.com/docs/z80/um0080.pdf), printed pages
213–237 and 243–264, and the reference comparison under [checks](#checks-and-limits).

## Nibble rotates

RLD rotates the three nibbles `(A low, memory high, memory low)` left; RRD
rotates them right. A's high nibble and HL remain fixed. Both read `(HL)` once
and write the rotated byte once, including unchanged values and code overlap.
S/Z and even-parity P/V describe the resulting A, H/N clear, and C is preserved.
These are binary nibble operations for every input, without decimal correction.
See the [Zilog manual](https://www.zilog.com/docs/z80/um0080.pdf), printed pages 238–242.

## Block copies and comparisons

LDI/LDD read `(HL)`, write `(DE)`, advance both pointers by +1/−1, and decrement
BC. H/N clear, P/V indicates whether the resulting BC is nonzero, and S/Z/C
are preserved. CPI/CPD instead compare A with `(HL)`, advance HL by +1/−1,
and decrement BC. They preserve A/DE/C, set S/Z/H from the discarded byte
subtraction, set N, and set P/V from the remaining count. All pointer/count
updates wrap at 16 bits. Copies always record a write, even for identical
source/destination addresses or unchanged bytes.

LDIR/LDDR and CPIR/CPDR perform **one iteration per `step()`**. If repetition
continues, PC moves back two bytes to the ED prefix: copies repeat while BC is
nonzero; comparisons also require a mismatch. The next step fetches the
instruction again, advances R twice again, and uses the current pointers,
count, and RAM. No hidden progress state is needed for snapshot resumption.
Changing code or data between iterations affects the next step normally.
Overlapping copies propagate values in the selected direction, byte by byte.

An initial BC of zero wraps to FFFF after the first iteration; repeating copy
therefore transfers 65,536 bytes. Repeating comparison also allows that many
iterations, stopping sooner on a match. A match on the last byte sets Z with
P/V clear. A match earlier sets both. Carry is preserved on every path.

Runner budgets count these visible iterations, so even a zero-count block can
be paused with a small `maxSteps`. There are no cycle-level dummy/refresh
accesses, and interrupt delivery remains deferred. This stepping convention
follows the instruction's PC-rewind/refetch behavior in the
[Zilog manual](https://www.zilog.com/docs/z80/um0080.pdf), printed pages 130–144.
The [indexed-buffer example](examples/indexed-buffer.md) checks complete copy
and search traces with resumption at every boundary.

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

RST encodes one of eight targets, `00/08/10/18/20/28/30/38`, in its opcode.
It pushes the following PC and jumps using the ordinary call behavior, with
no target operand to fetch. RST preserves both interrupt-enable latches, IM,
I, and all flags; it is a subroutine call, independent of interrupt delivery.

Instruction and data addresses may overlap. A call captures its target before
stack writes can overwrite it; a return reads the current RAM, including when
SP points into code. Stack writes remain in the access record even when their
values match RAM. Interrupt returns, interrupt delivery, and I/O remain deferred.

See the [Zilog manual](https://www.zilog.com/docs/z80/um0080.pdf), printed pages
115–120 and 281–287. The [bit-count example](examples/bit-count.md) combines three
levels of calls with saved registers, CB shifts, and conditional counting. It
satisfies the stack/call/return part of the
[CPU-only checkpoint](../../../ROADMAP.md#cpu-only-checkpoint).

## Jumps

JP nn replaces PC with the fetched low-first target word. JP cc,nn uses the
same eight conditions as CALL/RET and fetches both address bytes even on a
false path. JP (HL) takes the target directly from the HL register pair: the
parentheses do not mean reading a pointer from RAM. All preserve flags and
perform no target access until the next instruction step.

JR supports an unconditional form and the NZ/Z/NC/C conditions. A taken jump
adds the signed operand byte to PC after both instruction bytes, with 16-bit
wrapping; an untaken jump continues at that following address. JR preserves
all flags. DJNZ first decrements B with eight-bit wrapping, then jumps if B
is nonzero, preserving all flags including Z. B = `00` becomes `FF` and takes
the jump; B = `01` becomes `00` and falls through.
See the [Zilog manual](https://www.zilog.com/docs/z80/um0080.pdf), printed
pages 72, 165–171, and 265–279.

At this model's instruction boundary, JR and DJNZ read the opcode followed
by one operand, including on an untaken path. No target or dummy reads are
performed. R advances once on either path, following the existing opcode-fetch
rule. Subsequent steps fetch current
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
first bytes and every prefix-page entry are checked; CB rejects its eight SLL
encodings after the second byte. Construction, nested snapshots,
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

The remaining ordinary unprefixed instructions have further checks for every
A/flag combination in DAA, accumulator rotates, CPL, SCF, and CCF; every valid
decimal operand pair and incoming carry/borrow in ADC/SBC followed by DAA;
word values and boundaries in pair INC/DEC, ADD HL, word loads, and register
jumps/transfers; and every stack address in EX (SP),HL. Bank exchanges cover every
pair of flag patterns, repeated exchanges, and snapshot resumption. Absolute
jumps and RST cover every condition/vector, flag pattern, PC/SP wrapping,
code overlap, and refresh value. The decimal-total example verifies all 46
records, full RAM, preserved caller state, both carry paths, and resumption
from every boundary, with edited inputs spanning zero through 396.

All 1,000 independent cases for each of these 53 forms also passed:
**53,000 cases** from [SingleStepTests Z80 at revision ebe1875](https://github.com/SingleStepTests/z80/tree/ebe1875d48f374bcfd4b505d8eb8ee751568b5f7/v1).
The comparison checks modeled state, final RAM, fetched bytes, and ordered
memory transactions under the same exclusions above. In particular, it
checks arbitrary DAA states and EX (SP),HL's read/write order. These are
independent emulator cases; they do not establish hardware or cycle accuracy.

Indexed tests cover both registers, every signed displacement, byte value,
and carry input, real H/L transfers, word/stack wrapping, and overlap with
every encoding byte. All 171 new forms check every initial R value. ED checks
cover word arithmetic boundaries with every flag pattern, word-transfer
aliasing, every NEG input/flag combination, IFF1/IFF2 disagreement, live R
transfers, and every A/memory pair for RLD/RRD. Block checks cover all eight
forms, both pointer directions and wraps, zero/final/nonzero counts, every
comparison byte pair, overlapping copies, rewritten code, a full 65,536-byte
copy, and early comparison matches. The indexed-buffer example checks 24 full
records, every match position, failure, bounded running, snapshot resumption,
reset, complete memory images, and fresh factories.

All 1,000 independent cases for each of the **171 indexed/ED additions** also
passed: **171,000 cases** from
[SingleStepTests Z80 at revision ebe1875](https://github.com/SingleStepTests/z80/tree/ebe1875d48f374bcfd4b505d8eb8ee751568b5f7/v1).
They compare every modeled state field, final RAM, fetched bytes, and ordered
memory transactions, excluding undocumented F bits/internal latches and bus
refresh activity as above. Repeating block cases describe one iteration.
These supplementary emulator comparisons do not establish cycle accuracy;
repository tests remain self-contained.

The remaining documented forms are DI/EI, all port and block I/O, interrupt
mode selection, RETI, and RETN. Interrupt delivery, cycle timing, undocumented
instructions, and F bits 3/5 remain outside this model. The
[coverage inventory](../coverage.md#z80) tracks the documented-form count.
