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

| Model | Introduced | Transistors (approx.) | Source lines | Complete / documented opcode forms | Opcode completion |
| --- | --- | ---: | ---: | --- | --- |
| [Intel 8008](#8008) | 1972 | [3,500][intel-transistors] | [270](../../src/components/cpus/8008.ts) | 194 / 250 | 77.6% |
| [Intel 8080](#8080) | 1974 | [6,000][intel-transistors] | [651](../../src/components/cpus/8080.ts) | 240 / 244 | 98.4% |
| [Motorola 6800](#6800) | 1974 | [4,100][6800-transistors] | [250](../../src/components/cpus/6800.ts) | 41 / 197 | 20.8% |
| [MOS 6502](#6502) | 1975 | [3,510][6502-transistors] | [249](../../src/components/cpus/6502.ts) | 28 / 151 | 18.5% |
| [Zilog Z80](#z80) | 1976 | [8,500][z80-transistors] | [294](../../src/components/cpus/z80.ts) | 98 / 698 | 14.0% |
| [Motorola 6809](#6809) | 1978 | [9,000][6809-transistors] | [305](../../src/components/cpus/6809.ts) | 30 / 268 | 11.2% |
| [Intel 8088](#8088) | 1979 | [29,000][intel-transistors] | [227](../../src/components/cpus/8088.ts) | 22 / 291 | 7.6% |
| [Motorola 68000](#68000) | 1979 | [68,000][68000-transistors] | [243](../../src/components/cpus/68000.ts) | 96 / 36,029 | 0.3% |

[intel-transistors]: https://www.intel.com/pressroom/kits/quickreffam.htm "Intel Microprocessor Quick Reference Guide"
[6800-transistors]: https://www.rocelec.com/news/the-bygone-motorola-6800 "Rochester Electronics: The Bygone Motorola 6800"
[6502-transistors]: http://www.visual6502.org/docs/6502_in_action_14_web.pdf "Visual6502: Visualizing a Classic CPU in Action"
[z80-transistors]: https://bitsavers.computerhistory.org/magazines/Datamation/19781115.pdf "Zilog die photograph and caption, Datamation, November 15, 1978, page 18"
[6809-transistors]: https://classiccmp.org/mailman3/hyperkitty/list/test-drb%40ccmp.vtda.org/message/FQT5Q6A5Z72YYRFD2XIYELPGINCANG3U/ "Microprocessor Report figures, as transcribed by Mike Cheponis in May 2001"
[68000-transistors]: https://www.eetimes.com/motorolas-68000-microprocessor-receives-technology-award/ "Motorola Semiconductor Products Sector announcement, November 1996"

Transistor figures describe the original chips and link to their sources.
Treat them as approximate historical counts: conventions differ, including
whether pull-up devices and unused transistor sites are included. The 6502
figure follows Visual6502's 3,510-transistor model; the 6809 figure comes from
an archived transcription of Microprocessor Report data.

Source lines count the entire linked CPU implementation file, including
comments and blank lines, using `wc -l`. Shared helpers, tests, and machine
definitions are excluded. These counts describe the current incomplete models.

Completed examples are linked in each CPU section below and grouped by topic
in the [example catalog](../README.md#cpu-examples).

All eight initial CPU models have implementations; each remains incomplete.

The next milestone is the [CPU-only checkpoint across all eight targets](../../ROADMAP.md#cpu-only-checkpoint).
Interrupt delivery, interrupt-specific control instructions, port I/O, and
memory-mapped devices are deferred until then. Deferred instructions remain in
the documented-form totals; the checkpoint does not require a common percentage.

## How the percentages are counted

Opcode completion is **complete documented opcode forms / total documented
opcode forms × 100**, rounded to one decimal place. A positive result that
would round to zero is shown as **<0.1%**. It measures instruction
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
The full count includes 32 I/O forms even while I/O is deferred.

For the 6800, count each instruction/addressing encoding in tables 3–6 on
printed pages 18–21, expanding A/B choices. The total includes interrupt
instructions even while they are deferred. Undocumented encodings and
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
encodings and later x86 instructions are excluded, while deferred interrupts
and I/O remain in the total.

For the 68000, the operation word contains both register and effective-address
selectors, so they contribute separate forms. Literal operands do not: MOVEQ
immediates, ADDQ/SUBQ and shift counts, branch displacements, and TRAP vectors
are collapsed. Index extension words and MOVEM register masks do not multiply
forms, but each form must support all its documented choices to be complete.
The [count audit](68000/opcode-count.md) gives the permitted address sets and
family arithmetic. The current data-register subset has 88 long-operation
forms and eight MOVEQ forms. Those eight MOVEQ forms accept 2,048 operation
words because the low byte is an immediate operand, not an additional form.

## Support shared by the current models

| Area | Implemented scope |
| --- | --- |
| Memory connection | Flat RAM with recorded byte reads and writes: 16 KiB for the 8008, 1 MiB for the 8088, 16 MiB for the 68000, 64 KiB for the other current models |
| Initialization | Explicit caller-supplied registers and flags, copied and validated; no implicit reset |
| Inspection | Detached state snapshots, recursively readonly in TypeScript, without RAM access |
| Stepping | At most one instruction attempt; before/after snapshots, fetched instruction bytes, ordered accesses, and outcome |
| Reset records | Separate before/after snapshots and access list; CPU-specific reset effects |
| Arithmetic and addresses | Results wrap at their modeled widths; 14-bit addresses for the 8008, 16-bit addresses for the other 8-bit cores; the 8088 forms 20-bit physical addresses from segments/offsets; the 68000 preserves 32-bit registers and masks bus addresses to 24 bits |
| Unsupported attempts | `reason: "opcode"`, one opcode byte fetched (two for the 68000), unchanged CPU state and RAM; additional 6502 mode and 68000 alignment restrictions below |
| Lesson restart | Fresh CPU and RAM from the example factory |

All eight currently omit cycle counts, dummy bus accesses, electrical signals,
interrupt delivery, mapped devices, disassembly, and an
execution UI. Existing interrupt flags can be stored and inspected before interrupt
delivery is implemented; the 8008 has no interrupt-enable flag.

The following tables exhaustively list complete and partial opcode forms.
Unlisted forms remain unsupported. Opcodes and addresses are hexadecimal;
instruction lengths are in bytes.

## 8008

[Source](../../src/components/cpus/8008.ts) ·
[Model contract](8008/model.md) ·
[Arithmetic example](8008/examples/arithmetic.md) ·
[Example definition](../../src/machines/8008/example.machine)

[Stack specification](8008/examples/stack.md) ·
[Stack definition](../../src/machines/8008/stack-example.machine)

[Transfer specification](8008/examples/transfers.md) ·
[Transfer definition](../../src/machines/8008/transfers-example.machine)

[ALU specification](8008/examples/alu.md) ·
[ALU definition](../../src/machines/8008/alu-example.machine)

[Control-flow specification](8008/examples/control-flow.md) ·
[Control-flow definition](../../src/machines/8008/control-flow-example.machine)

| Opcode | Instruction | Addressing form | Length | Scope |
| --- | --- | --- | --- | --- |
| `00` | HLT | Implied | 1 | Advance PC and stop; preserve flags |
| `01` | HLT | Implied | 1 | Second documented low-page HLT encoding |
| `03/0B/13/1B/23/2B/33/3B` | RFc / RTc | Conditional return | 1 | Test C/Z/S/P for false or true; advance the outgoing PC, then select the previous slot only when taken |
| `04/0C/14/1C/24/2C/34/3C` | ADI / ACI / SUI / SBI / NDI / XRI / ORI / CPI | Immediate | 2 | All eight ALU operations with a fetched operand; [flag rules](8008/model.md#arithmetic-and-logic) match register/memory forms |
| `06/0E/16/1E/26/2E/36` | LrI n | Immediate | 2 | Load A/B/C/D/E/H/L; preserve flags |
| `07` | RET | Implied | 1 | Select the preceding address slot; preserve flags |
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
48 control-flow forms + 72 ALU forms = 194** complete forms. The control-flow
total includes 24 unconditional encodings and 24 conditional forms.

The 8008 now meets the [CPU-only checkpoint](../../ROADMAP.md#cpu-only-checkpoint).
Its control-flow example combines loads, arithmetic, logic, conditional
branches, calls and returns, and a RAM store in an independently checked
bounded run. The stack example and CPU tests additionally exercise nested
calls and the circular address registers.

| Area | Implemented scope |
| --- | --- |
| Stored state | A/B/C/D/E/H/L, S/Z/P/C, eight 14-bit address registers, selector 0–7, and halt state |
| Register views | PC selects an address-stack slot; HL exposes the raw H:L pair |
| Memory | Exactly 16 KiB RAM; instruction fetches wrap at 14 bits; H bits 7–6 are ignored for memory addressing while H remains a full byte in register transfers |
| Loads and transfers | All immediate and register/memory byte loads preserve flags; H/L memory destinations read through the original pair; stores do not read their destination |
| Arithmetic and logic | All eight accumulator operations across seven register sources, indirect memory, and immediate bytes; shared operation selector, explicit carry/borrow, logical C clearing, and compare preserving A |
| Control flow | Unconditional and all eight conditional jumps, calls, and returns; shared C/Z/S/P selector with explicit true/false choices; untaken jumps/calls still fetch their address bytes |
| Address stack | Eight circular address registers: CAL selects the next slot, RET selects the preceding slot; overwrite on overflow, retain outgoing PC after RET, no RAM stack |
| Reset | Model settled power-on clearing: zero data/address registers, select slot zero, stay stopped, preserve flags and RAM under the documented policy |
| Stopping | All three documented HLT encodings report once; already halted steps have no instruction or accesses |
| Remaining scope | Register increment/decrement, rotations, RST, interrupts, I/O, and timing |

Verification: [CPU tests](../../tests/components/cpus/8008.test.ts),
[arithmetic example tests](../../tests/machines/8008/example.test.ts),
[stack example tests](../../tests/machines/8008/stack-example.test.ts),
[transfer example tests](../../tests/machines/8008/transfers-example.test.ts),
[ALU example tests](../../tests/machines/8008/alu-example.test.ts),
[control-flow example tests](../../tests/machines/8008/control-flow-example.test.ts), and
[public type checks](../../tests/types/8008.ts). Checks cover every immediate ALU
operand pair and both carry inputs, all load bytes and flag patterns, arithmetic
boundaries, every H:L combination and PC, all selectors, and every unsupported opcode. Complete
records and actual RAM calls verify wrapping, overlapping/unchanged-value
stores, HALT, reset, and retained snapshots. Control-flow checks cover every
alias, encoded destination, selector, and flag pattern; wrapped fetches,
overflowing calls, and unbalanced returns. Examples check whole RAM images,
complete traces, bounded running, caller completion, and restart.
Parser and generator checks cover the smaller RAM size and explicit address list.
The load matrix checks every encoding, byte, and flag pattern, including
self-transfers, all PC slots, and HLT's lack of a data access. LAM and LMA
each check every H:L pair. Additional cases check all four address aliases,
H/L destination changes, LMI's wrapped and overlapping fetch/write sequence,
and current RAM. The transfer example verifies its fourteen-step trace,
whole memory image, and resumption from a snapshot.
All 72 ALU encodings also check every source byte and incoming flag pattern at
accumulator boundaries, including A as its own source. Independent decimal
arithmetic, logical truth tables, and digit counts supply expected results
and flags. Memory ALU cases check H's four address aliases, code overlaps,
and read-only accesses. The ALU example checks carry/borrow propagation, bit
operations, comparison, five output bytes, and resumption with a pending borrow.
Conditional control-flow checks cover all 24 encodings, flag combinations,
stack slots, taken/untaken paths, address aliases and wrapping, unchanged
inactive slots, and current flags and address bytes. The control-flow example
checks its 46-step trace, skipped failure path, single output byte, and
resumption between two conditional returns.

## 8080

[Source](../../src/components/cpus/8080.ts) ·
[Model contract](8080/model.md) ·
[Arithmetic example](8080/examples/arithmetic.md) ·
[Example definition](../../src/machines/8080/example.machine)

[Register-pair specification](8080/examples/register-pairs.md) ·
[Register-pair definition](../../src/machines/8080/register-pairs-example.machine)

[Stack specification](8080/examples/stack.md) ·
[Stack definition](../../src/machines/8080/stack-example.machine)

[PSW specification](8080/examples/psw.md) ·
[PSW definition](../../src/machines/8080/psw-example.machine)

[Addressing specification](8080/examples/addressing.md) ·
[Addressing definition](../../src/machines/8080/addressing-example.machine)

[Control-flow specification](8080/examples/control-flow.md) ·
[Control-flow definition](../../src/machines/8080/control-flow-example.machine)

[Transfers specification](8080/examples/transfers.md) ·
[Transfers definition](../../src/machines/8080/transfers-example.machine)

[ALU specification](8080/examples/alu.md) ·
[ALU definition](../../src/machines/8080/alu-example.machine)

[Decimal specification](8080/examples/decimal.md) ·
[Decimal definition](../../src/machines/8080/decimal-example.machine)

[Counted-loop specification](8080/examples/counted-loop.md) ·
[Counted-loop definition](../../src/machines/8080/counted-loop-example.machine)

[Rotates specification](8080/examples/rotates.md) ·
[Rotates definition](../../src/machines/8080/rotates-example.machine)

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
| `F1` | `POP PSW` | Stack | 1 | Read flags then A; ignore reserved flag bits; increment SP by 2 |
| `F2` | `JP addr` | Absolute target | 3 | Jump if S = 0 |
| `F4` | `CP addr` | Absolute target / stack | 3 | Call if S = 0 |
| `F5` | `PUSH PSW` | Stack | 1 | Write A then packed flags; decrement SP by 2; preserve A and flags |
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
| Stack | PUSH/POP for BC, DE, HL, and PSW plus control-flow return addresses, using a descending RAM stack and wrapping 16-bit SP; PSW packs/restores A and five flags with fixed reserved bits on PUSH; XTHL exchanges HL with stack memory without moving SP |
| Control flow | JMP, CALL, RET and all eight conditions for each; PCHL and RST 0–7; preserve arithmetic flags and interrupt enable |
| Reset | Set PC to `0000`, clear interrupt-enable and halted; preserve data registers, SP, flags, and RAM; no memory accesses |
| Stopping | HLT is implemented; subsequent steps return `halted` with no instruction or memory access |
| Accumulator arithmetic/logic | ADD/ADC, SUB/SBB, ANA/XRA/ORA, CMP and all immediate counterparts; 8-bit results, carry/borrow propagation, comparison without changing A, and 8080 auxiliary carry rules |
| Decimal adjustment | DAA corrects A using incoming AC/CY; updates result flags and AC while retaining or setting CY; no decimal-mode latch |
| Byte and word arithmetic | INR/DCR update byte results and S/Z/AC/P while preserving CY; INX/DCX wrap pairs and SP without changing flags; DAD adds to HL and updates only CY |
| Rotates and carry | RLC/RRC rotate within A; RAL/RAR rotate through CY; all preserve S/Z/AC/P. CMA complements A without changing flags; STC/CMC change only CY |
| Deferred instruction scope | DI, EI, IN, OUT; resume after the eight-CPU checkpoint |

Verification: [CPU tests](../../tests/components/cpus/8080.test.ts),
[arithmetic example tests](../../tests/machines/8080/example.test.ts),
[register-pair example tests](../../tests/machines/8080/register-pairs-example.test.ts),
[stack example tests](../../tests/machines/8080/stack-example.test.ts),
[PSW example tests](../../tests/machines/8080/psw-example.test.ts),
[addressing example tests](../../tests/machines/8080/addressing-example.test.ts),
[control-flow example tests](../../tests/machines/8080/control-flow-example.test.ts),
[transfers example tests](../../tests/machines/8080/transfers-example.test.ts),
[ALU example tests](../../tests/machines/8080/alu-example.test.ts),
[decimal example tests](../../tests/machines/8080/decimal-example.test.ts),
[counted-loop example tests](../../tests/machines/8080/counted-loop-example.test.ts),
[rotates example tests](../../tests/machines/8080/rotates-example.test.ts), and
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
Rotate/CMA/STC/CMC checks cover every accumulator value, all 32 flag combinations,
and both interrupt-enable values, using bit-string rotations and literal
regressions as independent expectations. They verify flag preservation, wrapped
PC, exact opcode reads, and current A/CY across successive operations. The
rotates example checks a word rotated through carry and restored, complete
records, final RAM, resumption between bytes, reset, and restart.
PSW checks independently cover every A/flag combination on PUSH and every
saved word on POP with both interrupt-enable values, including reserved bits,
wrapped PC/SP, overlapping opcode/data, mixed pair/PSW stacks, current RAM,
fixed-bit reconstruction, and retained records. NOP checks all flag combinations,
control preservation, wrapped PC, and exactly one opcode read. The PSW example
checks saved/restored state, use of restored carry, final RAM, and resumption
after a NOP step.
DAA checks cover every accumulator value and all 32 incoming flag combinations
with both interrupt-enable values, ordinary and wrapped PC, exact opcode reads,
and preserved unrelated state. Independent digit-wise correction and literal
regressions check all result flags, incoming carry retention, and non-BCD states.
ADI/ACI followed by DAA match decimal arithmetic for all two-digit operand pairs
and incoming carries. Successive adjustments retain independent records; the
decimal example checks carry propagation between bytes, complete records,
final RAM, resumption before adjustment, reset, and restart.

## 6800

[Source](../../src/components/cpus/6800.ts) ·
[Model contract](6800/model.md) ·
[Arithmetic example](6800/examples/arithmetic.md) ·
[Example definition](../../src/machines/6800/example.machine)

[Counted-loop specification](6800/examples/counted-loop.md) ·
[Counted-loop definition](../../src/machines/6800/counted-loop-example.machine)

[Stack specification](6800/examples/stack.md) ·
[Stack definition](../../src/machines/6800/stack-example.machine)

[Logic specification](6800/examples/logic.md) ·
[Logic definition](../../src/machines/6800/logic-example.machine)

| Opcode | Instruction | Addressing form | Length | Scope |
| --- | --- | --- | --- | --- |
| `16` | TAB | Inherent | 1 | Copy A to B; set N/Z, clear V, preserve H/I/C |
| `17` | TBA | Inherent | 1 | Copy B to A; set N/Z, clear V, preserve H/I/C |
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
| `32` | PULA | Inherent | 1 | Increment SP, then read A; preserve all flags |
| `33` | PULB | Inherent | 1 | Increment SP, then read B; preserve all flags |
| `36` | PSHA | Inherent | 1 | Write A at SP, then decrement SP; preserve all flags |
| `37` | PSHB | Inherent | 1 | Write B at SP, then decrement SP; preserve all flags |
| `39` | RTS | Inherent | 1 | Pull return address high byte first; preserve all flags |
| `4A` | DECA | Inherent | 1 | Decrement A; set N/Z/V, preserve H/I/C |
| `4C` | INCA | Inherent | 1 | Increment A; set N/Z/V, preserve H/I/C |
| `5A` | DECB | Inherent | 1 | Decrement B; set N/Z/V, preserve H/I/C |
| `5C` | INCB | Inherent | 1 | Increment B; set N/Z/V, preserve H/I/C |
| `84` | ANDA #n | Immediate | 2 | A AND operand → A; set N/Z, clear V, preserve H/I/C |
| `85` | BITA #n | Immediate | 2 | Set N/Z from A AND operand, clear V; preserve A and H/I/C |
| `86` | LDAA #n | Immediate | 2 | Load A; set N/Z, clear V, preserve H/I/C |
| `88` | EORA #n | Immediate | 2 | A XOR operand → A; set N/Z, clear V, preserve H/I/C |
| `8A` | ORAA #n | Immediate | 2 | A OR operand → A; set N/Z, clear V, preserve H/I/C |
| `8B` | ADDA #n | Immediate | 2 | Add to A without incoming carry; set H/N/Z/V/C, preserve I |
| `8D` | BSR rel | Relative | 2 | Push return PC low byte first, then branch relative to it; preserve flags |
| `8E` | LDS #nn | Immediate | 3 | Load SP; set N/Z from the full word, clear V, preserve H/I/C |
| `B7` | STAA addr | Extended | 3 | Store A; set N/Z, clear V, preserve H/I/C |
| `BD` | JSR addr | Extended | 3 | Push return PC low byte first, then jump to the high-byte-first target; preserve flags |
| `C4` | ANDB #n | Immediate | 2 | B AND operand → B; set N/Z, clear V, preserve H/I/C |
| `C5` | BITB #n | Immediate | 2 | Set N/Z from B AND operand, clear V; preserve B and H/I/C |
| `C6` | LDAB #n | Immediate | 2 | Load B; set N/Z, clear V, preserve H/I/C |
| `C8` | EORB #n | Immediate | 2 | B XOR operand → B; set N/Z, clear V, preserve H/I/C |
| `CA` | ORAB #n | Immediate | 2 | B OR operand → B; set N/Z, clear V, preserve H/I/C |

Opcode `21` is unused on the original 6800 and remains unsupported. It is not
the 6809's BRN instruction.

The 6800 now meets the [CPU-only checkpoint](../../ROADMAP.md#cpu-only-checkpoint).
Its logic example combines loads, stores, arithmetic, logic, conditional
branches, a call and return, and a saved accumulator on the RAM stack in an
independently checked bounded run. The stack example also checks nested calls.

| Area | Implemented scope |
| --- | --- |
| Stored state | Byte A/B, word X/SP/PC, and H/I/N/Z/V/C flags |
| Inspection | Detached registers and flags; no derived register pairs |
| Accumulator operations | Immediate A/B loads, A↔B transfers, and wrapping A/B increment/decrement; preserve H/I/C |
| Arithmetic and logic | Immediate addition to A; immediate AND, OR, XOR, and bit-test for A/B, with BIT updating flags without writing the accumulator |
| Control flow | BRA and all fourteen short conditional branches, relative BSR, extended JSR, and RTS; 16-bit targets and unchanged flags |
| Stack | Immediate LDS; A/B pushes and pulls; calls and returns share ordinary RAM, with SP pointing to the next free byte and wrapping at 16 bits |
| Memory | Exactly 64 KiB RAM; 16-bit PC wrapping; extended addresses fetched high byte first |
| Reset | Read FFFE then FFFF into PC, set I; preserve other registers, flags, and RAM under the model policy |
| Stopping | Caller completion address or step budget; unsupported instructions preserve state; no halt/wait latch |
| Remaining scope | Other loads/stores, arithmetic/logic, addressing forms including indexed JSR, jumps, remaining stack operations, interrupts, mapped devices, and timing |

Verification: [CPU tests](../../tests/components/cpus/6800.test.ts),
[arithmetic example tests](../../tests/machines/6800/example.test.ts),
[counted-loop tests](../../tests/machines/6800/counted-loop-example.test.ts),
[stack tests](../../tests/machines/6800/stack-example.test.ts),
[logic tests](../../tests/machines/6800/logic-example.test.ts), and
[public type checks](../../tests/types/6800.ts). Checks cover every addition
operand pair, every load/store/transfer/increment/decrement byte and incoming
flag pattern, arithmetic boundaries, every store destination, PC, and
reset-vector value. Literal branch truth tables check all flag combinations;
displacement checks cover every byte, both paths, and address boundaries.
Stack checks cover every LDS word, push/pull byte and flag pattern, full-width
SP, BSR displacement, and JSR/RTS target. Boundary cases verify LDS word flags,
code/stack overlap, PC/SP wrapping, byte order, and reads of edited stack RAM.
Independent per-bit truth tables check every logic operand pair in both
accumulators; mixed flag patterns and boundary operands check N/Z/V replacement,
H/I/C preservation, wrapped fetches, and BIT leaving registers unchanged.
Complete records and observed RAM calls verify wrapping, byte order,
self-modifying code, unchanged-value stores, unsupported attempts, reset, and
detached snapshots. The examples check whole RAM images, complete records,
bounded running, caller completion, reset, and fresh restart. The counted loop
also checks resumption and an edited displacement that branches to itself.
The stack example checks nested calls, saved accumulators, residual stack bytes,
resumption from snapshots and RAM at different call depths, and reset during a call.
The logic example checks all eight immediate forms, branches after BIT,
stack preservation, snapshot resumption, and edited masks that select alternate paths.
Parser and generator checks preserve the 6800's own state schema and generated
factory types.

## 6502

[Source](../../src/components/cpus/6502.ts) ·
[Model contract](6502/model.md) ·
[Arithmetic example](6502/examples/arithmetic.md) ·
[Example definition](../../src/machines/6502/example.machine)

[Stack specification](6502/examples/stack.md) ·
[Stack definition](../../src/machines/6502/stack-example.machine)

[Addressing specification](6502/examples/addressing.md) ·
[Addressing definition](../../src/machines/6502/addressing-example.machine)

[Counted-loop specification](6502/examples/counted-loop.md) ·
[Counted-loop definition](../../src/machines/6502/counted-loop-example.machine)

[Subroutine specification](6502/examples/subroutines.md) ·
[Subroutine definition](../../src/machines/6502/subroutines-example.machine)

| Opcode | Instruction | Addressing form | Length | Scope |
| --- | --- | --- | --- | --- |
| `10` | `BPL rel` | Relative | 2 | Branch if N = 0 |
| `18` | `CLC` | Implied | 1 | Clear carry |
| `20` | `JSR addr` | Absolute / stack | 3 | Fetch target low; push the last operand's address high then low; fetch target high and jump |
| `30` | `BMI rel` | Relative | 2 | Branch if N = 1 |
| `48` | `PHA` | Implied | 1 | Write A at 0100 + SP, then decrement 8-bit SP; preserve flags |
| `4C` | `JMP addr` | Absolute | 3 | Set PC from a low/high target; preserve flags |
| `50` | `BVC rel` | Relative | 2 | Branch if V = 0 |
| `60` | `RTS` | Implied / stack | 1 | Pull PC low then high and add one with 16-bit wrapping; preserve flags |
| `68` | `PLA` | Implied | 1 | Increment 8-bit SP, then read A at 0100 + SP; update N/Z |
| `69` | `ADC #n` | Immediate | 2 | Partial: binary arithmetic only; D must be false |
| `70` | `BVS rel` | Relative | 2 | Branch if V = 1 |
| `85` | `STA zp` | Zero page | 2 | Store A at 00:operand; preserve flags |
| `88` | `DEY` | Implied | 1 | Decrement Y; update N/Z |
| `8A` | `TXA` | Implied | 1 | Copy X to A; update N/Z |
| `8D` | `STA addr` | Absolute | 3 | Store A; address bytes low then high |
| `90` | `BCC rel` | Relative | 2 | Branch if C = 0 |
| `98` | `TYA` | Implied | 1 | Copy Y to A; update N/Z |
| `A0` | `LDY #n` | Immediate | 2 | Load Y; update N/Z |
| `A2` | `LDX #n` | Immediate | 2 | Load X; update N/Z |
| `A5` | `LDA zp` | Zero page | 2 | Load A from 00:operand; update N/Z |
| `A8` | `TAY` | Implied | 1 | Copy A to Y; update N/Z |
| `A9` | `LDA #n` | Immediate | 2 | Load A and update N/Z |
| `AA` | `TAX` | Implied | 1 | Copy A to X; update N/Z |
| `B0` | `BCS rel` | Relative | 2 | Branch if C = 1 |
| `C8` | `INY` | Implied | 1 | Increment Y; update N/Z |
| `CA` | `DEX` | Implied | 1 | Decrement X; update N/Z |
| `D0` | `BNE rel` | Relative | 2 | Branch if Z = 0 |
| `E8` | `INX` | Implied | 1 | Increment X; update N/Z |
| `F0` | `BEQ rel` | Relative | 2 | Branch if Z = 1 |

| Area | Current coverage |
| --- | --- |
| Stored registers | A, X, Y, SP, PC |
| Stored flags | N, V, D, I, Z, C; packed status and B/unused-bit conventions are not implemented |
| Register operations | Immediate A/X/Y loads, A↔X and A↔Y transfers, wrapping X/Y increment/decrement; replace N/Z and preserve V/D/I/C |
| Memory addressing | LDA and STA with one-byte addresses in fixed page zero; STA with an explicit 16-bit absolute address |
| Branches | All eight conditions; signed displacement relative to PC after the operand, with 16-bit wrapping; fetch the operand on both paths and preserve flags |
| Subroutines | Absolute JMP/JSR and RTS; JSR's final operand fetch follows its stack writes; RTS adds one to the saved pointer; preserve flags |
| Stack | PHA/PLA and subroutine return pointers in page 01 with wrapping 8-bit SP; pulls retain stored bytes; status stack forms are unsupported |
| Decimal mode | D can be initialized and inspected; ADC with D set reports `reason: "decimal-mode"` before operand fetch or state changes |
| Reset | Read `FFFC` then `FFFD` for PC, set I, subtract 3 from the 8-bit SP with wrapping; preserve other registers, flags (including D), and RAM |
| Stopping | The example caller stops at its completion address; the CPU has no synthetic halt or completion outcome |
| Remaining instruction scope | Further loads/stores, SP transfers, arithmetic and logic, decimal arithmetic, status stack operations, indirect JMP, and further flag operations |
| Remaining addressing scope | Indexed, indirect, and other forms beyond the exact encodings above |

All supported forms except ADC work with either D value. Decimal rejection is
an explicit implementation limit. Reset preserves D and therefore does not
remove it.
The model targets the original NMOS 6502; variant-specific behavior has not
been implemented.

Verification: [CPU tests](../../tests/components/cpus/6502.test.ts),
[arithmetic example tests](../../tests/machines/6502/example.test.ts),
[stack example tests](../../tests/machines/6502/stack-example.test.ts),
[addressing example tests](../../tests/machines/6502/addressing-example.test.ts),
[counted-loop example tests](../../tests/machines/6502/counted-loop-example.test.ts),
[subroutine example tests](../../tests/machines/6502/subroutines-example.test.ts), and
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
Register loads/transfers and index increments/decrements check every byte and
all 64 incoming flag combinations, N/Z replacement, preserved unrelated state,
and wrapping. All branch conditions are checked with every flag combination;
displacement checks cover every byte, both paths, page/address-space crossings,
and instruction-byte overlap. Further checks cover live flags after ADC and
register operations, current operands, and record ownership. The counted loop
checks nineteen complete records, actual RAM calls, both branch paths, full
memory images, bounded resumption and self-looping, reset, and fresh restart.

JMP/JSR checks cover every 16-bit target; RTS checks every stacked pointer and
its increment. All SP values and flag combinations, PC/SP wrapping, retained
stack data, unchanged-value writes, current operands, and code/stack overlap
are checked through complete records and observed RAM calls. Overlap cases
specifically check JSR's high operand after the pushes and RTS reading its own
opcode as stack data. The subroutine example checks thirteen complete records,
nested calls across page-one wrapping, a saved accumulator, the result store,
JMP completion, bounded resumption at different call depths, reset, and restart.

## 6809

[Source](../../src/components/cpus/6809.ts) ·
[Model contract](6809/model.md) ·
[Arithmetic example](6809/examples/arithmetic.md) ·
[Example definition](../../src/machines/6809/example.machine)

[Stack specification](6809/examples/stack.md) ·
[Stack definition](../../src/machines/6809/stack-example.machine)

[Addressing specification](6809/examples/addressing.md) ·
[Addressing definition](../../src/machines/6809/addressing-example.machine)

[Counted-loop specification](6809/examples/counted-loop.md) ·
[Counted-loop definition](../../src/machines/6809/counted-loop-example.machine)

| Opcode | Instruction | Addressing form | Length | Scope |
| --- | --- | --- | --- | --- |
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
| `34` | `PSHS mask` | Immediate register mask | 2 | Push any selection of CC/A/B/DP/X/Y/U/PC onto S; preserve flags |
| `35` | `PULS mask` | Immediate register mask | 2 | Pull any selection of CC/A/B/DP/X/Y/U/PC from S; flags change only if CC is selected |
| `36` | `PSHU mask` | Immediate register mask | 2 | Push any selection of CC/A/B/DP/X/Y/S/PC onto U; preserve flags |
| `37` | `PULU mask` | Immediate register mask | 2 | Pull any selection of CC/A/B/DP/X/Y/S/PC from U; flags change only if CC is selected |
| `4A` | `DECA` | Inherent | 1 | Decrement A; update N/Z/V; preserve E/F/H/I/C |
| `4C` | `INCA` | Inherent | 1 | Increment A; update N/Z/V; preserve E/F/H/I/C |
| `5A` | `DECB` | Inherent | 1 | Decrement B; update N/Z/V; preserve E/F/H/I/C |
| `5C` | `INCB` | Inherent | 1 | Increment B; update N/Z/V; preserve E/F/H/I/C |
| `86` | `LDA #n` | Immediate | 2 | Load A and update N/Z/V |
| `8B` | `ADDA #n` | Immediate | 2 | Add without incoming carry; update H/N/Z/V/C |
| `96` | `LDA direct` | Direct page | 2 | Load A from DP:operand; update N/Z and clear V |
| `97` | `STA direct` | Direct page | 2 | Store A at DP:operand; update N/Z and clear V |
| `B7` | `STA addr` | Extended | 3 | Store A and update N/Z/V; address bytes high then low; bypass DP |
| `C6` | `LDB #n` | Immediate | 2 | Load B; update N/Z and clear V; preserve E/F/H/I/C |

| Area | Current coverage |
| --- | --- |
| Stored registers | A, B, DP, X, Y, S, U, PC |
| Stored flags | E, F, H, I, N, Z, V, C; CC is packed/unpacked for stack transfers without a separate public CC state field |
| Register relationships | Snapshots derive D from A:B after loads, accumulator arithmetic, and stack pulls; 16-bit D operations and register transfers are not implemented |
| Accumulator operations | Immediate A/B loads and wrapping A/B increment/decrement; INC/DEC replace N/Z/V and preserve E/F/H/I/C |
| Memory addressing | Direct LDA/STA combine current DP with a one-byte operand; extended STA uses an explicit 16-bit address and bypasses DP |
| Branches | All sixteen encodings `20`–`2F`; signed displacement relative to PC after the operand, with 16-bit wrapping; fetch the operand on every path and preserve flags |
| Stack | S and U use descending RAM stacks with wrapping 16-bit pointers; all register masks work, including empty/full masks and the other pointer |
| PC stack transfers | Push saves PC after the postbyte; pull replaces PC and execution resumes there |
| Reset | Read `FFFE` then `FFFF` for PC, clear DP, set F/I; preserve other modeled state and RAM, including both stack pointers |
| Prefixes | `10` and `11` are rejected after the prefix byte alone; no second-byte fetch or opcode-page dispatch |
| Stopping | The example caller stops at its completion address; the CPU has no synthetic halt or completion outcome |
| Remaining instruction scope | Further B/D and register operations, arithmetic and logic beyond ADDA and accumulator INC/DEC, decimal adjustment, long branches, calls/returns, and other CC operations |
| Remaining addressing scope | Indexed, 16-bit relative, and other forms beyond the exact encodings above |

The [reset preservation policy](6809/model.md#cpu-reset) is specified in the
model contract; it does not claim hardware power-on values for unspecified
state. Interrupt handling, including NMI arming after reset, remains
unimplemented. MC6809/MC6809E clock and pin differences are outside this
instruction-level model.

Verification: [CPU tests](../../tests/components/cpus/6809.test.ts),
[arithmetic example tests](../../tests/machines/6809/example.test.ts),
[stack example tests](../../tests/machines/6809/stack-example.test.ts),
[addressing example tests](../../tests/machines/6809/addressing-example.test.ts),
[counted-loop example tests](../../tests/machines/6809/counted-loop-example.test.ts), and
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
LDB and accumulator INC/DEC checks cover every byte with all 256 CC values,
N/Z/V replacement, signed overflow, preserved E/F/H/I/C, wrapping, and derived D.
Branch truth tables cover all CC values, with every displacement checked on
each available path, page/address-space crossings, and instruction-byte overlap.
Further checks cover live flags after DECB and PULS, current operands, and
detached records. The counted loop checks twelve complete records, actual RAM
calls, both BNE paths, full memory images, bounded resumption and self-looping,
reset preservation, and fresh restart.

## Z80

[Source](../../src/components/cpus/z80.ts) ·
[Model contract](z80/model.md) ·
[Arithmetic example](z80/examples/arithmetic.md) ·
[Example definition](../../src/machines/z80/example.machine)

[Counted-loop specification](z80/examples/counted-loop.md) ·
[Counted-loop definition](../../src/machines/z80/counted-loop-example.machine)

[Transfer specification](z80/examples/transfers.md) ·
[Transfer definition](../../src/machines/z80/transfers-example.machine)

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
| `C6` | `ADD A,n` | Immediate | 2 | Add without incoming carry; set S/Z/H/PV/C from the result and clear N; PV means signed overflow |

| Area | Current coverage |
| --- | --- |
| Stored registers | A/B/C/D/E/H/L in main and alternate banks; IX, IY, PC, SP, I, R |
| Stored flags | S/Z/H/PV/N/C in both banks; undocumented F bits 3/5 and raw F/AF views are omitted |
| Register relationships | Snapshots derive BC, DE, and HL in both banks; pair loads update the main bank's stored bytes or SP; no bank exchanges yet |
| Register operations | Immediate and register/memory byte loads and immediate pair loads preserve flags; INC/DEC wrap byte registers and replace S/Z/H/PV/N, preserving C; the alternate bank is unchanged |
| Indirect transfers | HL addresses RAM for reads and writes; H/L destinations use the original HL address; HALT occupies the absent memory-to-memory transfer slot |
| Relative jumps | Unconditional JR and NZ/Z/NC/C conditions; signed displacement from PC after the operand, wrapping at 16 bits; fetch operand on every path |
| Counted loops | DJNZ decrements B and tests its result while preserving all flags; zero wraps to FF; BC follows the updated B |
| Interrupt state | IFF1, IFF2, and IM 0/1/2 can be initialized and inspected; no interrupt delivery or interrupt-control instructions |
| Refresh register | Each supported unprefixed opcode increments R bits 0–6 once, preserving bit 7; no increments for operand/data accesses |
| Reset | Clear PC/I/R, IFF1/IFF2, and IM; release HALT; preserve banks, flags, IX/IY/SP, and RAM under the documented model policy |
| Prefixes | CB/DD/ED/FD rejected after the first byte; all CPU state, including R, remains unchanged |
| Stopping | HALT reports its instruction once; already halted steps perform no accesses or refresh updates |
| Remaining instruction scope | Further transfers, arithmetic and logic, register exchanges, stack operations, absolute jumps, calls/returns, and I/O |
| Remaining addressing scope | Indirect forms beyond these HL byte transfers, indexed, prefixed, and other forms beyond the exact encodings above |

The model covers documented instruction semantics for the listed forms, not
undocumented flag bits or cycle activity. In particular, a physical Z80 keeps
refreshing during HALT; the instruction-level halted state does not model
those cycles. See the [model contract](z80/model.md) for unsupported-attempt and
reset-preservation policies.

Verification: [CPU tests](../../tests/components/cpus/z80.test.ts),
[arithmetic example tests](../../tests/machines/z80/example.test.ts),
[counted-loop example tests](../../tests/machines/z80/counted-loop-example.test.ts),
[transfer example tests](../../tests/machines/z80/transfers-example.test.ts), and
[public type checks](../../tests/types/z80.ts). ADD checks every byte operand
pair against independent column addition and signed-range overflow, with old
flags clear and set. Boundary programs exercise all flag patterns alongside
the 8080, independently checking parity versus overflow. Other checks cover
all immediate-load bytes and flag patterns, nested state isolation, register
views, exact accesses, PC and R wrapping, current RAM, overlapping stores,
every unsupported first byte, HALT, reset, and retained records. The generated
example and runner checks verify complete records, final RAM, and bounded
resumption with the concrete Z80 types.
The transfer matrix checks every encoding and byte while cycling through all
flag patterns, with additional code-overlap and H/L aliasing cases. Immediate
memory stores check every byte and flag combination; pair loads check all four
selectors, boundary words, flag patterns, and wrapped fetches. The buffer-fill
example combines these loads with DJNZ and verifies its 23-step trace and RAM.
Register load and INC/DEC checks cover every byte and all 64 flag patterns,
signed overflow, half carry/borrow, carry preservation, pair views, and alternate
bank isolation. JR conditions cover every flag pattern; DJNZ covers every B
value and flag pattern. Every displacement is checked on each available path,
including wrapping and instruction overlap. All supported opcodes are checked
with every R value. Further checks cover live flags after ADD/INC, current
operands, and detached records. The counted loop checks ten complete records,
actual RAM calls, full memory images, refresh wrapping, HALT, bounded resumption,
reset and restart, and a zero initial count producing 256 iterations.

## 8088

[Source](../../src/components/cpus/8088.ts) ·
[Model contract](8088/model.md) ·
[Arithmetic example](8088/examples/arithmetic.md) ·
[Example definition](../../src/machines/8088/example.machine) ·
[Transfer example](8088/examples/transfers.md) ·
[PC reference review](8088/reference-notes.md)

| Opcode | Instruction | Addressing form | Length | Scope |
| --- | --- | --- | --- | --- |
| `04`, `05` | `ADD AL,n`, `ADD AX,nn` | Immediate byte/word | 2/3 | Add without incoming carry; set CF/PF/AF/ZF/SF/OF at operand width, preserve TF/IF/DF and AH for byte operations |
| `A0`, `A1` | `MOV AL,[offset]`, `MOV AX,[offset]` | Direct offset in DS | 3 | Read one/two bytes after fetching the word offset; preserve all flags and AH for byte loads |
| `A2`, `A3` | `MOV [offset],AL`, `MOV [offset],AX` | Direct offset in DS | 3 | Write one/two bytes without destination reads; words use consecutive physical addresses; preserve all flags |
| `B0`–`B7` | `MOV r8,n` | Immediate byte | 2 | All eight byte registers; preserve the other half of the word and all flags |
| `B8`–`BF` | `MOV r16,nn` | Immediate word | 3 | All eight general word registers; replace the whole word and preserve all flags |

These families contribute **2 + 2 + 2 + 8 + 8 = 22** complete forms. Byte
and word register selectors follow their distinct encoded orders. Immediate
values and direct offsets are operands and do not add coverage forms.

| Area | Implemented scope |
| --- | --- |
| Stored registers | AX/BX/CX/DX, SP/BP/SI/DI, CS/DS/SS/ES, IP; all 16-bit |
| Stored flags | CF/PF/AF/ZF/SF/TF/IF/DF/OF; no packed FLAGS or reserved-bit policy yet |
| Register views | AL/AH, BL/BH, CL/CH, DL/DH derived from word registers; byte writes preserve the other half; physical PC derived from CS:IP |
| Memory | Exactly 1 MiB RAM; segment × 16 + offset wraps at 20 bits; byte transfers and unaligned word loads/stores supported |
| Instruction fetching | CS:IP, with IP wrapping at 16 bits between bytes; low-byte-first immediate words and offsets |
| Data words | Translate DS:offset once, then read/write consecutive physical bytes with 20-bit wrapping |
| Arithmetic | Operand width determines CF/ZF/SF/OF; PF uses only the low byte; AF records carry out of bit 3 |
| Reset | CS=FFFF, IP=0000, DS/SS/ES=0000, all flags clear; preserve general registers and RAM under the documented model policy; no vector reads |
| Prefixes | All rejected after the first byte with unchanged state and RAM; no segment overrides, LOCK, or repetition yet |
| Remaining scope | Other transfers and arithmetic, ModR/M addressing, logic, branches, calls/returns, stack operations, HALT, interrupts, I/O, and timing/prefetch behavior |

Verification: [CPU tests](../../tests/components/cpus/8088.test.ts),
[arithmetic example tests](../../tests/machines/8088/example.test.ts),
[transfer example tests](../../tests/machines/8088/transfers-example.test.ts), and
[public type checks](../../tests/types/8088.ts). Checks cover every load/store
word, direct offset, and IP; all flag patterns; independent arithmetic
expectations; register aliases; logical and physical boundary cases; every
unsupported first byte; reset; current RAM; and detached records. The example
checks complete traces, actual RAM calls, full memory images, physical completion
addresses, bounded resumption, reset, and restart. Parser and generator checks
cover word state, derived-view rejection, and one-megabyte memory bounds.
Register-family checks cover every selector and byte immediate, every byte-add
operand pair, preserved byte halves, byte versus word flag boundaries, direct
load/store widths, data reads after complete offset fetches, and sentinels.
The transfer example checks all five families together, physical completion
aliases, snapshot restoration, and detached earlier records.
An additional [hardware-test comparison](8088/reference-notes.md#independent-hardware-comparison)
passed all 109,996 unprefixed cases supplied for the 22 supported encodings.

## 68000

[Source](../../src/components/cpus/68000.ts) ·
[Model contract](68000/model.md) ·
[Arithmetic example](68000/examples/arithmetic.md) ·
[Example definition](../../src/machines/68000/example.machine) ·
[Mac reference review](68000/reference-notes.md) ·
[Opcode-count audit](68000/opcode-count.md)

[Transfer example](68000/examples/transfers.md) ·
[Transfer definition](../../src/machines/68000/transfers-example.machine)

The operation-word patterns below are binary. Register fields `ddd` and `rrr`
select D0–D7 in numeric order; `iiiiiiii` is MOVEQ's signed immediate byte.
All combinations shown are supported, including register self-transfers.

| Operation-word pattern | Instruction | Forms | Length | Scope |
| --- | --- | --- | --- | --- |
| `0000 0110 10 000 rrr` | `ADDI.L #n,Dn` | 8 | 6 | Unsigned long result; set X/N/Z/V/C, preserve T/S and interrupt mask |
| `00 10 ddd 000 000 rrr` | `MOVE.L Dm,Dn` | 64 | 2 | Replace the full destination and preserve the source; set N/Z, clear V/C, preserve X and control state |
| `00 10 ddd 000 111 100` | `MOVE.L #n,Dn` | 8 | 6 | Load the full long; set N/Z, clear V/C, preserve X and control state |
| `00 10 001 111 000 rrr` | `MOVE.L Dn,(addr).L` | 8 | 6 | Store high byte first at an even address; set N/Z, clear V/C, preserve X and control state |
| `0111 rrr 0 iiiiiiii` | `MOVEQ #n,Dn` | 8 | 2 | Sign-extend the embedded byte to a long; set N/Z, clear V/C, preserve X and control state |

| Area | Implemented scope |
| --- | --- |
| Stored state | D0–D7, A0–A6, USP/SSP, and PC as unsigned 32-bit values; X/N/Z/V/C/T/S and three-bit interrupt mask |
| Views | A7 derived from S and USP/SSP; physical PC derived from the low 24 bits of PC |
| Data-register families | All D0–D7 choices for long immediate load/add/store, register transfers, and MOVEQ; no register or quick transfer extension fetches |
| Memory | Exactly 16 MiB; mask addresses at RAM access, preserving full register values; big-endian words and longs |
| Instruction fetching | Even PC; 16-bit operation word; 32-bit immediate/address extensions; sequential PC wraps at 32 bits |
| Alignment | Word alignment for instructions and long operands; odd addresses rejected without state changes; address-error exceptions deferred |
| Reset | Read SSP from bytes 0–3 and PC from 4–7; set S, clear T, mask interrupts; preserve other registers, condition codes, and RAM under the documented policy |
| Remaining scope | Address-register operations, byte/word sizes, other effective-address families, logic, branches, calls/returns, stack operations, packed status, STOP, exceptions, interrupts, devices, timing, and prefetch |

Verification: [CPU tests](../../tests/components/cpus/68000.test.ts),
[example tests](../../tests/machines/68000/example.test.ts), and
[public type checks](../../tests/types/68000.ts). Checks cover every unsupported
operation word, all incoming flag patterns, independent BigInt arithmetic
expectations and low-word sweeps, full register ranges, active stack selection,
big-endian accesses, high-byte aliases, PC and physical-bus wrapping, odd-address
rejection, reset vectors, current RAM, overlapping stores, and detached records.
The example checks literal complete traces, actual RAM calls, full memory images,
logical completion, bounded resumption, reset, and restart. Parser and generator
checks cover unsigned long state, derived-view rejection, 16 MiB bounds, and
32-bit completion addresses without relaxing the smaller CPUs' limits.

Register-family checks cover every data register, all 64 transfer pairs,
self-transfers, every embedded MOVEQ byte, and all incoming flag patterns.
Literal operation words provide expectations independently of the pattern helper.
Further checks cover reserved MOVEQ encodings, two-byte PC wrapping, current
register values and modified immediates, and rejected stores followed by corrected
operands. The [transfer example tests](../../tests/machines/68000/transfers-example.test.ts)
verify all five families together, carry versus overflow, complete traces,
actual RAM calls, full memory images with sentinels, snapshot restoration,
bounded resumption, reset and rerunning, and detached records.

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
| Sharp SM83 | 0% | Not started |
| Intel 8086 | 0% | Not started as a separate model |
| Intel 80286 | 0% | Not started |
| Intel 80386 | 0% | Not started |
| ARM2 | 0% | Not started |
| ARM7TDMI | 0% | Not started |

## Keeping this tracker current

When support changes, update the relevant opcode rows, complete and partial
counts, percentages, restrictions, and feature status in the same change.
Refresh source-line counts whenever a CPU implementation file changes:

```sh
wc -l src/components/cpus/{8008,8080,6800,6502,z80,6809,8088,68000}.ts
```

Keep each denominator tied to its stated CPU variant and counting rules.
Link to the tests, model contracts, and example specifications that establish
the behavior. Keep current progress here; update the relevant contract or
specification when its behavior or acceptance criteria change, and update
overview documents when scope, milestones, architecture, or workflow changes.
