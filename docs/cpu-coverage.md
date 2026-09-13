# CPU implementation coverage

This is the living inventory of CPU support in Dromaios. Implementation
coverage means the instructions and processor features the models provide.
Test coverage measures how much existing code the tests exercise; even full
test coverage can accompany a small instruction subset.

Update this document whenever CPU support changes. The example specifications
define behavior and expected results; the [CPU roadmap](cpu-roadmap.md) records
intended scope and the reasons for choosing it. Existing reference emulators
do not count toward implementation here.

## At a glance

| Model | Complete / documented opcode forms | Opcode completion | Additional partial forms | Completed examples |
| --- | --- | --- | --- | --- |
| [Intel 8080](#8080) | 18 / 244 | 7.4% | 0 | [Arithmetic](8080-example.md), [register pairs](8080-register-pairs-example.md), [stack](8080-stack-example.md) |
| [NMOS MOS 6502](#6502) | 3 / 151 | 2.0% | 1: binary-only ADC | [Arithmetic](6502-example.md) |
| [Motorola MC6809 / MC6809E](#6809) | 3 / 268 | 1.1% | 0 | [Arithmetic](6809-example.md) |

A completed example establishes its specified program and checks; all three
CPU models remain small subsets.

## How the percentages are counted

Opcode completion is **complete documented opcode forms / total documented
opcode forms × 100**, rounded to one decimal place. It measures instruction
coverage, not overall processor completeness or the proportion of work done.
Timing, interrupts, reset, and other processor features are tracked separately
below and do not contribute to this percentage.

An opcode form is a specific encoding, including its addressing form. For
example, immediate LDA and absolute LDA count separately. Operand values do
not create additional forms. An opcode with restricted instruction semantics
is partial and earns no completion credit until the restriction is removed:
6502 `ADC #n` currently lacks decimal arithmetic, so only CLC, LDA, and STA
count toward its percentage.

The denominators count distinct documented encodings in the manufacturer
instruction tables, with register fields expanded where they form part of
the opcode. Mnemonic aliases sharing an encoding count once; undocumented
encodings and instructions belonging to other CPU variants are excluded.

| Model | Documented forms | Counting basis |
| --- | --- | --- |
| Intel 8080 | 244 | [Intel 8080 Assembly Language Programming Manual, Appendix B](https://altairclone.com/downloads/manuals/8080%20Programmers%20Manual.pdf): expand the opcode bit patterns, excluding the 12 undocumented byte encodings |
| NMOS MOS 6502 | 151 | [Synertek 6500 Programming Manual, Appendix B](https://syncopate.us/books/Synertek6502ProgrammingManual.html#ap-b): count the documented instruction/addressing forms |
| Motorola MC6809 / MC6809E | 268 | [Motorola MC6809–MC6809E Programming Manual, Appendix D](https://www.maddes.net/m6809pm/appendix_d.htm): 221 unprefixed forms + 38 on page 2 + 9 on page 3, counting mnemonic aliases once |

For the 6809, a prefix and following opcode byte identify one form; prefixes
alone do not count. Indexed and register-selection postbytes do not create
additional forms, but an opcode remains partial until all its documented
postbyte choices work.

## Support shared by the current models

| Area | Implemented scope |
| --- | --- |
| Memory connection | Flat 64 KiB RAM; recorded byte reads and writes |
| Initialization | Explicit caller-supplied registers and flags, copied and validated; no implicit reset |
| Inspection | Detached state snapshots, recursively readonly in TypeScript, without RAM access |
| Stepping | At most one instruction attempt; before/after snapshots, fetched instruction bytes, ordered accesses, and outcome |
| Reset records | Separate before/after snapshots and access list; CPU-specific reset effects |
| Arithmetic and addresses | Byte results and 16-bit PC/operand fetching wrap at their modeled widths |
| Unsupported attempts | `reason: "opcode"`, one opcode read, unchanged CPU state and RAM; additional 6502 mode restriction below |
| Lesson restart | Fresh CPU and RAM from the example factory |

All three currently omit cycle counts, dummy bus accesses, electrical signals,
interrupt delivery, branches and calls, mapped devices, disassembly, and an
execution UI. Interrupt flags can be stored and inspected before interrupt
delivery is implemented.

The following tables exhaustively list complete and partial opcode forms.
Unlisted forms remain unsupported. Opcodes and addresses are hexadecimal;
instruction lengths are in bytes.

## 8080

[Source](../src/components/cpus/8080.ts) ·
[Example specification](8080-example.md) ·
[Example definition](../src/machines/8080-example.machine)

[Register-pair specification](8080-register-pairs-example.md) ·
[Register-pair definition](../src/machines/8080-register-pairs-example.machine)

[Stack specification](8080-stack-example.md) ·
[Stack definition](../src/machines/8080-stack-example.machine)

| Opcode | Instruction | Addressing form | Length | Scope |
| --- | --- | --- | --- | --- |
| `01` | `LXI B,nn` | Immediate | 3 | Load B:C; low byte then high; preserve flags |
| `03` | `INX B` | Register pair | 1 | Increment B:C with 16-bit wrapping; preserve flags |
| `11` | `LXI D,nn` | Immediate | 3 | Load D:E; low byte then high; preserve flags |
| `13` | `INX D` | Register pair | 1 | Increment D:E with 16-bit wrapping; preserve flags |
| `21` | `LXI H,nn` | Immediate | 3 | Load H:L; low byte then high; preserve flags |
| `23` | `INX H` | Register pair | 1 | Increment H:L with 16-bit wrapping; preserve flags |
| `31` | `LXI SP,nn` | Immediate | 3 | Load SP; low byte then high; preserve flags |
| `32` | `STA addr` | Direct memory address | 3 | Store A; address bytes low then high |
| `33` | `INX SP` | Register pair | 1 | Increment SP with 16-bit wrapping; preserve flags |
| `3E` | `MVI A,n` | Immediate | 2 | Accumulator destination only |
| `76` | `HLT` | Implied | 1 | Advance PC and enter halted state |
| `C1` | `POP B` | Stack | 1 | Read low then high into B:C; increment SP by 2; preserve flags |
| `C5` | `PUSH B` | Stack | 1 | Write B:C high then low; decrement SP by 2; preserve flags |
| `C6` | `ADI n` | Immediate | 2 | Add without incoming carry; update S/Z/AC/P/CY |
| `D1` | `POP D` | Stack | 1 | Read low then high into D:E; increment SP by 2; preserve flags |
| `D5` | `PUSH D` | Stack | 1 | Write D:E high then low; decrement SP by 2; preserve flags |
| `E1` | `POP H` | Stack | 1 | Read low then high into H:L; increment SP by 2; preserve flags |
| `E5` | `PUSH H` | Stack | 1 | Write H:L high then low; decrement SP by 2; preserve flags |

| Area | Current coverage |
| --- | --- |
| Stored registers | A, B, C, D, E, H, L, PC, SP |
| Stored flags/control | S, Z, AC, P, CY; interrupt-enable and halted latches |
| Register relationships | Snapshots derive BC, DE, and HL from stored bytes; LXI, INX, and POP update the pairs |
| Stack | PUSH/POP for BC, DE, and HL using a descending RAM stack and wrapping 16-bit SP; PSW forms are unsupported |
| Reset | Set PC to `0000`, clear interrupt-enable and halted; preserve data registers, SP, flags, and RAM; no memory accesses |
| Stopping | HLT is implemented; subsequent steps return `halted` with no instruction or memory access |
| Remaining instruction scope | Other loads/moves, register and memory arithmetic, logical operations, other pair operations, PSW stack forms, control flow, flag-control instructions, and port I/O |

Verification: [CPU tests](../tests/components/cpus/8080.test.ts),
[arithmetic example tests](../tests/machines/8080-example.test.ts),
[register-pair example tests](../tests/machines/8080-register-pairs-example.test.ts),
[stack example tests](../tests/machines/8080-stack-example.test.ts), and
[public type checks](../tests/types/8080.ts). ADI checks cover every byte operand
pair with incoming flags clear and set. Other checks cover exact accesses,
wrapping, self-overwriting stores, halt/reset behavior, rejection of every
unimplemented opcode, input validation, and detached records.
LXI/INX checks cover all pair and SP forms, derived views, byte carry and
16-bit wrapping, flag preservation, operand order, and successive operations.
PUSH/POP checks cover all three pairs, stack-access order, SP and PC wrapping,
nested operations, program overlap, current RAM reads, and retained stack data.

## 6502

[Source](../src/components/cpus/6502.ts) ·
[Example specification](6502-example.md) ·
[Example setup](../src/machines/6502-example.machine)

| Opcode | Instruction | Addressing form | Length | Scope |
| --- | --- | --- | --- | --- |
| `18` | `CLC` | Implied | 1 | Clear carry |
| `69` | `ADC #n` | Immediate | 2 | Partial: binary arithmetic only; D must be false |
| `8D` | `STA addr` | Absolute | 3 | Store A; address bytes low then high |
| `A9` | `LDA #n` | Immediate | 2 | Load A and update N/Z |

| Area | Current coverage |
| --- | --- |
| Stored registers | A, X, Y, SP, PC |
| Stored flags | N, V, D, I, Z, C; packed status and B/unused-bit conventions are not implemented |
| Decimal mode | D can be initialized and inspected; ADC with D set reports `reason: "decimal-mode"` before operand fetch or state changes |
| Reset | Read `FFFC` then `FFFD` for PC, set I, subtract 3 from the 8-bit SP with wrapping; preserve other registers, flags (including D), and RAM |
| Stopping | The example caller stops at its completion address; the CPU has no synthetic halt or completion outcome |
| Remaining instruction scope | Other register loads/transfers, arithmetic and logic, decimal arithmetic, stack operations, control flow, and further flag operations |
| Remaining addressing scope | Zero page, indexed, indirect, relative, and other forms beyond the exact encodings above |

CLC, LDA, and STA work with either D value. Decimal rejection is an explicit
implementation limit. Reset preserves D and therefore does not remove it.
The model targets the original NMOS 6502; variant-specific behavior has not
been implemented.

Verification: [CPU tests](../tests/components/cpus/6502.test.ts),
[example tests](../tests/machines/6502-example.test.ts), and
[public type checks](../tests/types/6502.ts). Binary ADC checks cover every byte
operand pair and carry input with old result flags clear and set. Other checks
cover decimal rejection, exact accesses, wrapping, self-overwriting stores,
reset vectors and SP effects, caller completion, unsupported opcodes, input
validation, and detached records.

## 6809

[Source](../src/components/cpus/6809.ts) ·
[Example specification](6809-example.md) ·
[Example setup](../src/machines/6809-example.machine)

| Opcode | Instruction | Addressing form | Length | Scope |
| --- | --- | --- | --- | --- |
| `86` | `LDA #n` | Immediate | 2 | Load A and update N/Z/V |
| `8B` | `ADDA #n` | Immediate | 2 | Add without incoming carry; update H/N/Z/V/C |
| `B7` | `STA addr` | Extended | 3 | Store A and update N/Z/V; address bytes high then low; bypass DP |

| Area | Current coverage |
| --- | --- |
| Stored registers | A, B, DP, X, Y, S, U, PC |
| Stored flags | E, F, H, I, N, Z, V, C; packed CC access is not implemented |
| Register relationships | Snapshots derive D from A:B; 16-bit D operations and register transfers are not implemented |
| Reset | Read `FFFE` then `FFFF` for PC, clear DP, set F/I; preserve other modeled state and RAM, including both stack pointers |
| Prefixes | `10` and `11` are rejected after the prefix byte alone; no second-byte fetch or opcode-page dispatch |
| Stopping | The example caller stops at its completion address; the CPU has no synthetic halt or completion outcome |
| Remaining instruction scope | B/D and other register operations, arithmetic and logic beyond ADDA, decimal adjustment, stack operations, control flow, and CC operations |
| Remaining addressing scope | Direct, indexed, relative, and other forms beyond the exact encodings above |

The reset preservation policy is specified in the example document; it does
not claim hardware power-on values for unspecified state. Interrupt handling,
including NMI arming after reset, remains unimplemented. MC6809/MC6809E clock
and pin differences are outside this instruction-level model.

Verification: [CPU tests](../tests/components/cpus/6809.test.ts),
[example tests](../tests/machines/6809-example.test.ts), and
[public type checks](../tests/types/6809.ts). ADDA checks cover every byte
operand pair with both incoming carry values and old result flags clear and
set. Other checks cover derived D, exact accesses, wrapping, self-overwriting
stores, extended addressing with nonzero DP, reset, prefix rejection, caller
completion, unsupported opcodes, input validation, and detached records.

## CPUs and variants not started

These targets have no implementation in this repository. The existing NMOS
6502 subset does not establish the behavior of its intended variants.
The [roadmap](cpu-roadmap.md#intended-eventual-scope) owns target selection and
machine associations.

These targets are at 0% opcode completion. Establish each denominator and
its counting rules when implementation starts.

| CPU or variant | Opcode completion | Dromaios implementation |
| --- | --- | --- |
| MOS 6507 | 0% | Not started |
| MOS 6510 | 0% | Not started |
| Ricoh 2A03 | 0% | Not started |
| Zilog Z80 | 0% | Not started |
| Sharp SM83 | 0% | Not started |
| Motorola 68000 | 0% | Not started |
| Intel 8088 / 8086 | 0% | Not started |
| Intel 80286 | 0% | Not started |
| Intel 80386 | 0% | Not started |
| ARM2 | 0% | Not started |
| ARM7TDMI | 0% | Not started |
| Intel 8008 | 0% | Not started; optional target |

## Keeping this tracker current

When support changes, update the relevant opcode rows, complete and partial
counts, percentages, restrictions, and feature status in the same change.
Keep each denominator tied to its stated CPU variant and counting rules.
Link to the tests and example contracts that establish the behavior. Keep
current progress here; update example
specifications when their behavior or acceptance criteria change, and update
overview documents when scope, milestones, architecture, or workflow changes.
