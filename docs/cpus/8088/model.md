# 8088 model contract

The Intel 8088 model implements an instruction-level subset with flat 1 MiB
RAM, 16-bit registers, and 20-bit physical addresses. The stored instruction
address is CS:IP; the physical PC is a derived view.

[Implementation](../../../src/components/cpus/8088.ts) ·
[CPU tests](../../../tests/components/cpus/8088.test.ts) ·
[Public type checks](../../../tests/types/8088.ts) ·
[Coverage](../coverage.md#8088) ·
[Arithmetic example](examples/arithmetic.md) ·
[Transfer example](examples/transfers.md) ·
[Control-flow example](examples/control-flow.md) ·
[Masked word-sum example](examples/word-sum.md) ·
[dromaios-pc comparison](reference-notes.md)

Hardware behavior follows Intel's
[8086 Family User's Manual, October 1979](https://www.ardent-tool.com/CPU/docs/Intel/808x/manuals/9800722-03_alt.pdf):
sections 2.2–2.3 (registers, flags, and addressing), table 2-4 (reset), section
2.7 (data transfer, arithmetic, and control flow), and tables 4-12–4-14 (encodings). The 8086 and 8088 share
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
| CF, PF, AF, ZF, SF, TF, IF, DF, OF in `flags` | Boolean | Carry, parity, auxiliary carry, zero, sign, trap, interrupt enable, direction, overflow |

TypeScript fields are lowercase, including `flags.if`. `.machine` definitions
conventionally use uppercase register and flag names. There is no halt latch,
prefetch queue, or packed FLAGS view in this slice. TF and IF can be stored and
inspected while interrupt delivery is deferred.

Snapshots add AL/AH, BL/BH, CL/CH, and DL/DH as low/high byte views of the
corresponding word registers. They also add `pc`, the physical address of
CS:IP. These values are recomputed from stored state; they are not additional
storage and cannot be assigned in a `.machine` definition.
Instructions can write these byte registers: a byte write replaces only the
selected half of its word, while a word write replaces both halves together.

## Construction and inspection

`new Cpu8088(ram, initialState)` requires exactly 1 MiB RAM. It copies and
validates every declared register and flag. Each field is read once, including
non-enumerable getters; extra metadata and derived views are ignored. Invalid
numeric state or RAM size throws `RangeError`; non-Boolean flags throw
`TypeError`. Construction performs neither reset nor RAM accesses.

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

Direct memory MOV forms use DS:offset; stack operations use SS:SP. ModR/M
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

`step()` attempts one instruction and returns a `Cpu8088StepRecord` with
independent before/after snapshots, the instruction's physical start address
and fetched bytes, ordered memory accesses, and an outcome.

The supported unprefixed forms are:

| Opcode | Form | Effects |
| --- | --- | --- |
| `00`–`05`, `08`–`0D`, `10`–`15`, `18`–`1D`, `20`–`25`, `28`–`2D`, `30`–`35`, `38`–`3D` | ADD/OR/ADC/SBB/AND/SUB/XOR/CMP | Register/memory in both directions and widths, plus AL/AX immediate; CMP preserves its operands |
| `40`–`4F` | INC/DEC r16 | Adjust any word register by one; update arithmetic flags except CF |
| `50`–`57` | `PUSH r16` | Push AX/CX/DX/BX/SP/BP/SI/DI through SS; preserve flags |
| `58`–`5F` | `POP r16` | Pop AX/CX/DX/BX/SP/BP/SI/DI through SS; preserve flags |
| `70`–`7F` | `Jcc rel8` | All sixteen conditions; fetch the signed byte on both paths |
| `80`–`83` | Immediate ALU r/m | 80/81 support all operations; 82/83 support ADD/ADC/SBB/SUB/CMP; 83 sign-extends its byte immediate to a word |
| `84`, `85`, `A8`, `A9` | TEST r/m,r or AL/AX,n | Set AND flags without changing either operand |
| `86`, `87`, `90`–`97` | XCHG r/m,r or AX,r16 | Exchange original operand values; 90 is NOP; preserve every flag |
| `88`–`8B` | MOV r/m,r or r,r/m | Both widths/directions; preserve every flag and the unselected byte half |
| `A0`, `A1` | `MOV AL,[offset]`, `MOV AX,[offset]` | Fetch a word offset and read one/two bytes through DS; preserve all flags and, for AL, AH |
| `A2`, `A3` | `MOV [offset],AL`, `MOV [offset],AX` | Fetch a word offset and write one/two bytes through DS; preserve all registers and flags except advancing IP |
| `B0`–`B7` | `MOV r8,n` | Fetch an immediate byte and replace AL/CL/DL/BL/AH/CH/DH/BH; preserve the other half and all flags |
| `B8`–`BF` | `MOV r16,n` | Fetch a little-endian immediate word and replace AX/CX/DX/BX/SP/BP/SI/DI; preserve all flags |
| `C2`, `C3` | `RET n`, `RET` | Pop IP; optionally discard an unsigned word-sized byte count from SP |
| `C6`, `C7` /0 | MOV r/m,n | Immediate byte/word to any register or memory operand; no destination read |
| `D0`–`D3` /0–5, /7 | ROL/ROR/RCL/RCR/SHL/SHR/SAR | Byte/word, by one or the full CL count; /6 stays unsupported |
| `E8` | `CALL rel16` | Push the following IP and take a near relative branch |
| `E9`, `EB` | `JMP rel16`, `JMP rel8` | Near or short relative branch without a stack access |
| `F6`, `F7` /0, /2, /3 | TEST r/m,n; NOT; NEG | Immediate AND flags, one's complement, or two's-complement negation |
| `FE`, `FF` /0–1 | INC/DEC r/m | Adjust a byte/word register or memory operand; preserve CF |

Lengths follow the encoding: opcode, optional ModR/M and displacement, then
any immediate. **All instruction bytes are fetched before data accesses**;
data bytes do not appear in `instruction.bytes`. Word reads and writes are low
byte first. MOV reads only its source and writes only its destination. ALU
operations read the original operands before writing a result; CMP and TEST
perform no destination write. Writes are recorded even when values are unchanged.
If a write overlaps code, it cannot alter the already fetched instruction;
later steps read current RAM while retained records keep their earlier bytes.

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
remain unsupported rather than silently ignored.

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
Decimal adjustment remains a separate, unsupported instruction family.

NOT flips every bit within the operand width and preserves all flags. NEG
computes zero minus the operand: CF is set for every nonzero operand, OF
only for the most negative value (`80` or `8000`), and the other arithmetic
flags follow subtraction. INC/DEC memory forms share the register rules,
including preserving CF. Immediate TEST reads its operand without writing it;
NOT, NEG, INC, and DEC read then write, even when the value is unchanged.

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

All supported jumps and calls are near: CS remains unchanged. Short JMP and
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
the increment. All register stack forms preserve every flag.

CALL fetches the complete displacement before pushing the following IP,
including when the stack overlaps the fetched encoding. It then branches from
that following IP. RET reads IP from the stack without further adjustment to
that returned address; `RET n` subsequently adds its unsigned immediate byte
count to SP, with 16-bit wrapping. The count may be odd or zero. Discarded
parameters cause no reads. All calls and returns preserve CS and every flag.

The [control-flow example](examples/control-flow.md) saves an AX loop counter
while two nested calls accumulate a sum in RAM, then restores the counter and
compares it before branching. IP, SP, and the physical PC stay distinct.

## Unsupported instructions

Unsupported first bytes, including prefixes, produce `outcome: "unsupported"`
and `reason: "opcode"` after one opcode read. Unsupported operation selectors
in 82/83, C6/C7, D0–D3, F6/F7, and FE/FF read the opcode and ModR/M, then
reject without fetching a displacement or immediate or accessing an operand.
This includes documented operations that remain unimplemented, such as
multiply/divide and indirect calls. Both paths preserve IP, all other state,
and RAM. Repeating the attempt repeats the same reads. This atomic rejection
is a model policy, not an illegal-instruction exception implemented
by the original chip. Supported steps report `outcome: "executed"`.

## CPU reset

`reset()` sets CS to `FFFF`, IP to `0000`, DS/SS/ES to `0000`, and clears all
nine flags, including IF. It performs **no RAM access**: `FFFF0` is the first
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

Other instruction forms, segment overrides and other prefixes, far transfers,
loop instructions, segment/FLAGS stack operations, interrupts, I/O, mapped
devices, timing, bus arbitration, and prefetching remain deferred. The instruction-level
records are not a cycle trace; self-modifying code observes current RAM without
the original chip's prefetch-queue effects.
