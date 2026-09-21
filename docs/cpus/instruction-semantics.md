# Instruction semantics experiment

This implements the bounded executable review in
[stage 5 of the shared-building-blocks proposal](shared-building-blocks.md#5-execute-one-slice-and-produce-a-useful-second-output).
Typed definitions drive validation, a reproducible [expanded listing](semantic-examples.md),
and generated TypeScript instruction bodies used by all eight initial CPU models.
The public execution interfaces and supported opcode inventories are unchanged.

The experiment asks whether an instruction's meaning can be described clearly
enough for execution and explanation to share one source. The authored
[definitions](../../src/components/cpus/semantics/definitions.ts) pair prose with
structured bodies. This representation is independent of the external grammar
and document format used to author a CPU.

The [literate specification prototype](literate-specifications.md) now provides
an external authoring path into this representation. The language guide records
the executable chapters and their shared addressing rules; other definitions
remain TypeScript-authored.

The complete 8008, 8080, 6502, 6800, and 6809 models are now authored in their
[executable chapters](literate-specifications.md). The shared construction
patterns described below still explain the representation; for current 8080
behavior and encoding ownership, read its [chapter](../../src/components/cpus/specifications/8080.md).
The 6800 chapter owns stored state, packed condition codes, and every instruction
family, including addressing, encodings, and reusable stack/frame actions. Its
reset, waiting, execution, IRQ/NMI recognition, and public interface also come
from the chapter, with memory-only vector execution shared with the 6502.
The construction history below describes the earlier shared-builder migration;
the Z80, 8088, and 68000 retain TypeScript builders.

## The review slice

| Definitions | What they challenge |
| --- | --- |
| 68000 all MOVE/MOVEA, MOVEQ, EXT, SWAP, and EXG | Byte/word register views; active SSP/USP selection; source-before-destination decoding; pending auto-updates; program-space reads; alignment outcomes and partial writes |
| 68000 AND/OR/EOR, ordinary ANDI/ORI/EORI, CLR/NOT/TST | Shared operand/source construction; destination updates before reads; flags before writes; real CLR reads and no TST writeback |
| 68000 ADD/SUB/CMP, immediate/quick/address forms, ADDX/SUBX, NEG/NEGX, CMPM | Shared destination stages and arithmetic; X and cumulative Z; signed word sources for 32-bit address arithmetic; repeated An operands and fault commit points |
| 68000 BTST/BCHG/BCLR/BSET, shifts/rotates, and TAS | Modulo bit numbers; aliased count registers; zero-count flags; named local iteration for result/X/C/overflow; flags before partial writes |
| 68000 MULU/MULS/DIVU/DIVS, CHK, ABCD/SBCD/NBCD | Source updates after word results and before exceptions; separate quotient-overflow capture; signed bounds; explicit digit correction and cumulative decimal flags |
| 68000 Scc/DBcc, BRA/Bcc/BSR, LEA/PEA/JMP/JSR, LINK/UNLK/RTS | Shared native condition captures; separate sequential cursor and target selection; stack-before-target validation; delayed stack/counter commits and A7 aliases |
| 68000 MOVEP and MOVEM, both widths and directions | Alternate-byte transfers; explicit mask order, complete-register loads, captured base bank, and final pointer commit; preserve earlier transfers on failure |
| 68000 CCR/SR, USP, system operations, and RTE/RTR | Privilege before operand effects; captured status before immediate fetching; status before pending updates; explicit return-frame reads and target validation; device reset signal |
| 8088 immediate MOV and accumulator ALU/TEST, word INC/DEC, AX/register exchanges | Low/high byte views with live preservation of the other half; operand-before-CF capture; low-byte parity for words; explicit flag/write ordering; generated encoding bindings |
| 8088 ModR/M MOV/XCHG, absolute accumulator MOV, and immediate r/m MOV | Resolved segment/offset inputs; byte-offset wrap before physical projection; complete source capture and low-first partial writes |
| 8088 ModR/M and immediate ALU/TEST | Reuse resolved operands and accumulator arithmetic; source before destination before CF; sign-extended immediates; flags before partial writes; CMP/TEST without operand writes |
| 8088 INC/DEC/NOT/NEG, Jcc/LOOP/JCXZ/relative JMP, sign extension, status, and halt | Restore captured CF before unary writeback; short-circuit conditions; decrement before testing CX; partial status updates and live AL preservation; CPU-owned retirement |
| 8088 PUSH/POP, near/far CALL and RET, indirect/far JMP | Segmented word stacks; pointer/source capture ordering; full FLAGS replacement; explicit interrupt-deferral requests committed at retirement |
| 8088 segment MOV, LEA, LES/LDS, XLAT, CLI/STI, and IRET | Resolved transfers, complete pointer capture, live AH, and shared return/FLAGS/deferral sequences |
| 8088 MOVS/CMPS/STOS/LODS/SCAS, with legal repeats and source overrides | Zero-count guard; captured addresses; subtraction flags; live DF/indices/count; one element and conditional prefix-start rewind |
| 8088 shifts, rotates, multiply/divide, and decimal/ASCII adjustments | Full CL counts with ordered per-bit effects; complete products; explicit division outcomes before writes; short-circuit decimal flags and original-chip limits |
| 6502 CMP/CPX/CPY, every supported addressing form | Share subtraction without writeback; preserve V/D/I; C means no borrow |
| 8080 ADD/ADC/SUB/SBB/ANA/XRA/ORA/CMP and every immediate counterpart | Shared register, memory, and immediate sources; CY before A for ADC/SBB; parity, inverse half-borrow, and ANA's auxiliary carry rule |
| Z80 ADD/ADC/SUB/SBC/AND/XOR/OR/CP, including (IX+d)/(IY+d) | Chapter-owned byte sources and ALU actions with explicit overflow, half-carry, and N rules; enter indexed bodies after displacement/address resolution; preserve both-bank and prefix-decoding contracts |
| Z80 accumulator rotates and all documented CB shifts/rotates, including indexed forms | Preserve S/Z/PV on accumulator rotates; derive them for CB operations; share each memory body across HL/IX/IY, with flags before writeback and explicit failure boundaries |
| Z80 EX AF,AF′/EXX, I/R transfers, and NEG | Schema-owned alternate-bank references, whole flag-object exchange, explicit IFF2 reads, and flags before A |
| Z80 RLD/RRD and all eight block transfer/search forms | Direct nibble shifts; successful memory writes before flags; live pair rereads; one iteration and conditional PC rewind, with no hidden loop |
| Z80 BIT/RES/SET, including indexed forms | Fixed bit masks; BIT reads without writeback and preserves C; RES/SET write even unchanged values without accessing flags; share CB construction and bindings with shifts |
| 8080 INR/DCR and Z80 byte INC/DEC, including indexed forms | Chapter-owned read–adjust–flags–write bodies; Z80 indexed callers reuse its memory actions; preserve carry; distinguish 8080 inverse half-borrow and parity from Z80 half-borrow and overflow; retain calculated flags on failed writes |
| 8080 MOV/MVI and corresponding Z80 LD matrices, immediate and indexed forms | Chapters own the ordinary matrices; native Z80 indexed bodies retain resolved addresses; capture sources before writes, retain HL access timing and real indexed H/L operands, preserve every flag, and exclude HALT |
| 8080 STAX/LDAX/STA/LDA and corresponding Z80 accumulator LD forms | Capture BC/DE or the complete immediate address before A or memory; loads write only after a successful read, stores never read the destination, and neither direction accesses flags |
| 8080 LXI/LHLD/SHLD/SPHL and Z80 word loads/stores and SP copies, including ED and IX/IY forms | Share complete bodies with low-first fetching and memory accesses, high-first pair reads/writes, captured sources, and explicit second-byte failures; ED's HL forms reuse the unprefixed bodies |
| 8080 INX/DCX/DAD and Z80 word INC/DEC, ADD HL/IX/IY, ADC/SBC HL | Reuse pair descriptions and native base encodings; source before destination, optional C after both; write before flags; preserve all flags on adjustments and use the bit-11 H boundary on Z80 arithmetic |
| 8080 XTHL/XCHG and Z80 EX DE,HL and EX (SP),HL/IX/IY | Capture the register before SP; read memory low/high, write high/low, then replace the register; preserve completed writes on failure, SP, and flags; register-only exchanges swap high bytes before low bytes |
| 8008 Lr1r2/LrM/LMr and immediate LrI/LMI | Literate operand selection with native register selectors, matrix prefix, mnemonics, and a 14-bit memory mask; preserve full H/L bytes, source-before-address ordering, and address-slot fetching |
| 8008 AD/AC/SU/SB/ND/XR/OR/CP, every register/memory/immediate form | One literate body per operation across register, memory, and immediate encodings; typed carry inputs, S/Z/P/C, and an explicit 14-bit memory mask; retain address-slot fetching and supplied-byte rules |
| 8008 INr/DCr and RLC/RRC/RAL/RAR | Literate arithmetic and bit expressions; preserve C on adjustments, with explicit A-before-C rotate writeback and preserved S/Z/P |
| 8008 conditional/unconditional jumps, calls, returns, restarts, and halts | Explicit 14-bit targets and three-bit selector wrap; checked physical register arrays; no RAM-stack effects; retain ordinary versus supplied-byte fetching and all documented aliases |
| 6809 TFR/EXG, all legal same-width postbytes | Chapter writable views for D, CC, and S; match postbytes before reading both originals and writing either register |
| 6809 PSHS/PULS/PSHU/PULU and shared interrupt-frame transfers | One byte-mask recipe; each register captured at its turn, each pop committed after its complete read, explicit NMI arming and partial failures |
| 6809 LEAX/LEAY/LEAS/LEAU, SEX, ABX, MUL, and NOP | Resolved address inputs, precise flag policies, and unsigned byte multiplication with a full word result |
| 6809 CMPA/B/D/X/Y/U/S, every addressing form | Byte/word widths, D as A:B, and addressing that changes the register subsequently compared |
| 6800 CMPA/CMPB/CPX, every addressing form, and CBA | Share comparison construction; original CPX derives N/V from high bytes without low-byte borrow, Z from the whole word, and preserves C |
| 6502 LDA/LDX/LDY, every supported addressing form | Reuse comparison sources; delay destination and N/Z updates until the source succeeds |
| 6502 STA/STX/STY, every supported addressing form | Resolve the address before capturing the source; one write without a destination read or any flag access |
| 6502 ORA/AND/EOR and BIT, every supported addressing form | Reuse byte sources and N/Z; BIT preserves A and derives N/V from memory, separately from the masked result used for Z |
| 6800/6809 AND/BIT/EOR/OR on A/B, every supported addressing form | Share logical construction and operand bindings; N/Z describe the result, V clears, and BIT omits writeback |
| 6800/6809 byte loads and stores, every supported addressing form | Share N/Z with V cleared; stores capture A/B after addressing, never read the destination, and apply flags only after a successful write |
| 6800 word loads/stores for X/SP and 6809 word loads/stores for D/X/Y/U/S | Share byte/word transfer construction; high byte first, flags after both writes, explicit D split writes and LDS NMI arming |
| 6800/6809 ADD/ADC/SUB/SBC on A/B, 6800 ABA/SBA, and 6809 ADDD/SUBD | Share binary arithmetic with explicit carry/borrow input; apply flags before writeback, update H only for byte addition, and expose D split writes |
| 6800 TAB/TBA | Reuse the transfer recipe and Motorola byte-result policy, writing the destination before flags |
| All six 6502 register transfers | Share read/write behavior while selecting N/Z or preserving every flag; SP transfers do not access the stack |
| All 6502 ASL/ROL/LSR/ROR forms | One resolved address, an original-value write, a captured incoming carry for rotates, and separate C and N/Z stages; accumulator forms share the operation |
| All 6502 memory INC/DEC and INX/INY/DEX/DEY | Share wrapping byte updates while preserving C and the same memory-write boundaries |
| 8080 RLC/RRC/RAL/RAR | Circular or through-carry rotation; write A before CY and preserve every other flag |
| 6809 LSR/ROR/ASR/ASL/ROL on A/B and memory | Zero, carry, or sign-bit insertion; N/Z/C before writeback; left shifts set V to N XOR C, right shifts preserve V; memory bodies receive a resolved address and retain flags on a failed write |
| 6809 NEG/COM/INC/DEC/CLR/TST on A/B and memory | Reuse the same unary construction and bindings; INC/DEC/TST preserve C, TST omits writeback, and CLR retains the original memory read |
| All eleven 6800 unary operations on A/B and memory | Share the 6809's construction and selector table; omit the CLR read, clear C for TST, and set V to N XOR C for right shifts too |
| 6502 conditional branches and absolute/indirect JMP | Fetch before testing flags; read/write PC only when taken; keep the NMOS indirect pointer's page wrap explicit |
| 6800 short branches and JMP; 6809 short/long branches and JMP | Share conditions and displacement sources; preserve absent BRN on 6800, standalone LBRA on 6809, and indexed decoding before resolved JMP |
| 8080 conditional/unconditional JMP and PCHL; Z80 JP/JR/DJNZ | Share target fetching and condition construction; preserve supplied-byte PC rules, no target read for register jumps, and DJNZ's fetch–decrement–test order |
| 6502 PHA/PLA and JSR/RTS | Fixed stack page and byte-pointer wrap; PLA flags after the read; JSR's interleaved operand/stack access and RTS's final increment |
| 6800 A/B pushes/pulls and BSR/JSR/RTS; 6809 BSR/LBSR/JSR/RTS | Share big-endian word construction with distinct pointer position; preserve partial effects and indexed S updates before calls |
| 8080 BC/DE/HL and Z80 BC/DE/HL/IX/IY pushes/pops, all ordinary CALL/RET/RST | Capture sources before stack access; defer destination writes until complete pops; share conditional calls/returns while retaining supplied-byte and retirement contracts |
| 6502 ADC/SBC, all addressing forms; PHP/PLP, flag changes, and NOP | NMOS binary/decimal flag timing, invalid decimal digits, shared packed status, and complete ordinary instruction migration |
| 6800 DAA, TAP/TPA, flag/index/SP adjustments, and NOP; 6809 DAA and ORCC/ANDCC | Shared correction with preserved H/control; status before mask fetching; explicit complete flag replacement |
| 8080/Z80 DAA, complements/carry controls, NOP/HALT, and PSW/AF stacks | Shared correction thresholds and layouts with distinct flag policies, result ordering, reserved bits, and delayed pop commits |

The [coverage report](coverage.md#completed-instruction-definition-migration)
tracks the current generated-body count. Most bodies bind through opcode or
postbyte selection; chapter actions and other helpers supply stacks, entry,
reset, counter writes, and resumption. Composed chapter actions are inlined at
their call sites and also exposed as standalone generated functions.
The earlier MOV B,A test sample is part of the complete 8080 matrix.
All eight CPUs have complete instruction-definition migration.
The 68000 has all 36,029 documented forms migrated, including ordinary MOVE/MOVEA,
data logic, arithmetic/comparison, bit operations, shifts/rotates, TAS, word
products/division, signed bounds, decimal arithmetic, ordinary control flow,
address calculation, stack frames, MOVEP/MOVEM, and status/system instructions. Bodies
start after opcode selection. Chapter-owned 6809 base-page and ordinary prefixed
forms include their addressing, as do all 6800 forms. Named opcode pages also
supply the 6809 prefix dispatcher. The existing
[boundary probes](boundary-probes.md#existing-models-executable-evidence) and
independent CPU tests are the behavioral baseline.

## Shared port I/O

The four CPUs with separate port space now use the same `read-port` and
`write-port` effects. Each effect transfers one byte at an unsigned 16-bit port
address. Narrow selectors widen explicitly; word transfers expand into two
byte effects with visible ordering and wrapping. Device validation and access
recording still use the cores' existing `recordPorts` callbacks.

[Port-transfer construction](../../src/components/cpus/semantics/ports.ts)
captures the complete address before reading an output operand or starting
input. Outputs capture the whole operand before the first write; inputs commit
the register/view only after every read succeeds. This serves Z80 immediate
I/O and register output, and all 8088 byte/word I/O. The 8008 and 8080 chapters
express those ordered effects directly in their formal port families.
Address sources expose the difference between an encoded 8008 selector, an
8080 immediate port, Z80 old-A-high/immediate-low, BC, and 8088 immediate/DX.
The 8088 byte view preserves live AH after a device callback.

Z80 register input captures C after the port read, replaces the complete flag
object, then writes the register. Block input uses BC before decrementing B;
block output uses BC after the decrement. Both retain the decrement if their
write fails, and update captured HL only after success. Their definitions
retain the NMOS H/C/PV/N rules and the repeat phase's H/PV corrections.
Repeated I/O executes one transfer and rewinds PC for the next step to refetch
both opcode bytes. Refresh and instruction retirement remain in the CPU.

The [independent port-definition tests](../../tests/components/cpus/semantics/ports.test.ts)
check all 66 forms against imperative effect schedules, injecting failure at
every observed state/flag/bus effect and changing live state during callbacks.
They also check exact inventories, port widths, lexical scopes, descriptions,
and capability inference. Existing CPU tests retain exhaustive byte/count/flag
expectations, port records, wrapping, disconnections, malformed devices,
supplied instructions, and guard release. [Type checks](../../tests/types/instruction-semantics.ts)
keep port and memory capabilities distinct.

## Interrupt and control instructions

The 20 remaining 8-bit interrupt/control forms now use complete definitions:
6502 BRK/RTI; 6800 SWI/WAI/RTI; 8080 DI/EI; Z80 DI/EI, IM 0/1/2, RETN/RETI;
and 6809 SWI/SWI2/SWI3, SYNC/CWAI/RTI. This completes instruction migration for
all six 8-bit CPUs. External offer validation and recognition, supplied-byte
fetching, reset, retirement, and device notification delivery use the cores or
shared runtime services selected by chapter execution contracts.

Chapter actions list frame fields in physical transfer order. They capture
each field only at its turn and commit each popped field after its complete
read. The 6800 and 6809 reuse their chapter byte/word primitives while retaining
their free/occupied stack pointers and native field order. The former
`stackFrame` builder is no longer needed. `loadVector` reads both bytes in the selected byte order before
committing PC. The 6502 explicitly pushes separately read PC bytes, preserving
live changes between accesses, and consumes BRK's padding before entry. Its
external-entry body shares that sequence with the saved B marker clear.
The 6800 external-entry body shares SWI's frame and WAI reuse rules.

Control choices are schema-owned: Z80 IM is `0 | 1 | 2`; 6809 wait mode is
`"none" | "sync" | "cwai"`. `testChoice` captures a Boolean comparison at a
specific point; `writeChoice` assigns only a declared alternative. They do not
introduce general string expressions. `writeLatch` also accepts captured Boolean
expressions, allowing Z80 IFF restoration without an implicit live read.

8080/Z80 `deferInterrupt("irq")` requests inhibition at successful retirement.
The existing 8088 scopes remain `"intr" | "all"`. Z80 `notifyReti()` requests
device notification after architectural retirement; a failed stack read cannot
notify, while a failing device notification leaves a fully retired return.
The generator infers these as separate capabilities, including effects nested
under conditions. It validates each against the CPU's boundary contract.

The [independent control tests](../../tests/components/cpus/semantics/interrupt-control.test.ts)
compare all 20 forms and both external-entry helpers with imperative schedules,
including failure at every observed state/flag/bus effect and live callback
changes. Existing CPU tests retain the recognition, record, deferral, notification,
wait/wake, wrapping, and failure expectations. [Effect tests](../../tests/components/cpus/semantics/control-effects.test.ts)
and [type checks](../../tests/types/instruction-semantics.ts) cover schema choices,
Boolean captures, conditional capabilities, and CPU-specific request scopes.

## Completing the 8088 controls

INT3, INT, INTO, WAIT, and all eight ESC primary encodings complete the 8088's
instruction migration. Four numeric definitions join the generated opcode
bindings. Two resolved ESC bodies cover every ModR/M byte after the existing
CPU decoder fetches it and, for memory forms, resolves its segment and offset.
The [control module](../../src/components/cpus/semantics/definitions/8088.ts)
also supplies interrupt entry and WAIT resumption without opcode fetching.

Entry expands existing segmented memory, packed FLAGS, latch, and stack
construction. It reads the entire four-byte vector first, captures FLAGS, clears
TF then IF and the recognition/wait/halt latches, and pushes FLAGS, live CS,
then live IP. Only complete writes allow target CS and IP to be committed.
This preserves overlapping vectors/stacks, live changes between words, partial
failures, and previously owed traps. INT fetches its type byte before entry;
INTO reads OF and skips every delivery effect when clear. `reportInterrupt`
records software delivery after completion; it performs no CPU or memory work.
Trap, divide-error, INTR, and NMI paths call the same generated entry body.

WAIT captures `readTest` once, then writes the waiting latch. First entry
rewinds IP only when busy; resumption advances it only on release. Both read
live IP after the pin callback, wrap it within sixteen bits, and request
all-interrupt deferral only for a low sample. Resumption never refetches an
opcode, and CPU-owned retirement retains the existing TF sampling policy.

ESC's memory body reads a complete low-first dummy word through a captured
segment/offset, even when no device is connected. The register body inspects
no CPU register. Both construct the external opcode from the captured primary
and ModR/M fields, then use `sendEscape` with explicit captured request data.
The [device adapter](../../src/components/cpus/8088-external.ts) gives the device
a detached request and records only after callback success. Its TEST adapter
validates a Boolean physical level before recording or returning it. Neither
adapter performs instruction state transitions, memory reads, or interrupt entry.
The public connection and execution-record types remain compatible.

The three new effects—`read-test`, `send-escape`, and `report-interrupt`—are
validated against the 8088 context, with explicit Boolean/byte/word/address
requirements and ordinary lexical scope checks. A shared capability mapping
selects context types and imports for all CPUs, including effects in conditional
bodies; ordinary instructions gain no device or reporting capability.

[Independent definition tests](../../tests/components/cpus/semantics/8088-control.test.ts)
compare imperative effect schedules, inject failure at every observed state,
flag, memory, pin, request, and reporting effect, and mutate live state during
callbacks. They cover every ESC primary/ModR/M combination, vector/frame
aliasing, wrapping, wait/resume paths, request ownership, malformed pin levels,
and conditional capability inference. Existing
[interrupt](../../tests/components/cpus/8088/interrupts.test.ts) and
[external-device](../../tests/components/cpus/8088/external.test.ts) tests retain
complete CPU records, recognition, prefixes, restart, device failures, and
reentrancy checks. [Type checks](../../tests/types/instruction-semantics.ts)
keep pin/device access and completion reporting distinct from memory access.

## Representation and authoring

[model.ts](../../src/components/cpus/semantics/model.ts) separates declarations,
pure expressions, and ordered statements. Its constructors return ordinary
readonly data. There is no instruction callback stored in a definition.

The authoring layers have separate homes:

| Location | Responsibility |
| --- | --- |
| [model.ts](../../src/components/cpus/semantics/model.ts) | Primitive expressions, statements, and CPU symbols |
| [builders.ts](../../src/components/cpus/semantics/builders.ts) | Shared sources, ordered word reads/writes, construction-time register views, comparison/transfer/shift/logical/arithmetic recipes, N/Z policies, and checked opcode inventories |
| [control-flow.ts](../../src/components/cpus/semantics/control-flow.ts) | Conditional effects, jumps, branches, calls, returns, and vector loads with explicit operand/condition/stack order |
| [ports.ts](../../src/components/cpus/semantics/ports.ts) | Shared byte/word port transfers: capture addresses before operands, transfer low byte first, and commit input only after complete reads |
| [stack.ts](../../src/components/cpus/semantics/stack.ts) | Descending byte stacks, explicit pointer position and fixed page, word byte order, masked register transfers, ordered frames, and complete push/pop instruction construction |
| [motorola.ts](../../src/components/cpus/semantics/motorola.ts) | Shared Motorola condition construction for remaining 68000 definitions |
| [intel.ts](../../src/components/cpus/semantics/intel.ts) | Remaining Z80 builders for indexed byte transfers, word transfers/arithmetic, exchanges, jumps, stacks, and subroutines, with explicit access ordering; accumulator rotates with CPU-specific flag stages |
| [intel-encodings.ts](../../src/components/cpus/intel-encodings.ts) | Remaining native Z80 word/accumulator-transfer, word-arithmetic, exchange, jump, stack, and subroutine encoding inventories consumed by definition construction and runtime binding; memory-to-memory transfer slots omitted |
| [status.ts](../../src/components/cpus/semantics/status.ts) | Pack and restore CPU-owned layouts, construct single-flag changes, and declare flag policies |
| [decimal.ts](../../src/components/cpus/semantics/decimal.ts) | Shared decimal-correction selection with explicit Intel/Motorola flag and result stages |
| [6502 chapter](../../src/components/cpus/specifications/6502.md) | Complete state, instruction inventory, NMOS arithmetic, status, reset, execution, and named external-entry policies |
| [6800 chapter](../../src/components/cpus/specifications/6800.md) | Complete stored state, packed condition codes, instructions, reset, WAI suspension, IRQ/NMI entry, and public interface |
| [6809 chapter](../../src/components/cpus/specifications/6809.md) | Complete model, indexed/page decoding, named wait modes, IRQ/FIRQ/NMI gates and frames, and public interface |
| [z80.ts](../../src/components/cpus/semantics/definitions/z80.ts) | CPU-specific sources, flag policies, instruction bodies, and authored explanations |
| [definitions.ts](../../src/components/cpus/semantics/definitions.ts) | Typed module catalogue shared by executable generation, explanation, and reproducibility checks |

Register each generated module once in `instructionModules`, with its filename
stem, CPU, definitions, and optional generation settings. Catalogue order is
explanation order. The executable definition inventory is derived from these
entries; standalone source probes remain generation options and do not count
as instruction bodies.

Each CPU definition module follows sources, policies, instruction construction,
then instruction definitions and their selectors. Shared recipes return data built from the existing
vocabulary; they add no runtime callbacks or new language primitives. The
compiler and reporter expand their results just like directly authored bodies.

`readWord` returns two ordered memory reads and the expression assembling their
captured bytes; `writeWord` splits a captured word into two ordered writes. Both
take `low-first` or `high-first` and two explicit addresses in access order.
Callers supply wrapping and segmentation and place register/flag effects around
the transfers. For example, Intel stack exchange reads low first at `address`,
then `next`, but writes high first at `next`, then `address`. No helper assumes
ascending addresses or moves a state update across an access.

The 6800 and 6809 chapters now own every comparison and transfer body with its
addressing. Their former `operandFamily` constructor is removed. The chapters
retain operand-first comparison schedules and flags after successful transfer
writes; stores do not read a source operand from the destination address.

Statement constructors such as `fetchByte("low")`, `readRegister("index", X)`,
and `writeMemory(address, byte)` return the corresponding data nodes. They do
not execute effects or reorder statements. Their arguments retain the explicit
capture names, registers, addresses, and values used by validation and reporting.

The 6502 chapter's encoding families compile through `opcodePattern` into
definitions, without runtime callbacks or a second handwritten opcode inventory.
`instructionSet` rejects duplicate or out-of-range opcodes before constructing
the inventory. ORA/AND/EOR, LDA, and CMP
share one `bbb` operand selector, derived from the same address inventory used by STA.
The immediate slot has no address, so STA omits that encoding. CPX/CPY and
LDX/LDY/STX/STY share Y/X register selectors; indexed loads and stores explicitly
select the other register for indexing. The definition's
opcode is also its generated method key, so there is no second list of method
names or handwritten per-instruction bindings. These are construction-time
families; the resulting definitions still contain only data.

`cpuSymbols(name, stateDescription)` imports the CPU's existing authority for
stored fields. It offers typed register, register-array, flag, control-latch, and control-choice names and records register
widths from that schema. There is no second register-layout declaration.
Current symbols cover stored unsigned registers at supported widths, fixed
arrays of those registers, the `flags` group, and top-level Boolean control
latches, plus declared numeric or named choices. Array symbols derive both length and element width from the schema.
`fillArray(array, value)` fills the existing array in ascending physical-slot
order, without reading old elements. It checks the symbol against the schema
and requires the value's width to match each element. The literate spelling is
`ARRAY[] <- value`; the 8008 reset action uses it to clear its eight address slots.
`cpu.bank("alternate")` exposes the stored unsigned registers and complete
flag object in that named top-level bank, using the same CPU declaration.
Register and individual flag references carry an optional bank name; they never flatten or copy
live bank state. Names and widths are checked against the owning schema.
Arbitrary nested paths and implicit register slices remain outside this API.
Composed reads use ordinary sources: 8080 HL is explicitly read as H then L,
and the 6809's D as A then B, before combining the bytes. `intelPairView` supplies
both that source and construction-time split writes, reusing `RegisterView`.
Compound transfer and arithmetic destinations use explicit ordered statements consuming
`result`: LDD writes A then B using `highByte`/`lowByte`; LDS writes S then
`writeLatch(cpu.latch("nmiArmed"), true)`. A latch is distinct from an architectural
flag. `readLatch` captures its Boolean value for later conditions or policies;
`writeLatch` accepts a Boolean constant or a captured Boolean expression.
`choice`, `testChoice`, and `writeChoice` retain the state schema's literal unions
for mode selectors; those fields cannot be accessed as registers or latches.

TypeScript distinguishes a register, a captured numeric expression, and a flag
expression. Registers and flags do not implicitly read themselves. A numeric
expression cannot be a flag formula or register destination. `readFlag` captures
a Boolean at an explicit statement boundary; `flagValue` refers to that capture.
Validation keeps Boolean and numeric captures distinct within the same lexical
scope, including source-local scopes. Schema-derived names catch
misspelled registers and flags at compile time. Runtime validation checks
CPU identity and widths; the current state-schema types do not retain literal
register widths in TypeScript, so the experiment does not promise compile-time
width checking.

An instruction may declare numeric `inputs`, such as `{ address: 16 }`. These
are captured values supplied at entry, before any body statement, and belong
to the body's initial scope. Their names and widths are validated, and a later
capture cannot redefine them. Sources and flag policies retain their separate
closed scopes; a policy receives an input only through an explicit argument.
Policy parameters may declare a supported numeric width or `"flag"`; numeric and Boolean
arguments remain distinct and are evaluated once before any flag assignments.
Passing captured carry into a policy never reads live C again.
This lets a body consume a resolved address without hiding address calculation
inside a callback or pretending it is a new memory-access primitive.

The shared `compare(left, right, policy)` construction function produces four
statements: capture the right operand, read the left register or source, capture
subtraction, and apply the policy. The right operand may be a source or a pure
expression over values already captured by the body. The left may be a stored
register or a source that reads a view such as D. All right-operand effects finish
before the left is read. Source bodies and policies remain present as named,
inspectable data. The construction function itself is TypeScript, with typed
parameters; there is no general parameterized instruction-body call node yet.
We can judge the repeated pattern without first designing higher-order DSL
parameters for every operand role.

The 6809 chapter applies N/Z/V/C at the compared operand's width, with C meaning
borrow; its former `motorolaComparison` builder is removed. The original 6800 CPX instead supplies a named
policy using `highByte(left)` and `highByte(right)` for N/V, whole-word subtraction
for Z, and no C assignment. Its explanation accompanies the policy in the 6800
definition. CBA uses the same `compare` recipe with B as its register source.

`arithmetic(operation, policy, incoming?)` consumes captured `left` and `right`
and an optional captured carry expression, captures `result`, and applies the
policy. The caller schedules reads and writeback. This preserves each model's
existing order: Motorola ADC/SBC read the operand, accumulator, then C; 8080
ADC/SBB read the operand, CY, then A. The 6800 and 6809 chapters now specify
N/Z/V/C directly at the operand width, with C meaning carry for addition and
borrow for subtraction. Only byte addition replaces H; subtraction and word
arithmetic preserve it. The 6809 reads the full operand before A/B or the D view,
then captures incoming C for ADC/SBC. ADD/SUB and ADDD/SUBD never read incoming C.
Flags precede destination writes, including D's explicit A-then-B writes.
The former Motorola arithmetic builders have been removed. Failed operand reads
retain completed fetching and address updates, without arithmetic or writeback.
Decimal adjustment remains separate from binary arithmetic.

The 8080 expands all eight byte ALU families over one B/C/D/E/H/L/M/A/immediate
source inventory. Its chapter uses explicit addition/subtraction expressions, with
S/Z/P derived from the byte result, CY as carry/borrow, and AC as low-nibble
carry or inverse half-borrow. ANA instead derives AC from bit 3 of the original
A OR the operand; XRA/ORA clear it. All three logical families clear CY.
Flags precede A writeback, while CMP omits the write entirely. The definitions
use existing expressions and policies without adding a semantic primitive.

The [Z80 chapter](../../src/components/cpus/specifications/z80.md) owns its
byte operand catalogue and eight ALU actions. Each captures optional C before A,
then applies flags before writeback; CP omits writeback. Arithmetic uses P/V for
overflow, H for half-carry/half-borrow, and N for subtraction. Logic uses parity,
sets H only for AND, and clears N/C. Native indexed bodies read a resolved address
once and perform the same chapter actions. The old `intelByteSources` and
`intelByteAlu` builders have been removed; the 8080's distinct rules also live
in its own chapter.

The Z80 also reuses `intelAccumulatorRotate` unchanged for RLCA/RRCA/RLA/RRA,
appending N/H clearing after A and C writeback. S/Z/PV remain unchanged. Its CB
RLC/RRC/RL/RR/SLA/SRA/SRL definitions use the existing `shift` recipe with their
own result S/Z/parity policy, cleared H/N, and outgoing C. Registers are read
once; memory bodies receive one resolved address shared by (HL), (IX+d), and
(IY+d). Only RL/RR read C, after the operand. Flags precede the result write,
including unchanged-value writes. A failed read prevents flags and writeback;
a failed write retains the calculated flags. Prefix decoding and refresh
increments remain outside the generated body, including the non-M1 displacement
and final opcode bytes in DD/FD CB sequences. The undocumented SLL row is omitted.

BIT/RES/SET use the same CPU-local `cbFamily` construction for a single register
or resolved-memory read and optional writeback. Each bit's mask is a literal in
the expanded definition. BIT isolates the selected bit, omits writeback, and
sets Z/PV when that bit is clear; S follows masked bit 7, H is set, N is cleared,
and C is preserved without reading it. This retains the model's observed S/PV
policy. RES ANDs with the complemented byte mask; SET ORs with the mask. Both
write even an unchanged result and never access flags. Their 192 bodies cover
240 forms: each of the 24 memory bodies serves HL, IX, and IY. No new semantic
primitive or generator path is needed.

The 8080 and Z80 chapters each own their byte adjustment policies and encodings.
Both read the original byte, calculate, apply flags, and then write the result,
preserving carry without reading it. The 8080 reports parity and inverse
half-borrow; the Z80 reports signed overflow and half-borrow. Z80 resolved-memory
actions serve both `(HL)` and native indexed callers, retaining one address
through read/modify/write and calculated flags after a failed write. The unused
`intelByteAdjustment` builder has been removed.

The 8008 chapter defines each of its eight ALU operations once, sharing the
body between register/memory and immediate encodings. Its source inventory
follows A/B/C/D/E/H/L/M. Memory concatenates captured
H/L and masks the address with `3FFF`, using the existing word-valued bitwise
expression; no 14-bit register primitive is introduced. S/Z/P describe the byte
result, C reports carry/borrow, and logic clears C. AC/SB capture C before A;
CP has no destination write. The bodies neither select nor explicitly update
address-stack slots. Ordinary fetching advances the selected PC slot, while
interrupt-supplied bytes preserve it. These fetch policies stay in the CPU.

The 8008's twelve INr/DCr forms read the selected B/C/D/E/H/L register and
wrap the adjustment to a byte. They apply S/Z/P before writeback, leaving C
unread and unchanged. Its four accumulator rotates use explicit literate
shift and flag expressions: capture A, optionally capture incoming C,
calculate, write A, then replace carry. Circular forms use the captured
outgoing bit without reading carry. Other flags are untouched. These bodies
have no fetch, memory, port, or address-stack operations.

`transfer(destination, source, policy?)` captures its source as `result`, writes
the destination, and optionally applies a policy with that result parameter.
The destination is a stored register or an explicit statement list using
`result`; those statements are expanded directly, without an opaque setter.
The 6502 chapter spells out the same stages for its 18 load forms and six
register transfers. It applies N/Z except for TXS, which preserves every flag.
A source that fails never reaches the destination write or flag update. The 6809
byte/word loads use the same recipe with a width-dependent N/Z policy and V
cleared; the 6800 chapter now expresses these stages and TAB/TBA directly.

`intelByteTransfer` builds explicit source-capture and destination-write
statements for the remaining Z80 indexed transfers. Register transfers retain a real
read and write even when the source equals the destination. Loads through HL
read H then L before memory and destination writeback. Stores capture the source
or fetch the immediate first, then read H/L and write memory without a destination
read. None accesses flags, alternate banks, or control state. A failed source
access prevents destination writes; completed fetching and decoding remain.

The [8008 chapter](../../src/components/cpus/specifications/8008.md)
expresses its `3FFF` mask directly, so memory accesses use only H:L's low 14 bits
without narrowing the stored bytes. The earlier masked Intel-helper path is
removed. Its
native inventory uses A/B/C/D/E/H/L/M selector order and the `11 ddd sss`
matrix, excluding `FF` HLT. Definition names retain Intel's Lr1r2/LrM/LMr and
LrI/LMI spelling. Immediate and register stores still capture the source before
reading H/L; the address-stack selector and STOPPED are outside the body.

Z80 indexed bodies use the same construction with a supplied address. Real H/L
remain byte operands, and changes to IX/IY after entry cannot redirect the access.
For `LD (IX/IY+d),n`, the CPU fetches d and resolves the address before the body
fetches n. Fifteen bodies cover both index registers' thirty transfer forms.
Ordinary transfers retain explicit H/L reads rather than entering at this
resolved-address boundary.

`intelWordTransfer` uses the existing `transfer` recipe for immediate word loads,
absolute loads/stores, and HL/IX/IY-to-SP copies. Absolute operations fetch both
address bytes before touching the source register or data memory. All fetching
and data-memory transfers are low byte first, with 16-bit address wraparound.
Stores capture the complete register before either write, including unchanged
writes; a failed second write retains the first. A failed second read prevents
all destination writes. Flags, alternate banks, and control state are never
accessed. SP copies capture the source and write SP with no instruction context.

`intelWordRegister` describes BC/DE/HL using the existing register-pair byte
mapping, with explicit high-then-low reads and writes; SP, IX, and IY remain
single stored word registers. These are construction-time descriptions expanded
into ordinary statements, with no runtime setters or new semantic primitives.
The seven shared base forms use one encoding inventory for definitions and
bindings. The Z80 adds ED and IX/IY bindings, with ED's HL forms calling the
same bodies as their unprefixed counterparts. Its prefix decoder still owns
recognition, PC/R advancement, and interrupt retirement.

The 6502 describes effective addresses as word-valued sources. They perform
operand fetches and any pointer reads, then stop before the final data read.
`memorySource(address)` resolves that address once and reads its byte. Comparison,
load, and logical bodies use these byte sources; generated stores and memory
modifiers use the address sources directly. Zero-page indexing wraps the byte
address before widening; absolute indexing wraps the word address. LDX uses Y for
indexed modes, whereas LDY uses X.

`sources6502` in the [test harness](../../tests/helpers/6502-sources.ts) groups
eight chapter address sources and eight `bbb` operand sources for standalone
generation probes. Production accumulator bodies inline the same selector inventory.
This removes a second addressing implementation and operand list from the CPU.
Indirect JMP uses its explicit page-wrapped pointer source. Generated JSR
fetches its operand bytes separately around the stack writes.

All thirteen STA/STX/STY forms use one store construction: read the address
source, read the source register, and write its captured byte once. There is no
destination read or flag statement. Failed address resolution prevents the
register read and write; a failed write retains completed fetches and pointer
reads while leaving every flag unchanged. The existing vocabulary expresses
these effects without a new primitive, target abstraction, or compiler path.

All 24 ORA/AND/EOR forms use the shared `logical` construction: read the operand,
capture A, combine the captured bytes, write A, then apply the existing N/Z
policy. 6502 BIT has a separate read-only definition and named flag policy: N is
memory bit 7, V is memory bit 6, and Z tests whether A AND memory is zero.
Both BIT modes reuse the same address sources. None of these operations reads
incoming flags or changes C/D/I; ORA/AND/EOR also preserve V. Decimal mode has
no effect. A failed source read prevents all later register and flag updates.

The Motorola chapters express AND/BIT/EOR/OR with the same ordered primitives:
capture the operand before the accumulator, calculate the result, optionally
write it back, then apply the result policy. N/Z describe the result, V clears,
and C/H/control flags are preserved. Motorola BIT omits writeback; unlike 6502
BIT, it derives N from the masked result and always clears V. The original
6800's ORAA/ORAB spelling is retained. No Motorola logical-family builder remains.

A `ValueSource` has a name, result width, ordered body, and pure result expression.
Its captures live in a fresh scope; only its yielded value enters its caller's
scope. Sources can explicitly update registers or access memory. Nothing about
the word “source” makes its body pure. A resolved memory address is an immutable
captured word used by later reads/writes, not a callback that can resolve again.

A `match` statement captures a byte selector and tests disjoint mask/value cases.
Each case has its own ordered steps and numeric result, checked against the
match's declared width. It inherits outer captures without exporting branch
locals. An unmatched byte returns `"unsupported"` from the enclosing body,
retaining completed effects. Sources may contain this fixed rejection path;
explicit fault/rejection statements remain restricted to instruction bodies.
Composed actions cannot use matches, including through sources. The chapter
language exposes [byte-pattern matches](literate-specifications.md#byte-pattern-matches)
with catalogue selectors and an explicit unsupported fallback.

Sources with a top-level match generate shared decoder functions, deduplicated by
their complete checked definition within each output module. Callers propagate
unsupported results before later effects. Ordinary straight-line sources still
inline. The 6809 chapter's one indexed source therefore serves base-page bodies
and prefixed instruction bodies without duplicating its decoder in every
executable instruction. Its standalone reader now belongs only to test probes.

An `Action` has a name, optional numeric inputs, and an ordered body.
`perform(action, arguments)` captures all arguments from the caller before
expanding its body in a fresh scope. Only parameters enter that scope; action
captures do not escape it. Validation checks exact argument names and widths,
state references, and every nested effect. Composed actions cannot reject an
instruction, including through nested sources or conditions. Generation inlines
the body and collects its required capabilities; the reporter shows the action
boundary and expanded effects. The chapter language exposes this as
[`perform`](literate-specifications.md#views-and-state-actions), with references
restricted to earlier actions so recursion cannot arise.

A `FlagPolicy` declares numeric parameters and Boolean assignments. Each
invocation binds exactly those parameters from captured caller values. Policies
cannot reference caller-local names implicitly, access live registers, or
perform memory operations. `unlisted: "preserve"` is mandatory. All assignments
within one invocation are simultaneous: evaluate every expression first, then
apply the updates. Distinct invocations remain at their declared positions in
the instruction body.

The [6502 chapter](../../src/components/cpus/specifications/6502.md#shifts-rotates-and-byte-adjustments)
now authors these byte updates directly. Memory families resolve one address,
read the original byte, and write it back before calculating the result.
Register families read and write their selected register. Shifts/rotates update
C before result writeback; all families apply N/Z only after writeback succeeds.
INC/DEC preserve C. The chapter's catalogue supplies all four memory addressing
modes; its explicit statements replace the former `updateByte` construction
recipe without imposing that schedule on other processors.

The shared `shift(direction, incoming)` recipe consumes the caller's `original`
capture and produces `result`, plus an outgoing-carry expression. Its incoming
bit can be zero (logical shift), the original sign (arithmetic right shift),
the outgoing bit (circular rotation), or a CPU flag symbol (through-carry
rotation). Only the flag-symbol case emits a `readFlag("carry", ...)` statement.
The caller places these steps at the required point and schedules flags and
writeback separately. Literate families use the same primitive shift expressions
and declare their incoming-bit reads and flag stages explicitly.

The 8080 writes A before replacing CY and preserves S/Z/AC/P. The 6809 instead
updates N/Z/C before writing A, B, or memory; left shifts also replace V with N XOR C,
while right shifts preserve V. That XOR uses the captured original and result,
so the policy does not depend on assignments to live N or C. The 6502 retains
its separate carry-before-writeback and N/Z-after-writeback stages, including
the original-value memory write before a rotate reads incoming C.
The 6800 and 6809 chapters own every unary form, including addressing. Each path captures the original byte when required, calculates the
result, applies N/Z and the operation's additional flags, and optionally writes
the result. INC/DEC preserve C; TST clears V and omits writeback. The chapters
state these differences explicitly:

| Rule | 6800 | 6809 |
| --- | --- | --- |
| Read the CLR operand | No: CLR only writes | Yes: CLR reads before applying flags and writing |
| Clear C on TST | Yes | No: preserve C |
| Set V on right shifts | Yes: V = N XOR C | No: preserve V |

Both CPUs use the same primitive vocabulary without a runtime CPU-model
branch. The former Motorola unary builder and its native operand wrappers have
been removed.

Every 6809 memory unary operation reads its operand once. Rotates capture
incoming C after that read; all operations except TST write once, including
unchanged values. A failed read leaves flags unchanged; a failed write retains
the completed flag updates. Address-register updates performed by the decoder
survive either failure.
The 6800 uses the same ordering except for CLR's omitted read. A failed CLR
write therefore retains its flag updates without any preceding data-memory read.

## Register views and postbyte-selected transfers

`RegisterView` remains a TypeScript construction helper pairing a source with
write statements. Chapters instead declare a writable operand as
`view D write writeD`: an earlier pure view and a one-input action of the same
width. The 6809 uses this for D's split A/B writes, CC's complete flag replacement,
and S's NMI arming. These lower into source reads and composed actions, without
runtime view objects or hidden setters.

The 6809 chapter describes `ssss dddd` using separate byte and word catalogues,
with reserved word slots explicitly `unsupported`. An effect match validates
the complete same-width pair before reading either original. TFR writes the
target; EXG then writes the captured target to the source, including self-aliases
and post-fetch PC values. Both instructions now have complete bodies that fetch
their own postbyte; the old 104 specialized bodies and native inventory are gone. LEA applies its destination write after indexed decoding has finished,
retaining auto-updates, indirect reads, and failures before entry. X/Y update
only Z; S arms NMI; U preserves all flags.

The chapter expresses SEX and ABX with widening and addition. MUL uses
unsigned byte multiplication: capture A/B, calculate a word, write A then B,
then update Z/C. The C expression explicitly selects product bit 7.
[Register probes](../../tests/components/cpus/semantics/6809-registers.test.ts)
check every legal transfer pair, flag replacement and arming, read/write order,
failed register effects, all byte products, and rejected multiplication widths.

## 8088 byte views and register families

The [8088 definitions](../../src/components/cpus/semantics/definitions/8088.ts)
use the existing `RegisterView` construction for scalar words and a
`byteRegisterView(register, "low" | "high")` for their byte slices. A byte source
reads the stored word once and extracts the selected half. Its write statements
capture `preservedWord` at writeback and concatenate the new byte with the
current other half. This prevents an earlier operand read from freezing the
retained byte across later flag effects. Each view write introduces that capture
in its containing statement scope; callers give distinct capture names when
multiple view writes share a scope, as in XCHG. No view primitive, live callback,
or runtime view object enters the generated body.

Immediate MOV and accumulator ALU/TEST fetch all operand bytes before reading
registers or flags. Words reuse the Intel low-first source; the CPU's fetch
callback owns CS:IP mapping and per-byte offset wrapping. ADC/SBB read CF only
after the accumulator. The shared arithmetic recipe computes the result and
updates CF/AF/OF/ZF/SF/PF before writeback; CF and AF report carry or borrow.
Logic clears OF then CF then AF, followed by ZF/SF/PF. AF remains deterministically
clear under the existing undefined-flag policy. PF always uses the low byte;
ZF/SF use the full operand width. CMP/TEST never write or reread AX.

Word INC/DEC capture the word and incoming CF, perform ordinary arithmetic flag
updates, restore the captured CF, and then write the destination. Register
exchanges capture the selected register before AX and write AX before the selected
register, including both reads and writes for NOP's self-exchange. None of these
bodies reads or changes TF/IF/DF or the execution-control latches.

One encoded register inventory serves definitions and runtime operands. Numeric
definition keys drive generated opcode bindings; the constructor combines them
with handwritten entries only after state initialization. The accumulator-dispatch
and register-adjustment wrappers are removed. Prefix decoding, REP rejection,
segmented fetching, trap sampling, and interrupt-deferral retirement remain in
the CPU.

[Definition probes](../../tests/components/cpus/semantics/8088-registers.test.ts)
check the original 58-form register inventory, every stored word through both
byte views, complete word INC/DEC ranges with both carries, effect order, all partial-effect
failures, live alias changes, and explanations. Independent existing CPU tests
exhaust byte arithmetic and exercise word boundaries. The
[fetch-failure tests](../../tests/components/cpus/8088/register-failures.test.ts)
check all 58 forms with prefixes, wrapping IP/physical addresses, retained
inhibition on failure, guard release, and REP/REPNE rejection before body entry.

### Resolved segmented transfers

ModR/M MOV and XCHG, absolute accumulator MOV, and immediate r/m MOV use the
same byte/word views after the existing decoder selects registers or resolves
one segment and offset. Register-to-register bodies specialize both selectors;
memory bodies receive the captured numeric segment and offset, with only the
fetch/read/write callbacks they need. The immediate register cases reuse the
earlier MOV bodies. These 306 new bodies cover twelve complete opcode forms;
no address-mode or register specialization earns additional opcode credit.

`projectAddress(segment, offset, 4, 20)` maps a logical byte to the physical bus.
Word bodies first add one to the offset with 16-bit wrapping, then project
that byte independently. They never increment an already projected address.
MOV captures the entire source before any write and never reads a memory
destination. XCHG reads r/m before the register, captures both values, writes
r/m, then writes the register. Each byte-view write preserves its live other
half, including AL/AH aliases. All accesses are low byte first; a failed second
access retains the first, and flags/control state remain untouched by the body.

[Transfer probes](../../tests/components/cpus/semantics/8088-transfers.test.ts)
cover every specialization, aliased views, changing live state, and failure at
every effect. [CPU boundary probes](../../tests/components/cpus/8088/transfer-failures.test.ts)
cover all twelve forms with prefixes, wrapping fetch/data addresses, overlapping
code, retained partial writes and inhibition, and guard release. C6/C7 reject
nonzero operation extensions before fetching displacements or immediates;
REP/REPNE rejection and retirement remain with the existing CPU boundary.

### Resolved arithmetic, logic, and TEST

The same register and memory operand construction now serves all eight ModR/M
ALU operations, both full-width immediate groups, the documented 82/83 operation
selectors, and register/immediate TEST. Their 1,631 specialized bodies cover
62 complete forms. The 82 byte forms reuse ordinary immediate bodies; 83
explicitly sign-extends its fetched byte to a word. TEST omits the nonexistent
memory-source direction; sign-extended forms omit logical operations.

All forms capture the complete source before reading the destination, then
ADC/SBB read CF. The shared `aluSteps` recipe also constructs the earlier
accumulator forms without changing their expanded definitions. Arithmetic
updates CF/AF/OF, then ZF/SF/PF; logical operations clear OF/CF/AF before the
result flags. Word PF uses only the low byte. CMP/TEST stop after flags; other
operations write afterward, preserving a byte register's live other half.
A failed memory write retains the new flags and any earlier byte write.

MOV, XCHG, ALU, and register TEST share one CPU-owned ModR/M binding. The
decoder resolves memory once and rejects unused immediate selectors before
fetching a displacement. F6/F7 /0 enters immediate TEST's complete generated
body; /1 remains unsupported, /2 and /3 enter generated NOT/NEG bodies, and
multiply/divide enter the generated arithmetic bodies described below. Prefix rejection, fetching, and
retirement remain outside the bodies.
The handwritten ALU function table, operand-pair/application wrappers, immediate
reader/TEST wrapper, and logical-flag helper are removed. String comparisons
now share the same generated subtraction construction.

[Definition probes](../../tests/components/cpus/semantics/8088-alu.test.ts)
check the entire specialization inventory, every effect and partial failure,
aliased registers, replaced flag objects, live byte halves, and fixed addresses
across callbacks. [CPU boundary probes](../../tests/components/cpus/8088/alu-failures.test.ts)
cover all 62 forms, prefixes, wrapped fetches and data, every failed byte,
retained flags and partial writes, successful retirement, and unused-selector
rejection. Existing independent CPU tests cover every addressing/register
choice, signed-byte values, overlapping code/data, and arithmetic boundaries.
Generated context types give CMP/TEST no write capability.

### Unary operations, relative branches, and status

INC/DEC/NOT/NEG cover eight register/memory forms with 72 specialized bodies.
They reuse the same register and memory operands as transfers and ALU.
INC/DEC capture CF after the complete operand, update CF/AF/OF/ZF/SF/PF,
restore CF, and then write. The original word-register INC/DEC now share that
construction without changing their expanded definitions. NEG subtracts the
operand from zero; NOT complements it without flag access. Memory writes
retain low-first order and offset wrapping, and byte views retain their live
other half. A failed write leaves completed flag updates intact.

Jcc, LOOP/JCXZ, and relative JMP use the shared `relativeBranchSteps` recipe
with the IP role. It reads and writes IP only on the taken path, after the
complete displacement fetch. The CPU still owns per-byte CS:IP fetching.
The construction helper `choose` combines two conditional statement arms.
Conditions use captured flag values, so one arm cannot change which other
arm is selected. `either` composes these decisions during construction to
preserve JBE/JA's CF-before-ZF and JLE/JG's ZF-before-SF/OF short circuits.
No runtime condition callback or new semantic primitive is introduced.
LOOP variants fetch, read/decrement/write CX, then reread it; a zero count
skips ZF. JCXZ reads CX once and never changes it.

CBW and CWD express sign extension with existing byte/word expressions.
SAHF/LAHF share the CPU-owned low FLAGS layout with runtime FLAGS packing.
`updateStatus` reuses the status decoder but updates individual flags:
SAHF changes CF/PF/AF/ZF/SF without replacing the flag object or disturbing
TF/IF/DF/OF. LAHF packs those flags before reading live AL for its AH write.
Carry/direction controls reuse `flagInstruction`; HLT writes only the halt
latch. Trap sampling and retirement remain in the CPU boundary.

These bodies add 40 complete forms: eight unary, 22 relative control-flow,
and ten sign-extension/status/halt forms. The unary-operation and condition
tables, generic operand-group wrapper, adjustment/addition helpers, and
handwritten jump/loop paths are removed. FE/FF still reject invalid selectors
before resolving an operand, and the remaining FF control/stack paths retain
their schedules.

[Definition probes](../../tests/components/cpus/semantics/8088-ordinary.test.ts)
check the exact added inventory, all flag patterns, short-circuit reads,
counter rereads, live byte halves, and every failed effect.
[CPU boundary probes](../../tests/components/cpus/8088/ordinary-failures.test.ts)
cover all 40 forms, prefixed and wrapping fetches, partial memory writes,
retained inhibition, guard release, and rejection before body entry.
Existing CPU tests independently check complete unary value ranges and branch
truth tables. Generated types restrict branches to byte fetching, unary
memory bodies to read/write access, and state-only bodies to their CPU state.

## 8088 segmented stacks and far control flow

`segmentedWordStack` shares push/pop instruction construction with the byte-stack
models, while making the 8088 schedule explicit. A push reads and decrements SP
by two, then captures SS:SP before writing low and high bytes. A pop captures
SS:SP, reads both bytes, then reads and increments live SP. Each logical offset
wraps to sixteen bits before physical projection. A callback cannot retarget
an in-progress word; a subsequent word captures the then-current segment and
pointer. Failed accesses retain completed pointer changes and byte transfers.

Register, segment, FLAGS, and memory pushes capture their full source first.
PUSH SP subtracts two from its captured source before the stack's separate SP
update. POP SP overwrites the incremented pointer. ModR/M POP captures its
memory destination before popping and writes low/high without reading it.
The decoder still rejects invalid selectors and resolves addresses before body
entry. Register PUSH/POP reuse the short-encoding bodies.

Near indirect calls capture the target before stacking return IP. Relative
CALL captures and pushes return IP, then reads live IP for the relative target.
Far calls capture the complete target before stacking CS, then read live IP
for the second push, and commit CS followed by IP after both pushes. Returns
pop IP and optional CS before committing either target, then add the immediate
discard count to live SP, including a zero count. These schedules preserve
stack/pointer overlap, callback changes, and partial failures.

PUSHF/POPF share a CPU-owned sixteen-bit FLAGS layout with runtime packing.
The status construction defaults to eight bits for earlier CPUs; an explicit
word width supplies the 8088's reserved bits and nine stored flags. POPF pops
the complete word, reads live IF, requests INTR deferral on a zero-to-one
transition, then replaces the entire flag object. Segment pops write their
register before requesting inhibition of all interrupt recognition.

`deferInterrupt("intr" | "all")` is an explicit, validated boundary effect,
currently allowed only for the 8088. It calls the instruction context's
`InterruptDeferralContext` capability at that point in the sequence. The
callback queues the request; only successful retirement commits the stored
inhibition latches. A failed body retains earlier architectural effects but
never retires the request. This keeps boundary policy in the CPU while making
the request visible to both execution generation and explanation.

These definitions cover 38 complete forms with 54 instruction bodies. The
complete generated entry now shares their word-push construction directly;
the earlier standalone word-push helper is retired. IRET composes those same
return and FLAGS statements in its own definition, as described below.

[Definition probes](../../tests/components/cpus/semantics/8088-stack.test.ts)
independently specify every body's state, memory, and deferral order, fail each
effect, change live state during accesses, and exhaust all FLAGS words with
both incoming IF states. [CPU failure probes](../../tests/components/cpus/8088/stack-failures.test.ts)
cover all 38 forms with prefixes, wrapped fetches and stacks, overlapping
pointers, every failed byte access, rejection, and guard release. Existing CPU
stack and interrupt tests remain independent checks. Generated types expose
only each body's required byte accesses and deferral capability.

## 8088 remaining transfers and string elements

Segment MOV bodies receive a decoded register or captured memory address.
They capture the complete source before writing; a segment load then requests
all-interrupt deferral. LEA writes only the resolved offset. LES/LDS share the
far-pointer read sequence with indirect far CALL/JMP, capturing all four bytes
before writing the general register and then the segment. They do not request
MOV/POP's recognition delay. XLAT reads BX, then AL, wraps their sum, selects
DS or the already captured override, and reads one byte. Its AL write preserves
the live AH after that access.

The [string definitions](../../src/components/cpus/semantics/definitions/8088.ts)
specialize byte/word width, operation, repetition condition, and source override.
Each body performs one element. Plain forms do not read CX or IP. Repeated
forms first read CX; zero skips the entire operand/flag/index sequence.

For nonempty operations, capture source segment/SI and fixed destination ES/DI
before any data access, retaining even unused operand coordinates from the
existing schedule. MOVS captures the whole source before writing; STOS captures
AL/AX; LODS preserves live AH on byte writes. CMPS reads source then destination,
while SCAS reads AL/AX then destination. Both reuse subtraction CF/AF/OF/ZF/SF/PF
construction without operand writeback. Word offsets wrap before projection.

Only after data and flag effects read DF, derive the signed byte/word delta,
and advance live SI then DI as required. Repeats then decrement live CX and
reread it. Only a nonzero count permits CMPS/SCAS to read their new ZF; REP
transfers never read ZF. A continuing iteration writes the supplied prefix-start
IP. The next CPU step refetches prefixes and operands, preserving snapshot
resumption, code/data overlap, and interrupt boundaries. REPNE remains invalid
for MOVS/STOS/LODS, rejected in the decoder before any body effects.

CLI clears IF without a read or deferral. STI reads IF, requests INTR deferral
only when clear, then sets it. IRET expands the same complete far return and
FLAGS restoration used by RETF/POPF. A failure reading FLAGS retains the already
restored IP/CS and completed SP changes; retirement still samples the original
TF. No new primitive or runtime callback is required for these instructions.

Together these add 19 forms through 140 bodies: 89 addressing/transfer choices,
48 string choices, and three numeric opcode bodies. The
[definition probes](../../tests/components/cpus/semantics/8088-strings.test.ts)
check every body's ordered effects, failure at each effect, callback changes,
all incoming string flag patterns, and empty/one/multiple repeat counts.
[CPU failure probes](../../tests/components/cpus/8088/segmented-failures.test.ts)
cover all 19 forms, prefix precedence, wrapping, overlap, failed accesses,
rejection before body entry, retirement, and guard release. Existing
[string tests](../../tests/components/cpus/8088/strings.test.ts) check refetching
and snapshot resumption. Generated types admit only each body's required
numeric inputs and memory/deferral capabilities.

## 8088 remaining ordinary arithmetic

All 28 shift/rotate forms, eight multiply/divide forms, and six decimal/ASCII
adjustments now use generated bodies. Register and resolved-memory forms share
operand construction with earlier arithmetic; no runtime operand closure is
needed for these instructions.

The shift family reuses the shared one-bit recipe inside `iterate`. Its byte
count is captured from CL before reading the operand and is never masked to
five bits. Each iteration has an immutable current value, applies one shift,
and writes CF; RCL/RCR reread CF at the next iteration. Zero iterations still
lead to an unchanged operand write. OF changes only for count one; nonzero
shifts apply ZF/SF/PF then clear undefined AF, while rotates preserve those
flags. A failed memory write retains the completed flag changes.

`multiply` now accepts equal byte or word operands and optional signed
interpretation, yielding the full double-width unsigned bit pattern. Word
products and DX:AX use 32-bit intermediates. These remain exact JavaScript
numbers; bitwise operations explicitly restore unsigned results. `divide`
checks zero and quotient overflow before publishing its quotient and remainder.
The 8088 definition adds a separate rejection of the most negative signed
quotient. Named outcomes return to the CPU, which retains vector delivery,
stacking, recognition, and retirement. Generated bodies never invoke a hidden
interrupt callback.

DAA/DAS keep their AF-dependent original-chip high-digit threshold and
short-circuit flag reads. AAA/AAS adjust the two bytes separately. AAM/AAD
reject any second byte except 0A before reading AX; both reread AL after
writeback for result flags. Undefined flags retain the existing model policy.

[Arithmetic probes](../../tests/components/cpus/semantics/8088-arithmetic.test.ts)
check every body against independent schedules, every failed effect, all decimal
byte/flag inputs, and callbacks that change live registers or carry.
[Language probes](../../tests/components/cpus/semantics/wide-arithmetic.test.ts)
check lexical scopes, unsigned 32-bit results, BigInt product/division oracles,
bounded iteration, and early outcomes. [CPU boundary tests](../../tests/components/cpus/8088/arithmetic-failures.test.ts)
exercise every arithmetic group with wrapping, overlapping code/data, prefixes,
zero-count writes, and failures during divide-error entry. Existing exhaustive
CPU arithmetic tests retain their independent instruction expectations.

## Z80 banks, special registers, and repeated blocks

EXX exchanges B/C/D/E/H/L one byte at a time; EX AF,AF′ exchanges A, then the
complete flag objects. Each exchange reads alternate then main and writes main
then alternate. Register exchanges use ordinary captures and writes. The
`exchangeFlags` statement preserves flag-object identity without reading bits,
packing, or reconstructing flags. Both groups must have the same stored flag
names, and failed effects retain earlier assignments.

LD A,I/R captures the special register, IFF2, then C; it replaces S/Z/H/PV/N/C
before writing A. LD I/R,A copies all eight bits, including R bit 7, without
accessing flags. Decoding and refresh increments happen before body entry.
NEG also replaces flags before A. RLD/RRD use constant logical shifts to move
A's low nibble and both memory nibbles. They capture HL, read memory, read A,
write memory, then read C, replace flags, and write A. A failed write leaves
A and flags unchanged.

LDI/LDD/LDIR/LDDR and CPI/CPD/CPIR/CPDR each perform one iteration. They read
memory before capturing the decremented BC. Copy bodies read DE for the write,
reread DE after success, then adjust it and update N/H/PV. Comparisons preserve
A and replace flags with PV from the remaining count. Both reread and adjust
HL, write captured BC, and only then consider a PC rewind. Repeating comparisons
read the updated Z only when the count is nonzero. Rewinding PC by two lets the
next step refetch current code, update R, or accept an interrupt; it is not a
loop inside the generated body. Prefix and interrupt-supplied fetching,
recognition, and retirement stay in the CPU.

[Bank/shift validation probes](../../tests/components/cpus/semantics/banks.test.ts)
check ownership, widths, matching flag groups, latch scopes, safely emitted
property names, and every byte/word value at boundary shift counts.
[Generated-body probes](../../tests/components/cpus/semantics/z80-ordinary.test.ts)
check exact effect ordering, whole-object exchange, partial failures, live
callback changes, captured counters, and conditional PC access.
[CPU failure probes](../../tests/components/cpus/z80/ordinary-failures.test.ts)
cover every access failure in all 17 forms through ordinary and IM 0 execution.
Existing exhaustive CPU tests remain the independent value/flag baseline.

## Branches and jumps

[Shared control-flow construction](../../src/components/cpus/semantics/control-flow.ts)
fetches the complete displacement or reads the target before capturing condition
flags. Only a taken relative branch reads the post-fetch PC, adds the signed
displacement with word wrapping, and writes PC. Eight-bit displacements widen
explicitly; a 16-bit displacement already has the required modulo-word form.
Untaken branches and jumps never write PC. Conditions are data with an explicit
capture stage: Motorola compound conditions preserve flag-read order; Z80 DJNZ
uses that stage to decrement B, then reads B again without touching flags.
The 6502 chapter expresses branches with an explicit flag test and signed
widening; its page-wrapped indirect pointer stays in its own source. The Motorola
chapters likewise own JMP address fetching. Indexed 6809 JMP invokes the jump
action after its chapter-owned postbyte decoder completes, retaining indexed
side effects and rejection. Register-indirect Intel jumps read the register or
pair directly and never read memory at the destination. Instruction retirement
stays in the cores.

## Stacks and subroutines

[Stack construction](../../src/components/cpus/semantics/stack.ts) expands into
existing register, memory, and arithmetic statements. It adds no primitive or
runtime interpreter. `byteStack` declares the pointer and whether it names an
occupied or free byte. An occupied pointer predecrements on push and increments
after a successful pop read. A free pointer writes before decrementing on push
and increments before a pop read. Each adjustment reads the live pointer at its
own stage, including after a memory callback. Pointer width determines wrapping;
a byte pointer can select a fixed aligned page, such as the 6502's `0100`.
`wordStack` separately declares little- or big-endian memory layout, pushing in
the reverse order to popping. Each popped byte has a source-local capture.

The 6809 chapter's four masked-stack actions list CC/A/B/DP/X/Y/other-stack/PC
in transfer order: ascending bits for pulls and descending bits for pushes.
They use its byte/word primitives, capture each selected register at its turn,
and commit each pull after its full read. An empty mask never inspects state.
The now-unused `maskedStack` and `stackFrame` builders have been removed.

Ordinary PSHS/PULS arm NMI after a nonempty mask succeeds. PULU's S write action
arms immediately at that field's turn. External frame entry supplies a captured
mask to the same system-stack push action, omitting fetching and final arming.
RTI restores CC, captures E to select the remaining full or short frame, and
arms NMI only after success. CWAI and software interrupts share the full-frame
save action; SWI's masks follow the saved CC, while SWI2/SWI3 preserve I/F.
[Mask probes](../../tests/components/cpus/semantics/masked-stacks.test.ts) cover
every mask and failed access, register capture timing, complete-word writes,
live-pointer changes, flag replacement, and both arming schedules.

Complete push bodies capture the source before stack access. Pop bodies write
the destination only after all reads succeed; pairs retain high/low register
write order. PLA then applies N/Z. Calls capture the target before condition
flags, capture the return PC only if taken, push it, and write PC after both
writes succeed. Returns test flags before stack access and write PC after a
complete pop. Untaken calls and returns leave SP untouched and only advance
PC through instruction fetching. The
shared Intel native inventory supplies definition keys and runtime bindings;
condition callbacks and the old stack-pair dispatch are removed.

The 6502 chapter's JSR stays an explicit sequence: fetch low target, read/push current PC
high, read/push current PC low, fetch high target, then write PC. A stack write
can replace the final operand. RTS adds one to the popped word. Motorola calls
use high-first word layout through chapter actions. Indexed 6809 JSR retains
S auto-updates and NMI arming before invoking the same chapter call action;
subroutine stack effects do not arm NMI. Packed-status stacks use native
construction with explicit packing and replacement stages. The 6809 shares its mask-driven and fixed-frame
transfers with this construction; external recognition stays in the CPU.

## Packed status and decimal arithmetic

For TypeScript-authored status, each CPU owns one immutable packed layout beside
its state schema. The runtime `flagRegister` exposes it as `bits` and `fixed`;
generated sources consume that declaration. The 6502 and 8080 instead describe
packing and restoration directly in their executable chapters. Packing reads
each flag once, inserts its bit, and adds fixed bits. Restoring ignores unmodeled bits and explicitly
replaces the complete flag object. A replacement must supply every stored flag;
partial updates continue to preserve unlisted fields on the existing object.
The 6502 adds the stacked B marker for PHP and BRK, leaving it clear for
external IRQ/NMI entry. PSW/AF pushes capture
A before flags and both before stack effects; pops wait for both bytes before
writing A and replacing flags. The 6809's ORCC/ANDCC capture status before mask
fetching, preserving that ordering even if a callback changes live flags.

`select` chooses between equal-width captured expressions; `or` combines
captured Booleans. Both branches are validated, while only the selected expression
is evaluated. `atLeast` is construction shorthand for inverse unsigned borrow;
it adds no primitive. These operations express decimal thresholds without opaque
CPU callbacks. DAA chooses both corrections from the original accumulator and
incoming half/full carry. The Z80 selects correction direction with N; the 8080
always adds. Both replace their flags before A; Z80 then restores incoming N.
Motorola DAA preserves the flag object, H, and control bits, updating N/Z/V/C
before A and retaining the model's deterministic clear for undefined V.

The [6502 chapter](../../src/components/cpus/specifications/6502.md#arithmetic-in-binary-and-decimal)
authors NMOS ADC/SBC as distinct sequences; its former TypeScript arithmetic
helper has been removed. Binary arithmetic writes A then N/Z/C/V.
Decimal ADC sets Z from binary addition, N/V from the low-digit-corrected
intermediate, and C from the decimal threshold before writing A. SBC first
writes the binary result and flags, then optionally corrects A alone. Word-width
intermediates retain the digit carry/borrow before byte narrowing, including
invalid BCD digits. The existing exhaustive CPU arithmetic/status tests and
[new generated-body probes](../../tests/components/cpus/semantics/status.test.ts)
check results, effect stages, callback changes, and failures independently.

## Primitive meanings

This vocabulary supports unsigned **3-, 8-, 14-, 16-, and 32-bit values**,
**Boolean flag/latch captures**, constant **control-latch writes**, explicit
**interrupt-deferral requests**, and **byte memory addresses** expressed as
16-bit values or explicit physical projections.
The narrow widths describe the 8008 selector and physical
address registers; arithmetic and shifts require 8-, 16-, or 32-bit operands. Widths are decimal;
numeric literals in expanded listings are hexadecimal, while flag constants
are `0:flag` and `1:flag`. There is no implicit truncation on a write.

| Expression | Meaning |
| --- | --- |
| `value(name)` | An already captured numeric value in the current lexical scope |
| `flagValue(name)` | An already captured Boolean flag in the current lexical scope |
| `flagLiteral(value)` | A Boolean constant; never a numeric zero or one |
| `select(condition, yes, no)` | Evaluate a Boolean condition and select one of two equal-width pure numeric expressions; validate both arms |
| `literal(width, value)` | An unsigned constant that fits the width |
| `subtract(left, right, incoming?)` | Binary `left - right - incoming` modulo `2^width`; omitted incoming borrow is zero |
| `addWrap(left, right, incoming?)` | Binary `left + right + incoming` modulo `2^width`; omitted incoming carry is zero |
| `bitAnd(left, right)`, `bitOr(left, right)`, `bitXor(left, right)` | Bitwise AND, OR, and exclusive OR on equal-width unsigned numbers, preserving that width; distinct from Boolean `xor` |
| `multiply(left, right, signed?)` | Equal byte or word operands; optional two’s-complement interpretation; yields the complete unsigned bit pattern at double width (16 or 32 bits) |
| `concat(high, low)` | Equal byte or word halves combined high first, yielding an unsigned word or double word |
| `highByte(value)`, `lowByte(value)` | Extract bits 15–8 or 7–0 of a captured word as a byte; byte operands and live register symbols are rejected |
| `extend(value, width)` | Unsigned widening; narrowing and equal-width conversions are rejected |
| `truncate(value, width)` | Keep the low bits at a strictly narrower supported width; writes never narrow implicitly |
| `signExtend(value, width)` | Widen the two's-complement value, returning an unsigned bit pattern at the new width; `80:u8` becomes `FF80:u16`; narrowing and equal-width conversions are rejected |
| `shiftLeft(value, incoming)` | Shift left once at the operand's width, discard the outgoing high bit, and insert the Boolean incoming bit at bit 0 |
| `shiftRight(value, incoming)` | Shift right once at the operand's width, discard bit 0, and insert the Boolean incoming bit at the high bit |
| `shiftBits(value, direction, count)` | Logical left/right shift of a byte, word, or double word by a constant integer from zero through its width; zero-fill, retain the original width, discard shifted-out bits, and do not read or write carry |
| `negative(value)` | Whether the top bit at the value's width is set |
| `lowBit(value)` | Whether bit 0 is set |
| `zero(value)` | Whether the unsigned value is zero |
| `evenParity(value)` | Whether a byte has an even population count, including zero |
| `borrow(left, right, incoming?)` | Whether unsigned `left - right - incoming` is negative |
| `halfBorrow(left, right, incoming?)` | Whether `(left mod 16) - (right mod 16) - incoming` is negative, at the selected arithmetic width |
| `overflow(left, right, incoming?)` | Whether signed `left - right - incoming` falls outside the signed range at that width |
| `carry(left, right, incoming?)` | Whether unsigned `left + right + incoming` reaches `2^width` |
| `halfCarry(left, right, incoming?)` | Whether `(left mod 16) + (right mod 16) + incoming` reaches 16, at the selected arithmetic width |
| `addOverflow(left, right, incoming?)` | Whether signed `left + right + incoming` falls outside the signed range at that width |
| `not(value)` | Boolean negation |
| `xor(left, right)` | Boolean exclusive OR; true exactly when its two Boolean operands differ |
| `or(left, right)` | Boolean disjunction over captured values; no implicit flag reads |
| `and(left, right)` | Boolean conjunction of pure expressions over already captured values; no implicit flag reads |

Memory statements also accept `projectAddress(base, offset, baseShift, addressBits)`:
`(base * 2^baseShift + offset) modulo 2^addressBits`. Base and offset must be
captured word expressions; the constant shift is 0–16 and physical width is
1–32. Logical progression and wrapping belong in the offset expression before
projection. A projection can only supply a memory address; it is not an ALU
value or a new register width. Generation uses exact unsigned JavaScript number
arithmetic, avoiding signed 32-bit bitwise results. [Projection probes](../../tests/components/cpus/semantics/address-projection.test.ts)
check the bounds and lexical scope, compare emitted addresses with a BigInt
oracle, and cover the full unsigned 32-bit endpoint.

Binary arithmetic and bitwise operands must have equal widths. Narrow values
must be explicitly widened before arithmetic and narrowed before writing back;
for example, the 8008 selector update adds one as a byte and retains its low
three bits. Bitwise operations and top-bit/zero tests also accept narrow values. Optional arithmetic
inputs are Boolean expressions, contributing zero or one; omission means zero.
Carry/borrow/overflow use the original operands and input bit, never an already
wrapped `right + incoming`. These expressions perform no flag reads or writes. Shift operands have distinct
roles: an unsigned arithmetic value and a Boolean incoming bit; shifts do not update flags.
These arithmetic meanings correspond
to existing [ALU](../../src/components/cpus/alu.ts) contracts; generated code
uses those helpers for arithmetic facts and parity. Numeric bitwise expressions
compile to parenthesized JavaScript operators; 32-bit results use an unsigned
conversion, and shifting by the full width produces zero rather than a masked count. The reporter uses explanatory spellings
such as `topBit`, `zeroExtend16`, and `halfBorrow4` to expose those meanings.

| Statement | Ordered effect or capture |
| --- | --- |
| `capture` | Evaluate a pure numeric expression and give the value a fresh, immutable name |
| `read-register` | Read the selected stored register now, capturing its value |
| `read-element` | Read one register-array slot selected by a captured numeric expression, without RAM access |
| `read-flag` | Read the selected stored flag now, capturing its Boolean value |
| `read-latch` | Read a declared Boolean control latch now, capturing it as a Boolean for conditions or flag policies |
| `exchange-flags` | Capture the right complete flag object, then the left; assign left, then right, without inspecting or copying their bits |
| `fetch-byte` | Request one byte from the instruction context's fetch interface and capture it after success |
| `fetch-word` | Fetch one complete native-order operand word, preserving the CPU's word-level fetch-commit boundary |
| `read-next-address` | Capture the 68000's sequential fetch cursor as a long, independently of architectural PC and any selected target |
| `select-target` | Select a logical long target for successful 68000 retirement, without fetching from it or changing the sequential cursor; alignment checks are explicit preceding statements |
| `resolve-address` | Ask the 68000 decoder for a logical memory EA from explicit size/mode/register inputs; stage auto-updates for later address calculations |
| `commit-address-updates` | Commit the decoder's pending registers in first-use order, with each register's final staged value |
| `read-program-memory` | Read one byte through the 68000 program-space connection at an explicit logical address |
| `alignment-fault` | Return a rejected logical read, write, or target-fetch access immediately; program/data space is explicit for reads, writes are data, and fetches are program; the CPU delivers the error |
| `read-port` | Read one byte from a captured 16-bit port address, separately from memory; capture it after success |
| `read-memory` | Read one byte at an explicit 16-bit address, or a 32-bit logical address on the 68000; capture it after success |
| `write-register` | Replace the stored register with an equal-width unsigned value |
| `write-element` | Replace one register-array slot with an equal-width value; do not read its old contents |
| `test-choice` | Compare a live declared control choice with one permitted alternative, capturing the Boolean result |
| `write-choice` | Assign a permitted constant to a declared control choice; performs no read |
| `write-latch` | Assign a Boolean constant or captured Boolean expression to a declared top-level control latch; performs no implicit read |
| `defer-interrupt` | Request `irq` inhibition on 8080/Z80 or `intr`/`all` on 8088; the boundary commits it at successful retirement |
| `notify-reti` | Request Z80 device notification after successful architectural retirement |
| `reset-devices` | Assert the connected 68000 device reset signal now; the CPU records only successful callbacks and retains retirement/exception handling |
| `read-test` | Sample and record the 8088 physical TEST pin, capturing a validated Boolean level |
| `send-escape` | Send an 8088 ESC request from explicit captured operands; memory reads are separate statements; detach the device request and record only after success |
| `report-interrupt` | Report completed 8088 software delivery with a captured type byte; performs no entry or memory effects |
| `write-port` | Write one byte to a captured 16-bit port address; no implicit memory access or flag update |
| `write-memory` | Write one byte at an explicit 16-bit address, or a 32-bit logical address on the 68000, including unchanged values |
| `read-source` | Expand and perform the named source body once in its own scope, then capture its result |
| `update-flags` | Bind a named policy's pure parameters and apply its assignments at this point |
| `replace-flags` | Bind and evaluate a complete flag policy, then assign a fresh flag object; reject policies missing any stored flag |
| `when` | Evaluate a Boolean condition; execute the nested ordered statements only if true, with no body effects otherwise |
| `iterate` | Capture a byte count and initial numeric value; perform 0–255 ordered iterations with a fresh immutable current value in each iteration, then capture the final value under its name |
| `iterate-together` | Carry named numeric/Boolean values through a byte-counted loop; initialize from the outer scope, evaluate all next values before updating any, and publish only those names after the loop; zero iterations retain the initials |
| `divide` | Divide a double-width dividend by a byte/word divisor with explicit signedness; truncate toward zero, retain dividend sign on the remainder, and capture both results at divisor width; zero returns the named `onError` outcome; overflow also returns it unless an optional `overflow` flag capture is named |
| `reject` | Return a named outcome immediately from the complete instruction body; preserve completed effects and perform no later statement |

The current cores still own fetch-cursor behavior, PC commitment, access
recording, exception handling, and instruction boundaries. In particular,
`fetch-byte` does not assert one universal PC-update rule for all CPUs. Generated
bodies receive each core's existing callbacks, including interrupt-supplied
fetching on the 8080. The 68000's `fetch-word` retains its complete-word
cursor and recorded-instruction update, even when the second byte faults.
Operand data reads and writes remain explicit byte accesses with visible
ordering and address wrapping; no data-word primitive hides partial completion.

A conditional block inherits its parent's captured numbers and flags. Its local
captures cannot escape the block or shadow inherited names; separate sibling
blocks may reuse local names. Source and flag-policy scopes remain closed,
even inside conditionals. Validation checks untaken bodies too, and capability
inference includes their possible fetches, memory/port reads and writes, and deferral requests.

Iteration bodies inherit their enclosing scope, plus their current value. Local
captures cannot escape or shadow that value, and the yielded result must retain
the initial width. Zero iterations perform no body effects and yield the initial
value. This is a bounded numeric fold, not a whole-string execution loop; REP
and Z80 repeated blocks still retire one element per CPU step.

Division accepts signed ranges including the ordinary most-negative value;
CPU-specific restrictions are explicit later conditions. Its quotient and
remainder are unsigned bit patterns at the divisor width. Without an `overflow`
capture, zero or quotient overflow rejects before any results enter scope.
With one, zero still rejects; nonzero division captures the overflow flag and
both truncated results, leaving the definition to decide whether to write them.
The 68000 uses this for V-only overflow completion, distinct from the 8088's
divide-error outcome. A rejection inside a conditional or iteration returns from the
complete instruction. Sources cannot contain division or rejection: they must
yield a value. Validation checks every nested path, including zero-count bodies.
Generated methods and opcode bindings expose their possible named outcomes in
their return types, while successful paths retain `void`.

Statements execute in their listed order under this contract. A failed
effect stops the body; prior completed effects remain. There is no implicit
transaction or rollback. This describes the selected cores' existing host-error
behavior. Hardware fault delivery and cycle timing are separate contracts.

## Why the difficult cases remain visible

In `CMPX ,X++`, the existing address decoder captures old X and writes
`old X + 2` modulo 65536. The generated body receives the captured address,
reads the high byte there, then the low byte at `old X + 1` modulo 65536.
Only then does it read the updated X for comparison. Thus a second-read
failure retains the increment and performs no comparison flag update. Moving
that register read earlier would change the definition, not just its formatting.
The same boundary serves every indexed postbyte and compared register. CMPD
reads A then B after both operand bytes, so addressing through A, B, or D does
not move the comparison-register capture ahead of the memory reads.

The original 6800 CPX deliberately does not use whole-word N/V. Comparing
`0100` with `0101` leaves N clear: the high bytes are equal, and the low-byte
borrow does not enter their subtraction. Z is clear because the whole words
differ, and C retains its previous value. A high-byte extraction expression
makes this rule visible without a CPU-specific primitive or opaque callback.

In memory shifts and rotates, the original-value write precedes the calculation
and any flag update. ROL/ROR capture incoming C after that write succeeds.
The original top bit supplies outgoing C for ASL/ROL; bit 0 supplies it for
LSR/ROR. The result write separates the C policy from the N/Z policy. A reporter
can locate each stage directly. Generated code preserves both writes even when
their values are equal, and leaves C committed if the final write fails.
Memory INC/DEC use the same two writes but preserve C throughout; accumulator
and index-register forms perform no data-memory access.

The 8080 and Z80 chapters bind all 72 ordinary byte ALU forms directly from
formal encodings. Each body owns source reads, flags, and optional A writeback.
The Z80 also binds sixteen indexed forms to eight resolved-memory bodies that
perform the chapter's actions. Those native bodies still depend on handwritten
prefix and displacement decoding, so they earn no complete literate-form credit.

## Validation and generated explanations

[defineInstruction](../../src/components/cpus/semantics/validate.ts) copies and
deeply freezes the description, then validates it. It rejects host functions,
accessor properties, class instances, and cycles without invoking accessors. Reused input objects are copied without freezing
the caller's objects. Definitions retain neither live CPU state nor an
instruction's runtime captures.

Validation rejects unknown/cross-CPU symbols, wrong widths, out-of-range
constants, undeclared or duplicate captures, escaping source locals, missing
or extra policy arguments, duplicate flag assignments, and unsupported
conversions. Bank references require a declared bank; flag exchanges require
matching complete flag groups. Array accesses also check the schema's length and element width.
A constant index must fit; a dynamic index's entire unsigned range must fit.
A wider selector must therefore be explicitly narrowed before it can index an
eight-element array. Generated indexing needs no runtime bounds check for valid
stored state and declared inputs. Diagnostics identify the CPU, instruction, statement, and named
source or policy. This is a typed authoring API, not a parser for arbitrary JSON.
Validation establishes structural correctness; it cannot establish that the
author chose the hardware's correct effect order or formulas.

[describeInstruction](../../src/components/cpus/semantics/describe.ts) expands
source bodies and substitutes policy arguments. It also derives the flags
preserved throughout the body from the schema, update statements, and any
exchange involving the primary flag object.
Those lists are not hand-maintained annotations. Explanatory prose remains
authored text and is visibly separate from the generated operations.

Regenerate the committed [review artifact](semantic-examples.md) with:

```sh
node scripts/describe-cpu-semantics.ts
```

Add `--check` to verify it without writing. The normal test suite also compares
the artifact with fresh output. Source changes require regeneration; the ordinary
build does not silently rewrite this documentation.

[Tests](../../tests/components/cpus/semantics) independently specify expected
expansions and ordering, probe validation errors and ownership, and check
reproducibility. [Type checks](../../tests/types/instruction-semantics.ts) cover
schema-derived names, distinct operand roles, concrete generated CPU-state
types, and the precise context capabilities each body needs. Execution tests
cover all byte operand pairs against independent arithmetic, word boundaries,
lexical scope isolation, source effects, and retained effects on failure. The
existing CPU tests remain the independent opcode, record, and rejection baseline.
[Reader tests](../../tests/components/cpus/semantics/readers.test.ts) distinguish
address resolution from data reads, check byte/word wrapping and live index-read
order, and inject failures at each source access. CPU tests also check stores,
arithmetic, and memory modifiers through their ordinary opcode paths.
Store probes cover all thirteen generated forms, changing the source register
during address resolution to detect early captures. They reject any flag access,
extra destination read, or register write, and inject failures at every fetch,
pointer read, and write. Existing CPU tests exhaust all byte values and flag
combinations, verify unchanged-value writes and overlapping code/pointers, and
retain exact completed accesses on failure. Literal encoding expectations also
exclude immediate STA and undocumented STX/STY modes.
[Logical probes](../../tests/components/cpus/semantics/logic.test.ts) check numeric
bitwise expressions against individual bit truth tables for every byte pair,
word bit boundaries, and nested formulas. All 26 generated logical forms are
checked for operand-before-A ordering, absence of incoming flag reads, and
termination at each failed read. ORA/AND/EOR writeback precedes N/Z updates;
BIT never writes A. Existing CPU tests exhaust the ORA/AND/EOR and BIT operand
pairs with D clear/set and verify all addressing
forms, preserved flags, and complete access records. The CPU failure probe also
covers both BIT forms. Type and validation checks distinguish numeric bitwise
expressions from Boolean XOR and reject mixed operand widths.
Motorola probes exercise every generated logical body, including read failures,
operand-before-register capture, replaced flag objects, writeback before N/Z/V,
and BIT without writeback. CPU tests retain their literal opcode expectations
and bit truth tables. The 6800 failure probe covers all four addressing modes
and every indexed offset; the 6809 checks every legal indexed postbyte, A/B/D
offset aliases, pointer/code overlap, wrapping, and S auto-updates. Selected
6809 auto-update and indirect forms fail at every read, retaining exact completed
accesses. Its existing undefined-postbyte checks also cover the logical families.
[Unary probes](../../tests/components/cpus/semantics/unary.test.ts) check every
word value in both directions and with either incoming bit, distinguish a
captured flag from later live-state changes, and inspect carry reads and updates
between the two memory writes. The 6502 tests cover every byte and incoming flag
combination for every modifying form, plus failure at every memory access.
Generated-body probes also inspect the 8080, 6800, and 6809 register/flag write order,
require incoming-carry reads only for through-carry rotations, and exercise
nested Boolean XOR over its complete truth table. They check the additional
6809 unary families' flag assignments, TST's missing write, and CLR's retained
read, including an unchanged zero result. Existing CPU tests exhaust
every byte and incoming flag combination for the newly migrated forms, using
independent bit-string rotations and integer shift/overflow expectations.
The [6800 CPU tests](../../tests/components/cpus/6800.test.ts) cover all unsigned
indexed displacements, wrapped and overlapping fetches, and failures at every
fetch, operand read, and result write. Generated-body probes distinguish its
CLR with no register or memory read, TST's cleared carry, and right-shift V.
Comparison tests cover all unsigned indexed offsets, wrapped and overlapping
fetches/data reads, and failure at every read in boundary cases. CPX retains its
exhaustive independent high-byte-pair tests with equal and unequal low bytes.
Generated-body probes verify operand-before-register ordering and no writeback
for CMPA/CMPB/CPX and CBA. Compiler probes check `highByte` for every word and
after wrapped arithmetic; validation rejects non-word inputs and wrong-width
uses of its byte result.
The [6809 CPU tests](../../tests/components/cpus/6809.test.ts) also exercise all
217 legal indexed postbytes for every memory unary operation and all seven
comparisons, retain rejection of all 39 undefined postbytes, and inject failure
at each access in direct, extended,
auto-updated, and indirect examples. They check wrapping, code/pointer/data
overlap, S updates and NMI arming, exact completed accesses, and full state.
Generated comparison probes change the compared register during operand reads
and require its capture only after the last successful read. These cover every
register in immediate and memory bodies, D's A-then-B read order, and failures
before either operand byte completes.

[Arithmetic probes](../../tests/components/cpus/semantics/arithmetic.test.ts)
check every byte pair with both input bits, word boundaries, and Boolean policy
argument substitution against independent signed/unsigned calculations. They
verify complete-operand-before-register reads, single carry captures only for
ADC/SBC, current flag objects, flags before writeback, and failure at each read.
CPU tests retain exhaustive arithmetic expectations and now include these
families in their wrapping, overlap, index-update, and access-failure probes.

[8080 ALU probes](../../tests/components/cpus/semantics/8080-alu.test.ts) check
source-before-CY-before-A ordering, distinct reads when A is its own source,
flags before writeback, and CMP's omitted write. Failed operand reads prevent
later state access; successful reads may replace A and the flag object before
the body continues. CPU tests exercise every ALU form through ordinary and
interrupt-supplied execution, failing each fetch, acknowledgement, or memory
read. They check wrapped PC, overlapping code/data, completed accesses, retained
interrupt acceptance, EI deferral, and boundary-guard release. Existing exhaustive
byte-pair tests remain independent of the definitions.

[Z80 ALU probes](../../tests/components/cpus/semantics/z80-alu.test.ts) verify all
80 bodies, C-before-A capture, flag-before-writeback order, no CP write, current
flag storage, and no alternate-bank or control-state access. The
[CPU failure probes](../../tests/components/cpus/z80/alu-failures.test.ts) cover
all 88 forms through ordinary and IM 0 execution. Failed ordinary prefix decoding
preserves PC/R; completed decoding commits them before operand reads. IM 0
retains acceptance and each R increment preceding an acknowledgement, including
one that fails. Tests check exact completed accesses, wrapped/overlapping bytes,
deferred-interrupt retirement, guard release, and every signed displacement at
both address-space boundaries. Existing byte-pair, alternate-bank, and paired
8080/Z80 expectations remain independent of the definitions.

[Z80 shift probes](../../tests/components/cpus/semantics/z80-shifts.test.ts)
check all sixty rotate/shift bodies, operand-before-carry capture, the two flag schedules,
current flags after memory callbacks, captured addresses, and untouched alternate
and control state. [Z80 bit probes](../../tests/components/cpus/semantics/z80-bits.test.ts)
check all 192 BIT/RES/SET bodies, one operand read, no BIT write, no incoming
flag reads, and no RES/SET flag access. Memory callbacks replace flag storage
and change address registers to check live flags and the captured address.
[Failure probes](../../tests/components/cpus/z80/cb-failures.test.ts)
exercise all 314 accumulator-rotate and CB forms through ordinary and IM 0 execution, failing every opcode
read, acknowledgement, data read, and result write. They retain exact completed
accesses, flags before a failed write, PC/R decoding boundaries, acceptance and
retirement effects, code/data overlap, and guard release. Existing independent
CB and indexed tests continue to exhaust byte values, flags, and signed
displacements.

[Intel adjustment probes](../../tests/components/cpus/semantics/intel-adjustments.test.ts)
check all 32 generated bodies, every register byte, one read before flags and
writeback, preserved carry without reads, and untouched unrelated state. Memory
callbacks replace flag storage and change HL/IX/IY to test live flags and a
captured address on success and failure. The
[8080 CPU tests](../../tests/components/cpus/8080.test.ts) and
[Z80 adjustment failure probes](../../tests/components/cpus/z80/adjustment-failures.test.ts)
cover all 36 forms through ordinary and interrupt-supplied execution, failing
every fetch, acknowledgement, data read, and write. They check code/data overlap,
wrapped PC/R, acceptance and retirement effects, memory contents, and guard
release. Indexed tests cover every signed displacement at both address-space
boundaries.

[Intel transfer probes](../../tests/components/cpus/semantics/intel-transfers.test.ts)
independently enumerate the 71 ordinary encodings for each CPU and exclude HALT.
They check source-before-destination ordering, source capture before H/L on
stores, current H/L after an immediate fetch, and no flag or control-state access.
Callback changes expose premature reads and indexed-address recomputation.
[CPU failure probes](../../tests/components/cpus/intel-transfer-failures.test.ts)
exercise all 172 forms through ordinary and interrupt-supplied execution, failing
every fetch, acknowledgement, memory read, and write. Exact records and memory
contents cover unchanged writes, code/data overlap, PC/R wrapping, acceptance,
retirement, and guard release. Existing independent CPU tests retain exhaustive
byte/register cases and all signed indexed displacements.

[Word-transfer probes](../../tests/components/cpus/semantics/intel-word-transfers.test.ts)
check all 28 bodies, explicit register read/write order, absence of unrelated
state access, and source capture after address fetching but before either store.
Callbacks change source registers between fetches and writes to expose premature
or repeated reads. The [CPU failure probes](../../tests/components/cpus/intel-word-transfer-failures.test.ts)
exercise all 30 forms through ordinary and supplied execution, failing every
opcode, prefix, operand, and data access. They check full records, retained
partial writes, wrapped PC/R and data addresses, code overlap, unchanged writes,
acceptance/retirement effects, and guard release. Existing CPU tests retain
exhaustive word-value and flag checks. All 1,057 earlier definitions remain
unchanged; the four other generated CPU modules remain byte-for-byte identical.

[8008 transfer probes](../../tests/components/cpus/semantics/8008-transfers.test.ts)
independently enumerate its 71 native slots and exclude all HLT encodings.
They verify full-byte source capture, all four high-bit aliases of H:L, current
H/L after an immediate fetch, self-transfers, and no flag or control-state access.
The [CPU tests](../../tests/components/cpus/8008.test.ts) fail every fetch,
acknowledgement, data read, and write through ordinary and supplied execution.
They check all eight address slots, 14-bit PC wrapping, code/data overlap,
unchanged writes, exact records, memory contents, and guard release.

[8008 ALU probes](../../tests/components/cpus/semantics/8008-alu.test.ts) check
every generated body, all four high-bit aliases of H:L, distinct A-as-source
and accumulator captures, current flags after successful operand callbacks,
and no address-stack, selector, or STOPPED access. The
[CPU tests](../../tests/components/cpus/8008.test.ts) retain exhaustive byte-pair
and native source-selector expectations. New failure checks cover every ALU
form through ordinary and supplied execution, all eight selected PC slots,
wrapped/overlapping reads, and each failed fetch, acknowledgement, or memory
read. They require exact completed accesses, retained STOPPED release, untouched
other address slots, and a released boundary guard.
[8008 unary probes](../../tests/components/cpus/semantics/8008-unary.test.ts)
check register and carry capture order, adjustment flags before writeback,
rotation carry after writeback, and untouched unrelated state. Existing CPU
tests exhaust every byte and flag pattern for all sixteen forms. Fetch-boundary
probes check ordinary and supplied execution in every address slot, failed
opcode reads and acknowledgements, STOPPED release, and guard release.
All 530 earlier definitions remain structurally unchanged by this unary
migration; the five other generated CPU modules remain byte-for-byte identical.

[Conditional-language tests](../../tests/components/cpus/semantics/control-flow.test.ts)
check inherited scope, rejected shadowing and escaping captures, nested effects,
failure stopping, latent capabilities, every byte's signed widening, Boolean
AND, and explanatory indentation. [Branch probes](../../tests/components/cpus/semantics/branches.test.ts)
change flags and PC during fetching to verify live read order and no PC access
on untaken paths. [CPU boundary tests](../../tests/components/cpus/branch-failures.test.ts)
cover all 90 migrated encodings, every condition combination, signed boundaries,
PC/R wrapping, supplied Intel instructions, DJNZ count wrapping, and every failed
fetch or pointer read. Existing independent CPU tests retain exhaustive
displacement, pointer, and 6809 indexed-postbyte expectations.

[Stack body probes](../../tests/components/cpus/semantics/stacks.test.ts)
replace pointers, registers, and flag objects during memory callbacks to check
live pointer reads, captured push sources, delayed pop writeback, and conditional
effect boundaries. They also check 6502 JSR's separately captured return bytes.
[CPU stack tests](../../tests/components/cpus/stack-failures.test.ts) cover all
86 encodings, conditions, PC/SP/R wrap, overlapping code and stack memory,
interrupt-supplied Intel instructions, every failed access, and indexed 6809
calls through S. Unsupported indexed forms retain the existing rejection rule.

[8008 control probes](../../tests/components/cpus/semantics/8008-control-flow.test.ts)
check all 59 new forms, selectors, flag patterns, address aliases, and failed
fetches. They change flags and the selector during fetching to verify read order,
reject array reads and RAM transfers, and retain the selector if a later slot
write fails. [Register-array probes](../../tests/components/cpus/semantics/register-arrays.test.ts)
check schema identity, bounds, widths, lexical scopes, and exhaustive narrowing
of every word value. Existing CPU tests cover ordinary and supplied-byte
execution, wrapped PCs, nested calls, unbalanced returns, all halt aliases, and
exact execution records.

## Executable generation and integration

[generateInstructions](../../src/components/cpus/semantics/generate.ts) validates
and freezes its input before emitting code. Generated methods take the concrete
CPU state type (the 8008 uses `Cpu8008StoredState`, with owned mutable address
slots, rather than its readonly constructor-input array), followed by any numeric inputs
in declaration order, then only the callbacks their statements use, expressed
as a `Pick<ByteInstructionContext, ...>`, extended with
`BytePorts` when it accesses port space and `InterruptDeferralContext` when it
can request deferral. Each `Pick` still exposes only the used callbacks. For example,
`rolMemory(state, address, { readByte, writeByte })` cannot fetch operands or
resolve the address again. Bindings must supply unsigned integers fitting the
declared widths; the generated internal functions do not coerce or validate
runtime inputs. Register-only
bodies have no context parameter. There is no interpreter or semantic dispatch
on the execution path.

Captures become uniquely named constants. Conditional statements compile to
ordinary `if` blocks with inherited capture maps and scoped locals. Source scopes are expanded inline,
with separate name maps; only the result enters the caller's map. Policy
arguments are captured once, then all flag results are computed before any flag
assignment. No reads, writes, or policies move across one another. Widths select
the existing ALU helper arguments and sign bits. Widening a known unsigned value
requires no JavaScript arithmetic; signed widening replicates the sign bit and
returns the wider unsigned pattern. Narrowing emits an explicit low-bit mask.
Byte/word multiplication emits exact JavaScript multiplication, interpreting
signed operands when requested and preserving the full unsigned result.
Checked division emits a quotient range check before its named captures.
Bounded iteration emits a local accumulator and a loop with a once-captured
count; each body scope sees only that iteration’s value. Constant logical shifts emit unsigned
right shifts or masked left shifts, with counts checked against the operand width.
Bank references emit direct, safely quoted properties as needed. Flag exchange
emits two captured references followed by two assignments; it never packs or
rebuilds the objects. Array access emits direct indexing with an already
validated captured selector. The output is deliberately unoptimized:
repeated arithmetic facts remain separate calls rather than introducing an
optimization pass into this review.

The [generation script](../../scripts/generate-cpu-semantics.ts) produces
`src/components/cpus/generated/{6502,6800,68000,8008,8080,8088,6809,z80}.ts`,
`6502-state.ts`, `68000-quick.ts`, `68000-moves.ts`, `68000-word-moves.ts`, `68000-logic.ts`, `68000-arithmetic.ts`, `68000-bits.ts`, `68000-word-arithmetic.ts`,
`68000-decimal.ts`, `68000-control.ts`, `68000-transfers.ts`, `68000-system.ts`, and the separate 8088 transfer, ALU, unary,
stack, addressing, string, arithmetic, and control modules. The separate 8088
operand modules contain specialized resolved bodies; its numeric opcode module retains automatic bindings.
The 68000 word-transfer chapter owns 64 register-copy definitions in `68000.ts`
and 128 numeric load/store definitions in `68000-word-moves.ts`. The core selects
these encodings before the broader MOVE catalogue; other memory forms retain
their shared parameterized bodies. Its chapter-authored word-result policy
also serves the remaining word operations.
The script first compiles literate chapters to `semantics/generated/`, then
loads the definition registry. Both output directories are ignored and removed
by `npm run clean`.
Regenerate with `npm run generate:cpus`;
`npm run build` generates these bodies and the machine factories automatically.
The source-only check and ordinary compilation both type-check the generated
bodies. Reproducibility tests compare every module with fresh output and run the
native generator in a clean temporary tree from another working directory.

Handwritten CPU schemas live under
[`src/components/cpus/state/`](../../src/components/cpus/state). The 8008, 8080,
and 6502 schemas, mutable stored-state types, public aliases, and readonly caller
policies are generated into `semantics/generated/state/` and re-exported by their
`generated/<cpu>-cpu.ts` modules. Other schemas remain authored TypeScript.
Chapter generation builds owned schemas without importing existing output,
before the instruction registry loads them. The machine parser
uses these same schemas without importing executable handlers or expanded chapter
data. After a clean, generate CPUs before running machine generation separately.
There is one authority for each CPU's stored fields. Complete chapters also
generate their instruction catalogue entries, including the state-type import
and authored-source path passed to `generateInstructions`. Shared generation
uses those options instead of processor-specific state-adapter rules.

Opcode selection remains in the CPU tables. For the 6502 and numeric 8088 families,
`generateInstructions(..., { bindOpcodes: true })` also generates
`opcodeEntries(state)`, connecting every defined opcode to its body. The CPU
constructs its table after initializing state. The 6502 and 8008 use generated entries
exclusively; the 8088 combines them with handwritten entries. In every case
`opcodeTable` rejects collisions. A numeric list such as
`{ bindOpcodes: [0xC0, 0xC1] }` binds only those definition keys, allowing other
bodies in the same module to retain explicit bindings or decoded inputs. The
8008 uses `bindOpcodes: true`: every chapter-authored form contributes to
one numeric definition set, checked for collisions.
Each instance binds its own state; no register or memory read occurs during
binding. Generated methods retain their precise callback types, while the
bound handlers accept the shared byte instruction context, with deferral when
the module requires it. Automatic opcode
bindings reject selected definitions with numeric inputs, since they cannot
supply those values; such bodies require an explicit CPU-owned binding.

The 68000 keeps its static dispatch table. Its numeric register definitions
supply 792 entries directly, while eight MOVEQ bodies receive the decoded
immediate byte. Together these cover 800 documented forms and 2,840 operation
words. No new semantic primitive is needed: existing truncation, sign extension,
bitwise expressions, conditional statements, transfer construction, and flag
policies express the register behavior. Conditional A7 selection accesses only
the chosen stored stack pointer. A separate state-schema module lets generation
bootstrap without loading the 68000 core or its generated imports.

Of the remaining 9,150 MOVE/MOVEA forms, 128 word loads/stores use chapter-owned
numeric definitions. The other 9,022 forms select 169 bodies by source/destination
role, with numeric mode/register inputs from their common encoding inventory.
`Cpu68000AddressContext` retains the existing EA decoder and one pending-update
map per instruction. Address resolution performs extension fetches and staging,
with no operand-data read or flag update. The body explicitly requests source
resolution, checks alignment, reads the complete source, then resolves and
checks the destination. Only then does it commit updates and write back; flags
follow a complete ordinary MOVE write. MOVEA keeps flags and overwrites any
pending update to its destination register. The decoder's pending values feed
later base/index calculations; first-use order governs commits when operands
share a register. Abandoned bodies discard their pending map automatically.

The data logical families add 906 bodies for 6,660 forms through the same
binding and address context. Their [encoding inventory](../../src/components/cpus/68000-logic.ts)
shares [operand classification](../../src/components/cpus/68000-operands.ts)
with MOVE. The definitions share source reads (including A7's scoped bank
selection), complete immediate fetching, high-first byte transfers, alignment
checks, partial data-register writes, and N/Z/V/C policy. No new vocabulary or
compiler behavior is needed. AND/OR with an immediate source EA share bodies
with the equivalent ANDI/ORI-to-Dn encodings.

The logical sequence commits pending address updates before reading the
destination. CLR performs that read despite discarding its value; TST reads
and updates flags without writing. A source failure discards pending updates;
a destination-read failure retains them. Logical flags precede writeback,
so a failed write retains the computed flags and earlier bytes. Keep this
ordering distinct from MOVE's write-before-flags sequence. CCR/SR immediate
logic remains in its separate status path.

The addition/subtraction/comparison families add 2,678 bodies for 11,186 forms.
Their [encoding inventory](../../src/components/cpus/68000-arithmetic.ts) supplies
exact source/destination selectors through the same binding. Quick constants
use the source selector input: zero means eight; other codes mean one through
seven. Literal values do not add coverage or bodies. Ordinary immediate and
source-EA encodings share bodies where their data flow matches.

A shared ALU destination recipe now serves logic and arithmetic. It resolves
the destination, checks alignment, commits pending updates, reads the value,
applies the calculation, and optionally writes back. A7's bank is selected
before committing updates, while its value is read afterward. ADDA/SUBA/CMPA
sign-extend a word source and operate on all 32 destination bits. Quick
address-register operations use positive constants and also operate at 32 bits.
Only CMPA changes flags for these address destinations.

Shared arithmetic construction applies the 68000 N/Z/V/C policy; ordinary data
arithmetic also sets X from carry/borrow, while comparisons preserve X and
never write a result. ADDX/SUBX/NEGX capture Z then X after all operand reads;
a separate cumulative-zero stage combines the captured Z with the result.
Paired memory operands preserve source-before-destination resolution and
successive updates to the same An. A source or alignment failure discards
pending updates. A failed destination read retains committed updates, and a
failed write also retains calculated flags and earlier bytes. These definitions
use the existing vocabulary and compiler; earlier definitions and generated
modules are unchanged.

The [bit/shift inventory](../../src/components/cpus/68000-bits.ts) adds 2,086
bodies for 3,940 documented forms. All families reuse the ALU destination
recipe. Bit-number immediates fetch a complete word before target extensions;
dynamic bit numbers and register shift counts are captured before the target,
including when both operands select the same Dn. BTST also admits PC-relative
program reads and, in its dynamic form, a fetched immediate byte. Only Z changes
for bit operations. TAS sets N/Z and clears V/C from the old byte, then writes
that byte with bit 7 set.

`iterateTogether` extends bounded iteration to named numeric and Boolean
values. Initial expressions use only the outer scope. Every next expression
uses the current iteration's values and local captures; all next values are
computed before any accumulator changes. Zero iterations retain the initials,
and internal captures never escape. The validator checks names, widths, flag
expressions, byte counts, and rejection restrictions; the generator infers
capabilities inside the body and preserves early outcomes and failed effects.
The explanatory listing shows the same parallel update semantics.

68000 shifts use that loop for the result, X, C, and overflow, reusing the shared
one-bit recipe with a captured incoming bit. They read X after the operand and
write architectural flags only after the loop. ASL accumulates any sign change.
Zero counts still set N/Z and clear V while preserving X; ROX copies X to C,
whereas other zero-count families clear C. Ordinary rotates preserve X.
The [iteration tests](../../tests/components/cpus/semantics/iteration.test.ts)
exercise simultaneous updates, lexical scopes, zero/maximum counts, and failure
or rejection before publishing results. The [bit/shift tests](../../tests/components/cpus/semantics/68000-bits.test.ts)
scan every operation word independently, compare every generated body and effect
failure, and use a bit-array oracle for all six-bit counts and sign boundaries.
CPU bus tests retain byte failures, A7 updates in both banks, and program-space
function codes. Earlier definitions and generated modules remain unchanged.

The [arithmetic inventory](../../src/components/cpus/68000-arithmetic.ts) also
binds 2,120 MULU/MULS/DIVU/DIVS/CHK forms to 440 word-source bodies and 306
ABCD/SBCD/NBCD forms to 139 decimal bodies. These reuse the source reader and
ALU destination construction, with distinct commit schedules.

Word operations read the complete source before Dn. Failed reads discard staged
updates; completed operations commit them after result/flag effects and before
requesting a synchronous exception. MUL writes its full product before N/Z/V/C.
DIV first clears C. A zero divisor commits the source and requests its outcome
without reading Dn; a nonzero divisor uses shared `divide` with an explicit
quotient-overflow flag. Overflow sets V and preserves Dn/N/Z/X. Success writes
remainder:quotient before setting N/Z from the quotient and clearing V/C.
CHK accepts signed Dn.W from zero through the signed bound; failure changes
only N before committing source updates and requesting bounds-check.

Decimal pairs finish their source before resolving the destination; repeated
predecrements of one An therefore use successive addresses. Pending updates
commit before the destination read, including NBCD. After both operands,
read X and correct low then high digit with a propagated carry/borrow. Adding
six above nine or subtracting six below zero, then retaining four bits, keeps
the declared deterministic behavior for invalid packed digits. Set C then X,
read previous Z, and apply cumulative zero before writing even unchanged bytes.
N/V remain preserved; partial Dn writes retain their live upper bits.

The [word/decimal probes](../../tests/components/cpus/semantics/68000-word-and-decimal.test.ts)
independently scan every operation word, compare each binding and every failed
effect, and check signed limits with BigInt and every packed-byte input with
separate digit and valid-decimal oracles. Shared division tests cover both
outcome modes and capture validation. CPU bus tests check A7 source/destination
faults and retained flags in both stack banks. Earlier definitions and generated
modules remain unchanged.

The [control inventory](../../src/components/cpus/68000-control.ts) binds Scc,
DBcc, BRA/Bcc/BSR, LEA/PEA/JMP/JSR, LINK/UNLK, and RTS: 1,285 forms through
332 bodies, serving 5,349 operation words. The byte displacement is a decoded
parameter, while its zero encoding selects the word-fetch body. Modes and
register selectors remain separate three-bit inputs. Body keys use native
mnemonics, including ST/SF, DBT/DBF, BRA, and BSR.

`motorolaCondition` now shares the native flag-capture sequence between the
6800, 6809, and 68000. The 68000's branches and DBcc capture those flags before
reading the sequential cursor or fetching the extension, whereas Scc captures
them after its destination read. The superseded runtime condition table is
removed; its independent arithmetic-comparison tests exercise generated Scc.

`readNextAddress` and `selectTarget` expose narrow control capabilities. They
keep the sequential fetch cursor separate from the selected target and stored
PC. A branch uses the cursor before an extension fetch as its base. Only a
taken branch checks target alignment; DBcc's terminating counter likewise
ignores target alignment. A target fault returns a distinct
`TargetAlignmentFault`, while operand paths retain `OperandAlignmentFault`.
Both propagate through nested statements; no target byte is fetched. The CPU
still commits PC and trace state at retirement and uses the sequential cursor
for fault delivery, including failures after a call has selected its target.

Long pushes share explicit stack-bank selection, decremented-address alignment,
high-first byte writes, and pointer commit after complete writes. Calls check
stack alignment before target alignment, select their target, then write the
return address and commit SP. LINK reuses this construction with a different
finish: write the frame register before the allocated SP. LINK A7 saves the
decremented address itself. UNLK advances the captured stack bank before
restoring the frame register; RTS validates its whole popped target before
advancing the stack. LEA selects its destination register identity before
source decoding; PEA selects the stack afterward. These distinctions stay
visible in the definitions rather than becoming runtime callbacks.

The [control probes](../../tests/components/cpus/semantics/68000-control.test.ts)
independently scan every operation word, verify all conditions and displacement
boundaries, and compare every failed effect with live callback mutations.
Compiler/type probes cover widths, lexical scope, capabilities, and target
faults. CPU bus tests fail every stack byte in both banks, both Scc accesses,
and branch extension bytes, retaining partial writes, original pointers,
counters, and the sequential fault PC. Earlier definitions and generated
modules remain unchanged.

The [transfer inventory](../../src/components/cpus/68000-transfers.ts) binds
all 256 MOVEP and 140 MOVEM forms through 294 bodies. MOVEP captures its base
before fetching the signed displacement, then uses the shared high-first byte
construction with a stride of two. Loads replace Dn only after all bytes arrive;
word loads preserve the live upper word. Stores capture Dn after the displacement
fetch. Odd addresses remain legal.

MOVEM fetches its mask before resolving the address. Ordinary control EAs use
the CPU's resolver; postincrement/predecrement forms capture their own base bank
and pointer, bypassing the resolver's single-operand update. An empty mask still
fetches EA extensions but performs no alignment check or base update. Otherwise
the first transfer's alignment is checked before any register or memory effect.

The definition expands the sixteen mask bits in native order: D0..D7,A0..A7,
reversed for predecrement stores. Each bit names the address after its optional
transfer; clear bits consume no bytes. Sources and each selected A7 bank are
captured at that register's turn. Loads commit only complete registers and
sign-extend words to all 32 bits. PC-relative loads use program space. After the
whole list succeeds, the captured base bank receives the final pointer, replacing
any value loaded into that base. No ordinary EA auto-update commit is involved.
A failure retains earlier register loads and byte writes, skipping that final
pointer update. All this uses existing statements, with no new semantic primitive.

The [transfer probes](../../tests/components/cpus/semantics/68000-transfers.test.ts)
independently scan every encoding and compare effect order, partial failures,
stack banks, live callback mutations, signed boundaries, sparse/empty masks,
and logical wrap. The existing CPU tests sweep every MOVEM mask and signed word.
Additional bus tests fail every alternate MOVEP byte, every byte across multiple
MOVEM registers in both stack banks, and extension fetches for empty lists.
Type checks enforce data/program-space capabilities and the absence of ordinary
EA resolution in the auto-update bodies. All earlier definitions and generated
modules remain unchanged.

The [system inventory](../../src/components/cpus/68000-system.ts) completes all
186 remaining documented forms through 63 bodies, also serving TRAP literals and
software emulator-line requests. Privilege guards reject before operand fetching
or address resolution. These outcomes use the existing exception boundary, which
selects vectors, saved PCs, trace handling, and nested-fault behavior.

Packed SR reuses CPU-owned condition/system flag layouts and shared status
construction. Its captures retain T/S, interrupt mask, then X/N/Z/V/C order.
Immediate logic captures the old status before fetching the complete word.
CCR restoration preserves system fields and the flag object. Full SR restoration
writes condition codes, system flags, then interrupt mask. Loads commit pending
address updates afterward, preserving the bank selected before S changed.
MOVE from SR remains unprivileged, reads its destination before capturing status,
and retains live upper Dn bits on word writeback.

RTE captures SSP after its privilege check, then reads PC high, SR, and PC low.
RTR captures the active stack bank and reads CCR before the long target. Both
check stack alignment before any read and validate/select the target before
advancing the captured pointer and restoring status. A failed read or odd target
leaves those final effects unapplied. STOP restores the fetched SR before halting.
The narrow `reset-devices` statement invokes the existing RESET connection;
validation restricts it to the 68000, generated types require only that callback,
and the CPU records reset only after callback success. It does not reset CPU state.

The [system probes](../../tests/components/cpus/semantics/68000-system.test.ts)
independently scan all 8,393 encodings, check every status word and packed flag/mask
combination, and compare capture order and each failed effect with live callback
mutations. Additional CPU tests check status-source faults, destination reads and
partial writes through A7, and every RTR frame byte in both banks. Existing tests
retain exhaustive status logic, RTE, trace, exception, and RESET-connection checks.
The core's superseded operand wrappers, status writers, instruction handlers,
and return helpers are removed; memory address decoding and exception entry remain.

Program/data byte callbacks retain full logical addresses until the existing
adapter projects the bus and records access/fault metadata. Alignment outcomes
carry the rejected logical address and access space; they return through nested
conditions and are forbidden inside value sources. Exception delivery remains
at the CPU boundary. This preserves the same partial effects for host failures,
bus errors, address errors, and successful transfers.

The generator's `sources` option also emits `sourceReaders(state)`. These readers
use the same validation, lexical scopes, and statement compiler as instruction
bodies, returning the source's captured result. Each reader requires only the
callbacks it uses: a simple address needs fetching, an indirect address also
needs pointer reads, and a memory operand adds the final data read. Binding
performs no register or memory reads; each call observes live registers at its
declared position. The 6502 now expands these sources into every ordinary
instruction body; standalone readers remain focused generator probes.

The 6502 and 8080 now use generated chapter dispatch for their complete
instruction sets. The Z80 chapter directly binds byte loads, arithmetic, and
INC/DEC, removing their old hooks from `Cpu8080Family`. Its remaining inherited
word, control, and stack bindings stay in that class until migration.

Z80 indexed arithmetic and adjustments reuse chapter actions after native
address resolution. Four accumulator rotates still use the native family hook;
310 documented CB forms share ordinary and indexed bindings. Prefix recognition,
displacements, PC/R updates, and interrupt delivery remain in the CPU module.
Native transfer/word/control inventories continue to supply both definition keys
and binding opcodes for those remaining families. Indexed load/store bodies take
one resolved address. HALT remains a separate control body outside the chapter's
byte-transfer matrix.

Accumulator memory transfers through BC/DE and absolute addresses use the same
inventory and binder, completing the shared ordinary byte load/store bindings.
Their address sources are captured before A or memory: pair views read high byte
first, while the immediate word fetches low byte first. Loads reuse `memorySource`
and `transfer`; stores capture the address and then use `transfer` to read A and
write memory once. No flags or alternate-bank state are accessed. The old pair
selector is no longer needed. [Capture-order probes](../../tests/components/cpus/semantics/intel-accumulator-transfers.test.ts)
change registers and flags during accesses to check that only the intended
values are captured. [CPU boundary probes](../../tests/components/cpus/intel-accumulator-transfers.test.ts)
cover ordinary and supplied bytes, overlapping code/data, wrapping fetches,
and every failed access.
Word bodies also own their complete immediate or absolute-address fetching.
The shared word-store helper is removed; its word reader still serves Z80
interrupt-vector reads. ED and unprefixed HL word transfers
share bodies; IX/IY word transfers use the same construction with stored words.
The same pair descriptions and transfer recipe now serve all 44 word-arithmetic
forms. Source and destination are captured separately even when they alias;
ADC/SBC capture C after both reads. Adjustments never access flags. Arithmetic
writes the complete destination before applying the CPU-specific flag policy.
Z80 word H uses bit 12 of `left XOR right XOR result`, which identifies carry
or borrow out of bit 11, including incoming C; the byte half-carry primitive
retains its low-nibble meaning. This needs no new compiler vocabulary and
removes the shared addition hook, handwritten word-arithmetic helpers, and
the Z80's now-unused IX/IY pair-read/write overrides.
[Generated-body probes](../../tests/components/cpus/semantics/intel-word-arithmetic.test.ts)
check ordered register and flag accesses against independent integer arithmetic.
[CPU boundary tests](../../tests/components/cpus/intel-word-arithmetic.test.ts)
exercise all encodings through ordinary and supplied-byte execution, including
failed prefix fetches, PC/R wraparound, and interrupt retirement.
The six exchange bodies reuse stored words and pair views. XTHL and EX (SP)
capture the register before SP, read low/high, write high/low, and replace the
register only after both writes succeed. XCHG and EX DE,HL swap D/H before E/L.
Both handwritten exchange helpers are removed; SP and flags are never written.
[Generated-body probes](../../tests/components/cpus/semantics/intel-exchanges.test.ts)
change live state during memory accesses to check captured sources and addresses.
[CPU boundary tests](../../tests/components/cpus/intel-exchanges.test.ts) cover all
six encodings, ordinary and supplied instructions, wrapping, code overlap, and
every failed access, including retention of the first write if the second fails.
The 8008 chapter owns all 72 native ALU forms, twelve register adjustments,
four accumulator rotates, and 71 byte transfers. It supplies both definition
keys and binding opcodes, with explicit HLT exclusions. Generated bindings now
cover all 250 definitions, removing the remaining handwritten family binding
helpers from the CPU core.
The chapter also owns the 59 jumps, calls, returns, restarts, and halt forms
and all 32 port forms. Its patterns supply construction and binding without
separate TypeScript opcode lists. Calls advance the selector modulo eight before
writing the new 14-bit target; returns only decrement it. Targets are fetched
before conditions, and untaken paths never access the selector or array.
Its explicit INP/OUT effects preserve complete-input-before-writeback and
captured-output rules. A separate `8008-state.ts` module uses the same generator
for chapter-authored PC/HL readers and PC-write/reset/acceptance actions. Those helpers
have no opcode bindings. The chapter execution contract generates
`8008-execution.ts`, binding its counter, stopped latch, and actions to shared
fetching, recording, and guarding. The public core supplies owned state and
snapshots; its handwritten step and interrupt algorithms are removed.
The machine parser reads its separate state schema without
depending on generated execution code.
The 6800 chapter owns its complete model, including addressing, branches, stacks,
interrupt-frame effects, reset, and execution/event recognition. Its generated
public class uses the shared vector runtime, with chapter-defined IRQ/NMI entry
and waiting policies. No handwritten 6800 implementation remains.
The [6809 chapter](../../src/components/cpus/specifications/6809.md) owns all
base-page comparisons, arithmetic, logic, byte/word transfers, unary operations,
DAA, register/flag operations, every branch, LEA, and calls/jumps/returns, plus
ordinary prefixed comparisons and transfers, plus EXG/TFR, masked stacks,
SYNC/CWAI, RTI, and SWI/SWI2/SWI3.
Each includes its addressing. One generated indexed decoder serves these bodies
and the prefixed word families; its matches reject undefined postbytes while
retaining completed address effects. The chapter also supplies the full stored
schema and D/CC read/write rules. All 268 forms now belong to the chapter;
remaining TypeScript owns reset, execution, and external-event decisions.

[Named opcode pages](literate-specifications.md#opcode-pages) declare the 6809's
`$10` and `$11` dispatch. Expanded inventory keys combine prefix/opcode, while
execution fetches them individually. Generation binds separate page tables and
returns unsupported after an unknown second byte. SWI2/SWI3 are chapter forms
on those pages. Duplicate entries are rejected. The old Motorola operand wrappers and comparison, transfer,
and long-branch builders are removed; shared condition construction remains for
the 68000.

The earlier load and TAB/TBA migration used `transfer`: capture a source or an
already read value, write the destination, then apply the Motorola result policy.
Both chapters now spell out those stages. Word reads reuse high/low sources;
stores capture the register after addressing, write each byte without reading
the destination, then apply N/Z with V cleared. A failed word store preserves
flags and completed writes. LDS writes S and arms NMI only after a complete
operand read; earlier indexed S updates and their arming survive a later failure.

The existing independent CPU tests cover values, flag patterns, and unchanged
writes. Additional probes check each failed access, all 217 legal 6809 indexed
postbytes, source/index aliases, partial PC/index updates, and unsupported
postbyte rejection. Generated-body probes use replacement flag objects and
changing registers during callbacks to verify capture order, single accesses,
and flags derived from the captured byte or word. All seven word transfer
families receive failure injection at either byte, including S auto-updates
and successful LDS arming. Compiler probes test both byte extractions over
all words and constant latch set/clear without state reads. Type checks restrict store bodies to
writing plus address fetching, memory loads to fetching/reading, and immediate loads to fetching.

## Decision and next review

The experiment demonstrates one meaning producing executable code and an
explanation. Its initial representation and compiler added authored machinery;
migration percentages alone do not establish a reduction in code or complexity.
The family cleanup removes the 6502's duplicate load/comparison binding arrays
and individual bindings. Shared address and operand readers then remove four
handwritten addressing helpers and the duplicate accumulator operand list.
Completing the shift/rotate and increment/decrement families removes the shift
selector, shift/adjust family builders, memory-modification wrapper, carry-result
wrapper, and index-adjustment helper. Independent encoding and CPU tests check
execution connections, effect order, and failure boundaries.

Measure the complete [source footprint](coverage.md#source-footprint), including
definitions and shared machinery, with generated output counted separately.
Moving code into a definition file does not count as source reduction. Review
whether family authoring, reusable sources, and explicit ordered statements
improve understanding. The shared shift recipe now serves the 6502, 6800, 8080, and
6809, with sign extension and circular rotation expressed using existing
primitives. Boolean XOR is the only new expression needed for this extension.
Their different flag and writeback schedules remain explicit. Completing all
6809 unary families removes the remaining handwritten selector and
memory-modification path. Declared numeric inputs let eleven memory bodies
share the existing address-decoder boundary, covering thirty-three memory
opcode forms. TST's read-only behavior and CLR's real memory read remain
explicit. Sharing these definitions and the unary selector table with the 6800
removes four unused runtime ALU helpers and its shift/test wrappers. With the
last caller migrated, the earlier `modifyByte` helper is also removed; generated
statements and CPU boundary tests retain its relevant access-order guarantees.
Total authored CPU source now falls modestly after accounting for the shared
builder and the newly separate 6800 state schema. This demonstrates useful
family reuse, but does not establish a large code reduction or justify new
semantic primitives on its own.

Completing the 6809 comparison family replaces its partial indexed sample and
separate direct/extended definitions with one memory body per compared register.
Explicit byte reads and concatenation express D without a new register-view
primitive. All 28 comparison forms use the same construction, and total authored
source falls again after including the definitions and bindings.

Sharing comparison construction and bindings with the 6800 completes its thirteen
comparison forms. CPX motivates one narrow `highByte` expression, with width
validation, executable generation, and an explanatory spelling. Existing 6502,
8080, and 6809 generated bodies remain byte-for-byte unchanged. The CPU modules
and CPU-specific definitions shrink, but this step increases total authored
source after accounting for shared construction and the expression. Its benefit
is explicit hardware meaning and family reuse; the footprint report records the
cost rather than treating migration credit as source reduction.

The 6502 store migration consolidates thirteen handwritten bindings around one
three-statement body and the shared accumulator address inventory. Existing
definitions and address/operand sources remain structurally unchanged. It needs
no new language or generator support, and total authored CPU source is unchanged
after including its definition and binding costs.

Migrating ORA/AND/EOR and BIT adds three numeric bitwise expressions and reuses
the existing addressing and N/Z definitions. The CPU loses its BIT helper and
logical bindings; BIT's distinct flag policy stays separate from accumulator
writeback. All earlier definitions and address/operand sources remain unchanged.
The CPU module shrinks by 14 lines, while definitions and shared expression
support add 41, a net increase of 27 authored lines. Reusing this vocabulary
across further CPU families remains the next opportunity to reduce duplication.

The 6800/6809 logical migration uses that vocabulary without further primitives
or compiler changes. Its shared recipe also replaces the 6502's local statement
sequence without changing any earlier definition. The former comparison-only
binding is renamed to reflect its general immediate/resolved-memory role.
The 32 new bodies cover 64 complete opcode forms. Shared construction, bindings,
and CPU integration cost 41 net authored lines after removals; the footprint
report records this increase alongside the reuse across three CPUs.

The byte-transfer migration reuses the same sources, transfer recipe, and
Motorola flag policy without compiler changes. Fourteen new bodies cover thirty
forms across both CPUs. Earlier definitions remain structurally unchanged, and
the generated 6502/8080 modules are byte-for-byte identical. CPU modules shrink
by 26 lines, while definitions and shared construction/bindings add 48, a net
increase of 22 authored lines.

The word-transfer migration extends that construction to all seven Motorola
word registers or views, adding 21 bodies for 49 forms. Byte extraction gains
`lowByte`; constant control-latch assignments model LDS arming without a
CPU-specific compiler case. CPU modules shrink by 40 lines while definitions
and shared support add 41, leaving one additional authored line overall.
All 256 earlier definitions remain structurally unchanged. Compound writes
remain ordinary statements and do not introduce a general register-view system.

All eight documented instruction inventories now use generated definitions.
The [literate prototype](literate-specifications.md) now tests an external authoring
path into those definitions. Continue checking total authored source in the
[footprint report](coverage.md#source-footprint), including the chapters and their
compiler. Complete instruction migration does not yet provide a full CPU
authoring language: lifecycle contracts, native decoders, and external interfaces
remain outside the chapter language.

General addressing decoders (such as the full 6809 postbyte decoder), unbounded
loops, and CPU-boundary exception delivery remain outside the
semantic bodies. Pending 68000 address updates now have an explicit commit
stage while the decoder still owns their calculation. Bounded numeric iteration and named instruction outcomes now
serve 8088 arithmetic without moving CPU boundaries into the language. Register views and byte-mask stacks now have
construction recipes, but no new runtime or primitive representation. The 68000
MOVE and logical traces exercise distinct schedules with the same staged address
and commit vocabulary. The 6507 address-projection and 4004 nibble/interface
probes remain acceptance requirements, not capabilities
of this instruction-definition slice.
