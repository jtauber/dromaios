# 6502 example: nested subroutines

**Status: implemented and tested.**
Save A, call a routine that calls another routine, store their arithmetic
result, restore A, and jump to completion. The stack wraps within page one.
This builds on the [accumulator stack example](stack.md).

[Model contract](../../../../src/components/cpus/specifications/6502.md#subroutines-and-returns) ·
[Example definition](../../../../src/machines/6502/subroutines-example.machine) ·
[Example tests](../../../../tests/machines/6502/subroutines-example.test.ts) ·
[CPU coverage](../../coverage.md#6502)

## Instruction behavior

The example introduces absolute `JMP` (`4C`), absolute `JSR` (`20`), and implied
`RTS` (`60`). Their return-pointer convention and access order follow the
[manufacturer manual](https://syncopate.us/books/Synertek6502ProgrammingManual.html),
sections 4.0.2 and 8.1–8.3, and the [model contract](../../../../src/components/cpus/specifications/6502.md#subroutines-and-returns).
JSR saves the address of its final operand byte; RTS adds one to that saved
pointer. Calls and returns preserve flags and share the same RAM stack as
PHA/PLA. The model omits dummy reads and makes no timing claim.

## Definition and initial state

All numbers below are hexadecimal. Initialize zero-filled 64 KiB RAM with:

| Address | Bytes | Instruction or data |
| --- | --- | --- |
| `007F` | `AA CC 55` | Result byte `0080` and its neighbors |
| `0102` | `5A` | Sentinel above the first push |
| `01FC` | `A5` | Sentinel below the deepest call |
| `0200` | `A9 80` | `LDA #$80` |
| `0202` | `48` | `PHA` |
| `0203` | `20 20 02` | `JSR $0220` |
| `0206` | `8D 80 00` | `STA $0080` |
| `0209` | `68` | `PLA` |
| `020A` | `4C 40 02` | `JMP $0240` |
| `020D` | `A9 EE` | Skipped `LDA #$EE` |
| `0220` | `A9 05` | `LDA #$05` |
| `0222` | `18` | `CLC` |
| `0223` | `20 30 02` | `JSR $0230` |
| `0226` | `69 01` | `ADC #$01` |
| `0228` | `60` | `RTS` |
| `0230` | `69 0A` | `ADC #$0A` |
| `0232` | `60` | `RTS` |
| `FFFC` | `00 02` | Reset vector: `0200`, low byte first |

| State | Initial value |
| --- | --- |
| A, X, Y | `11`, `22`, `33` |
| PC, SP | `0200`, `01` |
| N, V, D, I, Z, C | `0`, `1`, `0`, `0`, `1`, `1` |

These are explicit lesson choices. D is clear to select binary ADC.
`create6502SubroutinesExample()` returns fresh `{ cpu, ram, endAddress }`, with
`endAddress = 0240`. `create6502SubroutinesExampleMemory()` creates the same
memory image without constructing a CPU. Neither factory executes or resets.

## Expected execution

All thirteen steps return `executed`. X/Y stay `22`/`33`; D/I stay clear.
Each before-state is the initial state or the preceding after-state.

| Step | PC before | Fetched bytes | PC after | A | SP | N | V | Z | C |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `0200` | `A9 80` | `0202` | `80` | `01` | 1 | 1 | 0 | 1 |
| 2 | `0202` | `48` | `0203` | `80` | `00` | 1 | 1 | 0 | 1 |
| 3 | `0203` | `20 20 02` | `0220` | `80` | `FE` | 1 | 1 | 0 | 1 |
| 4 | `0220` | `A9 05` | `0222` | `05` | `FE` | 0 | 1 | 0 | 1 |
| 5 | `0222` | `18` | `0223` | `05` | `FE` | 0 | 1 | 0 | 0 |
| 6 | `0223` | `20 30 02` | `0230` | `05` | `FC` | 0 | 1 | 0 | 0 |
| 7 | `0230` | `69 0A` | `0232` | `0F` | `FC` | 0 | 0 | 0 | 0 |
| 8 | `0232` | `60` | `0226` | `0F` | `FE` | 0 | 0 | 0 | 0 |
| 9 | `0226` | `69 01` | `0228` | `10` | `FE` | 0 | 0 | 0 | 0 |
| 10 | `0228` | `60` | `0206` | `10` | `00` | 0 | 0 | 0 | 0 |
| 11 | `0206` | `8D 80 00` | `0209` | `10` | `00` | 0 | 0 | 0 | 0 |
| 12 | `0209` | `68` | `020A` | `80` | `01` | 1 | 0 | 0 | 0 |
| 13 | `020A` | `4C 40 02` | `0240` | `80` | `01` | 1 | 0 | 0 | 0 |

The complete ordered accesses follow. `R` means read and `W` means write.
The two JSR records interleave stack writes with instruction reads.

| Step | Accesses: kind address:value |
| --- | --- |
| 1 | `R 0200:A9`, `R 0201:80` |
| 2 | `R 0202:48`, `W 0101:80` |
| 3 | `R 0203:20`, `R 0204:20`, `W 0100:02`, `W 01FF:05`, `R 0205:02` |
| 4 | `R 0220:A9`, `R 0221:05` |
| 5 | `R 0222:18` |
| 6 | `R 0223:20`, `R 0224:30`, `W 01FE:02`, `W 01FD:25`, `R 0225:02` |
| 7 | `R 0230:69`, `R 0231:0A` |
| 8 | `R 0232:60`, `R 01FD:25`, `R 01FE:02` |
| 9 | `R 0226:69`, `R 0227:01` |
| 10 | `R 0228:60`, `R 01FF:05`, `R 0100:02` |
| 11 | `R 0206:8D`, `R 0207:80`, `R 0208:00`, `W 0080:10` |
| 12 | `R 0209:68`, `R 0101:80` |
| 13 | `R 020A:4C`, `R 020B:40`, `R 020C:02` |

Final RAM differs only at `0080:10`, `0100:02`, `0101:80`, `01FD:25`,
`01FE:02`, and `01FF:05`. Pulls leave stack bytes intact. A and SP return to
`80` and `01`; the flags reflect the arithmetic and final PLA.
The caller stops before fetching `0240`. A direct step there executes BRK
and follows the unused IRQ/BRK vector to `0000`.

## Reset, resumption, and acceptance checks

- Check the full initial/final images, independent factory instances, all
  thirteen records, and actual RAM calls in order, including JSR's interleaving.
- Pause after either call, either return, or PLA; construct a CPU from the
  snapshot and existing RAM, then require the same remaining trace.
- Reset after the inner call: PC returns to `0200`, SP changes from `FC` to
  `F9`, and I becomes set. A/X/Y, other flags, and the entire RAM image remain
  unchanged. Resuming uses that SP; a fresh factory restores the original state.
- Edit the final JMP to target itself and require a bounded `step-limit` result.
  Preserve captured records across execution, RAM edits, and reset.
- CPU tests independently cover every JMP/JSR target and stacked RTS pointer,
  all SP values and flag combinations, PC/SP wrapping, edited stack data,
  unchanged-value pushes, and code/stack overlap. In particular, a JSR push
  can overwrite its high operand before it is fetched; RTS can read its own
  opcode as return-pointer data.
