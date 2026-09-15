# 8088 model contract

The Intel 8088 model implements an instruction-level subset with flat 1 MiB
RAM, 16-bit registers, 20-bit physical addresses, and an optional byte-port
connection, native interrupt delivery, and single-step traps. The stored instruction address is CS:IP; the physical PC is a derived view.

[Implementation](../../../src/components/cpus/8088.ts) ·
[CPU tests](../../../tests/components/cpus/8088.test.ts) ·
[Public type checks](../../../tests/types/8088.ts) ·
[Coverage](../coverage.md#8088) ·
[Arithmetic example](examples/arithmetic.md) ·
[Transfer example](examples/transfers.md) ·
[Control-flow example](examples/control-flow.md) ·
[Masked word-sum example](examples/word-sum.md) ·
[Decimal buffer example](examples/decimal-buffer.md) ·
[dromaios-pc comparison](reference-notes.md)

Hardware behavior follows Intel's
[8086 Family User's Manual, October 1979](https://www.ardent-tool.com/CPU/docs/Intel/808x/manuals/9800722-03_alt.pdf):
sections 2.2–2.3 (registers, flags, and addressing), table 2-4 (reset), section
2.4 (interrupts) and 2.7 (instructions), and tables 4-12–4-14 (encodings). The 8086 and 8088 share
these instruction semantics; this model targets the original 8088. Later x86
instructions and undocumented encodings are outside its scope.

## Stored state and derived views

`Cpu8088State` requires all these fields:

| Fields | Range | Meaning |
| --- | --- | --- |
| AX, BX, CX, DX | `0000`–`FFFF` | Word registers with byte-register views |
| SP, BP, SI, DI | `0000`–`FFFF` | Stack pointer, base pointer, source and destination indices |
| CS, DS, SS, ES | `0000`–`FFFF` | Code, data, stack, and extra segment values |
| IP | `0000`–`FFFF` | Instruction offset within CS |
| `halted` | Boolean | HLT latch; cleared by reset or accepted delivery |
| `interruptDeferred` | Boolean | INTR inhibited through the next retired instruction/REP element |
| `segmentDeferred` | Boolean | MOV/POP segment inhibition of INTR, NMI, and trap recognition |
| `trapPending` | Boolean | Type-1 trap owed from the previously sampled TF |
| CF, PF, AF, ZF, SF, TF, IF, DF, OF in `flags` | Boolean | Carry, parity, auxiliary carry, zero, sign, trap, interrupt enable, direction, overflow |

TypeScript fields are lowercase, including `flags.if`. `.machine` definitions
conventionally use uppercase register and flag names and camelCase control latches.
There is no prefetch queue or public packed FLAGS view. PUSHF/POPF and
LAHF/SAHF pack/unpack flags internally. Snapshots include all three recognition
latches; pending external requests and NMI edge detection belong to the caller.

Snapshots add AL/AH, BL/BH, CL/CH, and DL/DH as low/high byte views of the
corresponding word registers. They also add `pc`, the physical address of
CS:IP. These values are recomputed from stored state; they are not additional
storage and cannot be assigned in a `.machine` definition.
Instructions can write these byte registers: a byte write replaces only the
selected half of its word, while a word write replaces both halves together.

## Construction and inspection

`new Cpu8088(ram, initialState, ports?)` requires exactly 1 MiB RAM. It copies and
validates every declared register and flag. Each field is read once, including
non-enumerable getters; extra metadata and derived views are ignored. Invalid
numeric state or RAM size throws `RangeError`; non-Boolean flags or control latches throw
`TypeError`. Construction performs neither reset nor RAM/device accesses.

The optional [`BytePorts`](../../../src/components/cpus/port-access.ts) connection
provides `readPort(port)` and `writePort(port, value)`. Ports are 16-bit addresses;
each callback transfers one byte. The device owns its state. A reconstructed CPU
must be reconnected to the separately restored device.

`snapshot()` returns detached state and views without accessing RAM. Its
TypeScript type is recursively readonly. Bypassing that typing cannot change
the CPU, another snapshot, or a retained execution record. A snapshot may
initialize a new CPU; its views are recomputed from its stored registers.
The CPU retains no execution history.

## Logical and physical addresses

A logical address consists of a segment value and a 16-bit offset. Its physical
address is `(segment × 16 + offset) modulo 100000` in hexadecimal. Carries past
the 8088's twenty address lines are discarded. Different logical addresses can
refer to the same byte: `1000:2345` and `1234:0005` both address `12345`.

Instruction bytes are fetched through CS:IP. IP advances after each fetched
byte and wraps from `FFFF` to `0000`, leaving CS unchanged. Each new IP is
translated separately. For example, a fetch at `1234:FFFF` reads `2233F`, then
the next fetch reads `12340`. At `FFFF:000F`, consecutive fetches read `FFFFF`
and `00000` because the physical address itself wraps.

Direct memory MOV forms default to DS:offset; stack operations always use SS:SP. ModR/M
operands select DS or SS as described below. Words are low byte first. Each
byte's **offset wraps within its segment before translation** to a 20-bit
physical address. A word at `1234:FFFF` uses physical `2233F` and `12340`;
a word at `FFFF:000F` uses `FFFFF` and `00000`. Odd word addresses are valid.
Data transfers leave IP alone; instruction fetching advances it after each byte.

This corrects the earlier model's assumption that a word always continued at
the next physical byte. The hardware POP fixture at SS:FFFF and the hardware-test
author's word-bus routines supply the [boundary evidence](reference-notes.md#stack-and-control-flow-comparison).

RAM accesses and `instruction.address` contain physical addresses.
`record.before.cs` and `record.before.ip` retain the instruction's logical
address; `record.before.pc` equals `instruction.address`. The shared runner's
completion address is also physical. It stops at any CS:IP alias of that
address; it does not require a particular segment value.

## Instruction steps

`step()` delivers an owed trap, or attempts one instruction/REP element.
A fetched instruction returns a `Cpu8088StepRecord` with
independent before/after snapshots, the instruction's physical start address
and fetched bytes, ordered `Cpu8088Access` entries, and an outcome. Memory
`read`/`write` entries contain physical `address` and `value`; port
`input`/`output` entries contain `port` and `value`. Both share one log in transfer
order. `Cpu8088MemoryAccess` remains the memory-only alias. Software and divide-error
entry attach `interrupt: { source, vector }` to the triggering instruction's
executed record. An owed single-step trap instead returns `instruction: null`,
`outcome: "executed"`, and `interrupt: { source: "trap", vector: 1 }`; its step
contains vector/frame accesses and no instruction fetch. External offers have
their own records, described below.

The supported unprefixed forms are:

| Opcode | Form | Effects |
| --- | --- | --- |
| `00`–`05`, `08`–`0D`, `10`–`15`, `18`–`1D`, `20`–`25`, `28`–`2D`, `30`–`35`, `38`–`3D` | ADD/OR/ADC/SBB/AND/SUB/XOR/CMP | Register/memory in both directions and widths, plus AL/AX immediate; CMP preserves its operands |
| `06`, `0E`, `16`, `1E`; `07`, `17`, `1F` | PUSH ES/CS/SS/DS; POP ES/SS/DS | Transfer a segment through the original SS:SP; preserve flags |
| `27`, `2F`, `37`, `3F` | DAA/DAS/AAA/AAS | Packed/unpacked decimal adjustment with original-8088 flag and byte rules |
| `40`–`4F` | INC/DEC r16 | Adjust any word register by one; update arithmetic flags except CF |
| `50`–`57` | `PUSH r16` | Push AX/CX/DX/BX/SP/BP/SI/DI through SS; preserve flags |
| `58`–`5F` | `POP r16` | Pop AX/CX/DX/BX/SP/BP/SI/DI through SS; preserve flags |
| `70`–`7F` | `Jcc rel8` | All sixteen conditions; fetch the signed byte on both paths |
| `80`–`83` | Immediate ALU r/m | 80/81 support all operations; 82/83 support ADD/ADC/SBB/SUB/CMP; 83 sign-extends its byte immediate to a word |
| `84`, `85`, `A8`, `A9` | TEST r/m,r or AL/AX,n | Set AND flags without changing either operand |
| `86`, `87`, `90`–`97` | XCHG r/m,r or AX,r16 | Exchange original operand values; 90 is NOP; preserve every flag |
| `88`–`8B` | MOV r/m,r or r,r/m | Both widths/directions; preserve every flag and the unselected byte half |
| `8C`, `8E` | MOV r/m16,Sreg or Sreg,r/m16 | All four segment sources; ES/SS/DS destinations; selectors 4–7 and loading CS are excluded |
| `8D`, `C4`, `C5` | LEA, LES, LDS | Compute an offset or load a four-byte far pointer; memory addressing only |
| `8F` /0 | POP r/m16 | Resolve the destination before popping; preserve flags |
| `98`, `99` | CBW, CWD | Sign-extend AL into AX or AX into DX:AX; preserve flags |
| `9A`, `EA`, `FF` /3, /5 | Far CALL/JMP | Immediate or memory far pointer; change CS:IP; CALL saves CS and the following IP |
| `9C`–`9F` | PUSHF/POPF/SAHF/LAHF | Packed word or low-status-byte transfers, with reserved-bit policy below |
| `A4`–`A7`, `AA`–`AF` | MOVS/CMPS/STOS/LODS/SCAS | Byte/word strings, optional repetition, source overrides and fixed ES destinations |
| `A0`, `A1` | `MOV AL,[offset]`, `MOV AX,[offset]` | Fetch a word offset and read one/two bytes through DS; preserve all flags and, for AL, AH |
| `A2`, `A3` | `MOV [offset],AL`, `MOV [offset],AX` | Fetch a word offset and write one/two bytes through DS; preserve all registers and flags except advancing IP |
| `B0`–`B7` | `MOV r8,n` | Fetch an immediate byte and replace AL/CL/DL/BL/AH/CH/DH/BH; preserve the other half and all flags |
| `B8`–`BF` | `MOV r16,n` | Fetch a little-endian immediate word and replace AX/CX/DX/BX/SP/BP/SI/DI; preserve all flags |
| `C2`, `C3` | `RET n`, `RET` | Pop IP; optionally discard an unsigned word-sized byte count from SP |
| `C6`, `C7` /0 | MOV r/m,n | Immediate byte/word to any register or memory operand; no destination read |
| `D0`–`D3` /0–5, /7 | ROL/ROR/RCL/RCR/SHL/SHR/SAR | Byte/word, by one or the full CL count; /6 stays unsupported |
| `CA`, `CB` | RETF n, RETF | Pop IP then CS, optionally discard parameter bytes |
| `CC`–`CF` | INT3, INT n, INTO, IRET | Software entry or return through IP, CS, FLAGS |
| `D4 0A`, `D5 0A` | AAM, AAD | Base-ten adjustment; other second bytes are undocumented |
| `D7` | XLAT | Read a byte at DS:(BX+AL), with optional segment override |
| `E0`–`E3` | LOOPNE/LOOPE/LOOP/JCXZ | Counted or zero-count branch; preserve flags |
| `E8` | `CALL rel16` | Push the following IP and take a near relative branch |
| `E9`, `EB` | `JMP rel16`, `JMP rel8` | Near or short relative branch without a stack access |
| `E4`–`E7`, `EC`–`EF` | IN / OUT | Byte/word accumulator transfers through an immediate port or DX; preserve all flags |
| `F6`, `F7` /0, /2, /3 | TEST r/m,n; NOT; NEG | Immediate AND flags, one's complement, or two's-complement negation |
| `F6`, `F7` /4–7 | MUL/IMUL/DIV/IDIV | Byte/word multiplication and division; divide errors deliver type 0 |
| `FF` /2, /4, /6 | Near indirect CALL/JMP, PUSH r/m16 | Read target/value before changing IP or writing the stack |
| `F4`, `F5`, `F8`, `F9`, `FC`, `FD` | HLT/CMC/CLC/STC/CLD/STD | Set the halt latch or update only the selected flag |
| `FA`, `FB` | CLI, STI | Clear/set IF; a 0-to-1 transition delays INTR |
| `FE`, `FF` /0–1 | INC/DEC r/m | Adjust a byte/word register or memory operand; preserve CF |

Lengths follow the encoding: opcode, optional ModR/M and displacement, then
any immediate. **All instruction bytes are fetched before data accesses**;
data bytes do not appear in `instruction.bytes`. Word reads and writes are low
byte first. MOV reads only its source and writes only its destination. ALU
operations read the original operands before writing a result; CMP and TEST
perform no destination write. Writes are recorded even when values are unchanged.
If a write overlaps code, it cannot alter the already fetched instruction;
later steps read current RAM while retained records keep their earlier bytes.

## Port input and output

The eight forms share **`1110 r 1 d w`**: `r=0` fetches an immediate byte port,
`r=1` uses all of DX, `d=0/1` selects input/output, and `w=0/1` selects AL/AX.
The immediate is zero-extended to a 16-bit port address. Port space is separate
from RAM and unsegmented; no segment register contributes to a port address.
See Intel's [manual](https://www.ardent-tool.com/CPU/docs/Intel/808x/manuals/9800722-03_alt.pdf),
sections 2.4 and 2.7, I/O addressing on page 2-72, and table 4-13.

Byte IN replaces AL while preserving AH. Word IN reads low then high bytes
and replaces AX after both reads succeed. OUT captures AL or AX before calling
the device. Word transfers always call the device twice, at the selected port
and `(port + 1) modulo 10000` in hexadecimal. Thus immediate port `FF` continues
at `0100`, and DX=`FFFF` continues at `0000`. Odd word ports are valid. This is
the 8088's byte bus behavior, with [hardware comparison evidence](reference-notes.md#port-input-and-output-comparison).
All flags and other registers, including DX, are preserved.

Instruction fetching still advances and wraps CS:IP before any port transfer.
Segment overrides do not affect port selection. LOCK retains the model's lack
of bus-arbitration effects. REP/REPNE remain unsupported for IN/OUT: rejection
occurs at the opcode, before an immediate port or device callback is read.
Each complete IN/OUT is one step; the runner cannot pause between its two bytes.

An absent device fails only when a port instruction reaches its transfer.
Input values must be integers in 0–255; malformed values throw `RangeError`
without coercion. Callback failures propagate without a step record or rollback:
fetched IP and completed device effects remain. A failed word IN leaves all of
AX unchanged; a failed second output leaves the first output delivered. These
are host-failure policies, not hardware exceptions or resumable bus cycles.

RAM and device callbacks may inspect snapshots but cannot recursively call
`step()`, `reset()`, or `interrupt()` on the same CPU. The shared execution guard clears after
success or failure. Reset, inspection, and already halted steps never call the
port connection. Reset preserves the connection and external device state.

## ModR/M operands

ModR/M has the pattern **`mm ggg rrr`**. In register/memory ALU, MOV, TEST, and
XCHG, `ggg` selects a register. In immediate, unary, and shift groups it
selects the operation instead.
Register codes are AL/CL/DL/BL/AH/CH/DH/BH for bytes and
AX/CX/DX/BX/SP/BP/SI/DI for words. Register self-operations and byte halves
sharing a word use the operands' original values.

| `mm` | `rrr` interpretation | Displacement |
| --- | --- | --- |
| `00` | Memory base below, except `rrr=110` is direct DS:offset | None, or a word for the direct exception |
| `01` | Memory base below | Signed byte |
| `10` | Memory base below | Word, added modulo 65536 |
| `11` | Register selected by `rrr` | None |

| `rrr` | Memory base | Default segment |
| --- | --- | --- |
| `000` | BX+SI | DS |
| `001` | BX+DI | DS |
| `010` | BP+SI | SS |
| `011` | BP+DI | SS |
| `100` | SI | DS |
| `101` | DI | DS |
| `110` | BP (direct offset when `mm=00`) | SS (DS for the direct exception) |
| `111` | BX | DS |

Base and displacement are added modulo 65536 before segment translation.
The operand retains that segment and offset for its reads and writes; changing
a base register cannot change the already resolved address. For example,
`MOV BX,[BX+SI]` uses the original BX to find its source. Likewise,
`XCHG BX,[BX+SI]` reads and writes the address computed from the original BX.
XCHG reads both operands before writing either, including AL/AH exchanges
and self exchanges. `90` is the AX-with-AX encoding, also named NOP.
Memory exchanges record operand reads followed by writes; bus locking and
arbitration remain outside this instruction-level model.

The immediate group uses `1000 00 s w`. `80` is byte and `81` is word;
`82` is the documented alternate byte arithmetic encoding; `83` sign-extends
a byte to a word. `ggg=000/010/011/101/111` selects ADD/ADC/SBB/SUB/CMP
for every group byte. OR/AND/XOR (`001/100/110`) are documented only for
80/81; the 1979 manual marks those selectors unused for 82/83.
All documented register and memory choices are supported. Segment overrides
replace the default DS/SS choice for explicit memory operands.

LEA computes the effective offset without a data read. LES/LDS read the offset
word and segment word from the original resolved address before assigning either
destination; loading DS cannot redirect the second word. All four pointer-byte
offsets wrap inside that original segment. XLAT captures BX+AL modulo 65536,
reads one byte through DS or the override, and replaces only AL.

## Prefixes and strings

`26/2E/36/3E` override the data segment with ES/CS/SS/DS. They apply to explicit
memory operands, absolute MOV, XLAT, and string sources. They never redirect
instruction fetches, implicit stack accesses, or string destinations in ES.
`F0` (LOCK) is consumed with its instruction; bus arbitration has no modeled
state or effect with one CPU and flat RAM. Memory XCHG has the same limitation.

Prefix state belongs to the current attempt and is included in fetched bytes.
The last segment prefix and last repeat prefix win independently. A prefix-only
64 KiB code segment rejects after one full scan, preserving state and RAM;
there is no later-x86 fifteen-byte instruction limit.

MOVS copies DS:SI to ES:DI; CMPS subtracts ES:DI from DS:SI; STOS stores AL/AX
at ES:DI; LODS loads AL/AX from DS:SI; SCAS subtracts ES:DI from AL/AX. CMPS/SCAS
set subtraction flags without writing either operand. The other string operations
preserve flags. Used indices advance by one/two bytes with DF clear or retreat
with DF set, wrapping to 16 bits; unprefixed strings preserve CX.

`F3` repeats MOVS/STOS/LODS while CX is nonzero and repeats CMPS/SCAS while
CX is nonzero and the new ZF is set. `F2` repeats CMPS/SCAS while CX is nonzero
and the new ZF is clear. REPNE on other strings and REP on non-string instructions
are undocumented and rejected. Incoming ZF does not prevent the first comparison.
A zero starting CX completes after instruction fetches, without data accesses,
index changes, or flag changes.

**One repeated element is one step.** After an element, decrement CX; if another
is required, restore IP to the first prefix. The next step refetches the complete
encoding. The final element leaves IP after the instruction. This makes the
runner's step budget meaningful and allows snapshot restoration without hidden
iteration state. RAM edits between steps affect the next fetch and operand;
self-modifying REP therefore follows this explicit instruction-level policy,
without hardware prefetch-queue behavior.

## Arithmetic and logic

ADD/ADC wrap a sum to the operand width; SUB/SBB/CMP wrap a difference.
ADC adds incoming CF and SBB subtracts it as a borrow. ADD, SUB, and CMP
ignore incoming CF. CMP sets subtraction flags without changing either operand.
Arithmetic sets CF for unsigned carry/borrow, AF for low-nibble carry/borrow,
OF for signed overflow, SF for the result's sign, and ZF for zero. PF uses
only the low result byte, even for word operations. INC/DEC set the same flags
as adding/subtracting one, but preserve CF. Every operation preserves TF/IF/DF.

OR/AND/XOR store their logical result. TEST sets flags from AND without writing
the result. Logic clears CF/OF and sets SF/ZF/PF from the result. Intel leaves
AF undefined; the model **clears AF deterministically**, matching the pinned
hardware fixtures rather than promising portable software behavior for that bit.
Byte operations preserve the other half of their stored word register.


NOT flips every bit within the operand width and preserves all flags. NEG
computes zero minus the operand: CF is set for every nonzero operand, OF
only for the most negative value (`80` or `8000`), and the other arithmetic
flags follow subtraction. INC/DEC memory forms share the register rules,
including preserving CF. Immediate TEST reads its operand without writing it;
NOT, NEG, INC, and DEC read then write, even when the value is unchanged.

## Multiply, divide, and decimal adjustment

MUL/IMUL multiply AL by a byte into AX, or AX by a word into DX:AX. MUL sets
CF/OF when the upper half is nonzero; IMUL sets them when the result does not
fit the signed input width. SF/ZF/PF/AF are undefined and preserved. Operands
are read before assigning results, including aliases such as MUL AH or IMUL DX.

DIV divides unsigned AX by a byte, placing quotient/remainder in AL/AH, or
unsigned DX:AX by a word, placing them in AX/DX. IDIV uses signed values,
truncates toward zero, and gives the remainder the dividend's sign. Arithmetic
flags are undefined and preserved; successful division preserves control flags. On the original 8088 the signed quotient ranges
are **−127..127 and −32767..32767**: even −128 and −32768 cause divide errors.
These limits follow the 1979 manual and pinned hardware fixtures.

A zero divisor or out-of-range quotient delivers interrupt type 0 after fetching
the instruction and reading the divisor, leaving AX/DX unchanged. The frame
saves the **following IP**, as on the original 8088, rather than the faulting
instruction's address used by later x86. Arithmetic flags remain unchanged under
the model's undefined-flag policy; entry saves them and clears IF/TF.

DAA/DAS adjust AL after packed-decimal addition/subtraction. Low-digit
correction uses AF or a low nibble above nine; high correction uses CF or
original AL above `99` when incoming AF is clear, **`9F` when it is set**.
CF records that high correction; DAS does not add a separate low-digit borrow.
AF records low correction, SF/ZF/PF describe adjusted AL, and undefined OF is
preserved. AH is unchanged. These original-chip details differ from later x86:
DAA with AL=`9E`, AF=1, CF=0 gives `A4`, CF=0; DAS with AL=0, AF=1, CF=0 gives
`FA`, CF=0. Valid packed-BCD arithmetic is checked independently in decimal.

AAA/AAS adjust unpacked AL and AH independently, then mask AL to its low nibble.
A carry/borrow from AL's byte adjustment does not adjust AH a second time.
AF/CF report adjustment; undefined OF/SF/ZF/PF are preserved. AAM splits AL into
decimal quotient AH and remainder AL; AAD combines AH×10+AL into AL modulo 256
and clears AH. Only the documented fixed second byte `0A` is supported.
AAM/AAD set SF/ZF/PF from AL and preserve undefined CF/AF/OF. CBW and CWD
sign-extend the accumulator without changing flags.

## Packed flags and halt

PUSHF packs the nine flags at their original bit positions, with bits 15–12
and 1 set and bits 5/3 clear. POPF replaces the nine stored flags and ignores
reserved bits. LAHF writes the low status byte into AH while preserving AL;
SAHF replaces SF/ZF/AF/PF/CF from AH and preserves OF/DF/IF/TF. CMC complements
CF; CLC/STC clear/set CF; CLD/STD clear/set DF; other flags remain unchanged.

HLT advances IP and sets `halted`. With no owed trap it returns `outcome: "halted"`; later steps return the same outcome, `instruction: null`, and no
accesses or changes. Reset or accepted INTR/NMI releases halt. When TF was
sampled for HLT, the instruction instead reports `executed` with `halted` and
`trapPending` set. The next step delivers the trap and releases halt, so a
bounded runner can continue into the trap handler. Restored snapshots preserve
both the halt state and any pending trap.

## Interrupt entry and return

All sources use the same four-byte vector in physical memory at `vector × 4`:
little-endian IP followed by CS. Entry reads all four bytes **before any stack
write**, so a stack overlapping the vector table cannot redirect the current
entry. It captures FLAGS, clears IF/TF, and pushes FLAGS, CS, then return IP
through SS:SP. Each push decrements SP by two and writes low byte first, with
the ordinary segment-offset wrapping rule. The final stack therefore contains
IP at SP, CS at SP+2, and FLAGS at SP+4. Entry does not fetch handler code.

INT3 selects type 3; INT n fetches its type byte; INTO selects type 4 only when
OF is set. Untaken INTO performs only its instruction fetch. These software
entries and divide errors are not blocked by IF or recognition delays.
IRET pops IP, CS, then FLAGS, restoring all nine flag bits and ignoring reserved
bits. It uses the same word-pop and flag-restoration helpers as RETF and POPF.

The vector-first order follows the original interrupt microcode described in
[Ken Shirriff's silicon analysis](https://www.righto.com/2023/02/8086-interrupt.html)
and is checked against the [hardware fixtures](reference-notes.md#interrupt-comparison).

## External interrupt delivery

`interrupt("intr", acknowledge)` offers a currently asserted INTR request;
`interrupt("nmi")` offers an NMI edge selected by the caller. Neither queues a
request. The caller retains asserted INTR and latched NMI requests, offers NMI
first when both are pending, and reoffers a deferred request at a later boundary.
IF masks INTR only. `interruptDeferred` delays INTR; `segmentDeferred` delays
both sources. Ignored offers do not acknowledge, access memory, or release halt.

Accepted INTR releases halt and calls `acknowledge()` once for an integer type
byte in 0–255. This callback abstracts the whole hardware acknowledgement
sequence, including its two INTA bus cycles; only the supplied byte is recorded.
NMI uses type 2 without a callback. Both enter through the current CS:IP, which
already points after HLT or back to the first prefix of an unfinished REP.

`Cpu8088InterruptRecord` has detached `before`/`after` snapshots, `source`,
`instruction: null`, and ordered `accesses`. An accepted record adds
`outcome: "accepted"` and `vector`; an ignored record adds `outcome: "ignored"`
and `reason: "masked" | "deferred"`. Deferral takes precedence when both apply.
INTR's `{ kind: "acknowledge", value }` precedes vector reads and frame writes.
The callback is required for an eligible INTR offer and its byte is validated
before any vector access. The API does not model a PIC, pin timing, or an
interrupt scheduler.

## Recognition delays and single stepping

CLI clears IF. STI sets IF and, when it changes from zero to one, inhibits INTR
through the following retired instruction. POPF and IRET apply the same delay
when restoring IF from zero to one. Another STI with IF already set consumes
an existing delay without renewing it. NMI and traps do not use this IF delay.

On the original chip, MOV/POP into **any** segment register delays recognition
of INTR, NMI, and traps through the following instruction. This includes ES
and DS, not only SS; consecutive such loads renew `segmentDeferred`. LES/LDS
and control-flow changes to CS do not set it. Only a retired instruction or REP
element consumes a delay. Unsupported encodings and failed ordinary instructions do
not consume it; partially completed entry follows the failure policy below. Prefixes never form separate retirement boundaries.

TF is sampled before execution. A retired instruction with that sample set
leaves `trapPending`; the next `step()` delivers type 1 before fetching another
instruction, unless segment inhibition requires another instruction first.
Thus POPF/IRET setting TF begins trapping after the following instruction;
clearing TF does not cancel the trap owed for the instruction that cleared it.
An owed trap survives higher-priority software, divide-error, or external entry
and is delivered before that handler's first instruction. Callers offer pending
NMI/INTR before `step()` to preserve their priority over a pending trap.

Each REP element is a boundary in this model. Interruption saves the first
prefix's address while repetition is unfinished; IRET resumes with the remaining
CX and advanced indices. This retains the existing complete-prefix refetch
policy. It does not emulate the original chip's multiple-prefix restart quirks
or prefetch-dependent self-modification.

## Interrupt connection failures

RAM and acknowledgement callbacks may inspect state, but reentrant mutating
calls throw before changing it. Callback errors propagate without a record or
rollback. A failing acknowledgement leaves an accepted INTR's halt release in
place, with no vector read. A failing vector read preserves CS:IP and SP;
IF/TF clear only after the entire vector is read. A failing frame write leaves
that flag clearing, each attempted push's SP decrement, and completed writes
in place; the target CS:IP commits after all three pushes succeed.

IRET commits each completed pop's SP increment, changes CS:IP after both return
words, then restores FLAGS after its complete word is read. A pending trap is
consumed when its delivery begins, including on failure. These rules expose
host failures; they do not model bus faults, cycle-level register timing, or
resumption halfway through an instruction. Reset always clears all recognition
latches without reading RAM or calling a device.

## Shifts and rotates

The first byte is **`1101 00 v w`**: `v=0` uses count one, `v=1` uses CL;
`w=0/1` selects byte/word. ModR/M's operation field selects:

| `ggg` | Instruction | Direction | Bit inserted |
| --- | --- | --- | --- |
| `000` | ROL | Left | Outgoing high bit |
| `001` | ROR | Right | Outgoing low bit |
| `010` | RCL | Left | Previous CF |
| `011` | RCR | Right | Previous CF |
| `100` | SHL / SAL | Left | Zero; both mnemonics name the same encoding |
| `101` | SHR | Right | Zero |
| `110` | Unsupported | — | Undocumented encoding |
| `111` | SAR | Right | Sign bit |

The original 8088 uses **all eight bits of CL**, permitting 0–255 movements.
It does not apply the five-bit mask used by later x86 processors. Each movement
sets CF to the outgoing bit; carry rotations feed that flag into the next
movement. Counts equal to or larger than the width still execute. The count
is captured before changing any destination, including CL, CH, or CX.

For count one, OF records whether the sign bit changed. For larger counts
Intel leaves OF undefined; this model **preserves its incoming value**.
Rotations preserve SF/ZF/PF/AF. Nonzero shifts set SF/ZF/PF from the result
and **clear undefined AF deterministically**, as logical operations do.
Every form preserves TF/IF/DF. A zero count preserves all flags and the value.

Memory forms fetch the complete encoding, read the operand once, perform all
movements internally, then write it once. A zero count also records a read
and unchanged write. Word accesses retain the segment-offset wrapping policy.
These are explicit instruction-level access rules, without cycle counts or
prefetch effects. Pure one-bit movement is shared with the 6800/6809; counts,
flag updates, and operand accesses belong to the 8088.

Intel's [8086 Family User's Manual](https://www.ardent-tool.com/CPU/docs/Intel/808x/manuals/9800722-03_alt.pdf),
printed pages 2-39–2-40 and the instruction tables, defines these operations.
The [reference comparison](reference-notes.md#unary-shift-and-transfer-comparison)
checks documented encodings and defined flags against hardware cases.

## Control flow and stack

Near jumps and calls preserve CS. Short JMP and
Jcc add a signed byte to IP after the operand; near JMP/CALL add a signed word.
The resulting IP wraps to 16 bits. Jcc always fetches its displacement,
including when untaken. No transfer reads or prefetches its target.

| Opcodes | Condition for first mnemonic | First / inverted mnemonic (aliases) |
| --- | --- | --- |
| `70` / `71` | OF | JO / JNO |
| `72` / `73` | CF | JB (JC/JNAE) / JAE (JNC/JNB) |
| `74` / `75` | ZF | JE (JZ) / JNE (JNZ) |
| `76` / `77` | CF or ZF | JBE (JNA) / JA (JNBE) |
| `78` / `79` | SF | JS / JNS |
| `7A` / `7B` | PF | JP (JPE) / JNP (JPO) |
| `7C` / `7D` | SF differs from OF | JL (JNGE) / JGE (JNL) |
| `7E` / `7F` | ZF or SF differs from OF | JLE (JNG) / JG (JNLE) |

PUSH decrements SP by two, wrapping to 16 bits, then writes the selected word
low byte first at SS:SP and SS:(SP+1). **PUSH SP stores the decremented SP** on
the original 8088. POP reads those bytes, increments SP by two, then assigns
the word to its destination. **POP SP ends with the popped value**, replacing
the increment. All register stack forms preserve every flag. Segment PUSH/POP use the original
SS for the entire access, including POP SS. POP r/m resolves its destination
before the pop; an SP register destination receives the popped word after
the increment. FF /6 PUSH SP has the same decremented-value rule as opcode 54.

CALL fetches the complete displacement before pushing the following IP,
including when the stack overlaps the fetched encoding. It then branches from
that following IP. RET reads IP from the stack without further adjustment to
that returned address; `RET n` subsequently adds its unsigned immediate byte
count to SP, with 16-bit wrapping. The count may be odd or zero. Discarded
parameters cause no reads. Near calls and returns preserve CS; every call and return preserves flags.
Indirect near CALL/JMP read a register or memory target before writing the
stack or changing IP. Far immediate and memory forms capture a complete
segment:offset pointer; memory forms require a memory ModR/M choice. A far
CALL pushes the old CS then the following IP before replacing CS:IP, even
when stack writes overlap the pointer or instruction. RETF pops IP then CS,
then optionally adds its unsigned parameter byte count to SP.

LOOPNE/LOOPE/LOOP decrement CX modulo 65536 before testing for nonzero. The
first two also require ZF clear/set; JCXZ tests original CX for zero and
preserves it. Each fetches its signed displacement on either path. All preserve
flags and CS; no branch fetches its target as part of the same step.

The [control-flow example](examples/control-flow.md) saves an AX loop counter
while two nested calls accumulate a sum in RAM, then restores the counter and
compares it before branching. IP, SP, and the physical PC stay distinct.

## Unsupported instructions

Unsupported first bytes produce `outcome: "unsupported"`, `reason: "opcode"`
after their opcode fetch (and any preceding prefixes). Invalid ModR/M operation
or register selections reject immediately after ModR/M, before displacements,
immediates, or operand accesses. AAM/AAD reject after their second byte when it
is not `0A`. Invalid repetition combinations reject at the opcode.
All preserve complete state and RAM; repeating an attempt repeats its reads.
This atomic rejection is a model policy, not an illegal-instruction exception
implemented by the original chip. Divide errors use native delivery as described above.

Deferred documented instructions are external-processor ESC
(`D8`–`DF`) and WAIT (`9B`). ESC communicates with a coprocessor; WAIT observes
the external TEST input. Both stay with external I/O until those interfaces
exist. Undocumented aliases and later-x86 additions remain outside scope.

## CPU reset

`reset()` sets CS to `FFFF`, IP to `0000`, DS/SS/ES to `0000`, and clears all
nine flags, including IF, `halted`, and all three recognition latches. It performs **no RAM access**: `FFFF0` is the first
instruction address, not a pointer read from a reset-vector table.

AX/BX/CX/DX/SP/BP/SI/DI and RAM are preserved. Intel's reset table does not
specify values for these general registers; preserving them is a deterministic
model policy, not a claim about power-on values. The reset record has detached
before/after snapshots and an empty access list, without a step outcome or
instruction. A later step fetches current RAM at `FFFF0`.

Reset does not restart a lesson at its example entry point or restore the
example's memory image. Creating a fresh example performs that restart.

## Checks and limits

Independent tests cover every immediate byte and register selector, word-register
boundaries, every immediate AX value, byte views across every word value,
every code-segment value, and instruction fetches at every IP. ADD checks all
byte operand pairs, every word against carry and signed boundaries, every
incoming flag pattern at arithmetic boundaries, and parity examples that
distinguish a byte from a word. Memory checks cover every byte, word, and
direct word offset, odd addresses, segment-end and physical wrapping, exact
access widths, and unchanged-value writes. Complete records and observed RAM
calls check access order, state preservation, unsupported attempts, reset,
self-modifying code, and detached snapshots.

The arithmetic example checks full initial/final RAM images, three complete
records, distinct code/data segments, a physical completion address,
pause/resume, reset, and fresh restart. Parser, generator, and type checks keep
logical initial state separate from derived views and physical image addresses.
The [transfer example](examples/transfers.md) additionally checks byte writes
sharing word storage, byte versus word flags, direct readback, memory sentinels,
snapshot restoration, and physical completion through a different CS:IP alias.

CMP tests cover every byte pair and every AX value against signed/unsigned
word boundaries. PUSH/POP tests cover all register selectors and flags,
segment/bus boundaries, every PUSH SP/POP SP value, and the hardware POP DX
regression. Jcc uses independently listed truth sets for every flag pattern,
plus every displacement on both paths. Call/return checks cover wrapping,
operand overlap, unchanged CS, current stack memory, and optional cleanup.
The 39-step control-flow example checks complete records, saved loop counters,
full RAM images, nested-call resumption from snapshots, physical completion,
reset preservation, fresh restart, and bounded loops.

ModR/M checks cover every register pair, all supported operation groups, every
memory base and displacement mode, both widths/directions, BP segment defaults,
the direct-address exception, byte aliases, all signed-byte immediates, wrapped
instruction and data accesses, unchanged-value writes, and code/data overlap.
The [masked word-sum example](examples/word-sum.md) verifies all 76 records,
a 32-bit carry, BP stack-frame reads, conditional logic, edited source RAM,
bounded loops, full memory images, nested state restoration, reset, and restart.

Unary tests exhaust every byte/word with both incoming carry values. Byte
rotates/shifts exhaust every operand, all 256 CL counts, and both carry values;
word tests cover every operand for count one and boundary operands at every
count. All new groups cover register selectors, memory modes, flag patterns,
wrapped instruction/data accesses, code overlap, and atomic rejection.
XCHG checks every pair and byte alias; immediate TEST exhausts byte pairs.
The [signed word transformation](examples/word-transform.md) checks exact
records, carry propagation, two-word negation, both marker paths, byte swaps,
segment-end reads, physical wrapping, and complete guarded memory images.

Completion checks additionally cover all new register and memory selectors,
segment/FLAGS stack transfers, far pointers and overlapping frames, original
BCD and signed-division boundaries, every byte multiplication pair, full-word
sign extension/AAD/POPF sweeps, and invalid encodings. Prefix and string tests
check both directions and widths, empty repetition, flag-based termination,
segment and bus wrapping, exact accesses, bounded running, and snapshot-only
resumption. A separate encoding inventory audits 282 supported forms and the
9 deferred documented forms.

Port checks cover all eight forms, every immediate port and modeled flag
combination, distinct byte halves, odd and wrapped word ports, instruction-fetch
wrapping, prefixes, exact access order, invalid inputs, failures, and reentrancy.
An [eleven-instruction runner program](../../../tests/runtime/run-cpu.test.ts)
combines all eight forms with a memory result and HALT, checking restoration of
CPU, full RAM, and device state at every boundary. The supplementary
[80,000 hardware cases](reference-notes.md#port-input-and-output-comparison)
check modeled state and actual port bus transfers without adding network access
to the repository tests.

Interrupt checks cover all 256 vectors, all flag combinations for software
entry and restoration, IF transitions, segment inhibition, higher-priority entry
with an owed trap, wrapped/overlapping frames, and failures at each vector or
frame byte. A halted program enters a port-writing handler through INTR, returns
with IRET, and resumes from a snapshot during its restored recognition delay.
The [66,444 interrupt hardware cases](reference-notes.md#interrupt-comparison)
check native control instructions and divide-error delivery.

The [decimal buffer example](examples/decimal-buffer.md) combines a wrapped
three-word copy, a far decimal-formatting routine, unsigned division, reverse
string stores, saved FLAGS, and HLT. Its tests specify all 52 records, guarded
full RAM images, decimal output at unsigned boundaries, and restoration inside
both REP and a far-call frame.

Coprocessor/TEST interfaces, mapped devices, pin sampling and scheduling, timing,
bus arbitration, and prefetching remain deferred. The instruction-level records
are not a cycle trace; self-modifying code observes current RAM without the
original chip's prefetch-queue effects.
