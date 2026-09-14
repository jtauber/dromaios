# 6800 example: nested calls and saved accumulators

This program saves A and B, calls a subroutine that calls another subroutine,
stores the computed result, and restores A/B/SP. Saved accumulators and return
addresses occupy the same RAM stack, crossing the `0100` page boundary.

[Model contract](../model.md#stack-and-subroutines) ·
[Example definition](../../../../src/machines/6800/stack-example.machine) ·
[Example tests](../../../../tests/machines/6800/stack-example.test.ts) ·
[CPU coverage](../../coverage.md#6800)

## Definition and initial state

Addresses, bytes, and register values below are hexadecimal; step numbers and
signed displacements are decimal. Begin with zero-filled 64 KiB RAM and load:

| Address | Bytes | Instruction or data |
| --- | --- | --- |
| `0200` | `8E 01 01` | `LDS #$0101`: next free stack byte |
| `0203` | `36` | `PSHA`: save caller's A |
| `0204` | `37` | `PSHB`: save caller's B |
| `0205` | `BD 02 20` | `JSR $0220`: return to `0208` |
| `0208` | `B7 00 80` | `STAA $0080`: store computed result |
| `020B` | `33` | `PULB`: restore B |
| `020C` | `32` | `PULA`: restore A |
| `0220` | `86 05` | `LDAA #$05` |
| `0222` | `C6 07` | `LDAB #$07`: temporary value |
| `0224` | `8D 0A` | `BSR $0230`: +10 from return address `0226` |
| `0226` | `8B 01` | `ADDA #$01`: `0F + 01 = 10` |
| `0228` | `39` | `RTS`: return to `0208` |
| `0230` | `8B 0A` | `ADDA #$0A`: `05 + 0A = 0F` |
| `0232` | `39` | `RTS`: return to `0226` |
| `007F` | `AA CC 55` | Result byte `0080` between guards |
| `00FB` | `A5` | Guard below stack bytes `00FC`–`0101` |
| `0102` | `5A` | Guard above stack |
| `FFFE` | `02 00` | Reset vector: `0200`, high byte first |

The completion address `020D` and six stack bytes start at zero.

| State | Initial value |
| --- | --- |
| A, B | `80`, `00` |
| X, SP, PC | `3456`, `0101`, `0200` |
| H, I, N, Z, V, C | `1`, `0`, `1`, `1`, `1`, `1` |

These are explicit example choices. Stack and instruction behavior follows
Motorola's [M6800 Programming Reference Manual, sections 3.4–3.5 and Appendix A](https://manualzz.com/doc/1063126/motorola-m6800-microprocessor-programming-reference-manual).
LDS explicitly initializes SP to the same value chosen for construction; it
also updates N/Z/V from the full word. The first PSH writes at `0101`, then
decrements SP. Each pull increments SP before reading.

`create6800StackExample()` returns fresh `{ cpu, ram, endAddress }`, with
`endAddress = 020D`. `create6800StackExampleMemory()` creates the same memory
image without a CPU. Neither factory performs reset or execution.

## Expected execution

All fourteen steps return `executed`. X remains `3456` and I remains `0`.
Each before-state is the preceding after-state, starting from the initial
state above. All register and flag values below are after-state.

| Step | PC before | Fetched bytes | PC after | SP | A | B | H | N | Z | V | C | Data accesses in order |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `0200` | `8E 01 01` | `0203` | `0101` | `80` | `00` | 1 | 0 | 0 | 0 | 1 | — |
| 2 | `0203` | `36` | `0204` | `0100` | `80` | `00` | 1 | 0 | 0 | 0 | 1 | Write `0101=80` |
| 3 | `0204` | `37` | `0205` | `00FF` | `80` | `00` | 1 | 0 | 0 | 0 | 1 | Write `0100=00` |
| 4 | `0205` | `BD 02 20` | `0220` | `00FD` | `80` | `00` | 1 | 0 | 0 | 0 | 1 | Write `00FF=08`, `00FE=02` |
| 5 | `0220` | `86 05` | `0222` | `00FD` | `05` | `00` | 1 | 0 | 0 | 0 | 1 | — |
| 6 | `0222` | `C6 07` | `0224` | `00FD` | `05` | `07` | 1 | 0 | 0 | 0 | 1 | — |
| 7 | `0224` | `8D 0A` | `0230` | `00FB` | `05` | `07` | 1 | 0 | 0 | 0 | 1 | Write `00FD=26`, `00FC=02` |
| 8 | `0230` | `8B 0A` | `0232` | `00FB` | `0F` | `07` | 0 | 0 | 0 | 0 | 0 | — |
| 9 | `0232` | `39` | `0226` | `00FD` | `0F` | `07` | 0 | 0 | 0 | 0 | 0 | Read `00FC=02`, `00FD=26` |
| 10 | `0226` | `8B 01` | `0228` | `00FD` | `10` | `07` | 1 | 0 | 0 | 0 | 0 | — |
| 11 | `0228` | `39` | `0208` | `00FF` | `10` | `07` | 1 | 0 | 0 | 0 | 0 | Read `00FE=02`, `00FF=08` |
| 12 | `0208` | `B7 00 80` | `020B` | `00FF` | `10` | `07` | 1 | 0 | 0 | 0 | 0 | Write `0080=10` |
| 13 | `020B` | `33` | `020C` | `0100` | `10` | `00` | 1 | 0 | 0 | 0 | 0 | Read `0100=00` |
| 14 | `020C` | `32` | `020D` | `0101` | `80` | `00` | 1 | 0 | 0 | 0 | 0 | Read `0101=80` |

Each step reads its listed instruction bytes at consecutive addresses before
the data accesses shown. There are no other accesses in this instruction-level
model. Calls write the return address low byte first; RTS reads it high byte
first. No call or return prefetches the target instruction.

At the deepest point, SP is `00FB`, pointing to a free byte whose guard is
untouched. The saved values occupy:

| Addresses in ascending order | Bytes | Meaning |
| --- | --- | --- |
| `00FC`–`00FD` | `02 26` | Inner return address |
| `00FE`–`00FF` | `02 08` | Outer return address |
| `0100` | `00` | Saved B |
| `0101` | `80` | Saved A |

These bytes remain in RAM after completion; pulls never erase them. The write
to `0100` is still recorded even though it stores the existing zero byte.
Only the result and stack locations are written, and all guards remain intact.
Final A/B/SP equal their original values. PULB leaves Z clear despite restoring
zero, and PULA leaves N clear despite restoring `80`: pulls preserve all flags.

Run with `runCpu(cpu, { maxSteps: 14, endAddress })` to finish with
`stopReason: "completed"` before fetching at `020D`. A further direct CPU step
attempts the unsupported zero byte there and preserves state.

## Pause, reset, and restart

A seven-step budget pauses at `0230` inside both calls, with SP = `00FB`,
A = `05`, and B = `07`. Seven more steps finish. Constructing a new CPU from
that snapshot and the same RAM is sufficient to resume: return addresses are
ordinary stack bytes, with no hidden call history.

Reset at that pause reads the vector, sets PC to `0200`, and sets I. It preserves
SP = `00FB`, the accumulators, other flags, and every RAM byte. Executing LDS
then explicitly sets SP to `0101`; reset itself neither unwinds calls nor clears
the stack. Creating a fresh example restores the original state and memory.

## Acceptance checks

- Check independent factories and all bytes of the initial/final RAM images,
  including residual stack bytes and guards.
- Compare all fourteen complete records with the trace and observe actual RAM
  calls, including unchanged-value writes and separate stack data reads.
- Check final A/B/SP, preserved pull flags, and caller completion before another
  opcode fetch.
- Pause after steps 4, 7, 9, 11, and 13; resume using a snapshot and RAM, and
  compare the combined trace with an uninterrupted run.
- Reset inside the nested call, verify SP and whole-RAM preservation, then check
  explicit LDS initialization and fresh restart. Retained records must survive
  later execution, reset, and memory edits.

The [CPU tests](../../../../tests/components/cpus/6800.test.ts) separately cover
all new encodings, operand ranges, flag preservation, full 16-bit wrapping,
overlapping code and stack bytes, and reading edited stack memory.
