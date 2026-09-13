# 8088 model contract

The Intel 8088 model implements an instruction-level subset with flat 1 MiB
RAM, 16-bit registers, and 20-bit physical addresses. The stored instruction
address is CS:IP; the physical PC is a derived view.

[Implementation](../../../src/components/cpus/8088.ts) ·
[CPU tests](../../../tests/components/cpus/8088.test.ts) ·
[Public type checks](../../../tests/types/8088.ts) ·
[Coverage](../coverage.md#8088) ·
[Arithmetic example](examples/arithmetic.md) ·
[dromaios-pc comparison](reference-notes.md)

Hardware behavior follows Intel's
[8086 Family User's Manual, October 1979](https://www.ardent-tool.com/CPU/docs/Intel/808x/manuals/9800722-03_alt.pdf):
sections 2.2–2.3 (registers, flags, and addressing), table 2-4 (reset), section
2.7 (MOV and ADD), and tables 4-12–4-14 (encodings). The 8086 and 8088 share
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

The supported memory instruction stores AX at DS:offset. Its two operand bytes
encode the offset, low byte first. A data word occupies consecutive physical
bytes, with the low byte first; the second byte's physical address wraps at
`FFFFF`. This differs from fetching two instruction bytes through advancing
IP. A word at `1234:FFFF` uses physical `2233F` and `22340`; a word at
`FFFF:000F` uses `FFFFF` and `00000`. Odd word addresses are valid.

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
| `B8` | `MOV AX,n` | Fetch a little-endian immediate word and replace AX; preserve all flags |
| `05` | `ADD AX,n` | Add a little-endian immediate word to AX without incoming carry; replace CF/PF/AF/ZF/SF/OF |
| `A3` | `MOV [offset],AX` | Fetch a little-endian offset and write AX through DS, low byte then high; preserve all registers and flags except advancing IP |

All three fetch exactly three instruction bytes. MOV to memory then performs
two writes without reading the destination. Writes are recorded even when
their values are unchanged. Stores may overwrite code; later steps fetch
current RAM, while retained records keep the earlier fetched values.

ADD wraps AX to sixteen bits. CF reports unsigned carry; AF carry from bit 3;
ZF a zero word; SF bit 15; OF signed overflow. PF indicates an even number of
one bits in the **low byte only**, including for word arithmetic. TF, IF, and DF
are preserved. ADD has no decimal mode; decimal adjustment is a separate,
currently unsupported instruction.

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

Independent tests cover every immediate MOV value, both byte views across
every word value, every code-segment value, and instruction fetches at every
IP. ADD checks every word against carry and signed boundaries, all low-byte
operand pairs, every incoming flag pattern at arithmetic boundaries, and
parity examples that distinguish a byte from a word. Store checks cover every
offset and word value, odd addresses, segment-end and physical wrapping, and
unchanged-value writes. Complete records and observed RAM calls check access
order, state preservation, unsupported attempts, reset, self-modifying code,
and detached snapshots.

The generated example checks full initial/final RAM images, three complete
records, distinct code/data segments, a physical completion address,
pause/resume, reset, and fresh restart. Parser, generator, and type checks keep
logical initial state separate from derived views and physical image addresses.

Other instruction forms, ModR/M addressing, segment overrides and other
prefixes, control flow, stack operations, interrupts, I/O, mapped devices,
timing, bus arbitration, and prefetching remain deferred. The instruction-level
records are not a cycle trace; self-modifying code observes current RAM without
the original chip's prefetch-queue effects.
