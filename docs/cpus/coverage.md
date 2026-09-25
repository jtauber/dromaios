# CPU implementation coverage

All eight initial CPU models now implement **100% of their documented opcode
forms through [shared, inspectable instruction definitions](instruction-semantics.md)**
that generate executable code and explanations. Their whole declared models
are authored in literate chapters. The table records that completed milestone
and the current source footprint; it does not measure hardware fidelity or
future language work. Detailed opcode inventories and counting rules follow.

Update this document whenever literate authoring, CPU support, or source footprint changes.
The [model contracts](../README.md#cpu-models) define state and execution policies;
example specifications define programs and expected results. [CPU scope](scope.md)
records intended targets and the reasons for choosing them. Existing reference
emulators do not count toward implementation here.

## At a glance

| Model | Introduced | Transistors (approx.) | Handwritten CPU core lines | Literate spec lines | `cpu` fence lines | Literate / documented forms | Literate instruction coverage | [Literate model milestones](#literate-model-milestones) |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- |
| [Intel 8008](#8008) | 1972 | [3,500][intel-transistors] | [0](../../src/components/cpus/specifications/8008.md) | [1,436](../../src/components/cpus/specifications/8008.md) | 341 | 250 / 250 | 100% | 6 / 6 |
| [Intel 8080](#8080) | 1974 | [6,000][intel-transistors] | [0](../../src/components/cpus/specifications/8080.md) | [1,600](../../src/components/cpus/specifications/8080.md) | 510 | 244 / 244 | 100% | 6 / 6 |
| [Motorola 6800](#6800) | 1974 | [4,100][6800-transistors] | [0](../../src/components/cpus/specifications/6800.md) | [1,781](../../src/components/cpus/specifications/6800.md) | 745 | 197 / 197 | 100% | 6 / 6 |
| [MOS 6502](#6502) | 1975 | [3,510][6502-transistors] | [0](../../src/components/cpus/specifications/6502.md) | [1,758](../../src/components/cpus/specifications/6502.md) | 600 | 151 / 151 | 100% | 6 / 6 |
| [Zilog Z80](#z80) | 1976 | [8,500][z80-transistors] | [0](../../src/components/cpus/specifications/z80.md) | [2,908](../../src/components/cpus/specifications/z80.md) | 1,506 | 698 / 698 | 100% | 6 / 6 |
| [Motorola 6809](#6809) | 1978 | [9,000][6809-transistors] | [0](../../src/components/cpus/specifications/6809.md) | [2,548](../../src/components/cpus/specifications/6809.md) | 1,307 | 268 / 268 | 100% | 6 / 6 |
| [Intel 8088](#8088) | 1979 | [29,000][intel-transistors] | [0](../../src/components/cpus/specifications/8088.md) | [4,058](../../src/components/cpus/specifications/8088.md) | 2,657 | 291 / 291 | 100% | 6 / 6 |
| [Motorola 68000](#68000) | 1979 | [68,000][68000-transistors] | [0](../../src/components/cpus/specifications/68000.md) | [7,725](../../src/components/cpus/specifications/68000.md) | 4,370 | 36,029 / 36,029 | 100% | 6 / 6 |

**Literate instruction coverage** measures documented opcode forms authored in
executable chapters. This percentage alone does not measure the wider CPU
model. All eight chapters also own all model milestones and generate their
public interfaces; each is its CPU's sole processor-specific implementation source.

**Literate model milestones** count whole model areas owned by chapters, using
the six criteria below. All eight CPUs are at **6 / 6**: instructions,
stored state, register views, reset effects, normal execution, and external events.

**Literate spec lines** count whole Markdown chapters under
`src/components/cpus/specifications/`, including prose, diagrams, formal blocks,
and fence markers, using `wc -l`. **`cpu` fence lines** count just the bodies of
executable `cpu` fences, excluding their opening and closing markers. Both counts
include comments and blank lines and are summed across a CPU's chapters. CPUs
without a chapter have zero in both columns; partial chapters contribute their
current lines.

**Handwritten CPU core lines** count the entire maintained `<cpu>.ts` file,
including comments and blank lines, using `wc -l`. State schemas, instruction
definitions, chapters, shared helpers, generated code, tests, and machine
definitions are excluded. A fully generated core counts as zero.
All eight CPUs have **zero CPU-specific handwritten implementation lines**, including their
former state and definition adapters. Each chapter generates its public class and types,
snapshot assembly, instruction catalogue, execution bindings, and machine
integration metadata. Model discovery and test selection also use the generated
catalogue. Shared runtime
services handle fetching, dispatch, guarding, and records according to the
chapters' policies. See [source footprint](#source-footprint) for the wider
maintained-source count and [the 8008 file map](implementation.md#following-the-8008-files)
for the roles of its generated files.

## Literate model milestones

A milestone counts only when executable chapters determine the complete
behavior for that area, production execution uses the generated definitions,
independent checks establish the model contract, and the equivalent handwritten
CPU policy has been removed. Shared runtime machinery for validation, guarding,
access recording, and snapshot assembly may remain TypeScript; processor-specific
choices must come from the chapter.

| Milestone | What the chapter must own | 8008 | 8080 | 6502 | 6800 | 6809 | Z80 | 8088 | 68000 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Complete instruction definitions and encodings | Every documented opcode form and its behavior at the model's declared fidelity | [Complete](../../src/components/cpus/specifications/8008.md) | [Complete](../../src/components/cpus/specifications/8080.md#checks-and-examples) | [Complete](../../src/components/cpus/specifications/6502.md#checks-and-examples) | [Complete](../../src/components/cpus/specifications/6800.md#checks-and-examples) | [Complete](../../src/components/cpus/specifications/6809.md#checks-and-examples) | [Complete](../../src/components/cpus/specifications/z80.md#checks-and-limits) | [Complete](../../src/components/cpus/specifications/8088.md#checks-and-limits) | [Complete](../../src/components/cpus/specifications/68000.md#checks-and-limits) |
| Stored-state schema | All stored fields, types, widths, and array lengths | [Complete](../../src/components/cpus/specifications/8008.md#stored-state) | [Complete](../../src/components/cpus/specifications/8080.md#stored-state) | [Complete](../../src/components/cpus/specifications/6502.md#stored-state) | [Complete](../../src/components/cpus/specifications/6800.md#stored-state) | [Complete](../../src/components/cpus/specifications/6809.md#stored-state) | [Complete](../../src/components/cpus/specifications/z80.md#stored-state) | [Complete](../../src/components/cpus/specifications/8088.md#stored-state) | [Complete](../../src/components/cpus/specifications/68000.md#stored-state) |
| Derived register views and writes | Computed registers, aliases, and their write rules | [Complete](../../src/components/cpus/specifications/8008.md#register-views) | [Complete](../../src/components/cpus/specifications/8080.md#register-views-and-counter-writes) | [Complete](../../src/components/cpus/specifications/6502.md#status-as-a-byte) | [Complete](../../src/components/cpus/specifications/6800.md#condition-codes-as-a-byte) | [Complete](../../src/components/cpus/specifications/6809.md#register-views-and-writes) | [Complete](../../src/components/cpus/specifications/z80.md#pair-and-status-views) | [Complete](../../src/components/cpus/specifications/8088.md#byte-views-and-writes) | [Complete](../../src/components/cpus/specifications/68000.md#effective-address-decoding) |
| Reset effects | State changes, preservation rules, and any reset-time device or memory effects | [Complete](../../src/components/cpus/specifications/8008.md#reset) | [Complete](../../src/components/cpus/specifications/8080.md#reset) | [Complete](../../src/components/cpus/specifications/6502.md#reset-and-instruction-boundaries) | [Complete](../../src/components/cpus/specifications/6800.md#reset-and-instruction-boundaries) | [Complete](../../src/components/cpus/specifications/6809.md#reset-and-external-entry) | [Complete](../../src/components/cpus/specifications/z80.md#reset-and-execution) | [Complete](../../src/components/cpus/specifications/8088.md#reset-and-execution-lifecycle) | [Complete](../../src/components/cpus/specifications/68000.md#external-reset) |
| Normal execution | Fetching, decoding/dispatch, stopping, retirement, and failure policies | [Complete](../../src/components/cpus/specifications/8008.md#execution-and-interrupt-acceptance) | [Complete](../../src/components/cpus/specifications/8080.md#instruction-boundaries-and-interrupt-acceptance) | [Complete](../../src/components/cpus/specifications/6502.md#reset-and-instruction-boundaries) | [Complete](../../src/components/cpus/specifications/6800.md#reset-and-instruction-boundaries) | [Complete](../../src/components/cpus/specifications/6809.md#execution-and-public-interface) | [Complete](../../src/components/cpus/specifications/z80.md#reset-and-execution) | [Complete](../../src/components/cpus/specifications/8088.md#reset-and-execution-lifecycle) | [Complete](../../src/components/cpus/specifications/68000.md#fetching-dispatch-and-retirement) |
| External events | Interrupt/exception acceptance, entry, and externally supplied execution, as applicable | [Complete](../../src/components/cpus/specifications/8008.md#execution-and-interrupt-acceptance) | [Complete](../../src/components/cpus/specifications/8080.md#instruction-boundaries-and-interrupt-acceptance) | [Complete](../../src/components/cpus/specifications/6502.md#external-interrupt-entry) | [Complete](../../src/components/cpus/specifications/6800.md#waiting-and-external-interrupt-delivery) | [Complete](../../src/components/cpus/specifications/6809.md#execution-and-public-interface) | [Complete](../../src/components/cpus/specifications/z80.md#execution-and-public-interface) | [Complete](../../src/components/cpus/specifications/8088.md#external-interrupt-delivery) | [Complete](../../src/components/cpus/specifications/68000.md#exception-frames-and-external-events) |

These are milestones, not equally sized units of work, so the count is not
converted into a percentage. They cover each CPU's existing instruction-level
model; completing them does not add cycle timing or machine devices to its scope.
The [language guide](literate-specifications.md) describes supported syntax and
the remaining authoring boundaries.

## Literate authoring milestone

All eight chapters own every model area above and generate their public classes,
state types, snapshots, execution bindings, and integration metadata. No
CPU-specific handwritten implementation remains. The milestone table links to
the definitions and independent checks for each model.

[Chapter integration tests](../../tests/scripts/chapter-model-integration.test.ts)
verify that formal edits reach construction, snapshots, machine parsing, and
execution. [Literate language tests](../../tests/components/cpus/semantics)
exercise syntax, diagnostics, and effect ordering. The [design notes](design.md)
define the next generality test: adding a processor with the language and runtime
held fixed. Completed authoring percentages do not measure that future work.

## CPU-only checkpoint review

The September 2026 audit found that all eight models meet the
[roadmap's capability criteria](../../ROADMAP.md#cpu-only-checkpoint).
Each has validated explicit state, detached snapshots, instruction stepping,
and a defined reset contract, with independent CPU tests. Each also implements
loads/stores, arithmetic/logic, branches, calls/returns, and its native stack
conventions. The programs below exercise those capabilities through the shared
runner, including pause/resume and reset or reconstruction.

| CPU | Combined program evidence |
| --- | --- |
| 8008 | [Control flow](../../tests/machines/8008/control-flow-example.test.ts): conditional paths, internal address stack, memory result, and halt |
| 8080 | [Control flow](../../tests/machines/8080/control-flow-example.test.ts): calls, conditional jumps, memory result, and halt |
| 6502 | [Subroutines](../../tests/machines/6502/subroutines-example.test.ts): nested calls, page-one stack wrapping, memory result, and completion |
| 6800 | [Word transformation](../../tests/machines/6800/word-transform-example.test.ts) and [stack](../../tests/machines/6800/stack-example.test.ts): arithmetic, shifts, conditional execution, and native calls/returns |
| Z80 | [Bit count](../../tests/machines/z80/bit-count-example.test.ts): nested calls, bit operations, memory results, and halt |
| 6809 | [Sum of squares](../../tests/machines/6809/sum-of-squares-example.test.ts): stack locals, arithmetic, conditional looping, and completion |
| 8088 | [Decimal buffer](../../tests/machines/8088/decimal-buffer-example.test.ts): wrapped words, repetition, far calls/returns, formatting, and halt |
| 68000 | [Decimal pipeline](../../tests/machines/68000/decimal-pipeline-example.test.ts) and [control flow](../../tests/machines/68000/control-flow-example.test.ts): decimal arithmetic, transfers, status, nested calls, and stopping |

These programs establish the roadmap's capability checkpoint, not complete
processor accuracy. Opcode inventories, declared fidelity, and independent
hardware checks remain distinct evidence.

## Source footprint

The CPU core line counts above omit supporting code. Use this wider count when
judging source reduction; all counts include comments and blank lines.

| Scope | Lines |
| --- | ---: |
| Handwritten CPU cores (all eight) | 0 |
| CPU-specific instruction definition files | 0 |
| Other authored CPU source: shared helpers, state schemas, semantic model, builders, validation, generator, reporter, and literate front end | 6,602 |
| **All authored TypeScript under `src/components/cpus`, excluding both generated directories** | **6,602** |
| Authored CPU chapters (Markdown, including prose and formal blocks) | 23,814 |
| CPU generation scripts (`generate-cpu-semantics.ts` and `generate-cpu-chapters.ts`) | 148 |
| Generated executable CPU output, counted separately | 604,686 |
| Generated chapter data, catalogues, and entry-point metadata, counted separately | 995,540 |
| Generated state schemas/types, counted separately | 213 |

Chapter-data generation compares ordered plain data before formatting a shared
definition and its dependencies. This avoids rendering duplicates just to
discover they already have a reference. The chapter compiler also reuses frozen
instruction bodies within each encoding declaration when operand and condition
selections match. The 68000's **54,008 expanded opcode entries** now require
**9,671 compiled family bodies**. Exclusions and collisions still check every
opcode, and different encoding declarations retain independent bindings.

Local measurements of the body-sharing change (`b7b374f` → `e94eb53`) on macOS
ARM64 with Node 24.20.0, using medians from three fresh processes per version:

| CPU generation stage | Before body sharing | After body sharing |
| --- | ---: | ---: |
| Compile chapters | 7.20 s | 2.52 s |
| Serialize chapter modules | 1.57 s | 1.62 s |
| Load generated instruction registry | 3.42 s | 3.46 s |
| Emit instruction bodies | 0.19 s | 0.19 s |
| **Complete CPU generation, including startup and file writes** | **12.48 s** | **7.93 s** |

Stage timers surround compilation, chapter-module serialization, registry
import, and instruction emission. Complete generation is **36% faster**; median
process peak RSS falls from **1,367 to 1,078 MiB** (about 21%), measured with
`process.resourceUsage().maxRSS`. Across those versions, all **132 checked files**—generated
CPU and machine sources and the expanded instruction listing—were byte-identical.
Separate TypeScript 7.0.2 processes take **11.6 s / 2,026 MiB peak RSS** for
`tsc --project tsconfig.src.json` and **13.5 s / 3,359 MiB** for `tsc`. These are
single-run compilation measurements; RSS is the whole process's peak, not a
per-stage heap measurement. That change preserved generated file sizes and emulator behavior.

Tests, other documentation, machine definitions, and compiled JavaScript are
outside this source count. Generated TypeScript is reproducible build output,
not maintained source. Its size is still reported to keep expansion visible.
Both `src/components/cpus/generated/` and
`src/components/cpus/semantics/generated/` are excluded from authored counts.

## How the percentages are counted

Literate instruction coverage is **documented opcode forms whose complete instruction
bodies are authored in executable chapters / total documented forms × 100**,
rounded to one decimal place. Shared sources alone do not migrate their callers.
A chapter form counts only when the real CPU uses its generated body for every
documented operand choice, with behavior and failure boundaries verified.

This measures authoring coverage, not effort, source reduction, test coverage,
or processor accuracy. State, reset, external events, and execution are separate
[model milestones](#literate-model-milestones); timing remains outside the
current models' declared fidelity.

An opcode form is a specific encoding, including its addressing form. For
example, immediate LDA and absolute LDA count separately. Operand values do
not create additional forms. A form earns credit only when all its documented
operand choices have verified chapter-defined behavior.

The denominators count distinct documented encodings in the manufacturer
instruction tables, with register fields expanded where they form part of
the opcode. Mnemonic aliases sharing an encoding count once; undocumented
encodings and instructions belonging to other CPU variants are excluded.

| Model | Documented forms | Counting basis |
| --- | --- | --- |
| Intel 8008 | 250 | [Intel 8008 User's Manual, Basic Instruction Set and Appendix I](https://www.bitsavers.org/components/intel/MCS8/Intel_8008_8-Bit_Parallel_Central_Processing_Unit_Rev1_Apr72.pdf): expand documented selectors and opcode don't-care bits; 58 forms in `00`, and 64 each in `01`, `10`, and `11` |
| Intel 8080 | 244 | [Intel 8080 Assembly Language Programming Manual, Appendix B](https://altairclone.com/downloads/manuals/8080%20Programmers%20Manual.pdf): expand the opcode bit patterns, excluding the 12 undocumented byte encodings |
| Motorola 6800 | 197 | [Motorola MC6800 data sheet, tables 3–6](https://vtda.org/docs/computing/Motorola/M6800SystemsReferenceDataSheets_May75.pdf): 140 accumulator/memory + 24 index/stack + 25 jump/branch + 8 condition-code forms |
| MOS 6502 | 151 | [Synertek 6500 Programming Manual, Appendix B](https://syncopate.us/books/Synertek6502ProgrammingManual.html#ap-b): count the documented instruction/addressing forms |
| Motorola 6809 | 268 | [Motorola MC6809–MC6809E Programming Manual, Appendix D](https://www.maddes.net/m6809pm/appendix_d.htm): 221 unprefixed forms + 38 on page 2 + 9 on page 3, counting mnemonic aliases once |
| Zilog Z80 | 698 | [Zilog Z80 CPU User Manual, UM008011-0816](https://www.zilog.com/docs/z80/um0080.pdf): 252 unprefixed + 248 CB + 58 ED + 39 DD + 39 FD + 31 DD CB + 31 FD CB forms |
| Intel 8088 | 291 | [Intel 8086 Family User's Manual, October 1979, table 4-13](https://www.ardent-tool.com/CPU/docs/Intel/808x/manuals/9800722-03_alt.pdf): 226 documented non-prefix first bytes + 65 additional ModR/M opcode-extension forms; audit below |
| Motorola 68000 | 36,029 | [Motorola M68000 Family Programmer's Reference Manual](https://www.nxp.com/docs/en/reference-manual/M68000PRM.pdf): original-68000 operation words with register/addressing selectors expanded and literal operand values collapsed; [family audit](68000/opcode-count.md) |

For the 8008, the six absent encodings are `22`, `2A`, `32`, `38`, `39`,
and `3A`. The documented opcode don't-care bits are expanded: JMP, CAL,
and RET each have eight encodings, and HLT has three (`00`, `01`, `FF`).
Counting all these documented encodings follows the same rule as the other
CPUs; different mnemonic names for one encoding still count once. Immediate
values and address bytes, including their ignored high bits, do not add forms.
The full count includes all 32 I/O forms.

For the 6800, count each instruction/addressing encoding in tables 3–6 on
printed pages 18–21, expanding A/B choices. The total includes interrupt
instructions. Undocumented encodings and
later-family additions are excluded; operand and address bytes do not add forms.

For the 6809, a prefix and following opcode byte identify one form; prefixes
alone do not count. Indexed and register-selection postbytes do not create
additional forms, but an opcode remains partial until all its documented
postbyte choices work.

For the Z80, prefixes and the final opcode identify a form; displacement and
immediate values do not create forms. The DD CB and FD CB counts include only
the documented memory forms. Undocumented SLL, index-half register operations,
ignored-prefix aliases, and alternate encodings absent from the manual are
excluded. The ED count includes `ED 63` and `ED 6B`: the manual explicitly lists
HL among the choices for `LD (nn),dd` and `LD dd,(nn)` (printed pages 108 and 103).
These are different documented encodings from the unprefixed HL transfers,
so both count, giving 698 rather than the 696 obtained by excluding that pair.

For the 8088, start with the 256 first-byte values in table 4-13 (printed
pages 4-27–4-35). Exclude 23 unused bytes (`0F`, `60`–`6F`, `C0`, `C1`, `C8`,
`C9`, `D6`, `F1`) and seven prefixes (`26`, `2E`, `36`, `3E`, `F0`, `F2`, `F3`),
leaving 226. Expand the ModR/M `reg` field where it selects an operation:

| First bytes | Documented operations per byte | Additional forms beyond one per byte |
| --- | --- | --- |
| `80`, `81` | 8 | 14 |
| `82`, `83` | 5: ADD, ADC, SBB, SUB, CMP | 8 |
| `D0`–`D3` | 7 rotations/shifts | 24 |
| `F6`, `F7` | 7 | 12 |
| `FE` | 2: INC, DEC | 1 |
| `FF` | 7 | 6 |
| **Total** | | **65** |

This gives **226 + 65 = 291**. In particular, the October 1979 decoding guide
marks `/1`, `/4`, and `/6` unused for `82` and `83`; it documents the five
arithmetic forms counted here. Register fields within the first opcode byte
are expanded, as on the other CPUs. ModR/M register and effective-address
choices are operands, as are displacements, immediate values, and the external
opcode carried by ESC. They do not add forms; a form remains partial until
all its documented operand choices work. Each ESC first byte `D8`–`DF` counts
once. AAM/AAD's fixed second byte does not add forms.

The 8088 count measures unprefixed forms. Segment overrides, LOCK, and repetition
are modifiers; their support is tracked separately rather than multiplying the
denominator by prefix combinations. Mnemonic aliases count once. Undocumented
encodings and later x86 instructions are excluded. Documented interrupt and
I/O instructions are included. External delivery and other lifecycle behavior
are tracked by the model milestones, rather than adding opcode forms.

For the 68000, the operation word contains both register and effective-address
selectors, so they contribute separate forms. Literal operands do not: MOVEQ
immediates, ADDQ/SUBQ and shift counts, branch displacements, and TRAP vectors
are collapsed. Index extension words and MOVEM register masks do not multiply
forms, but each form must support all its documented choices to be complete.
The [count audit](68000/opcode-count.md) gives the permitted address sets and
family arithmetic. MOVE and MOVEA supply 9,726 forms; the six immediate ALU
families supply 900 (six × three sizes × 50 destinations), and MOVEQ supplies
eight. BRA/BSR/Bcc supply 32 (sixteen operations × byte/word displacement),
DBcc supplies 128 (sixteen conditions × eight registers), and RTS supplies one.
ADD/SUB supply 4,816 (two × eight registers × (53 byte sources + 61 word
sources + 61 long sources + three sizes × 42 memory destinations)). CMP supplies
1,400 (eight × (53 + 61 + 61)); ADDA/SUBA/CMPA supply 2,928 (three × two sizes
× eight address registers × 61 sources). AND/OR supply 4,560 (two × three sizes
× eight registers × (53 sources + 42 memory destinations)); EOR supplies 1,200
(three sizes × eight source registers × 50 data-alterable destinations).
The eight MOVEQ forms accept 2,048 operation words; the 32 relative-branch
forms accept 4,096 words. Embedded literal values do not add coverage forms.

## Support shared by the current models

| Area | Implemented scope |
| --- | --- |
| Memory connection | Flat RAM with recorded byte reads and writes: 16 KiB for the 8008, 1 MiB for the 8088, 16 MiB for the 68000, 64 KiB for the other current models |
| Initialization | Explicit caller-supplied registers and flags, copied and validated; no implicit reset |
| Inspection | Detached state snapshots, recursively readonly in TypeScript, without RAM access |
| Stepping | At most one instruction attempt; before/after snapshots, fetched instruction bytes, ordered accesses, and outcome |
| Reset records | Separate before/after snapshots and access list; CPU-specific reset effects |
| Arithmetic and addresses | Results wrap at their modeled widths; 14-bit addresses for the 8008, 16-bit addresses for the other 8-bit cores; the 8088 forms 20-bit physical addresses from segments/offsets; the 68000 preserves 32-bit registers and masks bus addresses to 24 bits |
| Unsupported attempts | Each chapter defines rejection or exception delivery, including fetch and partial-effect boundaries; rejection is not a universal rollback guarantee |
| Lesson restart | Fresh CPU and RAM from the example factory |

All eight omit cycle counts and complete electrical/bus-cycle modeling.
External interrupt delivery follows each chapter's policies. Memory-mapped
devices can be connected through [machine memory maps](../machines/memory-map.md);
those surrounding components are separate from CPU opcode coverage. Detailed
limits, records, and lifecycle contracts belong in the specifications.

The following tables list the supported documented opcode forms.
Unlisted forms remain unsupported. Opcodes and addresses are hexadecimal;
instruction lengths are in bytes.

## 8008

[Specification and model contract](../../src/components/cpus/specifications/8008.md)

| Opcode | Instruction | Addressing form | Length | Scope |
| --- | --- | --- | --- | --- |
| `00` | HLT | Implied | 1 | Advance PC and stop; preserve flags |
| `01` | HLT | Implied | 1 | Second documented low-page HLT encoding |
| `02/0A/12/1A` | RLC / RRC / RAL / RAR | Accumulator | 1 | Circular or through-carry rotation; replace C and preserve S/Z/P |
| `03/0B/13/1B/23/2B/33/3B` | RFc / RTc | Conditional return | 1 | Test C/Z/S/P for false or true; advance the outgoing PC, then select the previous slot only when taken |
| `04/0C/14/1C/24/2C/34/3C` | ADI / ACI / SUI / SBI / NDI / XRI / ORI / CPI | Immediate | 2 | All eight ALU operations with a fetched operand; [flag rules](../../src/components/cpus/specifications/8008.md#eight-accumulator-operations) match register/memory forms |
| `05/0D/15/1D/25/2D/35/3D` | RST | Encoded vector | 1 | Call `0000/0008/0010/0018/0020/0028/0030/0038`, saving the address after the opcode in the circular stack |
| `06/0E/16/1E/26/2E/36` | LrI n | Immediate | 2 | Load A/B/C/D/E/H/L; preserve flags |
| `07` | RET | Implied | 1 | Select the preceding address slot; preserve flags |
| `08/10/18/20/28/30` | INr | Register B/C/D/E/H/L | 1 | Increment the selected byte; set S/Z/P and preserve C |
| `09/11/19/21/29/31` | DCr | Register B/C/D/E/H/L | 1 | Decrement the selected byte; set S/Z/P and preserve C |
| `0F` | RET | Implied | 1 | Documented RET alias |
| `17` | RET | Implied | 1 | Documented RET alias |
| `1F` | RET | Implied | 1 | Documented RET alias |
| `27` | RET | Implied | 1 | Documented RET alias |
| `2F` | RET | Implied | 1 | Documented RET alias |
| `37` | RET | Implied | 1 | Documented RET alias |
| `3E` | LMI n | Immediate byte to indirect memory | 2 | Fetch the byte, then write RAM at the low 14 bits of H:L; preserve flags |
| `3F` | RET | Implied | 1 | Documented RET alias |
| `40/48/50/58/60/68/70/78` | JFc / JTc addr | Conditional absolute | 3 | Fetch both address bytes on either path; replace PC only when the selected flag matches |
| `42/4A/52/5A/62/6A/72/7A` | CFc / CTc addr | Conditional absolute call | 3 | Fetch both address bytes on either path; preserve the fall-through PC and select the next slot only when taken |
| `44` | JMP addr | Absolute | 3 | Set PC to the 14-bit destination; preserve flags |
| `46` | CAL addr | Absolute | 3 | Save the return PC in its slot, select the next slot, and jump; preserve flags |
| `4C` | JMP addr | Absolute | 3 | Documented JMP alias |
| `4E` | CAL addr | Absolute | 3 | Documented CAL alias |
| `54` | JMP addr | Absolute | 3 | Documented JMP alias |
| `56` | CAL addr | Absolute | 3 | Documented CAL alias |
| `5C` | JMP addr | Absolute | 3 | Documented JMP alias |
| `5E` | CAL addr | Absolute | 3 | Documented CAL alias |
| `64` | JMP addr | Absolute | 3 | Documented JMP alias |
| `66` | CAL addr | Absolute | 3 | Documented CAL alias |
| `6C` | JMP addr | Absolute | 3 | Documented JMP alias |
| `6E` | CAL addr | Absolute | 3 | Documented CAL alias |
| `74` | JMP addr | Absolute | 3 | Documented JMP alias |
| `76` | CAL addr | Absolute | 3 | Documented CAL alias |
| `7C` | JMP addr | Absolute | 3 | Documented JMP alias |
| `7E` | CAL addr | Absolute | 3 | Documented CAL alias |
| `41`, `43`, …, `4F` | INP | Encoded port `00`–`07` | 1 | Read one byte into A; preserve flags |
| `51`, `53`, …, `7F` | OUT | Encoded port `08`–`1F` | 1 | Send A to one output port; preserve registers and flags |
| `80`–`87` | ADr / ADM | Register or indirect memory | 1 | Add the source to A, ignoring incoming C; set S/Z/P and carry out |
| `88`–`8F` | ACr / ACM | Register or indirect memory | 1 | Add the source and incoming C to A; set S/Z/P and carry out |
| `90`–`97` | SUr / SUM | Register or indirect memory | 1 | Subtract the source from A, ignoring incoming C; set S/Z/P and borrow |
| `98`–`9F` | SBr / SBM | Register or indirect memory | 1 | Subtract the source and incoming borrow from A; set S/Z/P and borrow |
| `A0`–`A7` | NDr / NDM | Register or indirect memory | 1 | AND with A; set S/Z/P and clear C |
| `A8`–`AF` | XRr / XRM | Register or indirect memory | 1 | XOR with A; set S/Z/P and clear C |
| `B0`–`B7` | ORr / ORM | Register or indirect memory | 1 | OR with A; set S/Z/P and clear C |
| `B8`–`BF` | CPr / CPM | Register or indirect memory | 1 | Set S/Z/P/C from A − source, ignoring incoming C; retain A |
| `C0`–`FE` | Lr1r2 / LrM / LMr | Register or indirect memory | 1 | All 49 register transfers, seven memory reads, and seven memory writes; preserve flags |
| `FF` | HLT | Implied | 1 | HLT occupies the M,M transfer slot |

These families contribute **8 immediate loads + 63 transfers + 3 HLT encodings +
48 jump/call/return forms + 72 ALU forms + 12 register adjustments + 4 rotations +
8 RST forms + 32 port forms = 250** complete forms. The jump/call/return total includes
24 unconditional encodings and 24 conditional forms. The eight INP and 24 OUT
encodings complete the documented opcode inventory; only six undefined bytes
remain unsupported.
External interrupt delivery is implemented separately from opcode coverage;
timing remains deferred.

See the [model checks and limitations](../../src/components/cpus/specifications/8008.md#checks-and-limits)
and [program specifications](../README.md#cpu-examples) for acceptance evidence.

## 8080

[Specification and model contract](../../src/components/cpus/specifications/8080.md)

The MOV row groups 63 forms: all B/C/D/E/H/L/M/A source and destination
combinations except M,M, whose encoding is HLT. M means memory at current HL.
The two three-bit selector fields use the order B, C, D, E, H, L, M, A.
Each register/memory ALU row groups eight forms with the same source-selector
order. Their immediate counterparts are listed separately. These accumulator ALU forms
update S/Z/AC/P/CY according to the
[8080 flag contract](../../src/components/cpus/specifications/8080.md#arithmetic-and-logical-flags). INR/DCR,
DCX, and DAD have distinct [flag and access rules](../../src/components/cpus/specifications/8080.md#word-arithmetic).

| Opcode | Instruction | Addressing form | Length | Scope |
| --- | --- | --- | --- | --- |
| `00` | `NOP` | Implied | 1 | Advance PC; preserve all other state; fetch only the opcode |
| `01` | `LXI B,nn` | Immediate | 3 | Load B:C; low byte then high; preserve flags |
| `02` | `STAX B` | Register indirect through BC | 1 | Store A; preserve pair and flags |
| `03` | `INX B` | Register pair | 1 | Increment B:C with 16-bit wrapping; preserve flags |
| `04` | `INR B` | Register | 1 | Increment byte; update S/Z/AC/P; preserve CY |
| `05` | `DCR B` | Register | 1 | Decrement byte; update S/Z/AC/P; preserve CY |
| `06` | `MVI B,n` | Immediate | 2 | Load B; preserve flags |
| `07` | `RLC` | Implied | 1 | Rotate A left circularly; update only CY |
| `09` | `DAD B` | Register pair | 1 | Add to HL with 16-bit wrapping; update only CY |
| `0A` | `LDAX B` | Register indirect through BC | 1 | Load A; preserve pair and flags |
| `0B` | `DCX B` | Register pair | 1 | Decrement with 16-bit wrapping; preserve flags |
| `0C` | `INR C` | Register | 1 | Increment byte; update S/Z/AC/P; preserve CY |
| `0D` | `DCR C` | Register | 1 | Decrement byte; update S/Z/AC/P; preserve CY |
| `0E` | `MVI C,n` | Immediate | 2 | Load C; preserve flags |
| `0F` | `RRC` | Implied | 1 | Rotate A right circularly; update only CY |
| `11` | `LXI D,nn` | Immediate | 3 | Load D:E; low byte then high; preserve flags |
| `12` | `STAX D` | Register indirect through DE | 1 | Store A; preserve pair and flags |
| `13` | `INX D` | Register pair | 1 | Increment D:E with 16-bit wrapping; preserve flags |
| `14` | `INR D` | Register | 1 | Increment byte; update S/Z/AC/P; preserve CY |
| `15` | `DCR D` | Register | 1 | Decrement byte; update S/Z/AC/P; preserve CY |
| `16` | `MVI D,n` | Immediate | 2 | Load D; preserve flags |
| `17` | `RAL` | Implied | 1 | Rotate A left through carry; update only CY |
| `19` | `DAD D` | Register pair | 1 | Add to HL with 16-bit wrapping; update only CY |
| `1A` | `LDAX D` | Register indirect through DE | 1 | Load A; preserve pair and flags |
| `1B` | `DCX D` | Register pair | 1 | Decrement with 16-bit wrapping; preserve flags |
| `1C` | `INR E` | Register | 1 | Increment byte; update S/Z/AC/P; preserve CY |
| `1D` | `DCR E` | Register | 1 | Decrement byte; update S/Z/AC/P; preserve CY |
| `1E` | `MVI E,n` | Immediate | 2 | Load E; preserve flags |
| `1F` | `RAR` | Implied | 1 | Rotate A right through carry; update only CY |
| `21` | `LXI H,nn` | Immediate | 3 | Load H:L; low byte then high; preserve flags |
| `22` | `SHLD addr` | Direct memory address | 3 | Store L then H at consecutive wrapped addresses; preserve flags |
| `23` | `INX H` | Register pair | 1 | Increment H:L with 16-bit wrapping; preserve flags |
| `24` | `INR H` | Register | 1 | Increment byte; update S/Z/AC/P; preserve CY |
| `25` | `DCR H` | Register | 1 | Decrement byte; update S/Z/AC/P; preserve CY |
| `26` | `MVI H,n` | Immediate | 2 | Load H; preserve flags |
| `27` | `DAA` | Implied | 1 | Decimal-adjust A using incoming AC/CY; replace S/Z/AC/P/CY |
| `29` | `DAD H` | Register pair | 1 | Add to HL with 16-bit wrapping; update only CY |
| `2A` | `LHLD addr` | Direct memory address | 3 | Load L then H from consecutive wrapped addresses; preserve flags |
| `2B` | `DCX H` | Register pair | 1 | Decrement with 16-bit wrapping; preserve flags |
| `2C` | `INR L` | Register | 1 | Increment byte; update S/Z/AC/P; preserve CY |
| `2D` | `DCR L` | Register | 1 | Decrement byte; update S/Z/AC/P; preserve CY |
| `2E` | `MVI L,n` | Immediate | 2 | Load L; preserve flags |
| `2F` | `CMA` | Implied | 1 | Complement A; preserve every flag |
| `31` | `LXI SP,nn` | Immediate | 3 | Load SP; low byte then high; preserve flags |
| `32` | `STA addr` | Direct memory address | 3 | Store A; address bytes low then high |
| `33` | `INX SP` | Register pair | 1 | Increment SP with 16-bit wrapping; preserve flags |
| `34` | `INR M` | Memory through HL | 1 | Increment byte; update S/Z/AC/P; preserve CY |
| `35` | `DCR M` | Memory through HL | 1 | Decrement byte; update S/Z/AC/P; preserve CY |
| `36` | `MVI M,n` | Immediate | 2 | Load memory at HL; preserve flags |
| `37` | `STC` | Implied | 1 | Set CY; preserve A and other flags |
| `39` | `DAD SP` | Register pair | 1 | Add to HL with 16-bit wrapping; update only CY |
| `3A` | `LDA addr` | Direct memory address | 3 | Load A; address bytes low then high; preserve flags |
| `3B` | `DCX SP` | Register pair | 1 | Decrement with 16-bit wrapping; preserve flags |
| `3C` | `INR A` | Register | 1 | Increment byte; update S/Z/AC/P; preserve CY |
| `3D` | `DCR A` | Register | 1 | Decrement byte; update S/Z/AC/P; preserve CY |
| `3E` | `MVI A,n` | Immediate | 2 | Load A; preserve flags |
| `3F` | `CMC` | Implied | 1 | Complement CY; preserve A and other flags |
| `40–75`, `77–7F` | `MOV dst,src` | Register or indirect through HL | 1 | All 63 forms; read source before writing destination; preserve flags |
| `76` | `HLT` | Implied | 1 | Advance PC and enter halted state |
| `80–87` | `ADD r` | Register or memory through HL | 1 | Add to A without incoming carry |
| `88–8F` | `ADC r` | Register or memory through HL | 1 | Add to A with incoming carry |
| `90–97` | `SUB r` | Register or memory through HL | 1 | Subtract from A without incoming borrow |
| `98–9F` | `SBB r` | Register or memory through HL | 1 | Subtract from A with incoming borrow |
| `A0–A7` | `ANA r` | Register or memory through HL | 1 | AND with A; clear CY; AC is bit 3 of A OR operand |
| `A8–AF` | `XRA r` | Register or memory through HL | 1 | XOR with A; clear AC and CY |
| `B0–B7` | `ORA r` | Register or memory through HL | 1 | OR with A; clear AC and CY |
| `B8–BF` | `CMP r` | Register or memory through HL | 1 | Subtraction flags without incoming borrow; preserve A |
| `C0` | `RNZ` | Stack | 1 | Return if Z = 0 |
| `C1` | `POP B` | Stack | 1 | Read low then high into B:C; increment SP by 2; preserve flags |
| `C2` | `JNZ addr` | Absolute target | 3 | Jump if Z = 0 |
| `C3` | `JMP addr` | Absolute target | 3 | Replace PC with target |
| `C4` | `CNZ addr` | Absolute target / stack | 3 | Call if Z = 0 |
| `C5` | `PUSH B` | Stack | 1 | Write B:C high then low; decrement SP by 2; preserve flags |
| `C6` | `ADI n` | Immediate | 2 | Add to A without incoming carry |
| `C7` | `RST 0` | Encoded vector / stack | 1 | Push following PC; jump to `0000`; preserve interrupt enable |
| `C8` | `RZ` | Stack | 1 | Return if Z = 1 |
| `C9` | `RET` | Stack | 1 | Pop PC low then high |
| `CA` | `JZ addr` | Absolute target | 3 | Jump if Z = 1 |
| `CC` | `CZ addr` | Absolute target / stack | 3 | Call if Z = 1 |
| `CD` | `CALL addr` | Absolute target / stack | 3 | Push following PC, then jump to target |
| `CE` | `ACI n` | Immediate | 2 | Add to A with incoming carry |
| `CF` | `RST 1` | Encoded vector / stack | 1 | Push following PC; jump to `0008`; preserve interrupt enable |
| `D0` | `RNC` | Stack | 1 | Return if CY = 0 |
| `D1` | `POP D` | Stack | 1 | Read low then high into D:E; increment SP by 2; preserve flags |
| `D2` | `JNC addr` | Absolute target | 3 | Jump if CY = 0 |
| `D3` | `OUT n` | Immediate port | 2 | Write A to the selected byte port; preserve flags |
| `D4` | `CNC addr` | Absolute target / stack | 3 | Call if CY = 0 |
| `D5` | `PUSH D` | Stack | 1 | Write D:E high then low; decrement SP by 2; preserve flags |
| `D6` | `SUI n` | Immediate | 2 | Subtract from A without incoming borrow |
| `D7` | `RST 2` | Encoded vector / stack | 1 | Push following PC; jump to `0010`; preserve interrupt enable |
| `D8` | `RC` | Stack | 1 | Return if CY = 1 |
| `DA` | `JC addr` | Absolute target | 3 | Jump if CY = 1 |
| `DB` | `IN n` | Immediate port | 2 | Read the selected byte port into A; preserve flags |
| `DC` | `CC addr` | Absolute target / stack | 3 | Call if CY = 1 |
| `DE` | `SBI n` | Immediate | 2 | Subtract from A with incoming borrow |
| `DF` | `RST 3` | Encoded vector / stack | 1 | Push following PC; jump to `0018`; preserve interrupt enable |
| `E0` | `RPO` | Stack | 1 | Return if P = 0 |
| `E1` | `POP H` | Stack | 1 | Read low then high into H:L; increment SP by 2; preserve flags |
| `E2` | `JPO addr` | Absolute target | 3 | Jump if P = 0 |
| `E3` | `XTHL` | Stack | 1 | Exchange HL with the word at SP; preserve SP and flags |
| `E4` | `CPO addr` | Absolute target / stack | 3 | Call if P = 0 |
| `E5` | `PUSH H` | Stack | 1 | Write H:L high then low; decrement SP by 2; preserve flags |
| `E6` | `ANI n` | Immediate | 2 | AND with A; clear CY; AC is bit 3 of A OR operand |
| `E7` | `RST 4` | Encoded vector / stack | 1 | Push following PC; jump to `0020`; preserve interrupt enable |
| `E8` | `RPE` | Stack | 1 | Return if P = 1 |
| `E9` | `PCHL` | Register indirect through HL | 1 | Replace PC with current HL; no data read |
| `EA` | `JPE addr` | Absolute target | 3 | Jump if P = 1 |
| `EB` | `XCHG` | Register pairs | 1 | Exchange DE and HL; preserve flags |
| `EC` | `CPE addr` | Absolute target / stack | 3 | Call if P = 1 |
| `EE` | `XRI n` | Immediate | 2 | XOR with A; clear AC and CY |
| `EF` | `RST 5` | Encoded vector / stack | 1 | Push following PC; jump to `0028`; preserve interrupt enable |
| `F0` | `RP` | Stack | 1 | Return if S = 0 |
| `F1` | `POP PSW` | Stack | 1 | Read flags then A; ignore reserved flag bits; increment SP by 2 |
| `F2` | `JP addr` | Absolute target | 3 | Jump if S = 0 |
| `F3` | `DI` | Implied | 1 | Clear interrupt enable and any EI deferral; preserve flags |
| `F4` | `CP addr` | Absolute target / stack | 3 | Call if S = 0 |
| `F5` | `PUSH PSW` | Stack | 1 | Write A then packed flags; decrement SP by 2; preserve A and flags |
| `F6` | `ORI n` | Immediate | 2 | OR with A; clear AC and CY |
| `F7` | `RST 6` | Encoded vector / stack | 1 | Push following PC; jump to `0030`; preserve interrupt enable |
| `F8` | `RM` | Stack | 1 | Return if S = 1 |
| `F9` | `SPHL` | Register pair | 1 | Copy HL to SP; preserve HL and flags |
| `FA` | `JM addr` | Absolute target | 3 | Jump if S = 1 |
| `FB` | `EI` | Implied | 1 | Set interrupt enable; defer acceptance through the following instruction; preserve flags |
| `FC` | `CM addr` | Absolute target / stack | 3 | Call if S = 1 |
| `FE` | `CPI n` | Immediate | 2 | Subtraction flags without incoming borrow; preserve A |
| `FF` | `RST 7` | Encoded vector / stack | 1 | Push following PC; jump to `0038`; preserve interrupt enable |

See the [model checks and limitations](../../src/components/cpus/specifications/8080.md#checks-and-examples)
and [program specifications](../README.md#cpu-examples) for acceptance evidence.

## 6800

[Specification and model contract](../../src/components/cpus/specifications/6800.md)

**197 of 197 documented forms are complete (100%).** The accumulator families
below contribute 86 forms: ten byte-read operations for both A/B across four
addressing modes, plus three stores for each accumulator. Unary operations
contribute 44 forms, word transfers and CPX contribute 18, and the final table
contains 15 short branches plus 34 other forms, including CLI, SEI, WAI, SWI,
and RTI. Explicit IRQ/NMI delivery supports native frames and vectors, masked
offers, and WAI wake-up. The 6800 has no separate port-I/O opcodes; mapped
devices, external HALT, look-ahead, and cycle timing remain outside the model.

All documented forms of LDAA/LDAB, STAA/STAB, ADDA/ADDB, ADCA/ADCB,
SUBA/SUBB, SBCA/SBCB, CMPA/CMPB, ANDA/ANDB, BITA/BITB, EORA/EORB, and
ORAA/ORAB are implemented. Direct operands address page zero; indexed operands
add an unsigned byte to X and wrap at 16 bits. Extended addresses are high byte
first. A dash means there is no documented form on the original 6800.

| Instruction | Immediate | Direct | Indexed | Extended |
| --- | --- | --- | --- | --- |
| Length | 2 | 2 | 2 | 3 |
| SUBA | `80` | `90` | `A0` | `B0` |
| SUBB | `C0` | `D0` | `E0` | `F0` |
| CMPA | `81` | `91` | `A1` | `B1` |
| CMPB | `C1` | `D1` | `E1` | `F1` |
| SBCA | `82` | `92` | `A2` | `B2` |
| SBCB | `C2` | `D2` | `E2` | `F2` |
| ANDA | `84` | `94` | `A4` | `B4` |
| ANDB | `C4` | `D4` | `E4` | `F4` |
| BITA | `85` | `95` | `A5` | `B5` |
| BITB | `C5` | `D5` | `E5` | `F5` |
| LDAA | `86` | `96` | `A6` | `B6` |
| LDAB | `C6` | `D6` | `E6` | `F6` |
| STAA | — | `97` | `A7` | `B7` |
| STAB | — | `D7` | `E7` | `F7` |
| EORA | `88` | `98` | `A8` | `B8` |
| EORB | `C8` | `D8` | `E8` | `F8` |
| ADCA | `89` | `99` | `A9` | `B9` |
| ADCB | `C9` | `D9` | `E9` | `F9` |
| ORAA | `8A` | `9A` | `AA` | `BA` |
| ORAB | `CA` | `DA` | `EA` | `FA` |
| ADDA | `8B` | `9B` | `AB` | `BB` |
| ADDB | `CB` | `DB` | `EB` | `FB` |

Unary encodings use **`01 tt oooo`**: `tt=00/01/10/11` selects A/B/indexed/extended;
`oooo` selects the operation. Accumulator forms are one byte, indexed two,
extended three. The original 6800 has no direct-page unary forms. All preserve
H/I, and memory forms preserve both accumulators and X/SP.

| Operation | A | B | Indexed | Extended | Flag effects |
| --- | --- | --- | --- | --- | --- |
| NEG | `40` | `50` | `60` | `70` | N/Z/V/C from subtraction from zero |
| COM | `43` | `53` | `63` | `73` | N/Z; V=0, C=1 |
| LSR | `44` | `54` | `64` | `74` | N=0; Z/C from shift, V=C |
| ROR | `46` | `56` | `66` | `76` | N/Z/C from rotation through C; V=N XOR C |
| ASR | `47` | `57` | `67` | `77` | Preserve sign; N/Z/C from shift, V=N XOR C |
| ASL | `48` | `58` | `68` | `78` | N/Z/C from shift; V=N XOR C |
| ROL | `49` | `59` | `69` | `79` | N/Z/C from rotation through C; V=N XOR C |
| DEC | `4A` | `5A` | `6A` | `7A` | N/Z/V; preserve C |
| INC | `4C` | `5C` | `6C` | `7C` | N/Z/V; preserve C |
| TST | `4D` | `5D` | `6D` | `7D` | N/Z from operand; V=0, C=0; no write |
| CLR | `4F` | `5F` | `6F` | `7F` | N=0, Z=1, V=0, C=0 |

The [unary model contract](../../src/components/cpus/specifications/6800.md#unary-byte-operations) defines memory-access
records and the flag differences from the 6809. JMP occupies `oooo=1110` in
the two memory groups and uses the address without reading target data.

Word transfers set N/Z from the full word and clear V, preserving H/I/C.
CPX sets Z from whole-word equality and N/V from the separate high-byte
subtraction, with no low-byte borrow; C is preserved. All word memory
accesses are high byte first and wrap across `FFFF`, while a direct word at
`00FF` continues at `0100`.

| Instruction | Immediate | Direct | Indexed | Extended |
| --- | --- | --- | --- | --- |
| Length | 3 | 2 | 2 | 3 |
| CPX | `8C` | `9C` | `AC` | `BC` |
| LDS | `8E` | `9E` | `AE` | `BE` |
| STS | — | `9F` | `AF` | `BF` |
| LDX | `CE` | `DE` | `EE` | `FE` |
| STX | — | `DF` | `EF` | `FF` |

| Opcode | Instruction | Addressing form | Length | Scope |
| --- | --- | --- | --- | --- |
| `01` | NOP | Inherent | 1 | Advance PC only |
| `06` | TAP | Inherent | 1 | Replace H/I/N/Z/V/C from A bits 5–0 |
| `07` | TPA | Inherent | 1 | Pack flags into A with bits 7–6 set; preserve flags |
| `08` / `09` | INX / DEX | Inherent | 1 | Adjust X by one, wrapping at 16 bits; replace only Z |
| `0A` / `0B` | CLV / SEV | Inherent | 1 | Clear/set V; preserve other flags |
| `0C` / `0D` | CLC / SEC | Inherent | 1 | Clear/set C; preserve other flags |
| `0E` / `0F` | CLI / SEI | Inherent | 1 | Clear/set I; preserve other flags |
| `10` | SBA | Inherent | 1 | A − B into A; set N/Z/V/C, preserve H/I/B |
| `11` | CBA | Inherent | 1 | Compare A − B without writeback; set N/Z/V/C, preserve H/I |
| `16` | TAB | Inherent | 1 | Copy A to B; set N/Z, clear V, preserve H/I/C |
| `17` | TBA | Inherent | 1 | Copy B to A; set N/Z, clear V, preserve H/I/C |
| `19` | DAA | Inherent | 1 | Correct A after packed-BCD addition; set N/Z/C, preserve H/I, clear undefined V as [model policy](../../src/components/cpus/specifications/6800.md#decimal-adjustment) |
| `1B` | ABA | Inherent | 1 | A + B into A; set H/N/Z/V/C, preserve I/B |
| `20` | BRA rel | Relative | 2 | Always branch |
| `22` | BHI rel | Relative | 2 | Branch if C = 0 and Z = 0 |
| `23` | BLS rel | Relative | 2 | Branch if C = 1 or Z = 1 |
| `24` | BCC rel | Relative | 2 | Branch if C = 0 |
| `25` | BCS rel | Relative | 2 | Branch if C = 1 |
| `26` | BNE rel | Relative | 2 | Branch if Z = 0 |
| `27` | BEQ rel | Relative | 2 | Branch if Z = 1 |
| `28` | BVC rel | Relative | 2 | Branch if V = 0 |
| `29` | BVS rel | Relative | 2 | Branch if V = 1 |
| `2A` | BPL rel | Relative | 2 | Branch if N = 0 |
| `2B` | BMI rel | Relative | 2 | Branch if N = 1 |
| `2C` | BGE rel | Relative | 2 | Branch if N = V |
| `2D` | BLT rel | Relative | 2 | Branch if N ≠ V |
| `2E` | BGT rel | Relative | 2 | Branch if Z = 0 and N = V |
| `2F` | BLE rel | Relative | 2 | Branch if Z = 1 or N ≠ V |
| `30` | TSX | Inherent | 1 | X = SP + 1, wrapping at 16 bits; preserve flags |
| `31` | INS | Inherent | 1 | Increment SP without a data access; preserve flags |
| `32` | PULA | Inherent | 1 | Increment SP, then read A; preserve all flags |
| `33` | PULB | Inherent | 1 | Increment SP, then read B; preserve all flags |
| `34` | DES | Inherent | 1 | Decrement SP without a data access; preserve flags |
| `35` | TXS | Inherent | 1 | SP = X − 1, wrapping at 16 bits; preserve flags |
| `36` | PSHA | Inherent | 1 | Write A at SP, then decrement SP; preserve all flags |
| `37` | PSHB | Inherent | 1 | Write B at SP, then decrement SP; preserve all flags |
| `39` | RTS | Inherent | 1 | Pull return address high byte first; preserve all flags |
| `3B` | RTI | Inherent | 1 | Pull CC, B, A, X high/low, PC high/low from current stack RAM |
| `3E` | WAI | Inherent | 1 | Save full frame and wait; preserve I; accepted delivery reuses the frame |
| `3F` | SWI | Inherent | 1 | Save full frame with original I, set I, and enter through FFFA/FFFB |
| `6E` / `7E` | JMP | Indexed / extended | 2 / 3 | Set PC to the resolved address without a target read; preserve flags |
| `8D` | BSR rel | Relative | 2 | Push return PC low byte first, then branch relative to it; preserve flags |
| `AD` | JSR offset,X | Indexed | 2 | Resolve original X + unsigned offset, push return PC low byte first, and jump; preserve flags |
| `BD` | JSR addr | Extended | 3 | Push return PC low byte first, then jump to the high-byte-first target; preserve flags |

Opcode `21` is unused on the original 6800 and remains unsupported. It is not
the 6809's BRN instruction.

See the [model checks and limitations](../../src/components/cpus/specifications/6800.md#checks-and-examples)
and [program specifications](../README.md#cpu-examples) for acceptance evidence.

## 6502

[Specification and model contract](../../src/components/cpus/specifications/6502.md)

**All 151 documented forms are complete (100%).** The accumulator families
below contribute 63 forms; X/Y loads and stores contribute 16; shifts, rotates,
and memory INC/DEC contribute 28; CPX/CPY/BIT contribute 8. The remaining 36
complete forms appear in the final instruction table. BRK/RTI/CLI/SEI now
complete that inventory; IRQ/NMI delivery uses an explicit boundary-offer policy.

All documented addressing forms of ORA, AND, EOR, ADC, SBC, CMP, LDA, STA, LDX, LDY,
STX, STY, ASL, LSR, ROL, ROR, INC, DEC, CPX, CPY, and BIT are implemented.
A dash in these matrices means the original 6502 has no such form, rather than an implementation
gap. Length includes the opcode; absolute operands are low byte first.

| Instruction | `(zp,X)` | `zp` | `#n` | `addr` | `(zp),Y` | `zp,X` | `addr,Y` | `addr,X` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Length | 2 | 2 | 2 | 3 | 2 | 2 | 3 | 3 |
| ORA | `01` | `05` | `09` | `0D` | `11` | `15` | `19` | `1D` |
| AND | `21` | `25` | `29` | `2D` | `31` | `35` | `39` | `3D` |
| EOR | `41` | `45` | `49` | `4D` | `51` | `55` | `59` | `5D` |
| ADC | `61` | `65` | `69` | `6D` | `71` | `75` | `79` | `7D` |
| STA | `81` | `85` | — | `8D` | `91` | `95` | `99` | `9D` |
| LDA | `A1` | `A5` | `A9` | `AD` | `B1` | `B5` | `B9` | `BD` |
| CMP | `C1` | `C5` | `C9` | `CD` | `D1` | `D5` | `D9` | `DD` |
| SBC | `E1` | `E5` | `E9` | `ED` | `F1` | `F5` | `F9` | `FD` |

| Instruction | `#n` | `zp` | `addr` | `zp,X` | `zp,Y` | `addr,X` | `addr,Y` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Length | 2 | 2 | 3 | 2 | 2 | 3 | 3 |
| LDY | `A0` | `A4` | `AC` | `B4` | — | `BC` | — |
| LDX | `A2` | `A6` | `AE` | — | `B6` | — | `BE` |
| STY | — | `84` | `8C` | `94` | — | — | — |
| STX | — | `86` | `8E` | — | `96` | — | — |

| Instruction | `A` | `zp` | `addr` | `zp,X` | `addr,X` |
| --- | --- | --- | --- | --- | --- |
| Length | 1 | 2 | 3 | 2 | 3 |
| ASL | `0A` | `06` | `0E` | `16` | `1E` |
| ROL | `2A` | `26` | `2E` | `36` | `3E` |
| LSR | `4A` | `46` | `4E` | `56` | `5E` |
| ROR | `6A` | `66` | `6E` | `76` | `7E` |
| DEC | — | `C6` | `CE` | `D6` | `DE` |
| INC | — | `E6` | `EE` | `F6` | `FE` |

| Instruction | `#n` | `zp` | `addr` |
| --- | --- | --- | --- |
| Length | 2 | 2 | 3 |
| CPY | `C0` | `C4` | `CC` |
| CPX | `E0` | `E4` | `EC` |
| BIT | — | `24` | `2C` |

| Opcode | Instruction | Addressing form | Length | Scope |
| --- | --- | --- | --- | --- |
| `00` | `BRK` | Implied / stack | 1 | Consume padding; push PC after both bytes and NV11DIZC; set I and read the IRQ/BRK vector |
| `08` | `PHP` | Implied / stack | 1 | Push NV11DIZC at 0100 + SP, then decrement SP; preserve flags |
| `10` | `BPL rel` | Relative | 2 | Branch if N = 0 |
| `18` | `CLC` | Implied | 1 | Clear carry |
| `20` | `JSR addr` | Absolute / stack | 3 | Fetch target low; push the last operand's address high then low; fetch target high and jump |
| `28` | `PLP` | Implied / stack | 1 | Increment SP, then restore N/V/D/I/Z/C from the stacked byte; ignore bits 5/4 |
| `30` | `BMI rel` | Relative | 2 | Branch if N = 1 |
| `38` | `SEC` | Implied | 1 | Set carry; preserve other flags |
| `40` | `RTI` | Implied / stack | 1 | Pull status, PC low, PC high; ignore status bits 5/4; return without incrementing PC |
| `48` | `PHA` | Implied | 1 | Write A at 0100 + SP, then decrement 8-bit SP; preserve flags |
| `4C` | `JMP addr` | Absolute | 3 | Set PC from a low/high target; preserve flags |
| `50` | `BVC rel` | Relative | 2 | Branch if V = 0 |
| `58` | `CLI` | Implied | 1 | Clear I; preserve other flags |
| `60` | `RTS` | Implied / stack | 1 | Pull PC low then high and add one with 16-bit wrapping; preserve flags |
| `68` | `PLA` | Implied | 1 | Increment 8-bit SP, then read A at 0100 + SP; update N/Z |
| `6C` | `JMP (addr)` | Absolute indirect | 3 | Read target low/high from a pointer whose high-byte read stays on the same page; preserve flags |
| `70` | `BVS rel` | Relative | 2 | Branch if V = 1 |
| `78` | `SEI` | Implied | 1 | Set I; preserve other flags |
| `88` | `DEY` | Implied | 1 | Decrement Y; update N/Z |
| `8A` | `TXA` | Implied | 1 | Copy X to A; update N/Z |
| `90` | `BCC rel` | Relative | 2 | Branch if C = 0 |
| `98` | `TYA` | Implied | 1 | Copy Y to A; update N/Z |
| `9A` | `TXS` | Implied | 1 | Copy X to SP; preserve every flag |
| `A8` | `TAY` | Implied | 1 | Copy A to Y; update N/Z |
| `AA` | `TAX` | Implied | 1 | Copy A to X; update N/Z |
| `B0` | `BCS rel` | Relative | 2 | Branch if C = 1 |
| `B8` | `CLV` | Implied | 1 | Clear overflow; preserve other flags |
| `BA` | `TSX` | Implied | 1 | Copy SP to X; update N/Z |
| `C8` | `INY` | Implied | 1 | Increment Y; update N/Z |
| `CA` | `DEX` | Implied | 1 | Decrement X; update N/Z |
| `D0` | `BNE rel` | Relative | 2 | Branch if Z = 0 |
| `D8` | `CLD` | Implied | 1 | Clear decimal mode; preserve other flags |
| `E8` | `INX` | Implied | 1 | Increment X; update N/Z |
| `EA` | `NOP` | Implied | 1 | Advance PC only |
| `F0` | `BEQ rel` | Relative | 2 | Branch if Z = 1 |
| `F8` | `SED` | Implied | 1 | Set decimal mode; preserve other flags |

BRK has a one-byte opcode and consumes a following padding byte. Its
instruction record contains both fetched bytes; the saved PC advances by two.

See the [model checks and limitations](../../src/components/cpus/specifications/6502.md#checks-and-examples)
and [program specifications](../README.md#cpu-examples) for acceptance evidence.

## 6809

[Specification and model contract](../../src/components/cpus/specifications/6809.md)

**268 / 268 forms (100%).** All documented forms are complete: 221 on the
base page, 38 on page 2 (`10`), and nine on page 3 (`11`). IRQ/FIRQ/NMI delivery
uses explicit boundary offers, with full/short frames, wait modes, and NMI arming.
There are no separate port-I/O forms. Mapped devices and timing remain outside
the model. All 56 indexed forms support every documented postbyte.

The totals comprise 86 accumulator forms, 55 unary forms, 35 word transfers,
28 word arithmetic/comparison forms, 16 short and 15 prefixed long branches,
four register-mask stack transfers, six calls/returns, three JMP forms,
LBRA, NOP, the 12 additional inherent/status/register forms below, and six
interrupt/wait forms:

| Opcode | Instruction | Behavior |
| --- | --- | --- |
| `13` | SYNC | Wait; masked IRQ/FIRQ resume without vector entry |
| `3B` | RTI | Restore CC, then the full or short frame selected by saved E |
| `3C` | CWAI #mask | Mask CC, set E, save the entire frame, and wait for acceptance |
| `3F` | SWI | Entire frame, set F/I, vector `FFFA` |
| `10 3F` | SWI2 | Entire frame, preserve masks, vector `FFF4` |
| `11 3F` | SWI3 | Entire frame, preserve masks, vector `FFF2` |

Accumulator opcodes use **`1 r mm oooo`**: `r=0` selects A, `r=1` selects B;
`mm=00/01/10/11` selects immediate/direct/indexed/extended addressing.
Each cell below lists A/B opcodes; immediate/direct instructions are two bytes,
extended instructions three, and indexed instructions two to four.
Stores have no immediate form.

| Operation | Immediate A/B | Direct A/B | Indexed A/B | Extended A/B | Flag effects |
| --- | --- | --- | --- | --- | --- |
| SUB | `80` / `C0` | `90` / `D0` | `A0` / `E0` | `B0` / `F0` | N/Z/V/C; C records borrow |
| CMP | `81` / `C1` | `91` / `D1` | `A1` / `E1` | `B1` / `F1` | Subtraction flags without changing the accumulator |
| SBC | `82` / `C2` | `92` / `D2` | `A2` / `E2` | `B2` / `F2` | N/Z/V/C; subtract incoming borrow |
| AND | `84` / `C4` | `94` / `D4` | `A4` / `E4` | `B4` / `F4` | N/Z from result; V cleared |
| BIT | `85` / `C5` | `95` / `D5` | `A5` / `E5` | `B5` / `F5` | AND flags without changing the accumulator |
| LD | `86` / `C6` | `96` / `D6` | `A6` / `E6` | `B6` / `F6` | N/Z from loaded byte; V cleared |
| ST | — | `97` / `D7` | `A7` / `E7` | `B7` / `F7` | N/Z from stored byte; V cleared |
| EOR | `88` / `C8` | `98` / `D8` | `A8` / `E8` | `B8` / `F8` | N/Z from result; V cleared |
| ADC | `89` / `C9` | `99` / `D9` | `A9` / `E9` | `B9` / `F9` | H/N/Z/V/C; include incoming carry |
| OR | `8A` / `CA` | `9A` / `DA` | `AA` / `EA` | `BA` / `FA` | N/Z from result; V cleared |
| ADD | `8B` / `CB` | `9B` / `DB` | `AB` / `EB` | `BB` / `FB` | H/N/Z/V/C; ignore incoming carry |

Unary encodings use **`0000 oooo`** (direct), **`010r oooo`** (A/B),
**`0110 oooo`** (indexed), or **`0111 oooo`** (extended). Register forms are
one byte, direct two, indexed two to four, and extended three. ASL/LSL is one
encoding per form.

| Operation | Direct | A | B | Indexed | Extended | Flag effects |
| --- | --- | --- | --- | --- | --- | --- |
| NEG | `00` | `40` | `50` | `60` | `70` | N/Z/V/C; negate modulo 256 |
| COM | `03` | `43` | `53` | `63` | `73` | N/Z; V=0, C=1 |
| LSR | `04` | `44` | `54` | `64` | `74` | N/Z/C; preserve V |
| ROR | `06` | `46` | `56` | `66` | `76` | N/Z/C; rotate through C, preserve V |
| ASR | `07` | `47` | `57` | `67` | `77` | N/Z/C; retain sign and preserve V |
| ASL / LSL | `08` | `48` | `58` | `68` | `78` | N/Z/V/C |
| ROL | `09` | `49` | `59` | `69` | `79` | N/Z/V/C; rotate through C |
| DEC | `0A` | `4A` | `5A` | `6A` | `7A` | N/Z/V; preserve C |
| INC | `0C` | `4C` | `5C` | `6C` | `7C` | N/Z/V; preserve C |
| TST | `0D` | `4D` | `5D` | `6D` | `7D` | N/Z; V=0, preserve C; no write |
| CLR | `0F` | `4F` | `5F` | `6F` | `7F` | N=0, Z=1, V=0, C=0; memory forms read then write |

E/F/I are preserved by these byte operations. H changes only for ADD/ADC;
where Motorola leaves H undefined, this model preserves it. Exact behavior
and memory-access rules are in the [model contract](../../src/components/cpus/specifications/6809.md#arithmetic).

| Opcode | Instruction | Addressing form | Length | Scope |
| --- | --- | --- | --- | --- |
| `0E` / `6E` / `7E` | `JMP` | Direct / indexed / extended | 2 / 2–4 / 3 | Replace PC without reading the target |
| `12` | `NOP` | Inherent | 1 | Advance PC only |
| `16` | `LBRA rel16` | Long relative | 3 | Add signed word to PC after the operand |
| `17` | `LBSR rel16` | Long relative | 3 | Stack return PC on S and branch |
| `19` | `DAA` | Inherent | 1 | Adjust A after BCD addition; N/Z/C, preserve H, clear undefined V under model policy |
| `1A` / `1C` | `ORCC` / `ANDCC` | Immediate | 2 | Combine packed CC with the immediate byte; replace all eight flags |
| `1D` | `SEX` | Inherent | 1 | Sign-extend B into D; replace N/Z, preserve V and other flags |
| `1E` / `1F` | `EXG` / `TFR` | Register postbyte | 2 | Exchange/transfer any documented same-width pair; includes D, PC, and CC |
| `20` | `BRA rel` | Short relative | 2 | Branch always |
| `21` | `BRN rel` | Short relative | 2 | Branch never; fetch displacement and advance PC |
| `22` | `BHI rel` | Short relative | 2 | Branch if C = 0 and Z = 0 |
| `23` | `BLS rel` | Short relative | 2 | Branch if C = 1 or Z = 1 |
| `24` | `BCC rel` / `BHS rel` | Short relative | 2 | Branch if C = 0; aliases count once |
| `25` | `BCS rel` / `BLO rel` | Short relative | 2 | Branch if C = 1; aliases count once |
| `26` | `BNE rel` | Short relative | 2 | Branch if Z = 0 |
| `27` | `BEQ rel` | Short relative | 2 | Branch if Z = 1 |
| `28` | `BVC rel` | Short relative | 2 | Branch if V = 0 |
| `29` | `BVS rel` | Short relative | 2 | Branch if V = 1 |
| `2A` | `BPL rel` | Short relative | 2 | Branch if N = 0 |
| `2B` | `BMI rel` | Short relative | 2 | Branch if N = 1 |
| `2C` | `BGE rel` | Short relative | 2 | Branch if N = V |
| `2D` | `BLT rel` | Short relative | 2 | Branch if N ≠ V |
| `2E` | `BGT rel` | Short relative | 2 | Branch if Z = 0 and N = V |
| `2F` | `BLE rel` | Short relative | 2 | Branch if Z = 1 or N ≠ V |
| `30`–`33` | `LEAX` / `LEAY` / `LEAS` / `LEAU` | Indexed | 2–4 | Load resolved address; X/Y replace only Z, S/U preserve flags |
| `34` | `PSHS mask` | Immediate register mask | 2 | Push any selection of CC/A/B/DP/X/Y/U/PC onto S; preserve flags |
| `35` | `PULS mask` | Immediate register mask | 2 | Pull any selection of CC/A/B/DP/X/Y/U/PC from S; flags change only if CC is selected |
| `36` | `PSHU mask` | Immediate register mask | 2 | Push any selection of CC/A/B/DP/X/Y/S/PC onto U; preserve flags |
| `37` | `PULU mask` | Immediate register mask | 2 | Pull any selection of CC/A/B/DP/X/Y/S/PC from U; flags change only if CC is selected |
| `39` | `RTS` | Inherent | 1 | Pull PC from S, high byte then low; no adjustment |
| `3A` | `ABX` | Inherent | 1 | Add unsigned B to X, wrapping; preserve flags |
| `3D` | `MUL` | Inherent | 1 | Unsigned A × B into D; Z tests word, C copies product bit 7 |
| `8D` | `BSR rel8` | Short relative | 2 | Stack return PC on S and branch |
| `9D` / `AD` / `BD` | `JSR` | Direct / indexed / extended | 2 / 2–4 / 3 | Stack return PC on S and jump |

Page `10` supplies long counterparts of `21`–`2F` (LBRN and fourteen
conditional branches). These four-byte instructions fetch a high/low signed
word displacement on both paths, relative to PC after all four bytes. There
is no `10 20` LBRA alias. They preserve the same flags as short branches.

Word transfers use the same addressing selectors. Loads set N/Z from the full
word and clear V; stores apply the same flags to the stored value. Both preserve
E/F/H/I/C. Immediate word loads are three bytes; memory forms have the same
instruction lengths as the byte forms above. A page prefix adds one byte.
Word data is high byte first.

| Operation | Immediate | Direct | Indexed | Extended |
| --- | --- | --- | --- | --- |
| LDD | `CC` | `DC` | `EC` | `FC` |
| STD | — | `DD` | `ED` | `FD` |
| LDX | `8E` | `9E` | `AE` | `BE` |
| STX | — | `9F` | `AF` | `BF` |
| LDU | `CE` | `DE` | `EE` | `FE` |
| STU | — | `DF` | `EF` | `FF` |
| LDY | `10 8E` | `10 9E` | `10 AE` | `10 BE` |
| STY | — | `10 9F` | `10 AF` | `10 BF` |
| LDS | `10 CE` | `10 DE` | `10 EE` | `10 FE` |
| STS | — | `10 DF` | `10 EF` | `10 FF` |

Word arithmetic replaces N/Z/V/C and preserves E/F/H/I. ADDD/SUBD write D;
comparisons preserve their register apart from an indexed auto-update. C is
carry for addition and borrow for subtraction/comparison. The full-word
comparison differs from the original 6800's bytewise CPX.

| Operation | Immediate | Direct | Indexed | Extended |
| --- | --- | --- | --- | --- |
| SUBD | `83` | `93` | `A3` | `B3` |
| ADDD | `C3` | `D3` | `E3` | `F3` |
| CMPX | `8C` | `9C` | `AC` | `BC` |
| CMPD | `10 83` | `10 93` | `10 A3` | `10 B3` |
| CMPY | `10 8C` | `10 9C` | `10 AC` | `10 BC` |
| CMPU | `11 83` | `11 93` | `11 A3` | `11 B3` |
| CMPS | `11 8C` | `11 9C` | `11 AC` | `11 BC` |

See the [model checks and limitations](../../src/components/cpus/specifications/6809.md#checks-and-examples)
and [program specifications](../README.md#cpu-examples) for acceptance evidence.

## Z80

[Specification and model contract](../../src/components/cpus/specifications/z80.md)

**698 of 698 documented forms are complete (100%): 252 unprefixed, 248 CB,
58 ED, 39 DD, 39 FD, 31 DD CB, and 31 FD CB forms.** This includes all port
families, DI/EI, three IM forms, RETI, and RETN, with explicit IRQ/NMI delivery.

| Opcode | Instruction | Addressing form | Length | Scope |
| --- | --- | --- | --- | --- |
| `01/11/21/31` | `LD dd,nn` | Immediate word | 3 | Load BC/DE/HL/SP, low byte first; preserve flags |
| `04` | `INC B` | Register | 1 | Increment B; preserve C |
| `05` | `DEC B` | Register | 1 | Decrement B; preserve C |
| `06` | `LD B,n` | Immediate | 2 | Load B; preserve flags |
| `0C` | `INC C` | Register | 1 | Increment C; preserve carry flag |
| `0D` | `DEC C` | Register | 1 | Decrement C; preserve carry flag |
| `0E` | `LD C,n` | Immediate | 2 | Load C; preserve flags |
| `10` | `DJNZ rel` | Relative | 2 | Decrement B; jump if the result is nonzero; preserve all flags |
| `14` | `INC D` | Register | 1 | Increment D; preserve C |
| `15` | `DEC D` | Register | 1 | Decrement D; preserve C |
| `16` | `LD D,n` | Immediate | 2 | Load D; preserve flags |
| `18` | `JR rel` | Relative | 2 | Jump unconditionally; preserve flags |
| `1C` | `INC E` | Register | 1 | Increment E; preserve C |
| `1D` | `DEC E` | Register | 1 | Decrement E; preserve C |
| `1E` | `LD E,n` | Immediate | 2 | Load E; preserve flags |
| `20` | `JR NZ,rel` | Relative | 2 | Jump if Z = 0; preserve flags |
| `24` | `INC H` | Register | 1 | Increment H; preserve C |
| `25` | `DEC H` | Register | 1 | Decrement H; preserve C |
| `26` | `LD H,n` | Immediate | 2 | Load H; preserve flags |
| `28` | `JR Z,rel` | Relative | 2 | Jump if Z = 1; preserve flags |
| `2C` | `INC L` | Register | 1 | Increment L; preserve C |
| `2D` | `DEC L` | Register | 1 | Decrement L; preserve C |
| `2E` | `LD L,n` | Immediate | 2 | Load L; preserve flags |
| `30` | `JR NC,rel` | Relative | 2 | Jump if C = 0; preserve flags |
| `32` | `LD (nn),A` | Absolute | 3 | Store A; address bytes low then high; preserve flags |
| `36` | `LD (HL),n` | Immediate byte to indirect memory | 2 | Fetch the byte, then write RAM at HL; preserve flags |
| `38` | `JR C,rel` | Relative | 2 | Jump if C = 1; preserve flags |
| `3C` | `INC A` | Register | 1 | Increment A; preserve C |
| `3D` | `DEC A` | Register | 1 | Decrement A; preserve C |
| `3E` | `LD A,n` | Immediate | 2 | Load A; preserve flags |
| `40`–`7F`, except `76` | `LD r,r'` / `LD r,(HL)` / `LD (HL),r` | Register or indirect memory | 1 | All 49 register transfers, seven indirect reads, and seven indirect writes; preserve flags |
| `76` | `HALT` | Implied | 1 | Advance PC, increment R, and halt; preserve flags and interrupt latches |

All eight byte ALU operations use the register/memory pattern `10 ooo rrr`
and immediate pattern `11 ooo 110`. The `ooo` selector follows the rows below;
`rrr` selects B/C/D/E/H/L/(HL)/A. Register and `(HL)` forms are one byte;
immediate forms are two bytes. Indexed ALU forms use a DD/FD prefix and signed
displacement, for three bytes total; their encodings appear below.

| Operation | B | C | D | E | H | L | `(HL)` | A | Immediate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ADD | `80` | `81` | `82` | `83` | `84` | `85` | `86` | `87` | `C6` |
| ADC | `88` | `89` | `8A` | `8B` | `8C` | `8D` | `8E` | `8F` | `CE` |
| SUB | `90` | `91` | `92` | `93` | `94` | `95` | `96` | `97` | `D6` |
| SBC | `98` | `99` | `9A` | `9B` | `9C` | `9D` | `9E` | `9F` | `DE` |
| AND | `A0` | `A1` | `A2` | `A3` | `A4` | `A5` | `A6` | `A7` | `E6` |
| XOR | `A8` | `A9` | `AA` | `AB` | `AC` | `AD` | `AE` | `AF` | `EE` |
| OR | `B0` | `B1` | `B2` | `B3` | `B4` | `B5` | `B6` | `B7` | `F6` |
| CP | `B8` | `B9` | `BA` | `BB` | `BC` | `BD` | `BE` | `BF` | `FE` |

The unprefixed stack and subroutine families add 26 forms:

| Opcode | Instruction | Length | Scope |
| --- | --- | --- | --- |
| `C5/D5/E5/F5` | `PUSH BC/DE/HL/AF` | 1 | Predecrement SP; write high then low, wrapping at 16 bits |
| `C1/D1/E1/F1` | `POP BC/DE/HL/AF` | 1 | Read low then high; increment SP after each read |
| `CD` | `CALL nn` | 3 | Fetch target; push following PC; jump |
| `C4/CC/D4/DC/E4/EC/F4/FC` | `CALL cc,nn` | 3 | NZ/Z/NC/C/PO/PE/P/M; false paths fetch target without stack accesses |
| `C9` | `RET` | 1 | Pop PC without an extra increment |
| `C0/C8/D0/D8/E0/E8/F0/F8` | `RET cc` | 1 | Same conditions; false paths perform no stack accesses |

The remaining ordinary unprefixed families supply 53 forms:

| Opcode | Instruction | Forms | Scope |
| --- | --- | ---: | --- |
| `00` | `NOP` | 1 | Advance PC and R; preserve other state |
| `08/D9/EB/E3` | `EX AF,AF′` / `EXX` / `EX DE,HL` / `EX (SP),HL` | 4 | Exchange only the named registers/flags; stack exchange leaves SP fixed |
| `09/19/29/39` | `ADD HL,BC/DE/HL/SP` | 4 | Word addition; H from bit 11, C from bit 15; clear N and preserve S/Z/PV |
| `02/12/0A/1A` | `LD (BC)/(DE),A` / `LD A,(BC)/(DE)` | 4 | Indirect byte stores/loads; preserve flags |
| `3A` | `LD A,(nn)` | 1 | Absolute byte load; preserve flags |
| `22/2A` | `LD (nn),HL` / `LD HL,(nn)` | 2 | Low-first word stores/loads; wrap at 16 bits; preserve flags |
| `F9` | `LD SP,HL` | 1 | Copy the word; preserve flags |
| `03/13/23/33/0B/1B/2B/3B` | `INC/DEC BC/DE/HL/SP` | 8 | Wrap at 16 bits; preserve all flags |
| `34/35` | `INC/DEC (HL)` | 2 | Read then write once; byte INC/DEC flags, preserving C |
| `07/0F/17/1F` | `RLCA/RRCA/RLA/RRA` | 4 | Rotate A; replace C, clear H/N, preserve S/Z/PV |
| `27/2F/37/3F` | `DAA/CPL/SCF/CCF` | 4 | Decimal correction or accumulator/carry adjustment; CPU-specific flags |
| `C2/CA/D2/DA/E2/EA/F2/FA/C3/E9` | `JP cc,nn` / `JP nn` / `JP (HL)` | 10 | All eight conditions; fetch immediate targets on both paths; no target read |
| `C7/CF/D7/DF/E7/EF/F7/FF` | `RST 00H/08H/10H/18H/20H/28H/30H/38H` | 8 | Push following PC, jump to vector; ordinary calls preserving interrupt state |

CB's second byte uses `xx yyy rrr`. The `rrr` selector is B/C/D/E/H/L/(HL)/A;
`yyy` selects the rotate/shift when `xx=00`, or bit number 0–7 otherwise.
Every form below is two bytes including the CB prefix.

| Second-byte range | Instruction family | Forms | Scope |
| --- | --- | ---: | --- |
| `00`–`07` | RLC | 8 | Rotate left, outgoing bit also enters bit 0 |
| `08`–`0F` | RRC | 8 | Rotate right, outgoing bit also enters bit 7 |
| `10`–`17` | RL | 8 | Rotate left through C |
| `18`–`1F` | RR | 8 | Rotate right through C |
| `20`–`27` | SLA | 8 | Shift left, inserting zero |
| `28`–`2F` | SRA | 8 | Shift right, preserving sign |
| `38`–`3F` | SRL | 8 | Shift right, inserting zero |
| `40`–`7F` | BIT b | 64 | Test bit; no write; preserve C |
| `80`–`BF` | RES b | 64 | Clear bit; preserve all flags |
| `C0`–`FF` | SET b | 64 | Set bit; preserve all flags |

`CB 30`–`CB 37` are undocumented SLL forms and are excluded from both counts.
AF uses the existing six-flag model: PUSH writes F bits 5/3 as zero and POP
ignores them. BIT's unspecified S/PV behavior follows the independent reference
cases. The [model contract](../../src/components/cpus/specifications/z80.md#cb-rotations-shifts-and-individual-bits)
defines these policies and the ordered memory accesses.

### Indexed and ED forms

DD and FD implement the same 39 forms with IX and IY respectively. In this
table `index` means the selected register, and `ss` selects BC/DE/index/SP.

| Opcode after DD/FD | Family | Forms per prefix | Length including prefix |
| --- | --- | ---: | --- |
| `09/19/29/39` | ADD index,ss | 4 | 2 |
| `21`, `22/2A` | LD index,nn; LD (nn),index / index,(nn) | 3 | 4 |
| `23/2B` | INC/DEC index | 2 | 2 |
| `34/35`, `36` | INC/DEC (index+d); LD (index+d),n | 3 | 3; 4 for immediate store |
| `46/4E/56/5E/66/6E/7E` | LD r,(index+d), including real H/L | 7 | 3 |
| `70/71/72/73/74/75/77` | LD (index+d),r | 7 | 3 |
| `86/8E/96/9E/A6/AE/B6/BE` | Byte ALU (index+d) | 8 | 3 |
| `E1/E5`, `E3`, `E9`, `F9` | POP/PUSH index; EX (SP),index; JP (index); LD SP,index | 5 | 2 |

Each indexed-CB page adds **31** four-byte forms, `DD/FD CB d op`: the seven
shifts/rotates and eight each of BIT/RES/SET from the CB table, with final
`rrr=110`. BIT reads without writing; other forms read then write the indexed
byte. Undocumented SLL and register destinations are excluded. Displacements
are signed bytes, fetched before the final opcode; R advances twice.

| ED opcode | Family | Forms | Length including prefix |
| --- | --- | ---: | --- |
| `42/52/62/72`, `4A/5A/6A/7A` | SBC / ADC HL,BC/DE/HL/SP | 8 | 2 |
| `43/53/63/73`, `4B/5B/6B/7B` | LD (nn),BC/DE/HL/SP and reverse | 8 | 4 |
| `44` | NEG | 1 | 2 |
| `47/4F/57/5F` | LD I,A; LD R,A; LD A,I; LD A,R | 4 | 2 |
| `67/6F` | RRD / RLD | 2 | 2 |
| `A0/A8/B0/B8` | LDI / LDD / LDIR / LDDR | 4 | 2 |
| `A1/A9/B1/B9` | CPI / CPD / CPIR / CPDR | 4 | 2 |

Repeating blocks expose one byte transfer/comparison per step, rewinding PC
two bytes while repetition continues. An initial BC of zero permits 65,536
iterations; searches stop earlier on a match. Snapshots contain all state
needed to resume. See [block stepping](../../src/components/cpus/specifications/z80.md#block-copies-and-searches).

The port families add **24 forms**, all two bytes long:

| Opcode | Forms | Count | Address selection |
| --- | --- | ---: | --- |
| `DB/D3` | IN A,(n) / OUT (n),A | 2 | Old A supplies the high byte; n supplies the low byte |
| `ED 40/48/50/58/60/68/78` | IN B/C/D/E/H/L/A,(C) | 7 | Old BC, including when B/C is the destination |
| `ED 41/49/51/59/61/69/79` | OUT (C),B/C/D/E/H/L/A | 7 | BC |
| `ED A2/AA/B2/BA` | INI / IND / INIR / INDR | 4 | Old BC; decrement B after input |
| `ED A3/AB/B3/BB` | OUTI / OUTD / OTIR / OTDR | 4 | New BC after decrementing B |

All pass full 16-bit port addresses through the shared byte-port connection.
Repeating block I/O exposes one transfer per step; zero B allows 256 iterations.
Memory and device accesses share one ordered log. Flag rules, including H/PV
between repeat iterations, are in the [port contract](../../src/components/cpus/specifications/z80.md#port-input-and-output).

| Opcode | Instruction | Forms | Scope |
| --- | --- | ---: | --- |
| `F3/FB` | DI / EI | 2 | Clear/set both IFFs; EI defers IRQ through the next instruction |
| `ED 46/56/5E` | IM 0/1/2 | 3 | Select externally supplied instruction, fixed restart, or indirect vector entry |
| `ED 45/4D` | RETN / RETI | 2 | Restore PC/IFF1; RETI also notifies the device after retirement |

The [interrupt contract](../../src/components/cpus/specifications/z80.md#external-interrupt-delivery) defines
acceptance, HALT release, snapshot-preserved inhibition, supplied bytes,
stack/vector order, return notification, and failures.

See the [model checks and limitations](../../src/components/cpus/specifications/z80.md#checks-and-limits)
and [program specifications](../README.md#cpu-examples) for acceptance evidence.

## 8088

[Specification and model contract](../../src/components/cpus/specifications/8088.md)

| Opcode pattern / bytes | Instruction | Forms | Scope |
| --- | --- | ---: | --- |
| `00 ooo 0 d w` | ADD/OR/ADC/SBB/AND/SUB/XOR/CMP r/m,r or r,r/m | 32 | Both widths and directions; every register and memory operand choice |
| `00 ooo 10 w` | ADD/OR/ADC/SBB/AND/SUB/XOR/CMP AL/AX,n | 16 | Immediate byte/word; byte writes preserve AH |
| `000 ss 11p` (`06/0E/16/1E`, `07/17/1F`) | PUSH/POP segment | 7 | ES/CS/SS/DS pushes and ES/SS/DS pops; original SS for the entire access |
| `001 u s 111` (`27/2F/37/3F`) | DAA/DAS/AAA/AAS | 4 | Packed/unpacked decimal adjustment with original-chip AF/CF and byte behavior |
| `0100 s rrr` (`40`–`4F`) | INC/DEC r16 | 16 | All eight word registers; preserve CF, update PF/AF/ZF/SF/OF |
| `0101 p rrr` (`50`–`5F`) | PUSH/POP r16 | 16 | Descending SS:SP; original-8088 PUSH SP and POP SP behavior |
| `0111 ttt p` (`70`–`7F`) | Jcc rel8 | 16 | All sixteen conditions; fetch displacement on both paths |
| `80`, `81` + `mm ooo rrr` | Immediate ALU r/m8 or r/m16 | 16 | All eight operations and every operand choice |
| `82`, `83` + `mm ooo rrr` | Immediate ADD/ADC/SBB/SUB/CMP r/m | 10 | Byte for 82; sign-extended byte to word for 83; `/1`, `/4`, `/6` remain unused |
| `84`, `85` | TEST r/m,r | 2 | AND flags without a destination write |
| `86`, `87` | XCHG r/m,r | 2 | Both widths; read both original values before writes; resolve memory once |
| `88`–`8B` | MOV r/m,r or r,r/m | 4 | Both widths and directions; no destination read; preserve every flag |
| `8C`, `8E` | MOV r/m16,Sreg or Sreg,r/m16 | 2 | Four source segments; ES/SS/DS destinations; all legal operands |
| `8D` | LEA r16,m | 1 | Compute the effective offset without reading data |
| `8F` /0 | POP r/m16 | 1 | Resolve destination before popping; SP aliases and offset wrapping |
| `90`–`97` | XCHG AX,r16 / NOP | 8 | All word registers; 90 exchanges AX with itself; preserve every flag |
| `98`, `99` | CBW / CWD | 2 | Sign-extend AL to AX or AX to DX:AX; preserve flags |
| `9A` | Far CALL ptr16:16 | 1 | Push CS then following IP; change both CS and IP |
| `9B` | WAIT | 1 | Resumable TEST sampling, interrupt/trap restart, and recognition delay on release |
| `9C`–`9F` | PUSHF/POPF/SAHF/LAHF | 4 | Word and low-byte flag transfers with original reserved-bit policy |
| `A4`–`A7`, `AA`–`AF` | MOVS/CMPS/STOS/LODS/SCAS | 10 | Byte/word strings; DF controls direction; comparisons set subtraction flags |
| `A0`–`A3` | MOV AL/AX,[offset] or [offset],AL/AX | 4 | Direct offset in DS; word offsets wrap within the segment |
| `A8`, `A9` | TEST AL/AX,n | 2 | Immediate AND flags without changing AX |
| `B0`–`BF` | MOV r8/r16,n | 16 | All byte and word registers; preserve every flag |
| `C2`, `C3` | RET n / RET | 2 | Pop IP; optionally discard an unsigned byte count from SP |
| `C4`, `C5` | LES / LDS r16,m | 2 | Read a complete far pointer before changing either destination |
| `1100 11tt` (`CC`–`CF`) | INT3 / INT n / INTO / IRET | 4 | Native software entry and IP/CS/FLAGS return |
| `CA`, `CB` | RETF n / RETF | 2 | Pop IP then CS; optional unsigned parameter-byte discard |
| `C6`, `C7` /0 | MOV r/m,n | 2 | Immediate byte/word, all operand choices, no destination read |
| `D0`–`D3` /0–5, /7 | ROL/ROR/RCL/RCR/SHL/SHR/SAR | 28 | Both widths, count one or all eight bits of CL; /6 stays unsupported |
| `D4 0A`, `D5 0A`, `D7` | AAM / AAD / XLAT | 3 | Decimal radix adjustment or byte table lookup; AH and flag rules in the contract |
| `1101 1ooo` (`D8`–`DF`) + `mm ppp rrr` | ESC | 8 | Six-bit external opcode, every source, dummy word reads, and optional external delivery |
| `E0`–`E3` | LOOPNE/LOOPE/LOOP/JCXZ | 4 | Test post-decrement CX or original zero count; preserve flags |
| `1110 r 1 d w` (`E4`–`E7`, `EC`–`EF`) | IN / OUT | 8 | Immediate-byte or DX port; AL/AX; word transfers use two ordered bytes in wrapping 16-bit port space |
| `EA` | Far JMP ptr16:16 | 1 | Replace CS:IP from the complete immediate pointer |
| `E8` | CALL rel16 | 1 | Fetch displacement, push following IP, branch within CS |
| `E9`, `EB` | JMP rel16 / rel8 | 2 | Relative branch with 16-bit IP wrapping |
| `F4`, `F5`, `F8`, `F9`, `FC`, `FD` | HLT/CMC/CLC/STC/CLD/STD | 6 | Stored halt latch or one-flag update |
| `1111 101v` (`FA`, `FB`) | CLI / STI | 2 | Clear/set IF with snapshot-preserved recognition delay |
| `F6`, `F7` /0 | TEST r/m,n | 2 | Immediate AND flags without writing the operand |
| `F6`, `F7` /2–3 | NOT / NEG r/m | 4 | Both widths and every operand; NOT preserves flags, NEG sets subtraction flags |
| `F6`, `F7` /4–7 | MUL/IMUL/DIV/IDIV | 8 | Both widths and every operand; signed/unsigned results and type-0 divide-error delivery |
| `FF` /2–6 | Indirect near/far CALL/JMP, PUSH r/m16 | 5 | Capture targets/values before stack writes; far pointers require memory |
| `FE`, `FF` /0–1 | INC / DEC r/m | 4 | Both widths and every operand; preserve CF |
| **Total** | | **291** | **291 / 291 forms (100%)** |

The ALU field `ooo` selects ADD/OR/ADC/SBB/AND/SUB/XOR/CMP in that order.
For register/memory forms, `w=0/1` selects byte/word and `d=0/1` selects the
r/m or register destination. ModR/M is **`mm ggg rrr`**: `ggg` selects a
register or, in the immediate group, the operation. `mm` and `rrr` select
registers or memory through BX/BP/SI/DI combinations, optional displacement,
or a direct offset. BP-based addresses use SS; the direct-offset exception
uses DS. See the [addressing contract](../../src/components/cpus/specifications/8088.md#segmented-memory-and-modrm-operands).

ModR/M register/address choices, immediates, displacements, and stack
adjustments remain operands rather than additional coverage forms. These
291 forms include every documented operand choice. All seven prefixes are
implemented as modifiers: segment overrides, LOCK without bus arbitration,
and REP/REPE/REPNE on their documented strings. Repetition executes one element
per step; its snapshot and refetch policy is in the [model contract](../../src/components/cpus/specifications/8088.md#string-elements-and-repetition).

All documented forms are implemented, including the
[ESC and TEST/WAIT connections](../../src/components/cpus/specifications/8088.md#wait-and-coprocessor-escape).
Software interrupts, divide errors, external INTR/NMI, single-step traps, and
IRET now use native entry/return.
The [delivery contract](../../src/components/cpus/specifications/8088.md#external-interrupt-delivery) keeps external
requests with the caller and preserves recognition state in snapshots.

See the [model checks and limitations](../../src/components/cpus/specifications/8088.md#checks-and-limits)
and [program specifications](../README.md#cpu-examples) for acceptance evidence.

## 68000

[Specification and model contract](../../src/components/cpus/specifications/68000.md)

**All 36,029 documented forms are complete (100%)** within the
[model contract](../../src/components/cpus/specifications/68000.md). The instruction-word inventory contains
45,816 supported opwords; the coverage count collapses embedded literals.
RESET uses an explicit device connection; synchronous exceptions, trace,
external interrupt offers, STOP wakeup, and RTE are included. Illegal words and
line-A/line-F patterns also deliver their native exceptions without adding
documented opcode forms. Bus errors, timing, prefetch, and complete
devices remain separate.

MOVE and MOVEA
support every original-68000 source/destination combination and documented
index extension. The operation-word patterns below are binary. In MOVE,
`ddd mmm` selects the destination register then mode, while `sss rrr` selects
the source mode then register. Mode `001` in the destination selects MOVEA.

| Operation-word pattern | Instruction | Forms | Length | Scope |
| --- | --- | --- | --- | --- |
| `0000 000 0 ss mmm rrr` | `ORI.B/W/L #n,<ea>` | 150 | 4–10 | Three sizes × 50 data-alterable destinations; set NZ, clear VC, preserve X |
| `0000 001 0 ss mmm rrr` | `ANDI.B/W/L #n,<ea>` | 150 | 4–10 | Same sizes, destinations, and flags as ORI |
| `0000 010 0 ss mmm rrr` | `SUBI.B/W/L #n,<ea>` | 150 | 4–10 | Set X/N/Z/V/C; X and C report unsigned borrow |
| `0000 011 0 ss mmm rrr` | `ADDI.B/W/L #n,<ea>` | 150 | 4–10 | Set X/N/Z/V/C; X and C report unsigned carry |
| `0000 101 0 ss mmm rrr` | `EORI.B/W/L #n,<ea>` | 150 | 4–10 | Same sizes, destinations, and flags as ORI |
| `0000 110 0 ss mmm rrr` | `CMPI.B/W/L #n,<ea>` | 150 | 4–10 | Destination minus immediate; set NZVC, preserve X, no writeback |
| `0000 ooo0 0 f 111100` | ORI/ANDI/EORI #n,CCR/SR | 6 | 4 | ooo=000/001/101; f=0 CCR, 1 SR; masked status writes; SR privileged |
| `0000 1000 00 mmm rrr` | `BTST #n,<ea>` | 52 | 4–8 | Dn, memory, and PC-relative operands; test original bit, setting only Z |
| `0000 bbb 1 00 mmm rrr` | `BTST Dn,<ea>` | 424 | 2–6 | Eight bit-number registers × 53 operands; includes an immediate byte |
| `0000 1000 01 mmm rrr` | `BCHG #n,<ea>` | 50 | 4–8 | Complement bit in a data-alterable operand; Z describes original bit |
| `0000 bbb 1 01 mmm rrr` | `BCHG Dn,<ea>` | 400 | 2–6 | Eight bit-number registers × 50 data-alterable operands |
| `0000 1000 10 mmm rrr` | `BCLR #n,<ea>` | 50 | 4–8 | Clear bit in a data-alterable operand; Z describes original bit |
| `0000 bbb 1 10 mmm rrr` | `BCLR Dn,<ea>` | 400 | 2–6 | Eight bit-number registers × 50 data-alterable operands |
| `0000 1000 11 mmm rrr` | `BSET #n,<ea>` | 50 | 4–8 | Set bit in a data-alterable operand; Z describes original bit |
| `0000 bbb 1 11 mmm rrr` | `BSET Dn,<ea>` | 400 | 2–6 | Eight bit-number registers × 50 data-alterable operands |
| `0000 ddd 1 t s 001 aaa` | MOVEP.W/L | 256 | 4 | Eight data × eight address registers × two sizes × two directions; alternate-byte transfers |
| `00 01 ddd mmm sss rrr` | `MOVE.B <ea>,<ea>` | 2,650 | 2–10 | 53 sources × 50 data-alterable destinations; neither operand may be An |
| `00 10 ddd mmm sss rrr` (`mmm ≠ 001`) | `MOVE.L <ea>,<ea>` | 3,050 | 2–10 | 61 sources × 50 data-alterable destinations |
| `00 10 ddd 001 sss rrr` | `MOVEA.L <ea>,An` | 488 | 2–6 | 61 sources × 8 address registers; no flag changes |
| `00 11 ddd mmm sss rrr` (`mmm ≠ 001`) | `MOVE.W <ea>,<ea>` | 3,050 | 2–10 | 61 sources × 50 data-alterable destinations |
| `00 11 ddd 001 sss rrr` | `MOVEA.W <ea>,An` | 488 | 2–6 | Sign-extend the word into An; no flag changes |
| `0100 0000 ss mmm rrr` | `NEGX.B/W/L <ea>` | 150 | 2–6 | Zero minus operand minus X; cumulative Z; all data-alterable EAs |
| `0100 0010 ss mmm rrr` | `CLR.B/W/L <ea>` | 150 | 2–6 | Clear operand; set Z, clear NVC, preserve X; read memory before clearing |
| `0100 0100 ss mmm rrr` | `NEG.B/W/L <ea>` | 150 | 2–6 | Zero minus operand; subtraction flags; all data-alterable EAs |
| `0100 0110 ss mmm rrr` | `NOT.B/W/L <ea>` | 150 | 2–6 | Width-limited complement; set NZ, clear VC, preserve X |
| `0100 1010 ss mmm rrr` | `TST.B/W/L <ea>` | 150 | 2–6 | Set NZ from operand, clear VC, preserve X; no writeback; original-chip data-alterable EAs only |
| `0100 0000 11 mmm rrr` | MOVE SR,<ea> | 50 | 2–6 | Word destination; user mode permitted on original 68000; memory read before write |
| `0100 0100 11 mmm rrr` | MOVE <ea>,CCR | 53 | 2–6 | Word source, low five bits stored; preserve system flags |
| `0100 0110 11 mmm rrr` | MOVE <ea>,SR | 53 | 2–6 | Word source; mask unused bits; privileged |
| `0100 ddd 110 mmm rrr` | CHK.W <ea>,Dn | 424 | 2–6 | Signed bounds test; failed checks set N and deliver vector 6 after source updates |
| `0100 1000 00 mmm rrr` | NBCD <ea> | 50 | 2–6 | Decimal zero minus byte minus X; cumulative Z; preserve undefined NV |
| `0100 1010 11 mmm rrr` | TAS <ea> | 50 | 2–6 | Test original byte, then set bit 7; set NZ, clear VC, preserve X |
| `0100 1000 01 000 rrr` | SWAP Dn | 8 | 2 | Exchange words; set NZ, clear VC, preserve X |
| `0100 1000 1 s 000 rrr` | EXT.W/L Dn | 16 | 2 | Sign-extend byte to word or word to long; result flags |
| `0100 aaa 111 mmm rrr` | `LEA <ea>,An` | 224 | 2–6 | 28 control EAs × eight address registers; compute address without reading data; preserve flags |
| `0100 1000 01 mmm rrr` | `PEA <ea>` | 28 | 2–6 | Push a computed control EA as a long; preserve flags |
| `0100 1 d 00 1 s mmm rrr` | `MOVEM.W/L <list>,<ea>` / `<ea>,<list>` | 140 | 4–8 | Two sizes × (34 store + 36 load EAs); every mask; word loads sign-extend both register banks; preserve flags |
| `0100 1110 0101 0 rrr` | `LINK An,#d16` | 8 | 4 | Save An, establish frame, apply signed word allocation; preserve flags |
| `0100 1110 0101 1 rrr` | `UNLK An` | 8 | 2 | Restore frame and active stack, including A7 alias; preserve flags |
| `0100 1110 10 mmm rrr` | `JSR <ea>` | 28 | 2–6 | All control EAs; push full address after extensions; preserve flags |
| `0100 1110 11 mmm rrr` | `JMP <ea>` | 28 | 2–6 | All control EAs; validate target without a target read; preserve flags |
| `0100 1110 0111 0101` | `RTS` | 1 | 2 | Pop the full return address through active A7; preserve flags |
| `0100 1110 0110 d rrr` | MOVE An,USP / USP,An | 16 | 2 | Privileged full-long transfer; A7 selects SSP |
| `0100 1110 0111 0000` | RESET | 1 | 2 | Privileged device-reset callback; preserve CPU registers and flags |
| `0100 1110 0111 0001` | NOP | 1 | 2 | Advance PC only |
| `0100 1110 0111 0010` | STOP #SR | 1 | 4 | Privileged status load and stop; trace, accepted interrupt, or external reset wakes it |
| `0100 1110 0100 vvvv` | TRAP #n | 1 | 2 | All sixteen vectors 32..47; stack following PC and SR through SSP |
| `0100 1010 1111 1100` | ILLEGAL | 1 | 2 | Vector 4; stack the instruction start PC |
| `0100 1110 0111 0011` | RTE | 1 | 2 | Privileged six-byte SR/PC return through SSP; restore the selected stack bank |
| `0100 1110 0111 0110` | TRAPV | 1 | 2 | Vector 7 if V is set; otherwise advance PC |
| `0100 1110 0111 0111` | RTR | 1 | 2 | Restore CCR and full PC through active stack; preserve system state |
| `0101 qqq 0 ss mmm rrr` | `ADDQ.B/W/L #n,<ea>` | 166 | 2–6 | Counts 1–8; 50 byte or 58 word/long destinations; An uses all 32 bits and preserves flags |
| `0101 qqq 1 ss mmm rrr` | `SUBQ.B/W/L #n,<ea>` | 166 | 2–6 | Same sizes, counts, and destinations as ADDQ; data subtraction flags |
| `0101 cccc 11 mmm rrr` (`mmm ≠ 001`) | `Scc <ea>` | 800 | 2–6 | Sixteen conditions × 50 byte destinations; write FF/00; read memory first; preserve flags |
| `0101 cccc 11001 rrr` | `DBcc Dn,<label>` | 128 | 4 | All conditions/registers; decrement only Dn.W when false; preserve flags |
| `0110 0000 dddddddd` | `BRA <label>` | 2 | 2/4 | Signed byte/word displacement; preserve flags |
| `0110 0001 dddddddd` | `BSR <label>` | 2 | 2/4 | Push the full address after the instruction, then branch; preserve flags |
| `0110 cccc dddddddd` (`cccc=0010`–`1111`) | `Bcc <label>` | 28 | 2/4 | All fourteen conditions and both displacement forms; preserve flags |
| `0111 rrr 0 iiiiiiii` | `MOVEQ #n,Dn` | 8 | 2 | Sign-extend the embedded byte to a long; MOVE flags |
| `1000 rrr d ss mmm eee` | `OR.B/W/L <ea>,Dn` / `Dn,<ea>` | 2,280 | 2–6 | 53 data sources or 42 memory destinations; set NZ, clear VC, preserve X |
| `1000 ddd s11 mmm rrr` | DIVU/DIVS.W <ea>,Dn | 848 | 2–6 | Divide Dn.L by EA.W; packed remainder/quotient; overflow and zero-divisor policies |
| `1000 ddd 10000 m rrr` | SBCD | 128 | 2 | Register/predecrement decimal subtraction with X and cumulative Z |
| `1001 rrr d ss mmm eee` | `SUB.B/W/L <ea>,Dn` / `Dn,<ea>` | 2,408 | 2–6 | All legal source/memory-destination forms; set XNZVC from destination minus source |
| `1001 ddd 1 ss 00 0 rrr` | `SUBX.B/W/L Dn,Dn` | 192 | 2 | Three sizes × 64 register pairs; destination minus source minus X; cumulative Z |
| `1001 ddd 1 ss 00 1 rrr` | `SUBX.B/W/L -(An),-(An)` | 192 | 2 | Same arithmetic; two predecrement operands, source before destination |
| `1001 rrr s11 mmm eee` | `SUBA.W/L <ea>,An` | 976 | 2–6 | Sign-extend word source; full 32-bit subtraction; preserve all flags |
| `1011 rrr 0 ss mmm eee` | `CMP.B/W/L <ea>,Dn` | 1,400 | 2–6 | Set NZVC from Dn minus source; preserve X; no writeback |
| `1011 rrr 1 ss mmm eee` | `EOR.B/W/L Dn,<ea>` | 1,200 | 2–6 | Eight sources × three sizes × 50 data-alterable destinations; logic flags |
| `1011 ddd 1 ss 001 rrr` | `CMPM.B/W/L (An)+,(An)+` | 192 | 2 | Three sizes × 64 pointer pairs; destination minus source; replace NZVC, preserve X, no writeback |
| `1011 rrr s11 mmm eee` | `CMPA.W/L <ea>,An` | 976 | 2–6 | Sign-extend word source; full 32-bit comparison; preserve X; no writeback |
| `1100 rrr d ss mmm eee` | `AND.B/W/L <ea>,Dn` / `Dn,<ea>` | 2,280 | 2–6 | Same sizes, sources, destinations, and flags as OR |
| `1100 ddd s11 mmm rrr` | MULU/MULS.W <ea>,Dn | 848 | 2–6 | Word operands to full-long result; signed/unsigned; preserve X |
| `1100 ddd 10000 m rrr` | ABCD | 128 | 2 | Register/predecrement decimal addition with X and cumulative Z |
| `1100 ddd 1 ooooo rrr` | EXG | 192 | 2 | ooooo=01000 Dn/Dn, 01001 An/An, 10001 Dn/An; full longs, no flags |
| `1101 rrr d ss mmm eee` | `ADD.B/W/L <ea>,Dn` / `Dn,<ea>` | 2,408 | 2–6 | All legal source/memory-destination forms; set XNZVC from addition |
| `1101 ddd 1 ss 00 0 rrr` | `ADDX.B/W/L Dn,Dn` | 192 | 2 | Three sizes × 64 register pairs; destination plus source plus X; cumulative Z |
| `1101 ddd 1 ss 00 1 rrr` | `ADDX.B/W/L -(An),-(An)` | 192 | 2 | Same arithmetic; two predecrement operands, source before destination |
| `1101 rrr s11 mmm eee` | `ADDA.W/L <ea>,An` | 976 | 2–6 | Sign-extend word source; full 32-bit addition; preserve all flags |
| `1110 ccc d ss i 00 rrr` / `1110 0 00 d 11 mmm rrr` | `ASR/ASL` | 516 | 2–6 | Byte/word/long Dn; word memory; ASL retains intermediate sign-change overflow |
| `1110 ccc d ss i 01 rrr` / `1110 0 01 d 11 mmm rrr` | `LSR/LSL` | 516 | 2–6 | Same sizes/counts; shift zeros in, last outgoing bit to XC, clear V |
| `1110 ccc d ss i 10 rrr` / `1110 0 10 d 11 mmm rrr` | `ROXR/ROXL` | 516 | 2–6 | Rotate through X; copy X into C even at count zero; clear V |
| `1110 ccc d ss i 11 rrr` / `1110 0 11 d 11 mmm rrr` | `ROR/ROL` | 516 | 2–6 | Rotate within operand width; preserve X, clear V, last outgoing bit to C |

ADD/SUB/CMP use `ss=00/01/10` for byte/word/long. Direction `d=0`
reads any EA except byte An; `d=1` permits only memory-alterable destinations.
Address arithmetic uses `s=0/1` for word/long sources and accepts all 61 EAs.
The [arithmetic contract](../../src/components/cpus/specifications/68000.md#addition-subtraction-and-comparison)
defines widths, flag preservation, and source/destination pointer aliases.

ADDX/SUBX each contribute `3 × 2 × 8 × 8 = 384` forms; CMPM contributes
`3 × 8 × 8 = 192`. All use one operation word. Extended arithmetic preserves
Z on a zero result and consumes X; CMPM replaces Z and preserves X. Their
[paired-operand contract](../../src/components/cpus/specifications/68000.md#addition-subtraction-and-comparison)
defines source-first auto-updates, same-register aliases, and atomic faults.

AND/OR exclude An sources in every size, with the same memory destinations as
ADD/SUB. EOR uses only direction 1 and also permits Dn destinations. All three
preserve X and control state, set NZ from the selected width, and clear VC.
The [logic contract](../../src/components/cpus/specifications/68000.md#logical-operations-and-readmodifywrite) defines result
preservation and read/modify/write behavior, including unchanged-value writes.

Immediate ALU size `ss` is `00` byte, `01` word, `10` long; `11` is reserved.
The destination `mmm rrr` allows Dn, indirect, postincrement, predecrement,
displacement/index, and absolute word/long addresses. An direct, PC-relative,
and immediate destinations are excluded. ORI/ANDI/EORI to CCR/SR remain
unsupported and are not included in these counts. The immediate is fetched
before address extensions; each memory operand is resolved once. CMPI still
performs address auto-updates, despite doing no writeback.

Bit operations use long Dn operands (bit number modulo 32) and byte operands
elsewhere (modulo 8). Bit-number values do not multiply the count: BTST has
`52 + 8 × 53 = 476` forms, while each modifying operation has
`50 + 8 × 50 = 450`. Only Z changes, describing the bit before modification.
The [bit-operation contract](../../src/components/cpus/specifications/68000.md#testing-and-changing-a-bit) defines legal EAs,
extension fetching, register aliases, and address updates.

MOVE/MOVEQ set N/Z from the transferred size, clear V/C, and preserve X and
control state. Byte/word writes to Dn preserve the upper register bits.
See the [effective-address contract](../../src/components/cpus/specifications/68000.md#effective-address-decoding) for
mode encodings, extension words, and auto-update sequencing.

BRA/BSR/Bcc use the signed embedded byte unless it is `00`, which fetches one
signed extension word. `FF` remains byte displacement −1 on the original chip.
Branch and DBcc targets use the opcode address plus two as their base. DBcc
falls through without decrementing if its condition is true; otherwise it
decrements Dn.W and branches unless the result is `FFFF`. The
[control-flow contract](../../src/components/cpus/specifications/68000.md#conditions-and-control-flow) defines
stack behavior and address-error delivery for unaligned taken targets.

LEA/PEA/JMP/JSR accept only control EAs. MOVEM stores also permit
predecrement, excluding PC-relative forms; loads also permit postincrement.
Its mask precedes EA extensions, reverses register numbering for predecrement,
and never multiplies the coverage count. See the
[address and register-list contract](../../src/components/cpus/specifications/68000.md#peripheral-and-multiple-register-transfers)
and [frame contract](../../src/components/cpus/specifications/68000.md#control-addresses-and-frames) for base-register aliases,
word sign extension, LINK/UNLK A7 behavior, and empty-mask policy.

Quick arithmetic encodes eight as `qqq=000`; the operand choices do not
multiply completion forms. Size `ss=11` instead selects Scc/DBcc. Unary
operations and Scc share the data-alterable destination path; CLR and Scc
read memory before writing on the original 68000, while TST reads without
writing. The [quick/unary contract](../../src/components/cpus/specifications/68000.md#setting-a-byte-and-decrementing-a-counter)
defines flag preservation, full-width An arithmetic, and NEGX's cumulative Z.

Shift direction `d=0/1` means right/left. Register sizes `ss=00/01/10` mean
byte/word/long; `i=0` uses an immediate 1–8 count (`ccc=000` means eight),
while `i=1` reads the low six bits of Dccc. Memory forms always shift a word
once and permit only the 42 memory-alterable EAs. Each pair contributes
`2 × (3 × (8 + 64) + 42) = 516` forms; immediate count values do not multiply
the total. All operations set NZ, including at zero count. The
[shift contract](../../src/components/cpus/specifications/68000.md#bits-shifts-and-rotates) defines zero-count XC,
intermediate overflow, register aliases, and memory updates.

See the [model checks and limitations](../../src/components/cpus/specifications/68000.md#checks-and-limits)
and [program specifications](../README.md#cpu-examples) for acceptance evidence.

## CPUs and variants not started

These targets have no implementation in this repository. The existing MOS
6502 model does not establish the behavior of its intended variants.
The [CPU scope document](scope.md#intended-eventual-scope) owns target selection and
machine associations.

These targets are at 0% opcode completion. Establish each denominator and
its counting rules when implementation starts.

| CPU or variant | Opcode completion | Dromaios implementation |
| --- | --- | --- |
| MOS 6507 | 0% | Not started |
| MOS 6510 | 0% | Not started |
| Ricoh 2A03 | 0% | Not started |
| Sharp SM83 | 0% | Not started |
| Intel 8086 | 0% | Not started as a separate model |
| Intel 80286 | 0% | Not started |
| Intel 80386 | 0% | Not started |
| ARM2 | 0% | Not started |
| ARM7TDMI | 0% | Not started |

## Keeping this tracker current

When support changes, update the relevant opcode rows, complete and partial
counts, percentages, restrictions, and feature status in the same change.
When chapter ownership changes, update the literate instruction counts and
[model milestones](#literate-model-milestones), linking to the definitions and
checks that establish completion. Partial areas do not earn milestone credit.
Refresh chapter, fence, and shared-source counts whenever their authored files
change. All eight public CPU modules are generated, so handwritten core lines
remain zero unless a new CPU introduces a handwritten implementation.

Keep each denominator tied to its stated CPU variant and counting rules.
Link to the tests, model contracts, and example specifications that establish
the behavior. Keep current progress here; update the relevant contract or
specification when its behavior or acceptance criteria change, and update
overview documents when scope, milestones, architecture, or workflow changes.

[intel-transistors]: https://www.intel.com/pressroom/kits/quickreffam.htm "Intel Microprocessor Quick Reference Guide"
[6800-transistors]: https://www.rocelec.com/news/the-bygone-motorola-6800 "Rochester Electronics: The Bygone Motorola 6800"
[6502-transistors]: http://www.visual6502.org/docs/6502_in_action_14_web.pdf "Visual6502: Visualizing a Classic CPU in Action"
[z80-transistors]: https://bitsavers.computerhistory.org/magazines/Datamation/19781115.pdf "Zilog die photograph and caption, Datamation, November 15, 1978, page 18"
[6809-transistors]: https://classiccmp.org/mailman3/hyperkitty/list/test-drb%40ccmp.vtda.org/message/FQT5Q6A5Z72YYRFD2XIYELPGINCANG3U/ "Microprocessor Report figures, as transcribed by Mike Cheponis in May 2001"
[68000-transistors]: https://www.eetimes.com/motorolas-68000-microprocessor-receives-technology-award/ "Motorola Semiconductor Products Sector announcement, November 1996"
