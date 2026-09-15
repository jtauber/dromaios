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
belongs to EOR/CMPM. Those families remain unsupported. The tests execute all
9,144 added forms and reject every remaining operation word; BigInt arithmetic,
sign-extension sweeps, and the [word-sum example](examples/word-sum.md) supply
independent result and access expectations.
