# 6502 example: saving and restoring the accumulator

**Status: implemented and tested.**
This example saves A on the stack, replaces it with zero, restores it, and
stores the restored value. It complements the [8080 stack example](../../8080/examples/stack.md)
with the 6502's fixed stack page and different pointer convention.

[Example definition](../../../../src/machines/6502/stack-example.machine) ·
[Example tests](../../../../tests/machines/6502/stack-example.test.ts) ·
[CPU coverage](../../coverage.md#6502)

## Instruction behavior

The example uses the MOS 6502 and flat 64 KiB RAM, with `PHA` (`48`) and
`PLA` (`68`), both one-byte implied instructions. It also uses immediate LDA
and absolute STA.

The stack address is `0100 + SP`. PHA writes A there and then decrements SP;
PLA increments SP first and then reads A from that address. SP wraps as an
8-bit value, so stack accesses stay in `0100–01FF`. PHA preserves all flags;
PLA replaces N and Z from the loaded byte and preserves V, D, I, and C.
See the [manufacturer manual](https://syncopate.us/books/Synertek6502ProgrammingManual.html),
sections 8.3.1, 8.5–8.6, and Appendix B.

The model records the opcode fetch followed by the stack-data read or write.
It omits the hardware's discarded next-instruction reads and PLA's discarded
read at the old stack pointer. Cycle counts and complete bus traces remain
outside the current instruction-level model.

Stack storage is ordinary RAM: pulling leaves the byte in memory, and a pull
reads its current contents even if no matching push preceded it. There is no
separate stack container or depth check. Stack/code overlap follows ordinary
memory access order. The [subroutine example](subroutines.md) extends this
stack with calls and returns; the [status/dispatch example](status.md)
covers PHP/PLP and packed status bytes. Interrupt delivery remains deferred.

## Definition and initial state

All numbers below are hexadecimal. Create zero-filled RAM and load:

| Address | Bytes | Instruction |
| --- | --- | --- |
| `0200` | `A9 80` | `LDA #$80` |
| `0202` | `48` | `PHA` |
| `0203` | `A9 00` | `LDA #$00` |
| `0205` | `68` | `PLA` |
| `0206` | `8D 80 00` | `STA $0080` (absolute) |
| `FFFC` | `00 02` | Reset vector: `0200`, low byte first |

All other bytes start at zero, including result address `0080`, stack location
`01FF`, and completion address `0209`.

| State | Initial value |
| --- | --- |
| A, X, Y | `11`, `22`, `33` |
| PC, SP | `0200`, `FF` |
| N, V, D, I, Z, C | `0`, `1`, `1`, `0`, `1`, `1` |

These are explicit lesson choices. Flags are supplied independently of A;
the first LDA replaces N/Z. D is set to demonstrate that this program works
with either D value; D affects ADC/SBC arithmetic, but does not change stack transfers.

`create6502StackExample()` returns fresh `{ cpu, ram, endAddress }` values, with
`endAddress = 0209`. `create6502StackExampleMemory()` loads the same RAM image
without constructing a CPU. Construction performs no reset or execution.

## Expected execution

Each step returns `executed`. X and Y remain `22` and `33`; V, D, I, and C
remain `1`, `1`, `0`, and `1`. Each record's before-state is the initial state
or the preceding row's after-state.

| Step | PC before | Fetched bytes | PC after | A | SP | N | Z |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `0200` | `A9 80` | `0202` | `80` | `FF` | 1 | 0 |
| 2 | `0202` | `48` | `0203` | `80` | `FE` | 1 | 0 |
| 3 | `0203` | `A9 00` | `0205` | `00` | `FE` | 0 | 1 |
| 4 | `0205` | `68` | `0206` | `80` | `FF` | 1 | 0 |
| 5 | `0206` | `8D 80 00` | `0209` | `80` | `FF` | 1 | 0 |

The complete ordered accesses follow; `R` means read and `W` means write.

| Step | Accesses: kind address:value |
| --- | --- |
| 1 | `R 0200:A9`, `R 0201:80` |
| 2 | `R 0202:48`, `W 01FF:80` |
| 3 | `R 0203:A9`, `R 0204:00` |
| 4 | `R 0205:68`, `R 01FF:80` |
| 5 | `R 0206:8D`, `R 0207:80`, `R 0208:00`, `W 0080:80` |

Only `01FF` and `0080` change, both to `80`. The caller stops at `0209` before
another fetch. A further direct CPU step executes BRK there and follows the
unused IRQ/BRK vector to `0000`, as in the arithmetic example.

## Reset and restart

Reset retains the [existing 6502 policy](../../../../src/components/cpus/specifications/6502.md#reset-and-instruction-boundaries).
Immediately after PHA, reset reads `FFFC` then `FFFD`, returns PC to `0200`,
changes SP from `FE` to `FB`, and sets I. A, X, Y, the other flags, and RAM
remain unchanged, including the saved `80` at `01FF`.

Resuming the program uses SP = `FB`: its PHA writes `80` at `01FB` and its PLA
restores SP to `FB`. The older byte at `01FF` remains. Restarting through the
factory restores the original state and zeroed stack/result memory in fresh
components. Captured records remain independent of both operations.

## Acceptance checks

- Verify the entire initial and final RAM images, all five records, and caller
  completion. Check both factory exports and independent instances.
- Exercise PHA and PLA at ordinary SP values and both wrapping boundaries,
  including PC wrapping at `FFFF`. Observe real RAM calls as well as records.
- Check zero, positive, and negative bytes, all preserved flags with both
  values, and N/Z replacement even when A already equals the pulled byte.
- Verify nested pushes/pulls across wrapping, unchanged-value writes, retained
  stack bytes, and pulls from RAM modified after a push.
- Exercise stack/code overlap, including overwriting the opcode or the next
  instruction and reading the same location as both opcode and stack data.
- Check occupied-stack reset, subsequent execution, fresh lesson restart,
  detached records, and rejection of every remaining unsupported opcode.
