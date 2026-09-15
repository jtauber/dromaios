# 6502 example: counted loop

This program adds five three times, counts down in X, counts completed
iterations in Y, and stores fifteen in RAM. Its final branch uses the Z flag
left by DEX, even though A still holds a nonzero sum.

[Model contract](../model.md#register-operations-and-relative-branches) ·
[Example definition](../../../../src/machines/6502/counted-loop-example.machine) ·
[Example tests](../../../../tests/machines/6502/counted-loop-example.test.ts) ·
[CPU coverage](../../coverage.md#6502)

## Definition and initial state

Addresses, bytes, and register values below are hexadecimal; step numbers are
decimal. Begin with zero-filled 64 KiB RAM and load:

| Address | Bytes | Instruction or data |
| --- | --- | --- |
| `0200` | `A2 03` | `LDX #$03`: remaining iterations |
| `0202` | `A0 00` | `LDY #$00`: completed iterations |
| `0204` | `A9 00` | `LDA #$00`: running sum |
| `0206` | `18` | `CLC`: loop entry |
| `0207` | `69 05` | `ADC #$05` |
| `0209` | `C8` | `INY` |
| `020A` | `CA` | `DEX` |
| `020B` | `D0 F9` | `BNE $0206`: displacement −7 from `020D` |
| `020D` | `8D 80 00` | `STA $0080` |
| `FFFC` | `00 02` | Reset vector: `0200`, low byte first |

The destination `0080` and completion address `0210` start at zero.

| State | Initial value |
| --- | --- |
| A, X, Y | `11`, `22`, `33` |
| PC, SP | `0200`, `FF` |
| N, V, D, I, Z, C | `1`, `1`, `0`, `0`, `1`, `1` |

These are explicit example choices. D is clear to select binary ADC; each iteration clears C before adding. Register and branch
behavior follows the [model contract](../model.md#register-operations-and-relative-branches)
and the [manufacturer manual](https://syncopate.us/books/Synertek6502ProgrammingManual.html),
sections 4.1 and 7, with encodings in Appendix B.

`create6502CountedLoopExample()` returns fresh `{ cpu, ram, endAddress }`, with
`endAddress = 0210`. `create6502CountedLoopExampleMemory()` creates the same
memory image without a CPU. Neither factory performs reset or execution.

## Expected execution

All nineteen steps return `executed`. SP stays `FF`, and D/I remain clear.
The first record starts with the initial state; each later before-state is
the previous after-state. The register and flag columns show after-state.

| Step | PC before | Fetched bytes | PC after | A | X | Y | N | Z | V | C |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `0200` | `A2 03` | `0202` | `11` | `03` | `33` | 0 | 0 | 1 | 1 |
| 2 | `0202` | `A0 00` | `0204` | `11` | `03` | `00` | 0 | 1 | 1 | 1 |
| 3 | `0204` | `A9 00` | `0206` | `00` | `03` | `00` | 0 | 1 | 1 | 1 |
| 4 | `0206` | `18` | `0207` | `00` | `03` | `00` | 0 | 1 | 1 | 0 |
| 5 | `0207` | `69 05` | `0209` | `05` | `03` | `00` | 0 | 0 | 0 | 0 |
| 6 | `0209` | `C8` | `020A` | `05` | `03` | `01` | 0 | 0 | 0 | 0 |
| 7 | `020A` | `CA` | `020B` | `05` | `02` | `01` | 0 | 0 | 0 | 0 |
| 8 | `020B` | `D0 F9` | `0206` | `05` | `02` | `01` | 0 | 0 | 0 | 0 |
| 9 | `0206` | `18` | `0207` | `05` | `02` | `01` | 0 | 0 | 0 | 0 |
| 10 | `0207` | `69 05` | `0209` | `0A` | `02` | `01` | 0 | 0 | 0 | 0 |
| 11 | `0209` | `C8` | `020A` | `0A` | `02` | `02` | 0 | 0 | 0 | 0 |
| 12 | `020A` | `CA` | `020B` | `0A` | `01` | `02` | 0 | 0 | 0 | 0 |
| 13 | `020B` | `D0 F9` | `0206` | `0A` | `01` | `02` | 0 | 0 | 0 | 0 |
| 14 | `0206` | `18` | `0207` | `0A` | `01` | `02` | 0 | 0 | 0 | 0 |
| 15 | `0207` | `69 05` | `0209` | `0F` | `01` | `02` | 0 | 0 | 0 | 0 |
| 16 | `0209` | `C8` | `020A` | `0F` | `01` | `03` | 0 | 0 | 0 | 0 |
| 17 | `020A` | `CA` | `020B` | `0F` | `00` | `03` | 0 | 1 | 0 | 0 |
| 18 | `020B` | `D0 F9` | `020D` | `0F` | `00` | `03` | 0 | 1 | 0 | 0 |
| 19 | `020D` | `8D 80 00` | `0210` | `0F` | `00` | `03` | 0 | 1 | 0 | 0 |

Each step reads exactly its listed instruction bytes at consecutive addresses
starting at PC before. The final step then writes `0F` to `0080`, without
reading the destination. There are no other data accesses. Both taken and
untaken BNE steps fetch `D0 F9`; neither prefetches its next instruction.
These are the model's instruction-level accesses, without dummy reads or timing.

Only `0080` changes. Run with `runCpu(cpu, { maxSteps: 19, endAddress })` to
finish with `stopReason: "completed"` before fetching at `0210`. The CPU itself
has no completion outcome: a direct step there executes BRK (`00`) and follows
the unused IRQ/BRK vector to `0000`.

## Pause, reset, and restart

A seven-step budget pauses at `020B`, immediately before the first BNE, with
A = `05`, X = `02`, and Y = `01`. A further twelve steps complete the program;
the concatenated records match an uninterrupted run.

Reset follows the [6502 reset contract](../model.md#cpu-reset): read the current
vector, set PC to `0200`, set I, and change SP from `FF` to `FC`. Registers,
other flags, and RAM retain their final values. The setup instructions execute
again when resumed. Restarting through the factory creates fresh components
with the original explicit state and memory image.

## Acceptance checks

- Check both factories, independent components, and all bytes of the initial
  and final RAM images.
- Compare all nineteen complete records against the trace above, including
  the two taken branches, the untaken final branch, and preserved flags.
- Observe actual RAM calls independently; require a single final data write
  and caller completion before the next opcode fetch.
- Pause before BNE and resume with a bounded budget; verify reset preservation,
  fresh restart, and records retained across later execution and RAM edits.
- Change the displacement to `FE` so BNE repeats itself and verify the shared
  runner stops at its instruction budget without reaching the final store.

The [CPU tests](../../../../tests/components/cpus/6502.test.ts) separately cover
all eight branch conditions, all signed displacements, PC wrapping, and the
register operations across every byte and flag combination.
