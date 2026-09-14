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

- Extend the resolved operands now established by MOVE when arithmetic needs
  read/modify/write behavior. Preserve the explicit operand size, extension
  fetching, and auto-update lifetime.
- Preserve a resolved address for read/modify/write operands so addressing
  side effects happen once. The reference caches effective addresses; an
  explicit operand value may make the lifetime clearer here.
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
