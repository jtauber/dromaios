# Completing the initial eight CPUs

All eight initial CPUs now have complete documented opcode coverage.
The [coverage inventory](coverage.md) owns the counts and remaining forms;
this document records the capability review and implementation sequence.
Neither a finished DSL nor another CPU target is a prerequisite.

## CPU-only checkpoint review

The September 2026 audit found that all eight models meet the
[roadmap's capability criteria](../../ROADMAP.md#cpu-only-checkpoint).
Each has validated explicit state, detached snapshots, instruction stepping,
and a defined reset contract, with independent CPU tests. Each also implements
loads/stores, arithmetic/logic, branches, calls/returns, and its native stack
conventions. The programs below exercise those capabilities through the shared
runner, including pause/resume and reset or reconstruction.

| CPU | Combined program evidence |
| --- | --- |
| 8008 | [Control flow](../../tests/machines/8008/control-flow-example.test.ts): conditional paths, internal address stack, memory result, and halt |
| 8080 | [Control flow](../../tests/machines/8080/control-flow-example.test.ts): calls, conditional jumps, memory result, and halt |
| 6502 | [Subroutines](../../tests/machines/6502/subroutines-example.test.ts): nested calls, page-one stack wrapping, memory result, and completion |
| 6800 | [Word transformation](../../tests/machines/6800/word-transform-example.test.ts) and [stack](../../tests/machines/6800/stack-example.test.ts): arithmetic, shifts, conditional execution, and native calls/returns |
| Z80 | [Bit count](../../tests/machines/z80/bit-count-example.test.ts): nested calls, bit operations, memory results, and halt |
| 6809 | [Sum of squares](../../tests/machines/6809/sum-of-squares-example.test.ts): stack locals, arithmetic, conditional looping, and completion |
| 8088 | [Decimal buffer](../../tests/machines/8088/decimal-buffer-example.test.ts): wrapped words, repetition, far calls/returns, formatting, and halt |
| 68000 | [Decimal pipeline](../../tests/machines/68000/decimal-pipeline-example.test.ts) and [control flow](../../tests/machines/68000/control-flow-example.test.ts): decimal arithmetic, transfers, status, nested calls, and stopping |

The audit passed the build/type checks, 284 machine/runner tests, and 55
focused CPU state/snapshot/reset tests. These checks establish the checkpoint's
capabilities; they do not establish complete processor accuracy. Opcode
coverage and unmodeled processor features remain separately tracked.

## Completion sequence

Use small, reviewable slices with explicit state, delivery, record, and failure
contracts. Keep native interrupt behavior in the CPU; share narrow connections
and access mechanics when the next processor demonstrates the same need.

1. **8080 ports and interrupt controls, then delivery.** Implement `IN`/`OUT`
   through a byte-port connection and `DI`/`EI` with snapshot-preserved deferral.
   Follow with external acceptance, acknowledgement-supplied instruction bytes,
   and HALT release. Preserve the interrupted return address and distinguish
   the fetch source in records, including full supplied CALL instructions.
2. **8008 port instructions.** Reuse the byte transfer connection while keeping
   the native input/output selectors in the CPU. Verify every documented
   encoding and independently check port direction and access order.
3. **6502 interrupt entry and return.** Define software and external entry,
   stack/status images, vectors, mask changes, and return together. State the
   instruction-level recognition policy explicitly, including its timing limits.
4. **6800 and 6809 interrupt and wait behavior.** Work on each CPU separately;
   check native frames, masks, wait/wake transitions, and return. Waiting must
   be observable and resumable without pretending it is an ordinary instruction.
5. **Z80 port families and interrupt modes.** Extend ports to its native address
   selection, interleaved block transfers, and repeat behavior. Define mode
   selection, acceptance, return, and device notification before sharing more
   interrupt implementation with the 8080.
6. **8088 delivery and external connections.** Add port transfers and software
   interrupt entry/return, then connect existing detected faults to delivery.
   Define the external-processor behavior needed by `ESC` and `WAIT` without
   making a complete coprocessor emulator a prerequisite for those instructions.
7. **68000 exception delivery and external reset.** Define privilege checks,
   frames, vectors, supervisor stacks, and return before implementing the
   remaining system instructions. Connect existing detected exceptions to the
   delivery path; distinguish the `RESET` instruction's external effect from
   resetting the CPU itself.

For each slice, verify independently authored state and access sequences,
boundary addresses, stopped/resumed execution, snapshot restoration, and
relevant connection failures. A device callback is not an interrupt scheduler;
introduce scheduling and memory-mapped devices when a concrete machine needs
them. Keep cycle timing and electrical bus behavior explicit limitations.

The 8080's [port and control contract](../../src/components/cpus/specifications/8080.md#instruction-boundaries-and-interrupt-acceptance)
and [external delivery API](../../src/components/cpus/specifications/8080.md#external-interrupt-delivery) implement
the first item. The 8008's [port contract](../../src/components/cpus/specifications/8008.md#port-input-and-output)
implements the second. The 6502 now implements [entry and return](../../src/components/cpus/specifications/6502.md#software-interrupt-and-interrupt-return)
and [explicit IRQ/NMI offers](../../src/components/cpus/specifications/6502.md#external-interrupt-delivery), with
its recognition timing limits documented there. The 6800 now completes its
[interrupt and wait behavior](../../src/components/cpus/specifications/6800.md#waiting-and-external-interrupt-delivery),
including native frames, return, and snapshot-preserved WAI. The 6809 completes
[its interrupt and wait behavior](../../src/components/cpus/specifications/6809.md#execution-and-public-interface)
with SYNC/CWAI, full/short frames, RTI, software vectors, and NMI arming.
The Z80 now completes its [port families](../../src/components/cpus/specifications/z80.md#port-input-and-output)
and [interrupt behavior](../../src/components/cpus/specifications/z80.md#external-interrupt-delivery), including
all modes, native entries/returns, HALT release, and snapshot-preserved inhibition.
The 8088 now implements all eight [IN/OUT forms](../../src/components/cpus/specifications/8088.md#port-input-and-output),
including byte/word device transfers and snapshot-based program resumption.
It also implements [native interrupt entry/return](../../src/components/cpus/specifications/8088.md#interrupt-instructions-and-shared-entry),
INTR/NMI offers, divide-error delivery, and single stepping. It completes its inventory with
[ESC and TEST/WAIT connections](../../src/components/cpus/specifications/8088.md#wait-and-coprocessor-escape), including
resumable waiting and interrupt/trap restart.
The 68000 now completes its documented opcode inventory, including
[synchronous entry/RTE](../../src/components/cpus/specifications/68000.md#synchronous-exception-entry-and-return),
[interrupt offers and trace](../../src/components/cpus/specifications/68000.md#external-interrupt-delivery), STOP
wakeup, and the [RESET device connection](../../src/components/cpus/specifications/68000.md#reset-device-connection).
The 8008 also implements [external interrupt delivery](../../src/components/cpus/specifications/8008.md#external-interrupt-delivery),
including supplied instruction bytes, STOPPED release, startup after reset, and
native circular-stack calls without advancing the interrupted PC.
The documented opcode milestone is complete for all eight. Further accuracy
and machine integration work can now use that baseline. The 68000 also delivers
[illegal-instruction and emulator-line exceptions](../../src/components/cpus/specifications/68000.md#synchronous-exception-entry-and-return).
It delivers [address errors](../../src/components/cpus/specifications/68000.md#address-errors) and explicit
[bus errors](../../src/components/cpus/specifications/68000.md#bus-errors), including extended frames, retained
partial transfers, and terminal halt on failed error/reset entry. Exact hardware
prefetch and partial-instruction fault sequencing remain outside this model.
Timing and device scheduling remain separate from completed opcode inventories.
