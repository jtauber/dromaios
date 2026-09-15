# 6800 example: logic and bit tests

This program uses all eight immediate logic forms inside a subroutine, branches
on bit-test flags, adds to the result, and stores an answer. The subroutine
saves the caller's B on the same RAM stack as the return address.

[Model contract](../model.md#accumulator-logic) ·
[Example definition](../../../../src/machines/6800/logic-example.machine) ·
[Example tests](../../../../tests/machines/6800/logic-example.test.ts) ·
[CPU coverage](../../coverage.md#6800)

## Definition and initial state

`waiting` starts false and remains false throughout this example.

Addresses, bytes, and registers below are hexadecimal; step counts and signed
displacements are decimal. Begin with zero-filled 64 KiB RAM and load:

| Address | Bytes | Instruction or data |
| --- | --- | --- |
| `0200` | `8E 01 01` | `LDS #$0101`: next free stack byte |
| `0203` | `86 05` | `LDAA #$05` |
| `0205` | `C6 A5` | `LDAB #$A5` |
| `0207` | `BD 02 20` | `JSR $0220`: return to `020A` |
| `020A` | `B7 00 80` | `STAA $0080`: store the answer |
| `0220` | `37` | `PSHB`: save caller's B |
| `0221` | `84 0F` | `ANDA #$0F`: retain low four bits |
| `0223` | `8A 80` | `ORAA #$80`: set bit 7 |
| `0225` | `88 04` | `EORA #$04`: toggle bit 2 |
| `0227` | `85 80` | `BITA #$80`: test bit 7, preserving A |
| `0229` | `27 10` | `BEQ $023B`: +16, early return on a zero test |
| `022B` | `C4 0F` | `ANDB #$0F`: `A5 → 05` |
| `022D` | `CA 80` | `ORAB #$80`: `05 → 85` |
| `022F` | `C8 05` | `EORB #$05`: `85 → 80` |
| `0231` | `C5 7F` | `BITB #$7F`: test low seven bits, preserving B |
| `0233` | `27 02` | `BEQ $0237`: +2, skip fallback on a zero test |
| `0235` | `86 00` | `LDAA #$00`: fallback base, normally skipped |
| `0237` | `88 80` | `EORA #$80`: `81 → 01` on the normal path |
| `0239` | `8B 0F` | `ADDA #$0F`: `01 + 0F = 10` |
| `023B` | `33` | `PULB`: restore caller's B |
| `023C` | `39` | `RTS`: return to `020A` |
| `007F` | `AA CC 55` | Result byte `0080` between guards |
| `00FE` | `5A` | Guard below stack bytes `00FF`–`0101` |
| `0102` | `A5` | Guard above stack |
| `FFFE` | `02 00` | Reset vector: `0200`, high byte first |

The completion byte at `020D` and three stack bytes start at zero.

| State | Initial value |
| --- | --- |
| A, B | `81`, `22` |
| X, SP, PC | `3456`, `0101`, `0200` |
| H, I, N, Z, V, C | `1`, `0`, `1`, `1`, `1`, `1` |

These are explicit example choices. The logic operations and flags follow
Motorola's [M6800 Programming Reference Manual, Appendix A: AND, BIT, EOR, ORA](https://manualzz.com/doc/1063126/motorola-m6800-microprocessor-programming-reference-manual)
and [MC6800 data sheet, table 3](https://vtda.org/docs/computing/Motorola/M6800SystemsReferenceDataSheets_May75.pdf).
Stack and return behavior follows the [model contract](../model.md#stack-and-subroutines).

`create6800LogicExample()` returns fresh `{ cpu, ram, endAddress }`, with
`endAddress = 020D`. `create6800LogicExampleMemory()` creates the same memory
image without a CPU. Neither factory performs reset or execution.

## Expected execution

All twenty steps return `executed`. X remains `3456`, H remains `1`, and I
remains `0`. V becomes `0` at the first step and remains clear. Each before-state
is the preceding after-state, starting with the explicit state above.
Register and flag columns below show after-state.

| Step | PC before | Fetched bytes | PC after | SP | A | B | N | Z | C | Data accesses in order |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `0200` | `8E 01 01` | `0203` | `0101` | `81` | `22` | 0 | 0 | 1 | — |
| 2 | `0203` | `86 05` | `0205` | `0101` | `05` | `22` | 0 | 0 | 1 | — |
| 3 | `0205` | `C6 A5` | `0207` | `0101` | `05` | `A5` | 1 | 0 | 1 | — |
| 4 | `0207` | `BD 02 20` | `0220` | `00FF` | `05` | `A5` | 1 | 0 | 1 | Write `0101=0A`, `0100=02` |
| 5 | `0220` | `37` | `0221` | `00FE` | `05` | `A5` | 1 | 0 | 1 | Write `00FF=A5` |
| 6 | `0221` | `84 0F` | `0223` | `00FE` | `05` | `A5` | 0 | 0 | 1 | — |
| 7 | `0223` | `8A 80` | `0225` | `00FE` | `85` | `A5` | 1 | 0 | 1 | — |
| 8 | `0225` | `88 04` | `0227` | `00FE` | `81` | `A5` | 1 | 0 | 1 | — |
| 9 | `0227` | `85 80` | `0229` | `00FE` | `81` | `A5` | 1 | 0 | 1 | — |
| 10 | `0229` | `27 10` | `022B` | `00FE` | `81` | `A5` | 1 | 0 | 1 | — |
| 11 | `022B` | `C4 0F` | `022D` | `00FE` | `81` | `05` | 0 | 0 | 1 | — |
| 12 | `022D` | `CA 80` | `022F` | `00FE` | `81` | `85` | 1 | 0 | 1 | — |
| 13 | `022F` | `C8 05` | `0231` | `00FE` | `81` | `80` | 1 | 0 | 1 | — |
| 14 | `0231` | `C5 7F` | `0233` | `00FE` | `81` | `80` | 0 | 1 | 1 | — |
| 15 | `0233` | `27 02` | `0237` | `00FE` | `81` | `80` | 0 | 1 | 1 | — |
| 16 | `0237` | `88 80` | `0239` | `00FE` | `01` | `80` | 0 | 0 | 1 | — |
| 17 | `0239` | `8B 0F` | `023B` | `00FE` | `10` | `80` | 0 | 0 | 0 | — |
| 18 | `023B` | `33` | `023C` | `00FF` | `10` | `A5` | 0 | 0 | 0 | Read `00FF=A5` |
| 19 | `023C` | `39` | `020A` | `0101` | `10` | `A5` | 0 | 0 | 0 | Read `0100=02`, `0101=0A` |
| 20 | `020A` | `B7 00 80` | `020D` | `0101` | `10` | `A5` | 0 | 0 | 0 | Write `0080=10` |

Each step first reads its listed instruction bytes at consecutive addresses,
then makes the data accesses shown. There are no other accesses in this
instruction-level model. Both BEQ instructions fetch their displacement;
neither prefetches a target. Logic has no data-memory access beyond fetching
its immediate operand.

BITA's AND result is `80` while A remains `81`. BITB's AND result is `00` while
B remains `80`; the following BEQ uses Z and skips the fallback. Logic leaves
carry set until ADDA replaces it. PULB restores `A5` without changing N/Z.
The final answer is `10`, the caller's B is restored to `A5`, and SP returns
to `0101`. The three stack bytes retain `A5 02 0A` in ascending address order;
all guards remain intact.

Run with `runCpu(cpu, { maxSteps: 20, endAddress })` to complete before fetching
at `020D`. Another direct CPU step attempts the unsupported zero byte there
and leaves state unchanged.

## Pause, alternate paths, reset, and restart

Pausing after step 9 or 14 retains the BIT flags immediately before BEQ.
Pausing after step 18 retains the restored B immediately before RTS. A new CPU
constructed from the snapshot and the same RAM resumes each pause and produces
the same combined records as an uninterrupted run.

Changing the BITA mask at `0228` to `00` selects the early return. The program
skips the B operations and addition, restores B, and stores `81` in thirteen
steps. Final H/I/N/Z/V/C are `1/0/1/0/0/1`.

Changing only the BITB mask at `0232` to `80` makes the second BEQ fall through.
The fallback loads A with `00`, EORA changes it to `80`, and ADDA produces `8F`.
The program stores `8F` in twenty-one steps. Final H/I/N/Z/V/C are
`0/0/1/0/0/0`. Both alternate paths restore B = `A5` and SP = `0101`.

Reset after completion reads the vector, sets PC to `0200`, and sets I. It
preserves A/B/X/SP, the other flags, the answer, and the stack bytes. Creating
a fresh example restores the original explicit state and memory image.

## Acceptance checks

- Verify independent factories and complete initial/final RAM images, including
  output guards, stack guards, saved B, and the return address.
- Compare all twenty complete records with the trace and independently observe
  RAM calls, including the absent fallback fetch on the normal path.
- Verify all eight forms execute, both BIT operations preserve accumulators,
  BEQ uses current flags, and the final answer and restored B/SP are correct.
- Resume from snapshots after steps 9, 14, and 18; verify combined records,
  reset preservation, fresh restart, and retained records after later RAM edits.
- Edit each BIT mask independently and check both alternate paths, their exact
  PC sequences, instruction counts, final state, data writes, and whole RAM.

The [CPU tests](../../../../tests/components/cpus/6800.test.ts) separately cover
every logic operand pair, all incoming flag patterns at byte boundaries,
wrapped fetches, and unsupported addressing modes.
