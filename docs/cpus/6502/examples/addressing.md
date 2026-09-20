# 6502 example: zero-page addressing

This example copies a byte between the two ends of zero page. It complements
the [8080 addressing example](../../8080/examples/addressing.md) with addresses
supplied by one-byte instruction operands.

[Example definition](../../../../src/machines/6502/addressing-example.machine) ·
[Example tests](../../../../tests/machines/6502/addressing-example.test.ts) ·
[CPU coverage](../../coverage.md#6502)

## Instruction behavior

Use the existing MOS 6502 and flat 64 KiB RAM. `LDA zp` (`A5`) loads A and
replaces N/Z from the byte read, preserving V/D/I/C. `STA zp` (`85`) stores A
and preserves all flags. Both have a one-byte address operand: the effective
address's high byte is always zero, giving access to `0000–00FF` independently
of PC, X, Y, and SP. Both work with either value of D.
See the [manufacturer manual](https://syncopate.us/books/Synertek6502ProgrammingManual.html),
sections 2.1.1–2.1.2 and 5.6, and Appendix B.

Each step records the opcode fetch, address-operand fetch, and one data read
or write, in that order. PC advances by two with 16-bit wrapping. A store
does not read its destination and writes even when its value is unchanged.
Only the opcode and operand appear in `instruction.bytes`.

Data accesses use current RAM, including when code occupies zero page. A load
may read an instruction byte again as data; a store may overwrite its opcode,
operand, or a later instruction. Captured bytes remain unchanged, and subsequent
execution fetches current memory. The records describe instruction-level
accesses; cycle counts and complete hardware bus traces remain outside scope.

## Definition and initial state

All numbers below are hexadecimal. Create zero-filled RAM and load:

| Address | Bytes | Instruction or data |
| --- | --- | --- |
| `00FF` | `A5` | Source byte |
| `0200` | `A5 FF` | `LDA $FF` (zero page) |
| `0202` | `85 00` | `STA $00` (zero page) |
| `FFFC` | `00 02` | Reset vector: `0200`, low byte first |

The destination at `0000` and completion address `0204` start at zero.
The two operands explicitly select `00FF` and `0000`; the program performs
no pointer increment or indexed address calculation.

| State | Initial value |
| --- | --- |
| A, X, Y | `11`, `22`, `33` |
| PC, SP | `0200`, `FF` |
| N, V, D, I, Z, C | `0`, `1`, `1`, `0`, `1`, `1` |

These are explicit lesson choices. Initial N/Z differ from the flags produced
by the load, and D is set to exercise the supported behavior with decimal mode
enabled. D affects ADC/SBC arithmetic, but does not change loads or stores.

`create6502AddressingExample()` returns fresh `{ cpu, ram, endAddress }`, with
`endAddress = 0204`. `create6502AddressingExampleMemory()` loads the same RAM
image without a CPU. Construction performs no reset or execution.

## Expected execution

Each step returns `executed`. X, Y, SP, V, D, I, and C retain their initial
values. The first record's before-state is the initial state; the second's
before-state equals the first's after-state.

| Step | PC before | Fetched bytes | PC after | A | N | Z |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `0200` | `A5 FF` | `0202` | `A5` | 1 | 0 |
| 2 | `0202` | `85 00` | `0204` | `A5` | 1 | 0 |

The complete ordered accesses follow; `R` means read and `W` means write.

| Step | Accesses: kind address:value |
| --- | --- |
| 1 | `R 0200:A5`, `R 0201:FF`, `R 00FF:A5` |
| 2 | `R 0202:85`, `R 0203:00`, `W 0000:A5` |

Only `0000` changes, from `00` to `A5`; the source remains unchanged. The
caller stops at `0204` before fetching again. A further direct CPU step
executes BRK there and follows the unused IRQ/BRK vector to `0000`.

## Reset and restart

Reset follows the [existing 6502 policy](../../../../src/components/cpus/specifications/6502.md#reset-and-instruction-boundaries).
After this program it reads `FFFC` then `FFFD`, sets PC to `0200`, sets I, and
changes SP from `FF` to `FC`. Other state and RAM remain unchanged, including
the copied byte. Resuming execution reads the source's current contents.

Restarting through the factory restores the original state and RAM image in
fresh components. Earlier records remain independent of execution, RAM edits,
reset, and restart. Editing the source after LDA does not change A or the value
a subsequent STA writes.

## Acceptance checks

- Verify the full initial and final memory images, both exact records, caller
  completion, both factory exports, and independent components.
- Exercise addresses `00`, `7F`, `80`, and `FF` with nonzero X/Y and PC outside
  zero page. Check zero, positive, and negative values, each flag set and clear,
  and N/Z replacement even when A already contains the loaded value.
- Check PC and operand-fetch wrapping at `FFFE` and `FFFF`, while data accesses
  stay in zero page. Observe real RAM calls independently of the CPU's records.
- Require exactly one data access after both instruction bytes; stores must
  never read the destination, and unchanged-value stores must still write.
- Read and overwrite code in zero page, retaining captured opcode/operand
  bytes and fetching newly written instructions on subsequent steps.
- Check current RAM reads, loaded-byte retention after source edits, reset
  preservation, fresh restart, and rejection of every remaining unsupported opcode.
