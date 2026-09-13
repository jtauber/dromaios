# CPU implementation coverage

This is the living inventory of CPU support in Dromaios. Implementation
coverage means the instructions and processor features the models provide.
Test coverage measures how much existing code the tests exercise; even full
test coverage can accompany a small instruction subset.

Update this document whenever CPU support changes. The
[model contracts](../README.md#cpu-models) define state and execution policies;
example specifications define programs and expected results. [CPU scope](scope.md)
records intended targets and the reasons for choosing them. Existing reference
emulators do not count toward implementation here.

## At a glance

| Model | Introduced | Complete / documented opcode forms | Opcode completion | Additional partial forms | Completed examples |
| --- | --- | --- | --- | --- | --- |
| [Intel 8008](#cpus-and-variants-not-started) | 1972 | 0 / TBD | 0.0% | 0 | None |
| [Intel 8080](#8080) | 1974 | 229 / 244 | 93.9% | 0 | [Arithmetic](8080/examples/arithmetic.md), [register pairs](8080/examples/register-pairs.md), [stack](8080/examples/stack.md), [addressing](8080/examples/addressing.md), [control flow](8080/examples/control-flow.md), [transfers](8080/examples/transfers.md), [ALU](8080/examples/alu.md), [counted loop](8080/examples/counted-loop.md) |
| [Motorola 6800](#cpus-and-variants-not-started) | 1974 | 0 / TBD | 0.0% | 0 | None |
| [NMOS MOS 6502](#6502) | 1975 | 7 / 151 | 4.6% | 1: binary-only ADC | [Arithmetic](6502/examples/arithmetic.md), [stack](6502/examples/stack.md), [addressing](6502/examples/addressing.md) |
| [Zilog Z80](#z80) | 1976 | 4 / 698 | 0.6% | 0 | [Arithmetic and 8080 comparison](z80/examples/arithmetic.md) |
| [Motorola MC6809 / MC6809E](#6809) | 1978 | 9 / 268 | 3.4% | 0 | [Arithmetic](6809/examples/arithmetic.md), [stack](6809/examples/stack.md), [addressing](6809/examples/addressing.md) |
| [Intel 8088](#cpus-and-variants-not-started) | 1979 | 0 / TBD | 0.0% | 0 | None |
| [Motorola 68000](#cpus-and-variants-not-started) | 1979 | 0 / TBD | 0.0% | 0 | None |

A completed example establishes its specified program and checks; all four
implemented CPU models remain incomplete. The 8008, 6800, 8088, and 68000 are
not started; their documented-form totals will be established when
implementation begins.

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
6502 `ADC #n` currently lacks decimal arithmetic, so it earns no completion
credit while the fully supported forms do.

The denominators count distinct documented encodings in the manufacturer
instruction tables, with register fields expanded where they form part of
the opcode. Mnemonic aliases sharing an encoding count once; undocumented
encodings and instructions belonging to other CPU variants are excluded.

| Model | Documented forms | Counting basis |
| --- | --- | --- |
| Intel 8080 | 244 | [Intel 8080 Assembly Language Programming Manual, Appendix B](https://altairclone.com/downloads/manuals/8080%20Programmers%20Manual.pdf): expand the opcode bit patterns, excluding the 12 undocumented byte encodings |
| NMOS MOS 6502 | 151 | [Synertek 6500 Programming Manual, Appendix B](https://syncopate.us/books/Synertek6502ProgrammingManual.html#ap-b): count the documented instruction/addressing forms |
| Motorola MC6809 / MC6809E | 268 | [Motorola MC6809–MC6809E Programming Manual, Appendix D](https://www.maddes.net/m6809pm/appendix_d.htm): 221 unprefixed forms + 38 on page 2 + 9 on page 3, counting mnemonic aliases once |
| Zilog Z80 | 698 | [Zilog Z80 CPU User Manual, UM008011-0816](https://www.zilog.com/docs/z80/um0080.pdf): 252 unprefixed + 248 CB + 58 ED + 39 DD + 39 FD + 31 DD CB + 31 FD CB forms |

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

All four currently omit cycle counts, dummy bus accesses, electrical signals,
interrupt delivery, mapped devices, disassembly, and an
execution UI. Interrupt flags can be stored and inspected before interrupt
delivery is implemented.

The following tables exhaustively list complete and partial opcode forms.
Unlisted forms remain unsupported. Opcodes and addresses are hexadecimal;
instruction lengths are in bytes.

## 8080

[Source](../../src/components/cpus/8080.ts) ·
[Model contract](8080/model.md) ·
[Arithmetic example](8080/examples/arithmetic.md) ·
[Example definition](../../src/machines/8080/example.machine)

[Register-pair specification](8080/examples/register-pairs.md) ·
[Register-pair definition](../../src/machines/8080/register-pairs-example.machine)

[Stack specification](8080/examples/stack.md) ·
[Stack definition](../../src/machines/8080/stack-example.machine)

[Addressing specification](8080/examples/addressing.md) ·
[Addressing definition](../../src/machines/8080/addressing-example.machine)

[Control-flow specification](8080/examples/control-flow.md) ·
[Control-flow definition](../../src/machines/8080/control-flow-example.machine)

[Transfers specification](8080/examples/transfers.md) ·
[Transfers definition](../../src/machines/8080/transfers-example.machine)

[ALU specification](8080/examples/alu.md) ·
[ALU definition](../../src/machines/8080/alu-example.machine)

[Counted-loop specification](8080/examples/counted-loop.md) ·
[Counted-loop definition](../../src/machines/8080/counted-loop-example.machine)

The MOV row groups 63 forms: all B/C/D/E/H/L/M/A source and destination
combinations except M,M, whose encoding is HLT. M means memory at current HL.
The two three-bit selector fields use the order B, C, D, E, H, L, M, A.
Each register/memory ALU row groups eight forms with the same source-selector
order. Their immediate counterparts are listed separately. These accumulator ALU forms
update S/Z/AC/P/CY according to the
[8080 flag contract](8080/model.md#accumulator-arithmetic-and-logic). INR/DCR,
DCX, and DAD have distinct [flag and access rules](8080/model.md#increment-decrement-and-word-arithmetic).

| Opcode | Instruction | Addressing form | Length | Scope |
| --- | --- | --- | --- | --- |
| `01` | `LXI B,nn` | Immediate | 3 | Load B:C; low byte then high; preserve flags |
| `02` | `STAX B` | Register indirect through BC | 1 | Store A; preserve pair and flags |
| `03` | `INX B` | Register pair | 1 | Increment B:C with 16-bit wrapping; preserve flags |
| `04` | `INR B` | Register | 1 | Increment byte; update S/Z/AC/P; preserve CY |
| `05` | `DCR B` | Register | 1 | Decrement byte; update S/Z/AC/P; preserve CY |
| `06` | `MVI B,n` | Immediate | 2 | Load B; preserve flags |
| `09` | `DAD B` | Register pair | 1 | Add to HL with 16-bit wrapping; update only CY |
| `0A` | `LDAX B` | Register indirect through BC | 1 | Load A; preserve pair and flags |
| `0B` | `DCX B` | Register pair | 1 | Decrement with 16-bit wrapping; preserve flags |
| `0C` | `INR C` | Register | 1 | Increment byte; update S/Z/AC/P; preserve CY |
| `0D` | `DCR C` | Register | 1 | Decrement byte; update S/Z/AC/P; preserve CY |
| `0E` | `MVI C,n` | Immediate | 2 | Load C; preserve flags |
| `11` | `LXI D,nn` | Immediate | 3 | Load D:E; low byte then high; preserve flags |
| `12` | `STAX D` | Register indirect through DE | 1 | Store A; preserve pair and flags |
| `13` | `INX D` | Register pair | 1 | Increment D:E with 16-bit wrapping; preserve flags |
| `14` | `INR D` | Register | 1 | Increment byte; update S/Z/AC/P; preserve CY |
| `15` | `DCR D` | Register | 1 | Decrement byte; update S/Z/AC/P; preserve CY |
| `16` | `MVI D,n` | Immediate | 2 | Load D; preserve flags |
| `19` | `DAD D` | Register pair | 1 | Add to HL with 16-bit wrapping; update only CY |
| `1A` | `LDAX D` | Register indirect through DE | 1 | Load A; preserve pair and flags |
| `1B` | `DCX D` | Register pair | 1 | Decrement with 16-bit wrapping; preserve flags |
| `1C` | `INR E` | Register | 1 | Increment byte; update S/Z/AC/P; preserve CY |
| `1D` | `DCR E` | Register | 1 | Decrement byte; update S/Z/AC/P; preserve CY |
| `1E` | `MVI E,n` | Immediate | 2 | Load E; preserve flags |
| `21` | `LXI H,nn` | Immediate | 3 | Load H:L; low byte then high; preserve flags |
| `22` | `SHLD addr` | Direct memory address | 3 | Store L then H at consecutive wrapped addresses; preserve flags |
| `23` | `INX H` | Register pair | 1 | Increment H:L with 16-bit wrapping; preserve flags |
| `24` | `INR H` | Register | 1 | Increment byte; update S/Z/AC/P; preserve CY |
| `25` | `DCR H` | Register | 1 | Decrement byte; update S/Z/AC/P; preserve CY |
| `26` | `MVI H,n` | Immediate | 2 | Load H; preserve flags |
| `29` | `DAD H` | Register pair | 1 | Add to HL with 16-bit wrapping; update only CY |
| `2A` | `LHLD addr` | Direct memory address | 3 | Load L then H from consecutive wrapped addresses; preserve flags |
| `2B` | `DCX H` | Register pair | 1 | Decrement with 16-bit wrapping; preserve flags |
| `2C` | `INR L` | Register | 1 | Increment byte; update S/Z/AC/P; preserve CY |
| `2D` | `DCR L` | Register | 1 | Decrement byte; update S/Z/AC/P; preserve CY |
| `2E` | `MVI L,n` | Immediate | 2 | Load L; preserve flags |
| `31` | `LXI SP,nn` | Immediate | 3 | Load SP; low byte then high; preserve flags |
| `32` | `STA addr` | Direct memory address | 3 | Store A; address bytes low then high |
| `33` | `INX SP` | Register pair | 1 | Increment SP with 16-bit wrapping; preserve flags |
| `34` | `INR M` | Memory through HL | 1 | Increment byte; update S/Z/AC/P; preserve CY |
| `35` | `DCR M` | Memory through HL | 1 | Decrement byte; update S/Z/AC/P; preserve CY |
| `36` | `MVI M,n` | Immediate | 2 | Load memory at HL; preserve flags |
| `39` | `DAD SP` | Register pair | 1 | Add to HL with 16-bit wrapping; update only CY |
| `3A` | `LDA addr` | Direct memory address | 3 | Load A; address bytes low then high; preserve flags |
| `3B` | `DCX SP` | Register pair | 1 | Decrement with 16-bit wrapping; preserve flags |
| `3C` | `INR A` | Register | 1 | Increment byte; update S/Z/AC/P; preserve CY |
| `3D` | `DCR A` | Register | 1 | Decrement byte; update S/Z/AC/P; preserve CY |
| `3E` | `MVI A,n` | Immediate | 2 | Load A; preserve flags |
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
| `D4` | `CNC addr` | Absolute target / stack | 3 | Call if CY = 0 |
| `D5` | `PUSH D` | Stack | 1 | Write D:E high then low; decrement SP by 2; preserve flags |
| `D6` | `SUI n` | Immediate | 2 | Subtract from A without incoming borrow |
| `D7` | `RST 2` | Encoded vector / stack | 1 | Push following PC; jump to `0010`; preserve interrupt enable |
| `D8` | `RC` | Stack | 1 | Return if CY = 1 |
| `DA` | `JC addr` | Absolute target | 3 | Jump if CY = 1 |
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
| `F2` | `JP addr` | Absolute target | 3 | Jump if S = 0 |
| `F4` | `CP addr` | Absolute target / stack | 3 | Call if S = 0 |
| `F6` | `ORI n` | Immediate | 2 | OR with A; clear AC and CY |
| `F7` | `RST 6` | Encoded vector / stack | 1 | Push following PC; jump to `0030`; preserve interrupt enable |
| `F8` | `RM` | Stack | 1 | Return if S = 1 |
| `F9` | `SPHL` | Register pair | 1 | Copy HL to SP; preserve HL and flags |
| `FA` | `JM addr` | Absolute target | 3 | Jump if S = 1 |
| `FC` | `CM addr` | Absolute target / stack | 3 | Call if S = 1 |
| `FE` | `CPI n` | Immediate | 2 | Subtraction flags without incoming borrow; preserve A |
| `FF` | `RST 7` | Encoded vector / stack | 1 | Push following PC; jump to `0038`; preserve interrupt enable |

| Area | Current coverage |
| --- | --- |
| Stored registers | A, B, C, D, E, H, L, PC, SP |
| Stored flags/control | S, Z, AC, P, CY; interrupt-enable and halted latches |
| Register relationships | Snapshots derive BC, DE, and HL from stored bytes; byte transfers, INR/DCR, and pair operations update those views; XCHG exchanges DE/HL and SPHL copies HL to SP |
| Memory addressing | MOV/MVI, INR/DCR, and accumulator ALU operands through current HL; LDAX/STAX through BC or DE; LDA/STA and LHLD/SHLD with an explicit 16-bit address |
| Stack | PUSH/POP for BC, DE, and HL plus control-flow return addresses, using a descending RAM stack and wrapping 16-bit SP; XTHL exchanges HL with stack memory without moving SP; PSW forms are unsupported |
| Control flow | JMP, CALL, RET and all eight conditions for each; PCHL and RST 0–7; preserve arithmetic flags and interrupt enable |
| Reset | Set PC to `0000`, clear interrupt-enable and halted; preserve data registers, SP, flags, and RAM; no memory accesses |
| Stopping | HLT is implemented; subsequent steps return `halted` with no instruction or memory access |
| Accumulator arithmetic/logic | ADD/ADC, SUB/SBB, ANA/XRA/ORA, CMP and all immediate counterparts; 8-bit results, carry/borrow propagation, comparison without changing A, and 8080 auxiliary carry rules |
| Byte and word arithmetic | INR/DCR update byte results and S/Z/AC/P while preserving CY; INX/DCX wrap pairs and SP without changing flags; DAD adds to HL and updates only CY |
| Remaining instruction scope | Rotates, DAA, CMA, STC/CMC, PSW stack forms, DI/EI, NOP, and port I/O |

Verification: [CPU tests](../../tests/components/cpus/8080.test.ts),
[arithmetic example tests](../../tests/machines/8080/example.test.ts),
[register-pair example tests](../../tests/machines/8080/register-pairs-example.test.ts),
[stack example tests](../../tests/machines/8080/stack-example.test.ts),
[addressing example tests](../../tests/machines/8080/addressing-example.test.ts),
[control-flow example tests](../../tests/machines/8080/control-flow-example.test.ts),
[transfers example tests](../../tests/machines/8080/transfers-example.test.ts),
[ALU example tests](../../tests/machines/8080/alu-example.test.ts),
[counted-loop example tests](../../tests/machines/8080/counted-loop-example.test.ts), and
[public type checks](../../tests/types/8080.ts). ALU checks cover every byte operand
pair and both incoming carry values for all eight operations, using independent
bit-by-bit arithmetic and logic references. Other checks cover exact accesses,
wrapping, self-overwriting stores, halt/reset behavior, rejection of every
unimplemented opcode, input validation, and detached records.
LXI/INX checks cover all pair and SP forms, derived views, byte carry and
16-bit wrapping, flag preservation, operand order, and successive operations.
PUSH/POP checks cover all three pairs, stack-access order, SP and PC wrapping,
nested operations, program overlap, current RAM reads, and retained stack data.
Memory MOV checks cover HL addressing, flag preservation, PC wrapping, exact
data accesses, instruction-byte overlap, current RAM, and successive operations
across page and address-space boundaries.
Control-flow checks cover all 32 flag combinations and both interrupt-enable
values for every condition, all RST vectors, taken/untaken accesses, PC/SP
wrapping, code/stack overlap, nested CALL/RST/RET, current RAM and HL, and
retained records. The loop-and-subroutine example checks complete records,
final RAM, and resumption after a bounded run.
Transfer checks cover every MOV combination and every MVI destination/byte,
self-moves, register/pair views, current HL/BC/DE and RAM, flags and control
preservation, wrapped operand/data addresses, code overlap, ordered accesses,
and unchanged-value writes. The transfers example checks all records and the
full memory image, including different successive writes to one address.
ALU encoding checks cover all register/memory and immediate forms, all 32 flag
combinations, both interrupt-enable values, accumulator aliases, comparison
preservation, wrapped PC, memory/code overlap, and current HL/RAM across
successive operations. Literal regressions pin down subtraction and AND auxiliary
carry. The combined example checks complete records, two-byte carry/borrow
propagation, comparison-driven branching, final RAM, and bounded resumption.
INR/DCR checks cover all byte values, all 32 initial flag combinations, and
both interrupt-enable values for every destination, plus exact read/write
ordering, self-modifying code, current HL/RAM, and literal flag regressions.
DCX checks cover every word value for each pair and SP. DAD checks cover all
sources and flag combinations at arithmetic boundaries, every HL value with
BC = 0000/0001/FFFF, and every DAD H input. Independent byte additions supply
word-result expectations. Successive operations verify current pair values and
retained records; the counted loop checks all records, final RAM, and resumption
after address wrapping.

## 6502

[Source](../../src/components/cpus/6502.ts) ·
[Model contract](6502/model.md) ·
[Arithmetic example](6502/examples/arithmetic.md) ·
[Example definition](../../src/machines/6502/example.machine)

[Stack specification](6502/examples/stack.md) ·
[Stack definition](../../src/machines/6502/stack-example.machine)

[Addressing specification](6502/examples/addressing.md) ·
[Addressing definition](../../src/machines/6502/addressing-example.machine)

| Opcode | Instruction | Addressing form | Length | Scope |
| --- | --- | --- | --- | --- |
| `18` | `CLC` | Implied | 1 | Clear carry |
| `48` | `PHA` | Implied | 1 | Write A at 0100 + SP, then decrement 8-bit SP; preserve flags |
| `68` | `PLA` | Implied | 1 | Increment 8-bit SP, then read A at 0100 + SP; update N/Z |
| `69` | `ADC #n` | Immediate | 2 | Partial: binary arithmetic only; D must be false |
| `85` | `STA zp` | Zero page | 2 | Store A at 00:operand; preserve flags |
| `8D` | `STA addr` | Absolute | 3 | Store A; address bytes low then high |
| `A5` | `LDA zp` | Zero page | 2 | Load A from 00:operand; update N/Z |
| `A9` | `LDA #n` | Immediate | 2 | Load A and update N/Z |

| Area | Current coverage |
| --- | --- |
| Stored registers | A, X, Y, SP, PC |
| Stored flags | N, V, D, I, Z, C; packed status and B/unused-bit conventions are not implemented |
| Memory addressing | LDA and STA with one-byte addresses in fixed page zero; STA with an explicit 16-bit absolute address |
| Stack | PHA/PLA in page 01 with wrapping 8-bit SP; pulls retain stored bytes; status stack forms are unsupported |
| Decimal mode | D can be initialized and inspected; ADC with D set reports `reason: "decimal-mode"` before operand fetch or state changes |
| Reset | Read `FFFC` then `FFFD` for PC, set I, subtract 3 from the 8-bit SP with wrapping; preserve other registers, flags (including D), and RAM |
| Stopping | The example caller stops at its completion address; the CPU has no synthetic halt or completion outcome |
| Remaining instruction scope | Other register loads/transfers, arithmetic and logic, decimal arithmetic, status stack operations, control flow, and further flag operations |
| Remaining addressing scope | Indexed, indirect, relative, and other forms beyond the exact encodings above |

All supported forms except ADC work with either D value. Decimal rejection is
an explicit implementation limit. Reset preserves D and therefore does not
remove it.
The model targets the original NMOS 6502; variant-specific behavior has not
been implemented.

Verification: [CPU tests](../../tests/components/cpus/6502.test.ts),
[arithmetic example tests](../../tests/machines/6502/example.test.ts),
[stack example tests](../../tests/machines/6502/stack-example.test.ts),
[addressing example tests](../../tests/machines/6502/addressing-example.test.ts), and
[public type checks](../../tests/types/6502.ts). Binary ADC checks cover every byte
operand pair and carry input with old result flags clear and set. Other checks
cover decimal rejection, exact accesses, wrapping, self-overwriting stores,
reset vectors and SP effects, caller completion, unsupported opcodes, input
validation, and detached records.
PHA/PLA checks cover page-one addressing, SP and PC wrapping, nested operations,
flag preservation and replacement, stack/code overlap, current RAM reads,
retained stack bytes, and reset with an occupied stack.
Zero-page LDA/STA checks cover fixed-page addressing, N/Z replacement and flag
preservation with either D value, PC and operand wrapping, code overlap,
current RAM, unchanged-value writes without destination reads, and detached records.

## 6809

[Source](../../src/components/cpus/6809.ts) ·
[Model contract](6809/model.md) ·
[Arithmetic example](6809/examples/arithmetic.md) ·
[Example definition](../../src/machines/6809/example.machine)

[Stack specification](6809/examples/stack.md) ·
[Stack definition](../../src/machines/6809/stack-example.machine)

[Addressing specification](6809/examples/addressing.md) ·
[Addressing definition](../../src/machines/6809/addressing-example.machine)

| Opcode | Instruction | Addressing form | Length | Scope |
| --- | --- | --- | --- | --- |
| `34` | `PSHS mask` | Immediate register mask | 2 | Push any selection of CC/A/B/DP/X/Y/U/PC onto S; preserve flags |
| `35` | `PULS mask` | Immediate register mask | 2 | Pull any selection of CC/A/B/DP/X/Y/U/PC from S; flags change only if CC is selected |
| `36` | `PSHU mask` | Immediate register mask | 2 | Push any selection of CC/A/B/DP/X/Y/S/PC onto U; preserve flags |
| `37` | `PULU mask` | Immediate register mask | 2 | Pull any selection of CC/A/B/DP/X/Y/S/PC from U; flags change only if CC is selected |
| `86` | `LDA #n` | Immediate | 2 | Load A and update N/Z/V |
| `8B` | `ADDA #n` | Immediate | 2 | Add without incoming carry; update H/N/Z/V/C |
| `96` | `LDA direct` | Direct page | 2 | Load A from DP:operand; update N/Z and clear V |
| `97` | `STA direct` | Direct page | 2 | Store A at DP:operand; update N/Z and clear V |
| `B7` | `STA addr` | Extended | 3 | Store A and update N/Z/V; address bytes high then low; bypass DP |

| Area | Current coverage |
| --- | --- |
| Stored registers | A, B, DP, X, Y, S, U, PC |
| Stored flags | E, F, H, I, N, Z, V, C; CC is packed/unpacked for stack transfers without a separate public CC state field |
| Register relationships | Snapshots derive D from A:B, including after stack pulls; other 16-bit D operations and register transfers are not implemented |
| Memory addressing | Direct LDA/STA combine current DP with a one-byte operand; extended STA uses an explicit 16-bit address and bypasses DP |
| Stack | S and U use descending RAM stacks with wrapping 16-bit pointers; all register masks work, including empty/full masks and the other pointer |
| PC stack transfers | Push saves PC after the postbyte; pull replaces PC and execution resumes there |
| Reset | Read `FFFE` then `FFFF` for PC, clear DP, set F/I; preserve other modeled state and RAM, including both stack pointers |
| Prefixes | `10` and `11` are rejected after the prefix byte alone; no second-byte fetch or opcode-page dispatch |
| Stopping | The example caller stops at its completion address; the CPU has no synthetic halt or completion outcome |
| Remaining instruction scope | Other B/D and register operations, arithmetic and logic beyond ADDA, decimal adjustment, branch/call/return opcodes, and other CC operations |
| Remaining addressing scope | Indexed, relative, and other forms beyond the exact encodings above |

The [reset preservation policy](6809/model.md#cpu-reset) is specified in the
model contract; it does not claim hardware power-on values for unspecified
state. Interrupt handling, including NMI arming after reset, remains
unimplemented. MC6809/MC6809E clock and pin differences are outside this
instruction-level model.

Verification: [CPU tests](../../tests/components/cpus/6809.test.ts),
[arithmetic example tests](../../tests/machines/6809/example.test.ts),
[stack example tests](../../tests/machines/6809/stack-example.test.ts),
[addressing example tests](../../tests/machines/6809/addressing-example.test.ts), and
[public type checks](../../tests/types/6809.ts). ADDA checks cover every byte
operand pair with both incoming carry values and old result flags clear and
set. Other checks cover derived D, exact accesses, wrapping, self-overwriting
stores, extended addressing with nonzero DP, reset, prefix rejection, caller
completion, unsupported opcodes, input validation, and detached records.
PSH/PUL checks cover every register mask and CC value, byte and register order,
pointer and postbyte wrapping, PC transfers, nested saves, other-pointer
transfers, stack/code overlap, current RAM reads, and occupied-stack reset.
Direct LDA/STA checks cover page selection, N/Z/V effects and preserved flags,
PC and operand wrapping, code overlap, unchanged-value writes without destination
reads, DP changed by a stack pull or reset, current RAM, and detached records.

## Z80

[Source](../../src/components/cpus/z80.ts) ·
[Model contract](z80/model.md) ·
[Arithmetic example](z80/examples/arithmetic.md) ·
[Example definition](../../src/machines/z80/example.machine)

| Opcode | Instruction | Addressing form | Length | Scope |
| --- | --- | --- | --- | --- |
| `32` | `LD (nn),A` | Absolute | 3 | Store A; address bytes low then high; preserve flags |
| `3E` | `LD A,n` | Immediate | 2 | Load A; preserve flags |
| `76` | `HALT` | Implied | 1 | Advance PC, increment R, and halt; preserve flags and interrupt latches |
| `C6` | `ADD A,n` | Immediate | 2 | Add without incoming carry; set S/Z/H/PV/C from the result and clear N; PV means signed overflow |

| Area | Current coverage |
| --- | --- |
| Stored registers | A/B/C/D/E/H/L in main and alternate banks; IX, IY, PC, SP, I, R |
| Stored flags | S/Z/H/PV/N/C in both banks; undocumented F bits 3/5 and raw F/AF views are omitted |
| Register relationships | Snapshots derive BC, DE, and HL in both banks; no bank-exchange or pair-operation instructions yet |
| Interrupt state | IFF1, IFF2, and IM 0/1/2 can be initialized and inspected; no interrupt delivery or interrupt-control instructions |
| Refresh register | Each supported unprefixed opcode increments R bits 0–6 once, preserving bit 7; no increments for operand/data accesses |
| Reset | Clear PC/I/R, IFF1/IFF2, and IM; release HALT; preserve banks, flags, IX/IY/SP, and RAM under the documented model policy |
| Prefixes | CB/DD/ED/FD rejected after the first byte; all CPU state, including R, remains unchanged |
| Stopping | HALT reports its instruction once; already halted steps perform no accesses or refresh updates |
| Remaining instruction scope | All other transfers, arithmetic and logic, register exchanges, stack operations, control flow, and I/O |
| Remaining addressing scope | Register, indirect, indexed, relative, and prefixed forms beyond the exact encodings above |

The model covers documented instruction semantics for the listed forms, not
undocumented flag bits or cycle activity. In particular, a physical Z80 keeps
refreshing during HALT; the instruction-level halted state does not model
those cycles. See the [model contract](z80/model.md) for unsupported-attempt and
reset-preservation policies.

Verification: [CPU tests](../../tests/components/cpus/z80.test.ts),
[arithmetic example tests](../../tests/machines/z80/example.test.ts), and
[public type checks](../../tests/types/z80.ts). ADD checks every byte operand
pair against independent column addition and signed-range overflow, with old
flags clear and set. Boundary programs exercise all flag patterns alongside
the 8080, independently checking parity versus overflow. Other checks cover
all immediate-load bytes and flag patterns, nested state isolation, register
views, exact accesses, PC and R wrapping, current RAM, overlapping stores,
every unsupported first byte, HALT, reset, and retained records. The generated
example and runner checks verify complete records, final RAM, and bounded
resumption with the concrete Z80 types.

## CPUs and variants not started

These targets have no implementation in this repository. The existing NMOS
6502 subset does not establish the behavior of its intended variants.
The [CPU scope document](scope.md#intended-eventual-scope) owns target selection and
machine associations.

These targets are at 0% opcode completion. Establish each denominator and
its counting rules when implementation starts.

| CPU or variant | Opcode completion | Dromaios implementation |
| --- | --- | --- |
| MOS 6507 | 0% | Not started |
| MOS 6510 | 0% | Not started |
| Ricoh 2A03 | 0% | Not started |
| Motorola 6800 | 0% | Not started |
| Intel 8008 | 0% | Not started |
| Sharp SM83 | 0% | Not started |
| Motorola 68000 | 0% | Not started |
| Intel 8088 / 8086 | 0% | Not started |
| Intel 80286 | 0% | Not started |
| Intel 80386 | 0% | Not started |
| ARM2 | 0% | Not started |
| ARM7TDMI | 0% | Not started |

## Keeping this tracker current

When support changes, update the relevant opcode rows, complete and partial
counts, percentages, restrictions, and feature status in the same change.
Keep each denominator tied to its stated CPU variant and counting rules.
Link to the tests, model contracts, and example specifications that establish
the behavior. Keep current progress here; update the relevant contract or
specification when its behavior or acceptance criteria change, and update
overview documents when scope, milestones, architecture, or workflow changes.
