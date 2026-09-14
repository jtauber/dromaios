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

Direct memory MOV forms load or store AL or AX at DS:offset; stack operations
use SS:SP. Words are low byte first. Each byte's **offset wraps within its
segment before translation** to a 20-bit physical address. A word at
`1234:FFFF` uses physical `2233F` and `12340`; a word at `FFFF:000F` uses
`FFFFF` and `00000`. Odd word addresses are valid. Data transfers leave IP
alone, while instruction fetching advances it after every byte.

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
| `04`, `05` | `ADD AL,n`, `ADD AX,n` | Add an immediate byte/word without incoming carry; replace CF/PF/AF/ZF/SF/OF |
| `3C`, `3D` | `CMP AL,n`, `CMP AX,n` | Compare an immediate byte/word; replace CF/PF/AF/ZF/SF/OF and preserve AX |
| `50`–`57` | `PUSH r16` | Push AX/CX/DX/BX/SP/BP/SI/DI through SS; preserve flags |
| `58`–`5F` | `POP r16` | Pop AX/CX/DX/BX/SP/BP/SI/DI through SS; preserve flags |
| `70`–`7F` | `Jcc rel8` | All sixteen conditions; fetch the signed byte on both paths |
| `A0`, `A1` | `MOV AL,[offset]`, `MOV AX,[offset]` | Fetch a word offset and read one/two bytes through DS; preserve all flags and, for AL, AH |
| `A2`, `A3` | `MOV [offset],AL`, `MOV [offset],AX` | Fetch a word offset and write one/two bytes through DS; preserve all registers and flags except advancing IP |
| `B0`–`B7` | `MOV r8,n` | Fetch an immediate byte and replace AL/CL/DL/BL/AH/CH/DH/BH; preserve the other half and all flags |
| `B8`–`BF` | `MOV r16,n` | Fetch a little-endian immediate word and replace AX/CX/DX/BX/SP/BP/SI/DI; preserve all flags |
| `C2`, `C3` | `RET n`, `RET` | Pop IP; optionally discard an unsigned word-sized byte count from SP |
| `E8` | `CALL rel16` | Push the following IP and take a near relative branch |
| `E9`, `EB` | `JMP rel16`, `JMP rel8` | Near or short relative branch without a stack access |

Immediate byte instructions fetch two instruction bytes; immediate word
ALU/MOV instructions and all direct memory transfers fetch three. Data accesses
follow the complete instruction encoding and do not appear in `instruction.bytes`.
Loads read their source once, low byte then high for words. Stores perform
one or two writes without reading the destination or touching neighboring
bytes. Writes are recorded even when their values are unchanged. Stores may
overwrite code; later steps fetch current RAM, while retained records keep
the earlier fetched values.

ADD wraps its result to the operand width; byte ADD preserves AH. CF reports
unsigned carry; AF carry from bit 3; ZF a zero result; SF bit 7 or 15; OF signed
overflow at the selected width. PF indicates an even number of
one bits in the **low byte only**, including for word arithmetic. TF, IF, and DF
are preserved. ADD has no decimal mode; decimal adjustment is a separate,
currently unsupported instruction.

CMP subtracts the immediate from AL or AX to set flags without storing the
result; incoming CF is ignored and all of AX is preserved. CF indicates borrow,
AF borrow from bit 4 into the low nibble, ZF zero, SF the result's sign bit,
and OF signed overflow. PF uses the low result byte. TF/IF/DF are preserved.

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

All other opcode bytes, including prefixes, produce `outcome: "unsupported"`
and `reason: "opcode"` after one opcode read, preserving IP and every other
state field and RAM. Repeating the attempt repeats that read. This atomic
rejection is a model policy, not an illegal-instruction exception implemented
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

Other instruction forms, ModR/M addressing, segment overrides and other
prefixes, far transfers, loop instructions, segment/FLAGS stack operations, interrupts, I/O, mapped devices,
timing, bus arbitration, and prefetching remain deferred. The instruction-level
records are not a cycle trace; self-modifying code observes current RAM without
the original chip's prefetch-queue effects.
