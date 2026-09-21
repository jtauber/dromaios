# 6809 example: counted loop

This program adds five three times, counts down in B, and stores fifteen in
RAM. It complements the [6502 counted loop](../../6502/examples/counted-loop.md)
with an accumulator as the counter and the combined D register visible
throughout execution.

[Model contract](../../../../src/components/cpus/specifications/6809.md#arithmetic) ·
[Example definition](../../../../src/machines/6809/counted-loop-example.machine) ·
[Example tests](../../../../tests/machines/6809/counted-loop-example.test.ts) ·
[CPU coverage](../../coverage.md#6809)

## Definition and initial state

Initial control state is `waitMode = none` and `nmiArmed = false`. Neither
changes during this program.

Addresses, bytes, and register values below are hexadecimal; step numbers are
decimal. Begin with zero-filled 64 KiB RAM and load:

| Address | Bytes | Instruction or data |
| --- | --- | --- |
| `0200` | `C6 03` | `LDB #$03`: remaining iterations |
| `0202` | `86 00` | `LDA #$00`: running sum |
| `0204` | `8B 05` | `ADDA #$05`: loop entry |
| `0206` | `5A` | `DECB` |
| `0207` | `26 FB` | `BNE $0204`: displacement −5 from `0209` |
| `0209` | `B7 00 80` | `STA >$0080`: extended addressing |
| `FFFE` | `02 00` | Reset vector: `0200`, high byte first |

The destination `0080` and completion address `020C` start at zero.

| State | Initial value |
| --- | --- |
| A, B, DP | `11`, `34`, `12` |
| D (derived from A:B) | `1134` |
| X, Y | `2345`, `4567` |
| S, U, PC | `8000`, `4000`, `0200` |
| E, F, H, I, N, Z, V, C | `1`, `0`, `1`, `0`, `1`, `1`, `1`, `1` |

These are explicit example choices. The initial nonzero A/B make changes to
both halves of D visible. Nonzero DP distinguishes the extended destination
`0080` from a direct address on page `12`. Register and branch behavior follows
the [model contract](../../../../src/components/cpus/specifications/6809.md#arithmetic),
[Motorola instruction details](https://www.maddes.net/m6809pm/appendix_a.htm),
and [opcode reference](https://www.maddes.net/m6809pm/appendix_d.htm).

`create6809CountedLoopExample()` returns fresh `{ cpu, ram, endAddress }`, with
`endAddress = 020C`. `create6809CountedLoopExampleMemory()` creates the same
memory image without a CPU. Neither factory performs reset or execution.

## Expected execution

All twelve steps return `executed`. DP, X, Y, S, U, E, F, and I retain their
initial values. The first record starts with the initial state; each later
before-state equals the previous after-state. Register and flag columns show
after-state.

| Step | PC before | Fetched bytes | PC after | A | B | D | H | N | Z | V | C |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `0200` | `C6 03` | `0202` | `11` | `03` | `1103` | 1 | 0 | 0 | 0 | 1 |
| 2 | `0202` | `86 00` | `0204` | `00` | `03` | `0003` | 1 | 0 | 1 | 0 | 1 |
| 3 | `0204` | `8B 05` | `0206` | `05` | `03` | `0503` | 0 | 0 | 0 | 0 | 0 |
| 4 | `0206` | `5A` | `0207` | `05` | `02` | `0502` | 0 | 0 | 0 | 0 | 0 |
| 5 | `0207` | `26 FB` | `0204` | `05` | `02` | `0502` | 0 | 0 | 0 | 0 | 0 |
| 6 | `0204` | `8B 05` | `0206` | `0A` | `02` | `0A02` | 0 | 0 | 0 | 0 | 0 |
| 7 | `0206` | `5A` | `0207` | `0A` | `01` | `0A01` | 0 | 0 | 0 | 0 | 0 |
| 8 | `0207` | `26 FB` | `0204` | `0A` | `01` | `0A01` | 0 | 0 | 0 | 0 | 0 |
| 9 | `0204` | `8B 05` | `0206` | `0F` | `01` | `0F01` | 0 | 0 | 0 | 0 | 0 |
| 10 | `0206` | `5A` | `0207` | `0F` | `00` | `0F00` | 0 | 0 | 1 | 0 | 0 |
| 11 | `0207` | `26 FB` | `0209` | `0F` | `00` | `0F00` | 0 | 0 | 1 | 0 | 0 |
| 12 | `0209` | `B7 00 80` | `020C` | `0F` | `00` | `0F00` | 0 | 0 | 0 | 0 | 0 |

Each step reads exactly its listed instruction bytes at consecutive addresses
starting at PC before. The final step then writes `0F` to `0080`, without
reading the destination. There are no other data accesses. Both taken and
untaken BNE steps fetch `26 FB`; neither prefetches its next instruction.
These are the model's instruction-level accesses, without dummy reads or timing.

The final DECB sets Z and the following BNE falls through. The store then
updates N/Z/V from A, leaving Z clear. Only `0080` changes in RAM; `1280`
remains zero. Run with `runCpu(cpu, { maxSteps: 12, endAddress })` to finish
with `stopReason: "completed"` before fetching at `020C`. A further direct
CPU step would execute `NEG <$00`. Tests install unsupported byte `01` at the
endpoint to check rejection independently of caller completion.

## Pause, reset, and restart

A four-step budget pauses at `0207`, immediately before the first BNE, with
A = `05`, B = `02`, and D = `0502`. A further eight steps complete the program;
the concatenated records match an uninterrupted run.

Reset follows the [6809 reset contract](../../../../src/components/cpus/specifications/6809.md#reset-and-external-entry): read the current
vector, set PC to `0200`, clear DP, and set F/I. Both stack pointers, A/B/D,
other registers and flags, and RAM retain their final values. The setup
instructions execute again when resumed. Restarting through the factory
creates fresh components with the original explicit state and memory image.

## Acceptance checks

- Check both factories, independent components, and all bytes of the initial
  and final RAM images.
- Compare all twelve complete records against the trace above, including
  derived D, two taken branches, the untaken final branch, and the final
  store's flag changes.
- Observe actual RAM calls independently; require a single final data write
  and caller completion before the next opcode fetch.
- Pause before BNE and resume with a bounded budget; verify reset preservation,
  fresh restart, and records retained across later execution and RAM edits.
- Change the displacement to `FE` so BNE repeats itself and verify the shared
  runner stops at its instruction budget without reaching the final store.

The [CPU tests](../../../../tests/components/cpus/6809.test.ts) separately cover
all sixteen branch encodings, every CC value and displacement, PC wrapping,
and the accumulator operations across every byte and flag combination.
