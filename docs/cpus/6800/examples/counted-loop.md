# 6800 example: counted loop

This program adds five three times, counts down in B, and stores fifteen in
RAM. It uses the same instruction bytes as the
[6809 counted loop](../../6809/examples/counted-loop.md), with the 6800's own
register state and reset contract.

[Model contract](../../../../src/components/cpus/specifications/6800.md#branches-and-jumps) ·
[Example definition](../../../../src/machines/6800/counted-loop-example.machine) ·
[Example tests](../../../../tests/machines/6800/counted-loop-example.test.ts) ·
[CPU coverage](../../coverage.md#6800)

## Definition and initial state

`waiting` starts false and remains false throughout this example.

Addresses, bytes, and register values below are hexadecimal; step numbers are
decimal. Begin with zero-filled 64 KiB RAM and load:

| Address | Bytes | Instruction or data |
| --- | --- | --- |
| `0200` | `C6 03` | `LDAB #$03`: remaining iterations |
| `0202` | `86 00` | `LDAA #$00`: running sum |
| `0204` | `8B 05` | `ADDA #$05`: loop entry |
| `0206` | `5A` | `DECB` |
| `0207` | `26 FB` | `BNE $0204`: displacement −5 from `0209` |
| `0209` | `B7 00 80` | `STAA $0080`: extended addressing |
| `FFFE` | `02 00` | Reset vector: `0200`, high byte first |

The destination `0080` and completion address `020C` start at zero.

| State | Initial value |
| --- | --- |
| A, B | `11`, `22` |
| X, SP, PC | `3456`, `7FFF`, `0200` |
| H, I, N, Z, V, C | `1`, `0`, `1`, `1`, `1`, `1` |

These are explicit example choices. Register and branch behavior follows the
[model contract](../../../../src/components/cpus/specifications/6800.md#branches-and-jumps) and
Motorola's [M6800 Programming Reference Manual, Appendix A](https://manualzz.com/doc/1063126/motorola-m6800-microprocessor-programming-reference-manual).

`create6800CountedLoopExample()` returns fresh `{ cpu, ram, endAddress }`, with
`endAddress = 020C`. `create6800CountedLoopExampleMemory()` creates the same
memory image without a CPU. Neither factory performs reset or execution.

## Expected execution

All twelve steps return `executed`. X, SP, and I retain their initial values.
The first record starts with the initial state; each later before-state equals
the previous after-state. Register and flag columns show after-state.

| Step | PC before | Fetched bytes | PC after | A | B | H | N | Z | V | C |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `0200` | `C6 03` | `0202` | `11` | `03` | 1 | 0 | 0 | 0 | 1 |
| 2 | `0202` | `86 00` | `0204` | `00` | `03` | 1 | 0 | 1 | 0 | 1 |
| 3 | `0204` | `8B 05` | `0206` | `05` | `03` | 0 | 0 | 0 | 0 | 0 |
| 4 | `0206` | `5A` | `0207` | `05` | `02` | 0 | 0 | 0 | 0 | 0 |
| 5 | `0207` | `26 FB` | `0204` | `05` | `02` | 0 | 0 | 0 | 0 | 0 |
| 6 | `0204` | `8B 05` | `0206` | `0A` | `02` | 0 | 0 | 0 | 0 | 0 |
| 7 | `0206` | `5A` | `0207` | `0A` | `01` | 0 | 0 | 0 | 0 | 0 |
| 8 | `0207` | `26 FB` | `0204` | `0A` | `01` | 0 | 0 | 0 | 0 | 0 |
| 9 | `0204` | `8B 05` | `0206` | `0F` | `01` | 0 | 0 | 0 | 0 | 0 |
| 10 | `0206` | `5A` | `0207` | `0F` | `00` | 0 | 0 | 1 | 0 | 0 |
| 11 | `0207` | `26 FB` | `0209` | `0F` | `00` | 0 | 0 | 1 | 0 | 0 |
| 12 | `0209` | `B7 00 80` | `020C` | `0F` | `00` | 0 | 0 | 0 | 0 | 0 |

Each step reads exactly its listed instruction bytes at consecutive addresses
starting at PC before. The final step then writes `0F` to `0080`, without
reading the destination. There are no other data accesses. Both taken and
untaken BNE steps fetch `26 FB`; neither prefetches its next instruction.
These are the model's instruction-level accesses, without dummy reads or timing.

The final DECB sets Z and the following BNE falls through. The store then
updates N/Z/V from A, leaving Z clear. Only `0080` changes in RAM. Run with
`runCpu(cpu, { maxSteps: 12, endAddress })` to finish with
`stopReason: "completed"` before fetching at `020C`. A further direct CPU step
attempts the unsupported zero byte there and preserves state.

## Pause, reset, and restart

A four-step budget pauses at `0207`, immediately before the first BNE, with
A = `05` and B = `02`. A further eight steps complete the program; the
concatenated records match an uninterrupted run.

Reset follows the [6800 reset contract](../../../../src/components/cpus/specifications/6800.md#cpu-reset): read the current
vector, set PC to `0200`, and set I. A/B/X/SP, other flags, and RAM retain their
final values. The setup instructions execute again when resumed. Restarting
through the factory creates fresh components with the original explicit state
and memory image.

## Acceptance checks

- Check both factories, independent components, and all bytes of the initial
  and final RAM images.
- Compare all twelve complete records against the trace above, including
  two taken branches, the untaken final branch, and the final store's flag changes.
- Observe actual RAM calls independently; require a single final data write
  and caller completion before the next opcode fetch.
- Pause before BNE and resume with a bounded budget; verify reset preservation,
  fresh restart, and records retained across later execution and RAM edits.
- Change the displacement to `FE` so BNE repeats itself and verify the shared
  runner stops at its instruction budget without reaching the final store.

The [CPU tests](../../../../tests/components/cpus/6800.test.ts) separately cover
all fifteen branch encodings, every flag combination and displacement, PC
wrapping, and accumulator operations across every byte and flag combination.
