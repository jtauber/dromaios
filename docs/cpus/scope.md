# CPU scope

This records the working CPU scope and implementation priorities.
The [project roadmap](../../ROADMAP.md) describes the implementation stages;
[architecture.md](../architecture.md) describes component responsibilities.
The [web design plan](../web-design.md) describes how these CPUs and machines
will be organized for learning, exploration, and reference as support develops.

## Working decisions

- Use **TypeScript** for the implementation and shared instruction definitions.
  Develop literate CPU authoring through executable chapters and shared runtimes; see
  [implementation language and future definition languages](../architecture.md#implementation-language-and-future-definition-languages).
  [Editor tooling](../../editors/zed/README.md) currently follows the machine
  definition syntax; CPU DSL editor support will follow its eventual language design.
- The introductory examples were built in the order **8080 → 6502 → 6809**
  to inform shared CPU and inspection interfaces.
- Apply a **rule of three**: use evidence from three distinct architectures to
  judge generalizations, including examples that expose their differences.
- Keep changes small and reviewable. The initial examples used minimal
  instruction subsets; current work consolidates the completed instruction
  definitions and addresses remaining accuracy and machine-integration needs.
- The **eight initial CPU targets** meet the roadmap's
  [CPU-only checkpoint](../../ROADMAP.md#cpu-only-checkpoint): Intel 8008,
  Intel 8080, Motorola 6800, MOS 6502, Zilog Z80, Motorola 6809, Intel 8088,
  and Motorola 68000. The [capability audit](coverage.md#cpu-only-checkpoint-review)
  records the evidence across their models and combined examples.
- All eight have complete documented opcode coverage and instruction-definition
  migration, including their interrupt, exception, and I/O contracts. The
  [coverage tracker](coverage.md) owns support details and source footprint,
  linking to the specifications for remaining processor limitations.
  Timing and complete machine behavior remain separate work.
- The **Z80 was the fourth CPU**, introduced after substantial 8080 opcode
  coverage. Its initial arithmetic example tests common encodings and distinct
  flags while using the shared RAM setup and runner. It now shares encoding
  bindings and instruction construction with the 8080 while retaining its own
  flag policies, prefix decoding, and lifecycle. Browser work can proceed
  alongside CPU consolidation, as described in the [project roadmap](../../ROADMAP.md).
- The **8008 was the fifth CPU**. Its native encoding, 14-bit addresses,
  and internal address registers extend the comparison; see its
  [model contract](../../src/components/cpus/specifications/8008.md).
- The **6800 was the sixth CPU**, with its own state, flags, reset contract,
  and [arithmetic example](6800/examples/arithmetic.md). It shares instruction
  representation with the 6809 while their chapters retain distinct addressing
  and stack rules.
- The **8088 was the seventh CPU**. Its [model contract](../../src/components/cpus/specifications/8088.md) separates
  logical segment:offset addresses from physical RAM addresses, and derives
  byte-register views from stored words. Its [arithmetic example](8088/examples/arithmetic.md)
  exercises the shared runner without changes. The [PC reference review](8088/reference-notes.md)
  records comparisons with `dromaios-pc` and hardware-generated instruction tests.
- The **68000 was the eighth CPU**. Its [model contract](../../src/components/cpus/specifications/68000.md) preserves
  32-bit registers on a 24-bit bus and derives the active stack pointer from
  user/supervisor state. Its [arithmetic example](68000/examples/arithmetic.md)
  uses word encodings and big-endian long operands. The
  [Mac reference review](68000/reference-notes.md) records findings from `dromaios-mac`.
- Choose implementation order independently of the microcomputer tutorial's
  historical teaching order.

## Intended eventual scope

This is the working target list, not a commitment to implement every processor
immediately. Fidelity, supported variants, and implementation order will be
defined as each case is introduced. Software targets are recorded below as
they are selected.

| CPU group | Specific targets | Machine targets |
| --- | --- | --- |
| Intel 8080 | 8080 | Altair 8800 |
| MOS 6502 family | 6502, 6507, 6510, Ricoh 2A03 | Apple II, BBC Micro, Atari 2600, C64, NES |
| Motorola 6809 | 6809 / 6809E | TRS-80 Color Computer |
| Zilog Z80 | Z80 | ZX Spectrum |
| Motorola 6800 | 6800 | To be selected |
| Intel 8008 | 8008 | To be selected |
| Sharp SM83 | SM83 | Game Boy and Game Boy Color |
| Motorola 68000 | 68000 | Macintosh 128K, Amiga |
| Intel x86 | 8088 / 8086, 80286, 80386 | PC/XT, PC AT, later DOS machines |
| ARM | ARM2, ARM7TDMI | Archimedes, Game Boy Advance |

The BBC Micro's chosen software target is **Elite**.

The [pedagogical roadmap](../pedagogy.md#7-understand-substantial-software-through-guided-execution)
also includes detailed software studies, with Ultima IV and Elite as examples
of the intended ambition. Each study will select its platform and version.
Running a software target and completing a guide to its implementation have
separate acceptance criteria; isolated routine studies can precede full-program
support when their execution requirements are met.

The 80386 target comes from the existing PC project's longer-term goal of
running Ultima VII and its DOS extender requirements. See the
[PC architecture and roadmap](https://github.com/jtauber/dromaios-pc/blob/main/ARCHITECTURE.md).

These names identify support targets. Grouping related processors does not
predetermine how much implementation they share. Variants must preserve the
hardware differences that matter to their machines.

**Modern ARM / Apple M1 remains a conceptual visualization topic**; full modern
system emulation would require a separate scope decision. This follows the
tutorial's distinction between emulators and later architectural explorers.

## Why 8080, 6502, and 6809 first?

All three have existing emulator implementations to examine. They also expose
different requirements for execution and inspection.

| CPU | Relevant distinctions | Questions for shared support |
| --- | --- | --- |
| 8080 | Register pairs, a 16-bit stack pointer, separate memory and I/O accesses | How do we expose related register views and distinguish address spaces? |
| 6502 | Small register set, zero-page addressing, stack confined to page one | How do we preserve CPU-specific addressing and stack conventions? |
| 6809 | A and B also form the 16-bit D register; two stack pointers; relocatable direct page; rich indexed addressing | How do we represent overlapping state, multiple stacks, and effective-address calculation? |

Hardware references for these distinctions:

- [Intel 8080 Microcomputer Systems User's Manual](https://www.bitsavers.org/components/intel/MCS80/98-153B_Intel_8080_Microcomputer_Systems_Users_Manual_197509.pdf)
- [MOS MCS6500 Programming Manual](https://www.bitsavers.org/components/mosTechnology/6500-50A_MCS6500pgmManJan76.pdf)
- [Motorola M6809 Programming Manual](https://www.bitsavers.org/components/motorola/6809/M6809PM.rev0_May83.pdf)

## How we use the three examples

The initial sequence is complete: the [8080 example](8080/examples/arithmetic.md)
established RAM, stepping, and exact execution records; the equivalent
[6502](6502/examples/arithmetic.md) and [6809](6809/examples/arithmetic.md)
programs tested the first assumptions against distinct architectures.
Focused examples then exercised register relationships, stacks, addressing,
and memory access across all eight CPUs. Three versions of the same arithmetic
program alone would have left important differences untested.

Continue using those examples when consolidating execution, memory, and
inspection support. Record each model's limits and expected behavior, and add
new cases when a proposed generalization exposes a difference they do not cover.

The rule of three guides when we trust a generalization. It does not require
every operation to have a common implementation, every helper to have three
users, or a generic CPU base class. RAM and straightforward helpers may be
shared earlier. Decoding, flags, addressing, and timing can retain the structure
that best explains each CPU. Future processors can still challenge an interface
that worked for the first three.

The early examples test CPU conventions. The subsequent
[8080](8080/examples/echo.md) and [68000](68000/examples/echo.md) echo compositions
exercise the same input/output devices through different connections. These
provide tested machine wiring and component reuse before the first complete
historical machine.

## Existing reference coverage

The following records source present on the repositories' default branches
when reviewed on 12 September 2026. It is an inventory; implementation fidelity
and completeness still require separate checks against hardware documentation.

| CPU or teaching model | Existing source |
| --- | --- |
| 8080 | [Altair core](https://github.com/jtauber/dromaios-altair/blob/main/js/cpu_8080.js) and [tutorial implementation](https://github.com/jtauber/microcomputer-tutorial/blob/main/pantry/js/i8080.js) |
| 6502 | [Apple II core](https://github.com/jtauber/dromaios-apple2/blob/main/js/cpu.js) |
| MC6809E | [CoCo core](https://github.com/jtauber/dromaios-coco/blob/main/js/cpu.js) |
| SM83 | [Game Boy / Game Boy Color core](https://github.com/jtauber/dromaios-gameboy/blob/main/js/cpu.js) |
| 8088 / 8086 | [PC/XT core](https://github.com/jtauber/dromaios-pc/blob/main/js/cpu_8088.js) |
| 68000 | [Macintosh implementation and checks](https://github.com/jtauber/dromaios-mac) |
| 8008 teaching model | [Tutorial implementation](https://github.com/jtauber/microcomputer-tutorial/blob/main/pantry/js/i8008.js), using 8080 opcode encodings |

The PC's [AT page](https://github.com/jtauber/dromaios-pc/blob/main/index_at.html)
loaded the XT CPU and memory components at that review. Its proposed 286
components were commented out, so that scaffold did not establish 80286 support.

The tutorial's [master plan](https://github.com/jtauber/microcomputer-tutorial/blob/main/PLAN.md)
and [emulator plan](https://github.com/jtauber/microcomputer-tutorial/blob/main/EMULATORS.md)
provided the broader CPU and machine candidates. At that review, their status
lists lagged behind the source: 8080 and Macintosh implementations existed,
and the tutorial had its 8008 and 8080 interactives.

The tutorial's 8008 model should be treated as a teaching prototype. Its source
explicitly uses 8080 opcode encodings. The plan's description of the 8008 as
having "no stack" also needs qualification: the hardware has a return stack
supporting seven nested calls. The useful comparison is with the 8080's
programmer-managed stack in RAM. See
[Intel's 8008 documentation](https://www.bitsavers.org/components/intel/MCS8/Intel_8008_8-Bit_Parallel_Central_Processing_Unit_Rev1_Apr72.pdf).

## Current implementation

The [coverage tracker](coverage.md) records instruction-definition coverage,
source footprint, supported features, and remaining limits. The
[model contracts](../README.md#cpu-models) define state, execution records,
and reset; [example specifications](../README.md#cpu-examples) define programs
and acceptance checks. The [CoCo reference review](6809/reference-notes.md)
records ideas from the earlier implementation. Focused examples and comparison
of the models continue to test shared execution and inspection conventions.
The [specification questions](../architecture.md#model-contracts-and-example-specifications)
guide review of each implementation change.

The project uses the [MIT license](../../LICENSE).
