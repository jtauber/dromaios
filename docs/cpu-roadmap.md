# CPU scope and early roadmap

This records the CPU discussion and working direction as of 12 September 2026.
The [project roadmap](../ROADMAP.md) describes the implementation stages;
[architecture.md](architecture.md) describes component responsibilities.

## Working decisions

- Use **TypeScript** as the initial implementation language. Future DSLs for
  CPU and component definitions remain a possible direction; see
  [implementation language and future definition languages](architecture.md#implementation-language-and-future-definition-languages).
- Start with the **Intel 8080**.
- Introduce small **6502** and **6809** examples early, in that order, before
  settling shared CPU and inspection interfaces.
- Apply a **rule of three**: use evidence from three distinct architectures to
  judge generalizations, including examples that expose their differences.
- Keep changes small and reviewable. Initially implement only the instruction
  subsets required by the examples.
- Choose implementation order independently of the microcomputer tutorial's
  historical teaching order.

## Intended eventual scope

This is the working target list, not a commitment to implement every processor
immediately. Fidelity, supported variants, software targets, and the order
beyond the first three will be defined as each case is introduced.

| CPU group | Specific targets | Machine targets |
| --- | --- | --- |
| Intel 8080 | 8080 | Altair 8800 |
| MOS 6502 family | 6502, 6507, 6510, Ricoh 2A03 | Apple II, Atari 2600, C64, NES |
| Motorola 6809 | 6809 / 6809E | TRS-80 Color Computer |
| Zilog Z80 | Z80 | ZX Spectrum |
| Sharp SM83 | SM83 | Game Boy and Game Boy Color |
| Motorola 68000 | 68000 | Macintosh 128K, Amiga |
| Intel x86 | 8088 / 8086, 80286, 80386 | PC/XT, PC AT, later DOS machines |
| ARM | ARM2, ARM7TDMI | Archimedes, Game Boy Advance |

The 80386 target comes from the existing PC project's longer-term goal of
running Ultima VII and its DOS extender requirements. See the
[PC architecture and roadmap](https://github.com/jtauber/dromaios-pc/blob/main/ARCHITECTURE.md).

These names identify support targets. Grouping related processors does not
predetermine how much implementation they share. Variants must preserve the
hardware differences that matter to their machines.

The **8008 remains an optional additional target**. It offers an interesting
small architecture, but none of the machine targets above depends on it.
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

## How we will use the three examples

1. Build a tiny 8080 program with RAM, instruction stepping, and an execution
   record. The [first-example specification](first-example.md) specifies loading a
   number, adding another, storing the result, and halting, with exact expected
   records to check against.
2. Implement an equivalent program on the 6502. Examine which support carries
   over and where the first model made assumptions.
3. Repeat with the 6809, revisiting those assumptions with a third architecture.
4. Add focused examples covering register relationships, stack operations,
   addressing, and I/O. Three versions of the same arithmetic program alone
   would leave important differences untested.
5. Consolidate shared execution, memory, and inspection support where the
   examples justify it. Record the limits and expected behavior of each model.

The rule of three guides when we trust a generalization. It does not require
every operation to have a common implementation, every helper to have three
users, or a generic CPU base class. RAM and straightforward helpers may be
shared earlier. Decoding, flags, addressing, and timing can retain the structure
that best explains each CPU. Future processors can still challenge an interface
that worked for the first three.

These early examples test CPU conventions. A further composition using an
existing CPU and a simple device will test machine wiring and component reuse
before we build the first complete machine.

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
currently loads the XT CPU and memory components. Its proposed 286 components
are commented out, so the AT scaffold does not establish 80286 support.

The tutorial's [master plan](https://github.com/jtauber/microcomputer-tutorial/blob/main/PLAN.md)
and [emulator plan](https://github.com/jtauber/microcomputer-tutorial/blob/main/EMULATORS.md)
provide the broader CPU and machine candidates. Their implementation status
lists are older than the current code: 8080 and Macintosh implementations now
exist, and the tutorial has its 8008 and 8080 interactives.

The tutorial's 8008 model should be treated as a teaching prototype. Its source
explicitly uses 8080 opcode encodings. The plan's description of the 8008 as
having "no stack" also needs qualification: the hardware has a return stack
supporting seven nested calls. The useful comparison is with the 8080's
programmer-managed stack in RAM. See
[Intel's 8008 documentation](https://www.bitsavers.org/components/intel/MCS8/Intel_8008_8-Bit_Parallel_Central_Processing_Unit_Rev1_Apr72.pdf).

## Next decisions

The [first-example specification](first-example.md) has been reviewed. RAM,
8080 state, `MVI A,n`, step records, reset, and lesson setup are implemented,
with TypeScript compiled to ES modules and tests run by Node.js 24's built-in
runner. The next small change adds `ADI n` and its arithmetic flags. The
[specification questions](architecture.md#first-example-specification) continue
to guide review as each instruction is added.

The first code includes the [MIT license](../LICENSE).
