# Completing the initial eight CPUs

The destination is complete documented opcode coverage for each initial CPU.
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

The 8080's [port and control contract](8080/model.md#interrupt-controls-and-instruction-retirement)
and [external delivery API](8080/model.md#external-interrupt-delivery) implement
the first item. The 8008's [port contract](8008/model.md#port-input-and-output)
implements the second. The 6502 now implements [entry and return](6502/model.md#interrupt-entry-and-return)
and [explicit IRQ/NMI offers](6502/model.md#external-interrupt-delivery), with
its recognition timing limits documented there. The next slice is 6800
interrupt and wait behavior, followed by the 6809.
Timing and device scheduling remain separate from completed opcode inventories;
8008 external interrupt delivery is also still deferred.
