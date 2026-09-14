# Z80 buffer fill and readback example

This example combines immediate pair loads, register and memory transfers,
and DJNZ to fill a three-byte buffer with `7F 80 81`, append `00`, and read
back the first and last data bytes. It exercises the Z80 load matrix while
keeping the alternate bank and interrupt state intact.

[Machine definition](../../../../src/machines/z80/transfers-example.machine) ·
[Tests](../../../../tests/machines/z80/transfers-example.test.ts) ·
[Model contract](../model.md) ·
[Coverage](../../coverage.md#z80) ·
[Counted-loop example](counted-loop.md)

## Setup

The machine has flat 64 KiB RAM. Its initial main registers are A = `11`,
B = `22`, C = `33`, D = `44`, E = `55`, H = `66`, L = `77`, with all six
flags set. Alternate A/B/C/D/E/H/L are `88/99/AA/BB/CC/DD/EE`; alternate
S/Z/H/PV/N/C are `0/1/0/1/0/1`.

IX = `1234`, IY = `5678`, PC = `0200`, SP = `ABCD`, I = `42`, and R = `FE`.
IFF1 is true, IFF2 is false, IM = 2, and the CPU is not halted.
The buffer at `0080`–`0083` starts as `00 00 00 CC`, with `CC` guards at
`007F` and `0084`. All RAM outside the program, buffer, and guards starts at zero.

The generated module exports `createZ80TransfersExampleMemory(): Ram` and
`createZ80TransfersExample(): { cpu: CpuZ80; ram: Ram }`. Each call creates
fresh components without executing. The program stops with HALT; it has no
runner completion address.

## Program

All numeric values in the table are hexadecimal.

| Address | Bytes | Instruction | Purpose |
| --- | --- | --- | --- |
| `0200` | `01 00 03` | `LD BC,0300H` | B counts three iterations; C is cleared |
| `0203` | `11 55 7F` | `LD DE,7F55H` | D starts the data sequence at `7F` |
| `0206` | `21 80 00` | `LD HL,0080H` | Point at the buffer |
| `0209` | `31 00 F0` | `LD SP,F000H` | Load SP without accessing the stack |
| `020C` | `72` | `LD (HL),D` | Write the current data byte |
| `020D` | `14` | `INC D` | Advance the data value |
| `020E` | `2C` | `INC L` | Advance within the buffer's page |
| `020F` | `10 FB` | `DJNZ 020CH` | Decrement B and repeat while nonzero |
| `0211` | `36 00` | `LD (HL),00H` | Append the terminator |
| `0213` | `21 80 00` | `LD HL,0080H` | Point back at the first byte |
| `0216` | `7E` | `LD A,(HL)` | Read `7F` from RAM |
| `0217` | `4F` | `LD C,A` | Copy the first byte to C |
| `0218` | `21 82 00` | `LD HL,0082H` | Point at the last data byte |
| `021B` | `5E` | `LD E,(HL)` | Read `81` from RAM |
| `021C` | `76` | `HALT` | Halt after 23 instructions |

The displacement `FB` is −5 relative to `0211`, the address after DJNZ.
`INC L` wraps only L and does not carry into H; this buffer stays within one
page. A general buffer traversal will need a word increment or equivalent
address handling when that family is implemented.

## Trace and result

The first four instructions load BC, DE, HL, and SP. They preserve every flag
and advance R through `FF`, `80`, `81`, and `82`.

| Iteration | Write | D after INC | HL after INC L | B after DJNZ | Next PC | R after DJNZ |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `[0080] = 7F` | `80` | `0081` | `02` | `020C` | `86` |
| 2 | `[0081] = 80` | `81` | `0082` | `01` | `020C` | `8A` |
| 3 | `[0082] = 81` | `82` | `0083` | `00` | `0211` | `8E` |

The first INC D crosses the signed boundary from `7F` to `80` and sets H and
P/V. The following INC L replaces those flags. After each complete iteration,
S/Z/H/PV/N/C are `1/0/0/0/0/1`; DJNZ tests B directly and preserves them.
The terminating store, readback loads, register transfer, and HALT preserve them too.

The four data writes, in order, are `[0080] = 7F`, `[0081] = 80`,
`[0082] = 81`, and `[0083] = 00`. Readback adds two data reads:
`[0080] = 7F` and `[0082] = 81`. Instruction bytes include only opcode and
immediate fetches; data reads are recorded separately in the access list.
The guards and every other RAM byte remain unchanged.

Final state is A = `7F`, BC = `007F`, DE = `8281`, HL = `0082`, SP = `F000`,
PC = `021D`, R = `95`, and `halted = true`. Flags have the values above.
The alternate bank, IX, IY, I, both interrupt latches, and IM retain their
initial values. No load changes flags, and each opcode advances R once,
regardless of operand or data accesses.

## Acceptance checks

- A 23-step runner budget halts exactly, with complete before/after snapshots
  and instruction/access records checked against an independent literal trace.
- Observed RAM calls match those records; a full RAM comparison checks the
  buffer, guards, program, and unused memory.
- An eight-step run stops after the first iteration. A CPU reconstructed
  from its snapshot and the same RAM finishes in 15 more steps with the same trace.
- Already halted steps perform no accesses. Reset preserves loaded SP, both
  banks, flags, and RAM while applying the model's documented reset effects.
- Later execution, reset, RAM edits, and caller edits leave earlier records
  detached. Fresh factories restore the original state and memory image.
