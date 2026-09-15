# 68000 reference notes

The first slice reviewed `dromaios-mac` at commit
`9fa206830687b3ccdec4943d7ea5e318d6ba05ee`, alongside Motorola's
[MC68000 User's Manual](https://www.nxp.com/docs/en/reference-manual/MC68000UM.pdf)
and [programmer's reference manual](https://www.nxp.com/docs/en/reference-manual/M68000PRM.pdf).
The manuals establish hardware behavior; the existing emulator supplies ideas
and cases to examine. These notes do not count its support as Dromaios coverage.

## State and address views

The reference [CPU](https://github.com/jtauber/dromaios-mac/blob/9fa206830687b3ccdec4943d7ea5e318d6ba05ee/js/cpu.js)
uses unsigned arrays for eight data and eight address registers, with active
A7 in the address array and a saved user stack pointer. Dromaios instead stores
USP and SSP explicitly and derives A7 from S. This makes stack selection visible
without keeping duplicate active state synchronized.

The reference status object includes an M bit and a two-bit trace field.
Those describe later family members: the original 68000 has S at bit 13 and
a single T at bit 15, with no M or T0. The new model deliberately describes
only the original chip. Packed SR/CCR views can be added with instructions
that need them.

The reference masks PC to 24 bits during fetching and reset. Motorola's
programmer's model specifies a 32-bit PC; the original chip exposes a 24-bit
physical address space. Dromaios keeps those concepts distinct, preserving
PC while masking each RAM address. Tests use high-byte aliases and independently
exercise physical-bus and full-PC wrap.

## Fetching, execution, and reset

The reference `fetchWord`/`fetchLong` helpers make big-endian organization clear.
Its `fetchLong` combines words with JavaScript bitwise operators, which produce
a signed 32-bit number. Dromaios converts the combined result back to unsigned
with `>>> 0`, including high-bit immediates and both reset vectors.

The [instruction definitions](https://github.com/jtauber/dromaios-mac/blob/9fa206830687b3ccdec4943d7ea5e318d6ba05ee/js/instructions.js)
illustrate MOVE's asymmetric layout: destination register/mode precedes source
mode/register. Dromaios's table explains that full layout beside family patterns.
The reference's MOVE generation includes byte sources in address registers;
the original instruction disallows those. Future effective-address expansion
must follow the manual's permitted sets, not fill every selector combination.

The reference reset clears general registers, loads the two vectors, enters
supervisor mode, clears trace, and masks interrupts. Dromaios preserves general
registers, USP, and condition flags whose reset values are unspecified, while
performing the documented vector loads and control changes. That preservation
is a stated deterministic policy.

The reference combines CPU execution with Mac ROM hooks, memory-manager guards,
history, and device/runtime concerns. Dromaios keeps the CPU independent and
returns records of its RAM calls. Its initial implementation has no exception
delivery, prefetch, cycle counts, or device behavior. Alignment failures are
explicit unsupported attempts rather than simulated successful accesses.

## Ideas to revisit

- Review supervisor transitions and exception stacks when adding status and
  exception behavior. Keep original-68000 rules separate from 68010/68020 ones.
- Keep Macintosh mapping and ROM behavior in future machine/device components.

The [model contract](model.md) records current policies; the
[opcode-count audit](opcode-count.md) explains the coverage denominator.

## MOVE and effective-address expansion

The complete MOVE/MOVEA implementation uses a resolved operand distinguishing
Dn, An, memory, and immediates. Source reading precedes destination resolution;
pending An updates feed destination base/index calculations and commit only
after alignment checks. This retains atomic unsupported attempts while giving
successful instructions the required source/destination interactions.

The existing Mac emulator's `getEA`/`setEA` split and cached read/modify/write
address remain useful comparisons. Its comments still include an obsolete
claim that MOVEA flags are undefined; Motorola specifies no change, and its
current handler also preserves them. Dromaios checks byte/word preservation,
MOVEA sign extension, A7 stepping, original brief-index behavior, and PC-relative
bases against the manual, with independent fixtures rather than copied helpers.

The expanded table is shared by instances and receives the executing CPU
explicitly. A local Node 24 measurement of 1,000 constructions using the same
RAM/state took about 0.39 s with the old table and 3.25 s with the expanded
per-instance table. Sharing the table reduced that loop to about 0.0034 s;
this measures construction after module initialization, not instruction speed.
No changes to other CPU decoders were needed.

The [CPU tests](../../../tests/components/cpus/68000.test.ts) establish all
9,726 transfer forms and reject every unimplemented operation word. The
[addressing example](examples/addressing.md) specifies complete state and RAM
traces. These are local/manual-based checks; no external hardware corpus or
cycle-level comparison is claimed.

## Immediate arithmetic and logic

The six immediate families reuse MOVE's resolved operands and width-aware
read/write helpers. The immediate is fetched before destination extensions;
one resolved operand supplies both the read and write address. This makes
address auto-updates explicit without a separate effective-address cache.
CMPI commits its address update while omitting writeback.

The Mac reference's shared immediate-ALU path is a useful comparison, but its
CMPI decoder also admits address-register and PC-relative destinations that the
original chip disallows. Dromaios constructs only the manual's data-alterable
forms. Packed CCR/SR operations remain separate, unsupported encodings.

Shared binary arithmetic supplies carry, borrow, and signed overflow. The
68000 assigns flags locally: ADDI/SUBI copy carry/borrow to X; CMPI preserves
X; logical operations preserve X and clear V/C. Independent tests cover every
byte pair, all 900 legal forms, partial Dn writes, and read/modify/write traces.
No external hardware corpus or cycle comparison is claimed for this slice.

## Branches, counted loops, and returns

The Mac reference uses the same condition vocabulary for Bcc and DBcc, with
BSR occupying the branch family's false-condition encoding. Dromaios retains
that relationship, binding the BSR handler during table construction. Its
condition predicates receive the executing CPU's flags, so the shared table
captures no instance state.

The reference computes word branch targets by subtracting two after fetching
the extension and masks branch PCs to 24 bits. Dromaios captures the base before
the extension fetch and preserves all 32 bits in targets and return addresses.
Both retain the original chip's signed-byte interpretation of `FF`.

DBcc preserves the high word and flags; a false condition decrements only the
low word. The reference recombines words with a signed bitwise result; Dromaios
uses its existing partial-register writer, retaining an unsigned stored long.
Calls and returns reuse big-endian long access while selecting USP/SSP through
A7. Explicit target and stack validation preserves the model's atomic rejection
contract, without copying exception sequencing or timing from the reference.

Independent condition truth tables, displacement/counter sweeps, and the
[buffer example](examples/control-flow.md) check these decisions, including
nested calls, both stacks, wrapping, and resuming after corrected faults.

## Register and address arithmetic

ADD/SUB/CMP and ADDA/SUBA/CMPA reuse resolved operands, shared arithmetic,
and partial-register writes. Immediate and register-sourced memory arithmetic
now share the same destination path. Operation callbacks describe arithmetic
and flags; returning no result suppresses comparison writeback. Address
arithmetic sign-extends word sources and selects a 32-bit operation explicitly.

The Mac reference separates data and address arithmetic, preserving all flags
for ADDA/SUBA. Its EA helpers apply source auto-updates before reading the
destination An. The corresponding
[Musashi handlers](https://github.com/kstenerud/Musashi/blob/313ebf1bd9f4d0d93341eb5ce21fd8a119e9dbdd/m68k_in.c)
also read the source before the destination in ADDA/SUBA/CMPA. Dromaios retains
that ordering after alignment validation; tests include CMPA cases where only
the updated pointer compares equal. This is a source cross-check, not a
hardware comparison.

Manual address sets remain authoritative: the memory-destination ADD/SUB
encodings exclude Dn/An modes, which encode ADDX/SUBX. CMP's other direction
belongs to EOR/CMPM; CMPM remains unsupported. The tests execute all
9,144 added forms and reject every remaining operation word; BigInt arithmetic,
sign-extension sweeps, and the [word-sum example](examples/word-sum.md) supply
independent result and access expectations.

## Register and memory logic

AND/OR/EOR use the same operation callbacks, resolved operands, and flag helper
as the existing ALU. The shared data-ALU builder now names the EA field's role:
ordinary source, data source, memory destination, or data destination. These
sets express the original chip's restrictions without decoding operation names
or adding execution paths. EOR's data destination includes Dn, while AND/OR's
data sources exclude An for all sizes.

The Mac reference makes the AND/OR distinction explicit, but its EOR decoder
admits PC-relative and immediate destinations. Motorola permits only data
alterable destinations. Dromaios rejects those extra forms and the neighboring
SBCD, SUBX, CMPM, ABCD/EXG, and ADDX encodings. Long logic uses the existing
unsigned-result helper, avoiding signed JavaScript register values.

Independent bit truth tables, all 5,760 forms, and complete
[masked-merge traces](examples/logic.md) check the new bindings. Memory checks
include unchanged writes, postincrement/predecrement, both stacks, physical
and logical wrapping, overlapping code/data, and atomic alignment rejection.
These are local and manual-based checks; no hardware corpus comparison is claimed.

## Addresses, register lists, and stack frames

LEA/PEA/JMP/JSR reuse the existing EA resolver but use its address without
reading operand data. BSR and JSR share one call operation, including full
return addresses and atomic alignment rejection. The Mac reference's LEA
and JSR tables admit extra modes; Dromaios uses Motorola's 28 control EAs
consistently for all four instructions.

The Mac reference handles MOVEM's reversed predecrement mask and final
postincrement base explicitly, but repeats its register loops for each bank
and direction. Dromaios uses one transfer loop, mapping mask bits to Dn or An
and retaining an independent transfer address. Motorola specifies that a
predecrement base in the list stores its original value on the 68000; the
later-processor rule is excluded. Word loads sign-extend into both banks.

The pinned [Musashi handlers](https://github.com/kstenerud/Musashi/blob/313ebf1bd9f4d0d93341eb5ce21fd8a119e9dbdd/m68k_in.c)
cross-check the MOVEM base rules and specialize LINK/UNLK for A7. LINK A7
saves the decremented SP; UNLK A7 leaves the popped value itself in SP.
The Mac reference agrees on LINK but increments the popped value for UNLK A7.
Dromaios follows Musashi's explicit A7 behavior and tests both cases separately.
This is a source comparison, not a hardware validation claim.

MOVEM fetches its mask before resolving the EA. PC-relative bases therefore
follow the mask, and all register updates occur after the EA has been captured.
An empty mask performs no data access or base update, matching the reference
loops; this model does not impose data alignment in that case. Nonempty lists
validate alignment before transferring anything. Within each transfer,
Dromaios retains ascending, high-first byte records, including predecrement
long stores; Musashi models their low-word-first hardware ordering instead.
No timing or physical bus-order comparison is claimed.

Independent tests enumerate the manual's legal forms, sweep every register
mask in both sizes and directions, and exercise every word sign extension and
LINK displacement. They also check unchanged flags, original and discarded
base values, A7 aliases, wrapping, overlapping code/data, and atomic faults.
The [frame example](examples/stack-frame.md) checks complete records and RAM
images for a caller and subroutine using all seven new families.

## Quick arithmetic, unary operations, and condition bytes

ADDQ/SUBQ reuse the existing arithmetic helpers and resolved destination path.
The Mac reference separates An from data destinations: even the word encoding
changes the entire address register without changing flags. Dromaios binds
that distinction while constructing the opcode table, including the encoded
zero that means an immediate eight. Immediate and unary families now share
size and data-alterable EA validation; execution still fetches immediates only
for the instructions that have them.

The reference TST decoder admits later-chip An, PC-relative, and immediate
forms. Dromaios retains the original 68000's data-alterable set. Its CLR and
Scc memory handlers, like the pinned Musashi handlers, write without first
reading. Motorola's programmer's reference explicitly requires that read on
the 68000/68008 (notes on pages 4-74 and 4-173). Dromaios therefore uses the
same read/modify/write path for CLR, Scc, and the other unary/quick operations;
TST returns no result to suppress writeback while retaining address updates.

NEGX uses the shared width-aware subtraction with incoming X, then applies
its cumulative-zero rule explicitly. This agrees with the Mac reference and
[Musashi's NEGX handlers](https://github.com/kstenerud/Musashi/blob/313ebf1bd9f4d0d93341eb5ce21fd8a119e9dbdd/m68k_in.c).
An all-ones operand plus incoming X produces a zero result with borrow; an
already-clear Z must remain clear. Tests derive signed overflow from BigInt
ranges and cover every word with each incoming X/Z pair, independently of
the implementations' bit formulas. Scc uses the existing Motorola conditions,
including T/F, with separate literal truth-table checks for all incoming flags.

The [combined example](examples/unary.md) classifies signed words, computes
magnitudes, and negates a two-long value. Its final high long becomes zero
while the complete result is nonzero, checking cumulative Z across a restored
snapshot. All checks here use manual expectations, local tests, and source
comparisons; no external hardware corpus or cycle comparison is claimed.

## Shifts and rotates

Motorola's programmer's reference defines the register and memory variants
on pages 4-21–4-24 (ASL/ASR), 4-113–4-115 (LSL/LSR), 4-160–4-162 (ROL/ROR),
and 4-163–4-165 (ROXL/ROXR). Memory forms shift one word once, while register
counts come from an embedded 1–8 operand or the low six bits of a data register.
The two formats place their kind selectors in different fields; both layouts
are shown explicitly in the Dromaios table.

The [Mac reference](https://github.com/jtauber/dromaios-mac/blob/9fa206830687b3ccdec4943d7ea5e318d6ba05ee/js/instructions.js)
uses separate register loops for the four families. It preserves X for ordinary
rotates and copies X into C for a zero-count ROX, but its ASL path always clears
V. Motorola requires V to record any intermediate sign change. For example,
ASL.B by two turns `40` into `00` with V set, despite both endpoint signs being
positive. Dromaios shares one repetition loop using the existing one-bit shift
helpers and applies those flag rules locally, including unsigned long results.

Tests use whole-value BigInt arithmetic and bit-string rotation independently
of that loop, plus literal flag cases and every legal encoding. The
[combined program](examples/shifts.md) exercises all eight operations and
restores execution between shifts of a multi-word operand. This is manual-
and test-based verification; no external hardware or timing comparison is claimed.

## Bit operations

Motorola's programmer's reference documents BCHG on pages 4-27–4-29,
BCLR on 4-30–4-32, BSET on 4-56–4-58, and BTST on 4-61–4-63. The
tables distinguish writable data operands from BTST's broader data-source
set. Dynamic BTST accepts an immediate tested byte; static BTST does not.
Both permit PC-relative memory. These address restrictions determine the
1,826 forms in the [opcode audit](opcode-count.md).

The Mac reference separates static and dynamic bit-operation loops. Its static
BTST decoder admits an immediate tested operand, and the dynamic modifying
operations admit PC-relative and immediate modes. Those combinations are
excluded here according to Motorola's tables. The reference's bit masking
and pre-modification Z calculation are useful comparisons, while the tests
derive their expectations independently from bit strings.

Dromaios binds the two number sources to one operation family and the existing
EA/ALU path. That path now permits an immediate operand for an operation that
returns no writeback result; writable operations retain an explicit guard.
The static form fetches the complete number word before resolving its EA,
so PC-relative bases follow that word. The model ignores the number word's
upper byte, consistent with using only its low three or five bits. Tests cover
every extension word as well as the documented low-byte operand range.

The [combined example](examples/bits.md) records requested bits in D0 while
toggling their modulo-eight positions in memory, and classifies their old
values through Z. It also exercises all four operations in both number-source
forms and an explicit PC-relative test. These are manual-derived local checks,
not an external hardware or timing comparison.

## Extended arithmetic and memory comparison

Motorola's programmer's reference describes ADDX on pages 4-13–4-14,
CMPM on 4-81, and SUBX on 4-183–4-184. ADDX/SUBX combine an incoming X
with the two operands and retain Z for a zero result. CMPM preserves X,
replaces NZVC, and advances both memory pointers without writing either operand.
Their original-chip register, size, and addressing choices contribute the
960 forms listed in the [opcode audit](opcode-count.md).

The Mac reference reads the source before applying the destination pointer
update, including when the two operands select the same An. Its ADDX/SUBX
handler distinguishes register and predecrement forms; CMPM has a separate
postincrement loop. The arithmetic formulas and cumulative-Z behavior are
useful comparisons, while Dromaios tests use independent BigInt arithmetic.

Dromaios generalizes its existing register-ALU path to resolve two operands,
with pending source updates visible to destination resolution. ADDX/SUBX and
CMPM then share the ordinary arithmetic operand reads, result writes, alignment
checks, and active-stack handling. ADD/SUB accept an extended mode, allowing
NEGX to reuse SUBX's flag logic with a zero left operand. The opcode table
retains the complete bit patterns and explicit addressing choices.

The [model contract](model.md#extended-arithmetic-and-memory-comparison)
specifies atomic alignment rejection and instruction-level access order;
neither exception delivery nor cycle ordering is added here. The
[combined example](examples/extended.md) restores a 64-bit memory value and
compares it with a reference, while retaining the sum in registers. Tests
restore snapshots at all four low/high carry and borrow boundaries.

## Ordinary-instruction completion

The programmer's reference is authoritative for the remaining ordinary
families: ABCD (4-2–4-3), CHK (4-69–4-70), DIVS (4-92) and DIVU (4-96),
EXG (4-105), EXT (4-106), MOVE to CCR (4-123–4-124), MOVE from SR (4-125),
MOVEP (4-131–4-133), NBCD (4-141–4-142), RTR (4-168), TAS (4-186–4-187),
and the system-instruction entries for SR/USP transfers and STOP. Only the
original chip's word multiply/divide, single T bit, and defined SR bits apply.
MOVE from SR is unprivileged on the 68000 and reads a memory destination
before writing it. MOVE to CCR reads a word, then retains five bits.

The Mac reference's multiply/divide handlers offer a useful comparison for
packed remainder/quotient layout, but its divide-by-zero path sets V instead
of delivering the processor exception. Dromaios now delivers vector 5 with
the following PC; C clears, while undefined N/Z/V are preserved. Quotient overflow
is distinct: V sets, C clears, Dn is preserved, and source auto-updates commit.
Undefined N/Z remain unchanged by model policy.

Its decimal handlers preserve undefined N/V and apply corrections in two
nibbles. Dromaios uses a shared byte operation for ABCD/SBCD/NBCD and the
existing paired-operand path for predecrement. That path also handles A7's
two-byte step; the reference's decimal path decrements byte A7 by one.
Valid packed operands are checked against independent integer decimal
arithmetic; non-BCD inputs follow the explicit deterministic correction
policy in the [model contract](model.md#decimal-arithmetic).

MOVEP reuses ordered memory transfer with a stride of two. Word-source
execution shares EA resolution, alignment checks, and deferred address
updates across multiply/divide, CHK, and status loads. Status packing reuses
the shared flag-register helper. RTR shares RTS's stack/target validation,
adding the CCR word without changing supervisor state. These checks use
manual-derived expectations, not a claim of external hardware conformance.

The [decimal pipeline](examples/decimal-pipeline.md) exercises the families
together, including a divide-by-zero handler and RTE. Synchronous exception
delivery is described below; external interrupts and devices remain deferred.


## Synchronous exception delivery

The [MC68000 User's Manual](https://www.nxp.com/docs/en/reference-manual/MC68000UM.pdf)
§6.2.4 specifies the original chip's six-byte SR/PC frame; the format/vector
word belongs to the 68010 and later. Sections 6.3.5–6.3.7 distinguish the
following PC for TRAP/TRAPV/CHK/divide-by-zero from the faulting instruction
PC for illegal instructions and privilege violations. Entry saves the previous
SR, selects supervisor mode, and clears trace. RTE restores the six-byte frame
through SSP before exposing the bank selected by the returned S bit.

The [programmer's reference](https://www.nxp.com/docs/en/reference-manual/M68000PRM.pdf)
CHK entry defines N on failed checks and leaves Z/V/C undefined; DIVU/DIVS
clear C even on division by zero, with N/Z/V undefined. Dromaios preserves
undefined flags while applying defined changes before stacking SR. Operand
auto-updates survive these completed reads; privileged instructions check S
before fetching any extensions or operands.

Pinned [Musashi exception helpers](https://github.com/kstenerud/Musashi/blob/313ebf1bd9f4d0d93341eb5ce21fd8a119e9dbdd/m68kcpu.h)
and [instruction handlers](https://github.com/kstenerud/Musashi/blob/313ebf1bd9f4d0d93341eb5ce21fd8a119e9dbdd/m68k_in.c)
provide an independent implementation comparison for frame size, saved PCs,
and RTE's stack-bank switch. Its divide-by-zero path does not clear C;
Dromaios follows the manual's condition-code rule.

An external comparison against pinned [SingleStepTests/680x0 68000 V1 cases](https://github.com/SingleStepTests/680x0/tree/e0d5ece9670205cc84a0101081837deb446f86a3/68000/v1)
passed **25,089 cases**: 8,065 TRAP, 8,065 TRAPV, 4,011 RTE, and 4,948 CHK.
These are **emulator-generated tests, not hardware traces**. The comparison
checked full registers, defined SR bits, final RAM, and ordered data accesses.
It materialized the fixture's two prefetched words for this core's direct
instruction fetch, excluded instruction-prefetch transactions, and masked
undefined CHK flags both in SR and its stacked copy. The corpus supplies the
word order used here: entry writes PC low, SR, PC high; RTE reads PC high, SR,
PC low. Timing, function codes, and instruction prefetch are not modeled.

The RTE file's 4,054 and CHK file's 3,117 address-error cases were excluded
because their longer frame and fault sequencing remain outside this model.
The DIVU/DIVS files were also inspected: after excluding address errors and
ordinary division, they supply only one zero-divisor case (DIVU
`80ef [DIVU (d16, A7), D0] 5745`). It stacks the instruction start PC, unlike
the following PC specified by the user's manual §6.3.5 and used by Musashi.
All other defined state, frame, and data-access checks matched after masking
undefined flags. This case is recorded as a discrepancy, not counted as a
pass; Dromaios retains the manual's following-PC rule. In-repo tests cover
zero divisors for both signed and unsigned division across every source form.

Manual-derived tests additionally cover user/supervisor banks, all trap vectors,
all RTE status words, nested entries/returns and snapshot restoration, address
wrapping, stack/vector overlap, privilege rejection before operand reads,
and host RAM failures during frame/vector transfers. The
[model contract](model.md#synchronous-exception-entry-and-return) describes
alignment boundaries and callback-visible partial state. Only explicit
ILLEGAL (`4AFC`) enters vector 4; decoding other illegal opwords, line-A/line-F,
external interrupts, trace, address/bus errors, and RESET remain later work.
