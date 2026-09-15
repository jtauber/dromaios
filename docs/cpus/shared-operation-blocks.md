# First shared operation blocks

This is the first bounded TypeScript experiment from the
[shared-building-blocks proposal](shared-building-blocks.md#staged-roadmap).
It preserves the CPU models, opcode coverage, public interfaces, and execution
records. The experiment covers comparisons, flag-changing and flag-preserving
transfers, and byte memory modification. It introduces no specification language.

## What is shared

| Building block | Contract | Current uses |
| --- | --- | --- |
| `negativeZero(width, value)` | Pure N/Z updates for an unsigned result already reduced to 8, 16, or 32 bits | 6502 results; Motorola byte/word/long results; the S/Z portion of 8080 results |
| `signZeroParity8(value)` | Pure S/Z/P updates; P is even byte parity | 8080 arithmetic, logic, and comparison |
| `motorolaArithmeticFlags(width, facts)` | Pure NZVC updates from addition/subtraction facts; C means carry or borrow respectively | 6800/6809 byte ALU, 6809 word arithmetic/comparison, 68000 comparison/subtraction |
| `modifyByte(address, transform, memory, writeback)` | Read and transform one byte at an already resolved address, then write its result; optional original-value write before transformation | 6502 memory shifts/INC/DEC; 6800/6809 memory unary operations |

Flag calculations live in [flags.ts](../../src/components/cpus/flags.ts) and
[motorola.ts](../../src/components/cpus/motorola.ts). They return fresh objects
and neither read nor mutate CPU state. The instruction applies the returned
subset at its existing point in execution; unnamed flags remain untouched.
The 8080 still replaces its complete flag object where its existing ALU did.
Motorola operations still obtain the current flag object when invoked, so
restoring CC cannot leave them attached to old storage.

## Comparisons: retain the existing arithmetic boundary

Comparison already uses the shared subtraction primitive. Its residual
processor rules are small and meaningful:

| Model | Comparison behavior |
| --- | --- |
| 6502 CMP/CPX/CPY | Subtract an unsigned byte, apply N/Z, set C to inverse borrow; preserve V/D/I |
| 8080 CMP/CPI | Use subtraction's S/Z/P, CY=borrow, AC=inverse half-borrow; retain A |
| 6809 CMPA/CMPB and word comparisons | Apply NZVC; preserve H and control flags; no destination write |
| 68000 CMP/CMPI/CMPA/CMPM | Apply NZVC at the operation width; preserve X and system flags; retain each family's address-update rules |

The refactor extracts repeated flag calculations, while keeping register
selection, source reads, and result discard visible in the existing operation
methods. A new generic comparison executor would add operand adapters around
code that is already shared. This experiment does not establish a benefit
for that extra layer.

In particular, the 6809 finishes indexed addressing and both source reads
before reading the comparison register. `CMPX ,X++` compares **updated X**
with the word at **old X**. If the second source read throws, the address
update remains but comparison flags have not changed. The original 6800's
CPX still uses its separate high-byte N/V algorithm and whole-word equality;
it does not use the ordinary word flag policy.

## Transfers: flags and effects remain separate

The 6502's loads and register transfers reuse the pure N/Z calculation after
writing their destination. The 8080's MOV/MVI retain their direct transfer
bodies and preserve all flags. The Motorola load/store paths apply N/Z and
clear V at their existing points; their other flags are preserved.

For `STX ,X++` on the 6809, resolving the old destination first updates X.
The instruction then captures the updated X, writes its high and low bytes,
and updates flags only after both writes succeed. If the second write fails,
X and the first byte remain changed while flags retain their previous values.
A combined transfer-and-flags helper must preserve that ordering. The current
small transfer bodies already expose it clearly, so they remain local.

## Memory modification: two validated sequences

[memory-operations.ts](../../src/components/cpus/memory-operations.ts) shares
one ordered body with two supported writeback choices:

| Writeback | Order |
| --- | --- |
| `"result"` (default) | Read → transform → write result |
| `"original-and-result"` | Read → write original → transform → write result |

The address has already been resolved exactly once. The callbacks own address
mapping and recording; this helper does not truncate, align, or resolve it.
The transform consumes one unsigned byte and returns one unsigned byte. It
may read/update instruction flags, but must not perform memory access or
resolve another operand. The helper returns only after the final write succeeds.
The supported variation inserts one specific write; it does not reorder other
effects or offer arbitrary flag-timing options.

The 6502's transform sets shift carry between the original and final writes.
Its caller applies N/Z after the helper returns. Therefore a failed final
write leaves C changed and N/Z unchanged. A failed original write leaves all
flags unchanged. For the 6800/6809 unary operations, the transform applies its
flags before the single result write. The 6800's write-only CLR remains an
explicit instruction; the 6809's CLR uses the ordinary read/transform/write
sequence. TST remains read-only. Unchanged writes are never omitted.

Errors propagate immediately, with completed effects retained and no later
calls. These are preserved **host-error behaviors**, not claims about hardware
bus faults, interrupts, or cycle boundaries.

## Evidence and result

The existing independent CPU tests continue to check all comparison operands,
flag combinations, addressing forms, register aliases, transfers, and exact
access records. New checks cover:

- [Pure result flags](../../tests/components/cpus/flags.test.ts) and
  [Motorola arithmetic policies](../../tests/components/cpus/motorola.test.ts)
  against signed ranges, arithmetic bounds, and independent parity counts.
- [Memory sequences](../../tests/components/cpus/memory-operations.test.ts),
  including unchanged writes and failure at every effect.
- [6502 ASL failures](../../tests/components/cpus/6502.test.ts) at either write,
  and [6809 CMPX/STX failures](../../tests/components/cpus/6809.test.ts) after
  indexed address updates. These new regressions also pass against the
  pre-refactor CPU sources.
- [Type checks](../../tests/types/operation-blocks.ts) for exact returned flag
  subsets, supported widths, required memory capabilities, and writeback choices.

The five CPU modules lose 24 lines in total; shared source gains 26, including
comments and the explicit memory-effect contract. Total source is essentially
flat. The benefit is one maintained Motorola arithmetic flag policy, common
result calculations, and one tested memory-modification sequence with an
explicit NMOS variation. This is a modest semantic consolidation, not evidence
of a large code-size reduction or a general CPU framework.

The subsequent [boundary probes](boundary-probes.md) test these distinctions
against partial execution, address mapping, and future architectures. They
assess register views and operand capabilities using the existing direct
implementations as the comparison. Substantial addressing decoders, CPU
lifecycle, exception behavior, and a structured DSL representation remain
separate work.
