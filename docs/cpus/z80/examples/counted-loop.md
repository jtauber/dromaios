# Z80 example: counted loop

This program adds five three times, uses DJNZ to count down in B, stores
fifteen in RAM, and halts. It complements the
[6502](../../6502/examples/counted-loop.md) and
[6809](../../6809/examples/counted-loop.md) loops with a combined decrement
and branch that preserves flags, plus visible refresh-register updates.

[Model contract](../model.md#jumps) ·
[Example definition](../../../../src/machines/z80/counted-loop-example.machine) ·
[Example tests](../../../../tests/machines/z80/counted-loop-example.test.ts) ·
[CPU coverage](../../coverage.md#z80)

The explicit initial state sets `interruptDeferred` and `nmiDeferred` to false.

## Definition and initial state

Addresses, bytes, and register values below are hexadecimal; step and iteration
counts are decimal. Begin with zero-filled 64 KiB RAM and load:

| Address | Bytes | Instruction |
| --- | --- | --- |
| `0200` | `06 03` | `LD B,03H`: remaining iterations |
| `0202` | `3E 00` | `LD A,00H`: running sum |
| `0204` | `C6 05` | `ADD A,05H`: loop entry |
| `0206` | `10 FC` | `DJNZ 0204H`: displacement −4 from `0208` |
| `0208` | `32 80 00` | `LD (0080H),A` |
| `020B` | `76` | `HALT` |

The destination `0080` and reset address `0000` start at zero.

| State | Initial value |
| --- | --- |
| A, B, C, D, E, H, L | `11`, `22`, `33`, `44`, `55`, `66`, `77` |
| BC, DE, HL (derived) | `2233`, `4455`, `6677` |
| Main flags S, Z, H, PV, N, C | `1`, `1`, `1`, `1`, `1`, `1` |
| A′, B′, C′, D′, E′, H′, L′ | `88`, `99`, `AA`, `BB`, `CC`, `DD`, `EE` |
| Alternate BC, DE, HL (derived) | `99AA`, `BBCC`, `DDEE` |
| Alternate flags S, Z, H, PV, N, C | `0`, `1`, `0`, `1`, `0`, `1` |
| IX, IY, PC, SP | `1234`, `5678`, `0200`, `ABCD` |
| I, R, IM | `42`, `FE`, `2` |
| IFF1, IFF2, halted | `1`, `0`, `0` |

These are explicit example choices. Distinct banks reveal accidental changes
to alternate state. R starts near a boundary so its low seven bits wrap during
setup. Instruction behavior follows the
[model contract](../model.md#jumps) and the
[Zilog manual](https://www.zilog.com/docs/z80/um0080.pdf), printed pages
72, 147, 278–279, and the refresh-register description.

`createZ80CountedLoopExample()` returns fresh `{ cpu, ram }`.
`createZ80CountedLoopExampleMemory()` creates the same memory image without a
CPU. Neither factory resets or executes the CPU. No `endAddress` is defined;
this program uses the processor's HALT instruction.

## Expected execution

The first record starts with the initial state; each later before-state equals
the previous after-state. The columns show after-state except PC before and
fetched bytes. Both initial loads preserve all six main flags at `1`. The first
ADD clears all six, and they remain clear through HALT. In particular, the final
DJNZ leaves Z clear even though B has become zero.

| Step | PC before | Fetched bytes | PC after | A | B | BC | R | Outcome |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `0200` | `06 03` | `0202` | `11` | `03` | `0333` | `FF` | executed |
| 2 | `0202` | `3E 00` | `0204` | `00` | `03` | `0333` | `80` | executed |
| 3 | `0204` | `C6 05` | `0206` | `05` | `03` | `0333` | `81` | executed |
| 4 | `0206` | `10 FC` | `0204` | `05` | `02` | `0233` | `82` | executed |
| 5 | `0204` | `C6 05` | `0206` | `0A` | `02` | `0233` | `83` | executed |
| 6 | `0206` | `10 FC` | `0204` | `0A` | `01` | `0133` | `84` | executed |
| 7 | `0204` | `C6 05` | `0206` | `0F` | `01` | `0133` | `85` | executed |
| 8 | `0206` | `10 FC` | `0208` | `0F` | `00` | `0033` | `86` | executed |
| 9 | `0208` | `32 80 00` | `020B` | `0F` | `00` | `0033` | `87` | executed |
| 10 | `020B` | `76` | `020C` | `0F` | `00` | `0033` | `88` | halted |

C/D/E/H/L, DE/HL, the alternate bank and its pair views and flags, IX/IY/SP/I,
and both interrupt latches and IM retain their initial values. The halted
latch is false until the final step.

Each step reads exactly its listed instruction bytes at consecutive addresses
starting at PC before. Step nine then writes `0F` to `0080` without reading
the destination. There are no other data accesses. Both taken and untaken
DJNZ steps fetch `10 FC`; neither prefetches its next instruction. Only the
opcode fetch increments R. These are instruction-level accesses without
dummy reads, cycle counts, or ongoing HALT refresh activity.

Only `0080` changes in RAM. Running with `runCpu(cpu, { maxSteps: 10 })`
returns `stopReason: "halted"` and the ten records above. An already halted
step returns a null instruction, no accesses, and unchanged state including R.

## Pause, reset, and restart

A three-step budget pauses at `0206`, immediately before the first DJNZ,
with A = `05`, B = `03`, BC = `0333`, and R = `81`. A further seven steps
complete the program; concatenated records match an uninterrupted run.

Reset follows the [Z80 reset contract](../model.md#cpu-reset): PC/I/R become
zero, IFF1/IFF2 clear, IM becomes zero, and HALT is released. The two register
banks and their flags, IX/IY/SP, and RAM retain their values. Reset does not
return to this example's entry point: a step at `0000` executes NOP (`00`),
advancing PC and R to 1. Restarting through the factory restores
the original state, entry point `0200`, and memory image in fresh components.

## Acceptance checks

- Check both factories, independent components, and all bytes of the initial
  and final RAM images.
- Compare all ten complete records against the trace, including BC, preserved
  alternate state, DJNZ's two taken paths and final untaken path, and R wrapping.
- Observe actual RAM calls independently; require one final data write and
  no reads or R changes after HALT.
- Pause before DJNZ and resume with a bounded budget; check reset preservation,
  fresh restart, and records retained across later execution and RAM edits.
- Change the initial count operand to `00`. After a ten-step budget, four
  iterations have run: A = `14`, B = `FC`, PC = `0204`, R = `88`. Another 506
  steps finish all 256 iterations, store zero, and halt with R = `82`. The
  unchanged-value store must still occur. This checks that B wraps and that
  bounded running can pause and resume the longer loop.

The [CPU tests](../../../../tests/components/cpus/z80) separately cover
all register forms, JR conditions, every displacement, every B value for DJNZ,
all flag patterns, and every R value for all supported opcodes.
