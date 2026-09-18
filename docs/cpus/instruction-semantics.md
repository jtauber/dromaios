# Instruction semantics experiment

This implements the bounded executable review in
[stage 5 of the shared-building-blocks proposal](shared-building-blocks.md#5-execute-one-slice-and-produce-a-useful-second-output).
Typed definitions drive validation, a reproducible [expanded listing](semantic-examples.md),
and generated TypeScript instruction bodies used by the 6502, 6800, 8008, 8080, 6809, and Z80.
The public execution interfaces and supported opcode inventories are unchanged.

The experiment asks whether an instruction's meaning can be described clearly
enough for execution and explanation to share one source. The authored
[definitions](../../src/components/cpus/semantics/definitions.ts) pair prose with
structured bodies. This is a step toward the literate-programming aspiration;
it does not choose an external grammar or a document format for authoring CPUs.

## The review slice

| Definitions | What they challenge |
| --- | --- |
| 6502 CMP/CPX/CPY, every supported addressing form | Share subtraction without writeback; preserve V/D/I; C means no borrow |
| 8080 ADD/ADC/SUB/SBB/ANA/XRA/ORA/CMP and every immediate counterpart | Shared register, memory, and immediate sources; CY before A for ADC/SBB; parity, inverse half-borrow, and ANA's auxiliary carry rule |
| Z80 ADD/ADC/SUB/SBC/AND/XOR/OR/CP, including (IX+d)/(IY+d) | Share 8080 sources and ALU construction with distinct overflow, half-carry, and N rules; enter indexed bodies after displacement/address resolution; preserve both-bank and prefix-decoding contracts |
| Z80 accumulator rotates and all documented CB shifts/rotates, including indexed forms | Preserve S/Z/PV on accumulator rotates; derive them for CB operations; share each memory body across HL/IX/IY, with flags before writeback and explicit failure boundaries |
| Z80 EX AF,AF′/EXX, I/R transfers, and NEG | Schema-owned alternate-bank references, whole flag-object exchange, explicit IFF2 reads, and flags before A |
| Z80 RLD/RRD and all eight block transfer/search forms | Direct nibble shifts; successful memory writes before flags; live pair rereads; one iteration and conditional PC rewind, with no hidden loop |
| Z80 BIT/RES/SET, including indexed forms | Fixed bit masks; BIT reads without writeback and preserves C; RES/SET write even unchanged values without accessing flags; share CB construction and bindings with shifts |
| 8080 INR/DCR and Z80 byte INC/DEC, including indexed forms | Share read–adjust–flags–write bodies; preserve carry; distinguish 8080 inverse half-borrow and parity from Z80 half-borrow and overflow; retain calculated flags on failed writes |
| 8080 MOV/MVI and corresponding Z80 LD matrices, immediate and indexed forms | Share one encoding inventory for definition generation and execution binding; capture sources before writes, retain HL access timing and real indexed H/L operands, preserve every flag, and exclude HALT |
| 8080 STAX/LDAX/STA/LDA and corresponding Z80 accumulator LD forms | Capture BC/DE or the complete immediate address before A or memory; loads write only after a successful read, stores never read the destination, and neither direction accesses flags |
| 8080 LXI/LHLD/SHLD/SPHL and Z80 word loads/stores and SP copies, including ED and IX/IY forms | Share complete bodies with low-first fetching and memory accesses, high-first pair reads/writes, captured sources, and explicit second-byte failures; ED's HL forms reuse the unprefixed bodies |
| 8080 INX/DCX/DAD and Z80 word INC/DEC, ADD HL/IX/IY, ADC/SBC HL | Reuse pair descriptions and native base encodings; source before destination, optional C after both; write before flags; preserve all flags on adjustments and use the bit-11 H boundary on Z80 arithmetic |
| 8080 XTHL/XCHG and Z80 EX DE,HL and EX (SP),HL/IX/IY | Capture the register before SP; read memory low/high, write high/low, then replace the register; preserve completed writes on failure, SP, and flags; register-only exchanges swap high bytes before low bytes |
| 8008 Lr1r2/LrM/LMr and immediate LrI/LMI | Reuse Intel transfer construction with native register selectors, matrix prefix, mnemonics, and a 14-bit memory mask; preserve full H/L bytes, source-before-address ordering, and address-slot fetching |
| 8008 AD/AC/SU/SB/ND/XR/OR/CP, every register/memory/immediate form | Reuse Intel ALU construction with S/Z/P/C, native register order, and an explicit 14-bit memory mask; retain address-slot fetching and supplied-byte rules |
| 8008 INr/DCr and RLC/RRC/RAL/RAR | Preserve C on adjustments; share 8080 rotate construction with explicit A-before-C writeback and preserved S/Z/P |
| 8008 conditional/unconditional jumps, calls, returns, restarts, and halts | Explicit 14-bit targets and three-bit selector wrap; checked physical register arrays; no RAM-stack effects; retain ordinary versus supplied-byte fetching and all documented aliases |
| 6809 TFR/EXG, all legal same-width postbytes | Construction-time views for D, CC, and S; read both originals before writes; keep postbyte validation in the CPU |
| 6809 PSHS/PULS/PSHU/PULU and shared interrupt-frame transfers | One byte-mask recipe; each register captured at its turn, each pop committed after its complete read, native NMI arming and partial failures |
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

There are 1,572 generated, executable bodies. All serve CPU execution;
1,570 are bound through opcode or postbyte selection, and two are shared 6809
frame helpers called by interrupt entry and return. The earlier MOV B,A test
sample is part of the complete 8080 matrix.
Other instruction families retain their existing shared helpers. This is not a
complete CPU migration. Bodies start after opcode selection. Each 6809 memory
body starts after successful address resolution and serves direct, indexed, and
extended forms, including all legal indexed postbytes. The 6800 memory
comparisons, logic, arithmetic, and byte/word transfers likewise serve direct/indexed/extended
forms, while its unary operations have indexed/extended forms. Both decoders
remain handwritten. The existing
[boundary probes](boundary-probes.md#existing-models-executable-evidence) and
independent CPU tests are the behavioral baseline.

## Representation and authoring

[model.ts](../../src/components/cpus/semantics/model.ts) separates declarations,
pure expressions, and ordered statements. Its constructors return ordinary
readonly data. There is no instruction callback stored in a definition.

The authoring layers have separate homes:

| Location | Responsibility |
| --- | --- |
| [model.ts](../../src/components/cpus/semantics/model.ts) | Primitive expressions, statements, and CPU symbols |
| [builders.ts](../../src/components/cpus/semantics/builders.ts) | Shared sources, construction-time register views, comparison/transfer/shift/logical/arithmetic recipes, N/Z policies, and checked opcode inventories |
| [control-flow.ts](../../src/components/cpus/semantics/control-flow.ts) | Conditional effects, jumps, branches, calls, and returns with explicit operand/condition/stack order |
| [stack.ts](../../src/components/cpus/semantics/stack.ts) | Descending byte stacks, explicit pointer position and fixed page, word byte order, masked register transfers, and complete push/pop instruction construction |
| [motorola.ts](../../src/components/cpus/semantics/motorola.ts) | Shared 6800/6809 unary, comparison, logical, arithmetic, byte/word-transfer, branch, and subroutine construction, with explicit access and flag policies |
| [intel.ts](../../src/components/cpus/semantics/intel.ts) | Shared 8008/8080/Z80 byte ALU and transfers, 8080/Z80 word transfers, arithmetic, exchanges, jumps, stacks, and subroutines, with explicit address, read, and writeback policies; byte sources and adjustments; shared accumulator rotates with CPU-specific additional flag stages |
| [intel-encodings.ts](../../src/components/cpus/intel-encodings.ts) | Native 8008 transfer/control and 8080/Z80 transfer, word-arithmetic, exchange, jump, stack, and subroutine encoding inventories consumed by definition construction and runtime binding; memory-to-memory transfer slots omitted, with 8008 HALT defined separately |
| [status.ts](../../src/components/cpus/semantics/status.ts) | Pack and restore CPU-owned layouts, construct single-flag changes, and declare flag policies |
| [decimal.ts](../../src/components/cpus/semantics/decimal.ts) | Shared decimal-correction selection with explicit Intel/Motorola flag and result stages |
| [mos.ts](../../src/components/cpus/semantics/mos.ts) | NMOS ADC/SBC binary facts, decimal digit correction, and distinct flag/write stages |
| [definitions/6502.ts](../../src/components/cpus/semantics/definitions/6502.ts), [6800.ts](../../src/components/cpus/semantics/definitions/6800.ts), [8008.ts](../../src/components/cpus/semantics/definitions/8008.ts), [8080.ts](../../src/components/cpus/semantics/definitions/8080.ts), [6809.ts](../../src/components/cpus/semantics/definitions/6809.ts), [z80.ts](../../src/components/cpus/semantics/definitions/z80.ts) | CPU-specific sources, flag policies, instruction bodies, and authored explanations |
| [definitions.ts](../../src/components/cpus/semantics/definitions.ts) | Inventory consumed by executable generation and explanation |

Each CPU definition module follows sources, policies, instruction construction,
then instruction definitions and their selectors. Shared recipes return data built from the existing
vocabulary; they add no runtime callbacks or new language primitives. The
compiler and reporter expand their results just like directly authored bodies.

Motorola comparisons, logic, loads, and arithmetic use a local `operandFamily`
constructor for immediate and resolved-memory forms. It supplies their names,
address inputs, and byte/word sources. Each family explicitly places the supplied
memory reads before consuming their captured value and retains its own flag and
writeback order. Stores remain separate because they do not read a source operand
from the destination address.

Statement constructors such as `fetchByte("low")`, `readRegister("index", X)`,
and `writeMemory(address, byte)` return the corresponding data nodes. They do
not execute effects or reorder statements. Their arguments retain the explicit
capture names, registers, addresses, and values used by validation and reporting.

The 6502 uses the existing `opcodeFamily` and `opcodePattern` helpers to construct
definitions in place of runtime callbacks. `instructionSet` rejects duplicate or
out-of-range opcodes before constructing the inventory. ORA/AND/EOR, LDA, and CMP
share one `bbb` operand selector, derived from the same address inventory used by STA.
The immediate slot has no address, so STA omits that encoding. CPX/CPY and
LDX/LDY/STX/STY share Y/X register selectors; indexed loads and stores explicitly
select the other register for indexing. The definition's
opcode is also its generated method key, so there is no second list of method
names or handwritten per-instruction bindings. These are construction-time
families; the resulting definitions still contain only data.

`cpuSymbols(name, stateDescription)` imports the CPU's existing authority for
stored fields. It offers typed register, register-array, flag, and control-latch names and records register
widths from that schema. There is no second register-layout declaration.
Current symbols cover stored unsigned registers at supported widths, fixed
arrays of those registers, the `flags` group, and top-level Boolean control
latches. Array symbols derive both length and element width from the schema.
`cpu.bank("alternate")` exposes the stored unsigned registers and complete
flag object in that named top-level bank, using the same CPU declaration.
Register references carry an optional bank name; they never flatten or copy
live bank state. Names and widths are checked against the owning schema.
Arbitrary nested paths and implicit register slices remain outside this API.
Composed reads use ordinary sources: 8080 HL is explicitly read as H then L,
and the 6809's D as A then B, before combining the bytes. `intelPairView` supplies
both that source and construction-time split writes, reusing `RegisterView`.
Compound transfer and arithmetic destinations use explicit ordered statements consuming
`result`: LDD writes A then B using `highByte`/`lowByte`; LDS writes S then
`writeLatch(cpu.latch("nmiArmed"), true)`. A latch is distinct from an architectural
flag. `readLatch` captures its Boolean value for later conditions or policies;
`writeLatch` still accepts only a Boolean constant.

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

`motorolaComparison` constructs immediate and resolved-memory bodies for each
compared register or view. Its default policy applies N/Z/V/C at the operand's
width, with C meaning borrow. The original 6800 CPX instead supplies a named
policy using `highByte(left)` and `highByte(right)` for N/V, whole-word subtraction
for Z, and no C assignment. Its explanation accompanies the policy in the 6800
definition. CBA uses the same `compare` recipe with B as its register source.

`arithmetic(operation, policy, incoming?)` consumes captured `left` and `right`
and an optional captured carry expression, captures `result`, and applies the
policy. The caller schedules reads and writeback. This preserves each model's
existing order: Motorola ADC/SBC read the operand, accumulator, then C; 8080
ADC/SBB read the operand, CY, then A. `motorolaArithmetic` supplies N/Z/V/C at the
operand width, with C meaning carry for addition and borrow for subtraction.
Only byte addition replaces H; subtraction and word arithmetic preserve it.
`motorolaArithmeticFamily` reads the full immediate or resolved-memory operand
before A/B or the D view, then captures incoming C for ADC/SBC. ADD/SUB and
ADDD/SUBD never read incoming C. Flags precede destination writes, including
D's explicit A-then-B writes. ABA/SBA supply their own A-then-B operand reads
and use the same calculation/policy construction. Failed operand reads retain
completed fetching and address updates, without arithmetic or writeback.
Decimal adjustment remains outside this binary arithmetic family.

The 8080 expands all eight byte ALU families over one B/C/D/E/H/L/M/A/immediate
source inventory. Addition/subtraction use the same `arithmetic` recipe, with
S/Z/P derived from the byte result, CY as carry/borrow, and AC as low-nibble
carry or inverse half-borrow. ANA instead derives AC from bit 3 of the original
A OR the operand; XRA/ORA clear it. All three logical families clear CY.
Flags precede A writeback, while CMP omits the write entirely. The definitions
use existing expressions and policies without adding a semantic primitive.

`intelByteSources` shares the register, (HL), and immediate source inventory
between the 8080 and Z80. `intelByteAlu` consumes the captured right operand,
reads optional carry before A, calculates the result and flags, then writes A
unless the operation is comparison. It reuses `arithmetic` for addition and
subtraction. Each CPU supplies its flag policy: Z80 arithmetic uses P/V for
overflow, H for half-carry/half-borrow, and N for subtraction; logic uses parity,
sets H only for AND, and clears N/C. The Z80 supplies a resolved address to its
eight indexed bodies, each shared by IX and IY. They read that address once
before the ALU construction, without fetching displacement or touching either
index register again. No general indexed-addressing primitive is needed.

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

`intelByteAdjustment` shares the complete read–adjust–flags–write construction
for 8080 INR/DCR and Z80 byte INC/DEC. Each CPU supplies a named flag policy:
8080 derives S/Z/P from the result, with AC meaning carry on increment and
inverse borrow on decrement; Z80 uses S/Z, H as carry/borrow, P/V as signed
overflow, and N to distinguish subtraction. Neither reads nor writes carry.
The register bodies read and write their selected byte once; memory bodies use
one supplied address for both accesses. Failed reads prevent flags and writeback;
failed writes retain the calculated flags. The 32 bodies cover 36 forms, with
the two Z80 memory bodies each shared by HL, IX, and IY. Existing arithmetic
expressions suffice; no semantic-model or generator extension is needed.

The 8008 is a third consumer of `intelByteAlu`, with no change to that builder.
Its own source inventory follows A/B/C/D/E/H/L/M. Memory concatenates captured
H/L and masks the address with `3FFF`, using the existing word-valued bitwise
expression; no 14-bit register primitive is introduced. S/Z/P describe the byte
result, C reports carry/borrow, and logic clears C. AC/SB capture C before A;
CP has no destination write. The bodies neither select nor explicitly update
address-stack slots. Ordinary fetching advances the selected PC slot, while
interrupt-supplied bytes preserve it. These fetch policies stay in the CPU.

The 8008's twelve INr/DCr forms read the selected B/C/D/E/H/L register and
wrap the adjustment to a byte. They apply S/Z/P before writeback, leaving C
unread and unchanged. Its four accumulator rotates share
`intelAccumulatorRotate` with the 8080: capture A, optionally capture incoming
C/CY, calculate, write A, then replace carry. Circular forms use the captured
outgoing bit without reading carry. Other flags are untouched. These bodies
have no fetch, memory, port, or address-stack operations.

`transfer(destination, source, policy?)` captures its source as `result`, writes
the destination, and optionally applies a policy with that result parameter.
The destination is a stored register or an explicit statement list using
`result`; those statements are expanded directly, without an opaque setter.
All 18 6502 load forms and six register transfers use this recipe.
The 6502 selects its N/Z policy except for TXS,
which supplies no policy and preserves every flag. A source that fails never
reaches the destination write or flag update. Motorola byte/word loads and
TAB/TBA use the same recipe with a width-dependent N/Z policy and V cleared.

`intelByteTransfer` builds explicit source-capture and destination-write
statements for the 8008/8080/Z80 transfer families. Register transfers retain a real
read and write even when the source equals the destination. Loads through HL
read H then L before memory and destination writeback. Stores capture the source
or fetch the immediate first, then read H/L and write memory without a destination
read. None accesses flags, alternate banks, or control state. A failed source
access prevents destination writes; completed fetching and decoding remain.

The 8008 supplies `{ mask: 0x3fff }` to the shared construction, so memory
accesses use only H:L's low 14 bits without narrowing the stored bytes. Its
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

`sources6502` groups eight named address sources and eight `bbb` operand sources.
The operand readers and generated accumulator bodies use the same selector inventory.
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

`logical(register, source, operation, policy, writeBack)` also serves the 6800
and 6809. It captures a source or already-read expression before the accumulator,
calculates the result, optionally writes it back, and applies its result policy.
The operation constructor runs only while building data. Each Motorola CPU uses
one shared family construction for AND/BIT/EOR/OR on A/B, with separate immediate
and resolved-memory bodies. N/Z describe the result, V clears, and C/H/control
flags are preserved. Motorola BIT passes `false` for writeback; unlike 6502 BIT,
it derives N from the masked result and always clears V. The original 6800's
ORAA/ORAB spelling is retained, while both CPUs use the same internal body keys.

A `ValueSource` has a name, result width, ordered body, and pure result expression.
Its captures live in a fresh scope; only its yielded value enters its caller's
scope. Sources can explicitly update registers or access memory. Nothing about
the word “source” makes its body pure. A resolved memory address is an immutable
captured word used by later reads/writes, not a callback that can resolve again.

A `FlagPolicy` declares numeric parameters and Boolean assignments. Each
invocation binds exactly those parameters from captured caller values. Policies
cannot reference caller-local names implicitly, access live registers, or
perform memory operations. `unlisted: "preserve"` is mandatory. All assignments
within one invocation are simultaneous: evaluate every expression first, then
apply the updates. Distinct invocations remain at their declared positions in
the instruction body.

The 6502's `updateByte` construction recipe captures `original`, expands an
operation that captures `result`, writes the result, and applies N/Z. Memory
targets first resolve one address and include the original-value write;
register targets read and write the selected register. The four shift/rotate
operations declare their carry stage before writeback. INC/DEC declare only
the wrapped arithmetic, preserving C. These are CPU-specific construction
recipes: the original-value write and flag schedule are not imposed on other
processors. Opcode fields select the operation and address source from one
inventory for the complete families.

The shared `shift(direction, incoming)` recipe consumes the caller's `original`
capture and produces `result`, plus an outgoing-carry expression. Its incoming
bit can be zero (logical shift), the original sign (arithmetic right shift),
the outgoing bit (circular rotation), or a CPU flag symbol (through-carry
rotation). Only the flag-symbol case emits a `readFlag("carry", ...)` statement.
The caller places these steps at the required point and schedules flags and
writeback separately. Extracting this recipe leaves the existing 6502 bodies
structurally unchanged.

The 8080 writes A before replacing CY and preserves S/Z/AC/P. The 6809 instead
updates N/Z/C before writing A, B, or memory; left shifts also replace V with N XOR C,
while right shifts preserve V. That XOR uses the captured original and result,
so the policy does not depend on assignments to live N or C. The 6502 retains
its separate carry-before-writeback and N/Z-after-writeback stages, including
the original-value memory write before a rotate reads incoming C.
The shared `motorolaUnary` construction covers all eleven byte unary operations
for the 6800 and 6809. It captures the original register or memory byte when
required, calculates a result using a pure expression or ordered steps, applies
N/Z and the operation's additional flag updates, and optionally writes the result.
INC/DEC preserve C; TST clears V and omits writeback. Each CPU's definition
declares three differences:

| Rule | 6800 | 6809 |
| --- | --- | --- |
| `clearReadsOperand` | No: CLR only writes | Yes: CLR reads before applying flags and writing |
| `testClearsCarry` | Yes | No: preserve C |
| `rightShiftSetsOverflow` | Yes: V = N XOR C | No: preserve V |

These choices affect construction only; generated bodies contain no CPU-model
branch. Both CPUs use the existing primitive vocabulary. Sharing unary
construction left the existing 6502, 8080, and 6809 generated code byte-for-byte unchanged.

Every 6809 memory unary operation reads its operand once. Rotates capture
incoming C after that read; all operations except TST write once, including
unchanged values. A failed read leaves flags unchanged; a failed write retains
the completed flag updates. Address-register updates performed by the decoder
survive either failure.
The 6800 uses the same ordering except for CLR's omitted read. A failed CLR
write therefore retains its flag updates without any preceding data-memory read.

## Register views and postbyte-selected transfers

`RegisterView` pairs a `ValueSource` with a construction-time function returning
write statements. `registerView(register, afterWrite?)` supplies the scalar case;
6809 D supplies A/B reads and split writes, CC supplies packing and complete flag
replacement, and S appends NMI arming. These functions run while definitions are
built. Only expanded statements enter validation, generation, and explanations;
there is no runtime view object or hidden setter in a body.

One shared 6809 inventory enumerates the legal same-width pairs in `ssss dddd`.
The CPU uses it to bind postbytes and the definition module to construct TFR/EXG
bodies. Each body reads both originals before writing the target, then the source
for EXG, including self-aliases and post-fetch PC values. Invalid postbytes never
enter a body. LEA uses the same writes after indexed decoding has finished,
retaining auto-updates, indirect reads, and failures before entry. X/Y update
only Z; S arms NMI; U preserves all flags.

SEX and ABX use existing widening and addition expressions. MUL introduces only
unsigned byte multiplication: capture A/B, calculate a word, write A then B,
then replace Z/C. The C expression explicitly selects product bit 7.
[Register probes](../../tests/components/cpus/semantics/6809-registers.test.ts)
check every legal transfer pair, flag replacement and arming, read/write order,
failed register effects, all byte products, and rejected multiplication widths.

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
The 6502's page-wrapped indirect pointer stays in its own source. Motorola JMP
receives an address only after the CPU decoder completes, retaining indexed
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

`maskedStack` takes up to eight byte/word register views in mask-bit order.
Pulls visit ascending bits; pushes reverse the order. Each selected register is
captured only at its turn, then its complete byte or word is transferred through
`byteStack`/`wordStack`. A pull writes the destination only after its full read;
an empty mask never inspects state. All effects expand into existing conditional,
source, register, and memory statements.

The 6809 supplies CC/A/B/DP/X/Y/other-stack/PC views. Its four instruction bodies
fetch a mask; nonempty PSHS/PULS arm NMI only after all effects succeed. PULU's S
view arms immediately after the complete S pop. The two frame helpers receive
a captured mask and omit fetching and final arming. Interrupt policy still
selects full/short frames, restores CC before examining E, and arms after RTI.
This reuse removes the CPU's handwritten stack implementation without claiming
the interrupt instructions themselves as migrated.
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

The 6502's JSR stays an explicit sequence: fetch low target, read/push current PC
high, read/push current PC low, fetch high target, then write PC. A stack write
can replace the final operand. RTS adds one to the popped word. Motorola calls
use big-endian stacks and the existing address decoder. Indexed 6809 JSR retains
S auto-updates and NMI arming before body entry; subroutine stack effects do not
arm NMI. Packed-status stacks use the same construction with explicit packing
and replacement stages. The 6809 shares its mask-driven frame transfers with
this construction while keeping interrupt policy in the CPU.

## Packed status and decimal arithmetic

Each migrated CPU owns one immutable packed layout beside its state schema.
The runtime `flagRegister` exposes that layout as `bits` and `fixed`; generated
sources consume the same declaration. Packing reads each flag once, inserts its
bit, and adds fixed bits. Restoring ignores unmodeled bits and explicitly
replaces the complete flag object. A replacement must supply every stored flag;
partial updates continue to preserve unlisted fields on the existing object.
The 6502 adds the stacked B marker only when pushing PHP. PSW/AF pushes capture
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

NMOS ADC/SBC remain distinct sequences. Binary arithmetic writes A then N/Z/C/V.
Decimal ADC sets Z from binary addition, N/V from the low-digit-corrected
intermediate, and C from the decimal threshold before writing A. SBC first
writes the binary result and flags, then optionally corrects A alone. Word-width
intermediates retain the digit carry/borrow before byte narrowing, including
invalid BCD digits. The existing exhaustive CPU arithmetic/status tests and
[new generated-body probes](../../tests/components/cpus/semantics/status.test.ts)
check results, effect stages, callback changes, and failures independently.

## Primitive meanings

This vocabulary supports unsigned **3-, 8-, 14-, and 16-bit values**,
**Boolean flag/latch captures**, constant **control-latch writes**, and **16-bit byte
memory addresses**. The narrow widths describe the 8008 selector and physical
address registers; arithmetic and shifts still require 8- or 16-bit operands. Widths are decimal;
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
| `multiply(left, right)` | Unsigned byte-by-byte multiplication yielding the complete 16-bit product; non-byte operands are rejected |
| `concat(high, low)` | Two bytes combined as `high * 256 + low`, yielding a word |
| `highByte(value)`, `lowByte(value)` | Extract bits 15–8 or 7–0 of a captured word as a byte; byte operands and live register symbols are rejected |
| `extend(value, width)` | Unsigned widening; narrowing and equal-width conversions are rejected |
| `truncate(value, width)` | Keep the low bits at a strictly narrower supported width; writes never narrow implicitly |
| `signExtend(value, width)` | Widen the two's-complement value, returning an unsigned bit pattern at the new width; `80:u8` becomes `FF80:u16`; narrowing and equal-width conversions are rejected |
| `shiftLeft(value, incoming)` | Shift left once at the operand's width, discard the outgoing high bit, and insert the Boolean incoming bit at bit 0 |
| `shiftRight(value, incoming)` | Shift right once at the operand's width, discard bit 0, and insert the Boolean incoming bit at the high bit |
| `shiftBits(value, direction, count)` | Logical left/right shift of a byte or word by a constant integer from zero through its width; zero-fill, retain the original width, discard shifted-out bits, and do not read or write carry |
| `negative(value)` | Whether the top bit at the value's width is set |
| `lowBit(value)` | Whether bit 0 is set |
| `zero(value)` | Whether the unsigned value is zero |
| `evenParity(value)` | Whether a byte has an even population count, including zero |
| `borrow(left, right, incoming?)` | Whether unsigned `left - right - incoming` is negative |
| `halfBorrow(left, right, incoming?)` | Whether `(left mod 16) - (right mod 16) - incoming` is negative, at either arithmetic width |
| `overflow(left, right, incoming?)` | Whether signed `left - right - incoming` falls outside the signed range at that width |
| `carry(left, right, incoming?)` | Whether unsigned `left + right + incoming` reaches `2^width` |
| `halfCarry(left, right, incoming?)` | Whether `(left mod 16) + (right mod 16) + incoming` reaches 16, at either arithmetic width |
| `addOverflow(left, right, incoming?)` | Whether signed `left + right + incoming` falls outside the signed range at that width |
| `not(value)` | Boolean negation |
| `xor(left, right)` | Boolean exclusive OR; true exactly when its two Boolean operands differ |
| `or(left, right)` | Boolean disjunction over captured values; no implicit flag reads |
| `and(left, right)` | Boolean conjunction of pure expressions over already captured values; no implicit flag reads |

Binary arithmetic and bitwise operands must have equal widths. Narrow values
must be explicitly widened before arithmetic and narrowed before writing back;
for example, the 8008 selector update adds one as a byte and retains its low
three bits. Bitwise operations and top-bit/zero tests also accept narrow values. Optional arithmetic
inputs are Boolean expressions, contributing zero or one; omission means zero.
Carry/borrow/overflow use the original operands and input bit, never an already
wrapped `right + incoming`. These expressions perform no flag reads or writes. Shift operands have distinct
roles: a byte/word value and a Boolean incoming bit; shifts do not update flags.
These arithmetic meanings correspond
to existing [ALU](../../src/components/cpus/alu.ts) contracts; generated code
uses those helpers for arithmetic facts and parity. Numeric bitwise expressions
compile to parenthesized JavaScript operators; the supported widths
keep their results unsigned without extra masking. The reporter uses explanatory spellings
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
| `read-memory` | Read one byte at an explicit word address; capture it after success |
| `write-register` | Replace the stored register with an equal-width unsigned value |
| `write-element` | Replace one register-array slot with an equal-width value; do not read its old contents |
| `write-latch` | Assign a Boolean constant to a declared top-level control latch; performs no read |
| `write-memory` | Write one byte at an explicit word address, including unchanged values |
| `read-source` | Expand and perform the named source body once in its own scope, then capture its result |
| `update-flags` | Bind a named policy's pure parameters and apply its assignments at this point |
| `replace-flags` | Bind and evaluate a complete flag policy, then assign a fresh flag object; reject policies missing any stored flag |
| `when` | Evaluate a Boolean condition; execute the nested ordered statements only if true, with no body effects otherwise |

The current cores still own fetch-cursor behavior, PC commitment, access
recording, exception handling, and instruction boundaries. In particular,
`fetch-byte` does not assert one universal PC-update rule for all CPUs. Generated
bodies receive each core's existing callbacks, including interrupt-supplied
fetching on the 8080. Word
data reads and writes in this slice are two explicit byte accesses with visible
ordering and address wrapping; no word-access primitive hides partial completion.

A conditional block inherits its parent's captured numbers and flags. Its local
captures cannot escape the block or shadow inherited names; separate sibling
blocks may reuse local names. Source and flag-policy scopes remain closed,
even inside conditionals. Validation checks untaken bodies too, and capability
inference includes their possible fetches, reads, and writes.

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

The shared 8080/Z80 ALU table binds complete instruction handlers. Each CPU
selects generated bodies for all 72 register, (HL), and immediate ALU forms;
each owns its source reads, flag updates, and optional A writeback. The Z80 also
binds sixteen indexed forms to eight resolved-memory bodies. Their old ALU
methods and the operand-and-accumulator wrapper are gone; unrelated handwritten
Z80 operations retain their existing result helpers. The 8080 result helper is
removed now that DAA is generated.

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
as a `Pick<ByteInstructionContext, ...>`. For example,
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
Unsigned byte multiplication emits JavaScript multiplication with a word result;
no truncation or ALU helper is needed. Constant logical shifts emit unsigned
right shifts or masked left shifts, with counts checked against the operand width.
Bank references emit direct, safely quoted properties as needed. Flag exchange
emits two captured references followed by two assignments; it never packs or
rebuilds the objects. Array access emits direct indexing with an already
validated captured selector. The output is deliberately unoptimized:
repeated arithmetic facts remain separate calls rather than introducing an
optimization pass into this review.

The [generation script](../../scripts/generate-cpu-semantics.ts) produces
`src/components/cpus/generated/{6502,6800,8008,8080,6809,z80}.ts`. These files are ignored build
output and removed by `npm run clean`. Regenerate with `npm run generate:cpus`;
`npm run build` generates these bodies and the machine factories automatically.
The source-only check and ordinary compilation both type-check the generated
bodies. Reproducibility tests compare every module with fresh output and run the
native generator in a clean temporary tree from another working directory.

The six CPU-owned state declarations now live under
[`src/components/cpus/state/`](../../src/components/cpus/state), re-exported
through their original CPU modules. This lets definitions and generation load
schemas without importing execution or requiring generated files to exist.
The machine parser imports those schemas directly too, so machine generation
works independently of generated CPU output. There is still one authority for
each CPU's stored fields.

Opcode selection remains in the CPU tables. For the 6502,
`generateInstructions(..., { bindOpcodes: true })` also generates
`opcodeEntries(state)`, connecting every defined opcode to its body. The CPU
constructs its combined table after initializing state, and the ordinary
`opcodeTable` rejects any collision with its remaining handwritten entries.
Each instance binds its own state; no register or memory read occurs during
binding. Generated methods retain their precise callback types, while the
bound handlers accept the shared byte instruction context. Automatic opcode
bindings reject definitions with numeric inputs, since they cannot supply
those values; such bodies require an explicit CPU-owned binding.

The generator's `sources` option also emits `sourceReaders(state)`. These readers
use the same validation, lexical scopes, and statement compiler as instruction
bodies, returning the source's captured result. Each reader requires only the
callbacks it uses: a simple address needs fetching, an indirect address also
needs pointer reads, and a memory operand adds the final data read. Binding
performs no register or memory reads; each call observes live registers at its
declared position. The 6502 now expands these sources into every ordinary
instruction body; standalone readers remain focused generator probes.

This covers the complete 6502 comparison, load/store, logical, shift/rotate, and
byte increment/decrement families, plus all six register transfers. The 8080 uses
named bodies for all 72 byte ALU bindings and four accumulator rotates in the
shared 8080/Z80 family. The Z80 binds its 72 ordinary ALU bodies through that
same hook, with eight further bodies serving its sixteen indexed ALU forms.
Both CPUs supply complete generated byte-adjustment handlers to the shared
`00 rrr 10d` family. The former calculation hook, modification wrapper, and
modification-table builder are removed; each CPU binds the register bodies
directly and supplies HL only to the memory body. The Z80 also supplies its
resolved IX/IY addresses directly, removing its indexed modification wrapper.
It binds four generated accumulator rotates through the shared family hook,
and all 310 documented CB forms through unified ordinary and indexed CB bindings.
Thirty-one resolved-memory bodies each serve HL, IX, and IY after address resolution.
Its prefix recognition, signed displacement calculation, PC/R updates, and
interrupt handling remain in the CPU module.
The shared 8080/Z80 transfer, word-arithmetic, exchange, jump, stack, and subroutine inventory supplies both definition keys and ordinary
binding opcodes. Each CPU exposes its generated bodies to one family binder;
there are no duplicate per-CPU transfer binding tables. HALT is an explicit
generated control body outside the transfer matrix. The former operand read/write helpers and transfer body are
removed. Z80 indexed bindings retain their decoder and supply the resolved
address to generated load/store bodies.
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
The 8008 independently binds all 72 native ALU forms, twelve register adjustments,
four accumulator rotates, and 71 byte transfers through complete generated bodies.
Its native transfer inventory supplies both definition keys and binding opcodes,
with an explicit HLT slot; handwritten operand read/write helpers are removed.
Another 59 generated bodies cover its jumps, calls, returns, restarts, and all
three halt encodings. The control-flow inventory serves construction and binding
without separate opcode lists. Calls advance the selector modulo eight before
writing the new 14-bit target; returns only decrement it. Targets are fetched
before conditions, and untaken paths never access the selector or array.
Fetching, reset, port access, and interrupt acceptance remain handwritten;
all ordinary instruction bodies are generated. The machine parser reads its separate state schema,
without depending on generated execution code.
The 6800 and 6809 bind generated A/B and memory bodies through one
`motorolaUnaryOperations` selector table, including TST and CLR. Each CPU's static
inventory contains function references only; each invocation supplies the current
CPU state. CPU-owned wrappers resolve one address, with the 6809 rejecting
undefined postbytes before body entry. The handwritten unary calculations and
memory-modification paths are gone. JMP remains a separate address operation.
The 6800 and 6809 share `motorolaOperandBindings` for comparisons, arithmetic, logic, and
byte/word transfers, with the 6809 using it across its three opcode pages for comparisons.
Each register has an immediate body that fetches its operand and a memory body
that receives the decoder's resolved address. This covers CMPA/B/D/X/Y/U/S in
all four addressing modes, with no special indexed postbyte path. Unsupported
postbytes retain the same rejection behavior before body entry. ADDD/SUBD use
the same bindings; the old word-arithmetic helper is gone. The 6800 binds
CMPA/CMPB/CPX through the same wrapper and CBA, ABA, and SBA directly.
The handwritten accumulator-operation table and original 6800 CPX helper are
gone. Binding captures a state
getter without reading it until execution, and resolves each memory address once
before entering its body. Address decoding remains outside the generated definitions.

`motorolaByteBindings` selects SUB/CMP/SBC/AND/BIT/LD/ST/EOR/ADC/OR/ADD and A/B from the native
`1 r mm oooo` encoding. Stores omit the immediate binding. Each resolved-memory
body serves direct, indexed, and extended forms, with no new addressing path.

Loads and the 6800's TAB/TBA reuse `transfer`: capture a source or an already
read value, write the destination, then apply the Motorola result policy.
`motorolaTransfers` constructs byte and word families; word reads reuse the
same high/low layout and immediate source as comparisons. Stores capture the
register or view after addressing, write each byte without reading the
destination, then apply N/Z with V cleared. A failed word store preserves flags
and completed writes. Unary memory modifications instead apply flags before
writing. D supplies A/B reads and split writes; S supplies a write followed by
NMI arming. Both CPUs' byte and word load/store helpers are gone, along with
the shared runtime result-flag helper. The 6809's later ordinary-instruction
migration also removes its runtime word-register writer; explicit D and S
writes are shared within the definition module.

The existing independent CPU tests cover values, flag patterns, and unchanged
writes. Additional probes check each failed access, all 217 legal 6809 indexed
postbytes, source/index aliases, partial PC/index updates, and unsupported
postbyte rejection. Generated-body probes use replacement flag objects and
changing registers during callbacks to verify capture order, single accesses,
and flags derived from the captured byte or word. All seven word transfer
families receive failure injection at either byte, including S auto-updates
and successful LDS arming. Compiler probes test both byte extractions over
all words and constant latch set/clear without state reads. Type checks restrict store bodies to
writing, resolved loads to reading, and immediate loads to fetching.

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

Subsequent migrations should identify the handwritten helpers they can retire.
The 6502's arithmetic, result-writing, and operand-dispatch helpers are now gone;
its byte-stack helpers still serve BRK/RTI and interrupt entry. Ordinary Intel
status stacks also use generated bodies; the runtime call stack is private to
the Z80's interrupt paths. Total source accounting remains in the
[footprint report](coverage.md#source-footprint).

General addressing decoders (such as the full 6809 postbyte decoder), loops,
wider register masks, instruction rejection, pending commits, and exception
delivery are not represented here. Register views and byte-mask stacks now have
construction recipes, but no new runtime or primitive representation. The 68000 MOVE traces still challenge later ordering vocabulary. The 6507 address-projection
and 4004 nibble/interface probes remain acceptance requirements, not capabilities
of this byte/word slice.
