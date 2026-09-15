# Documentation

Dromaios documentation covers the platform's design, implemented CPU behavior,
small example programs, and machine definitions. For setup and test commands,
see the [development instructions](../README.md#development).

## Design and scope

- [Project roadmap](../ROADMAP.md): development stages and review points.
- [Architecture](architecture.md): component responsibilities, execution and
  inspection boundaries, and the implementation language.
- [Web design and site structure](web-design.md): proposed sitemap, shared
  exploration workspace, detailed software-guide layouts, visual direction,
  and website delivery steps.
- [Pedagogical explorations](pedagogy.md): teaching principles, reusable
  instruments, and learning milestones from arithmetic to detailed software guides.
- [CPU scope](cpus/scope.md): intended CPU targets, existing reference work,
  and the reasons for testing generalizations across three architectures.
- [CPU implementation coverage](cpus/coverage.md): current opcode percentages,
  supported forms and features, and remaining gaps across all CPUs.
  The [68000 count audit](cpus/68000/opcode-count.md) details its denominator.
- [CPU source organization](cpus/implementation.md): reading order, bit-encoding
  layout, and the separation of handler construction from instruction behavior.
- [Opcode definition experiment](cpus/opcode-definitions.md): typed encoding
  patterns for explicit opcodes, aliases, and instruction families.
- [CPUs assembled from shared building blocks](cpus/shared-building-blocks.md):
  exploratory design for shared CPU semantics and an eventual specification
  DSL. The staged roadmap begins with ordinary TypeScript building blocks,
  reviews their clarity and limits, and tests later language support against
  existing models and future CPUs.

## CPU models

- [Intel 8008](cpus/8008/model.md)
- [Intel 8080](cpus/8080/model.md)
- [MOS 6502](cpus/6502/model.md)
- [Motorola 6800](cpus/6800/model.md)
- [Motorola 6809](cpus/6809/model.md)
- [Zilog Z80](cpus/z80/model.md)
- [Intel 8088](cpus/8088/model.md)
- [Motorola 68000](cpus/68000/model.md)

Each model contract defines stored state, initialization, snapshots, execution
records, unsupported-instruction policies, and CPU reset. Coverage stays in
the combined tracker; concrete instruction behavior belongs with the examples.

## CPU examples

Each specification defines its program, initial state, expected records, and
acceptance checks, and links to its model contract, machine definition, and tests.
The arithmetic examples provide a starting point for following execution.

| CPU | Arithmetic | Register pairs | Stack | Addressing | Transfers | Control flow |
| --- | --- | --- | --- | --- | --- | --- |
| Intel 8008 | [Load, add, and store through H:L](cpus/8008/examples/arithmetic.md); [carry, borrow, and logic](cpus/8008/examples/alu.md); [rotations, carry, and restart calls](cpus/8008/examples/carry.md) | — | [Nested calls and circular address registers](cpus/8008/examples/stack.md) | — | [Copying bytes and changing H:L](cpus/8008/examples/transfers.md) | [Conditional loop and subroutine](cpus/8008/examples/control-flow.md) |
| Intel 8080 | [Load, add, and store](cpus/8080/examples/arithmetic.md); [carry, borrow, and logic](cpus/8080/examples/alu.md); [rotates and carry](cpus/8080/examples/rotates.md); [packed-decimal addition](cpus/8080/examples/decimal.md) | [HL and register views](cpus/8080/examples/register-pairs.md) | [Save and restore BC](cpus/8080/examples/stack.md); [A and flags (PSW)](cpus/8080/examples/psw.md) | [Memory through HL](cpus/8080/examples/addressing.md) | [Registers, memory, and exchanges](cpus/8080/examples/transfers.md) | [Loop and subroutine](cpus/8080/examples/control-flow.md); [counted loop](cpus/8080/examples/counted-loop.md) |
| MOS 6502 | [Load, add, and store](cpus/6502/examples/arithmetic.md); [decimal carry and borrow](cpus/6502/examples/decimal.md); [shifts and memory counters](cpus/6502/examples/shifts.md) | — | [Save and restore A](cpus/6502/examples/stack.md); [status preservation and indirect dispatch](cpus/6502/examples/status.md) | [Zero page](cpus/6502/examples/addressing.md); [indexed buffer processing](cpus/6502/examples/buffer.md) | — | [Counted loop](cpus/6502/examples/counted-loop.md); [nested subroutines](cpus/6502/examples/subroutines.md); [comparisons and flags](cpus/6502/examples/flags.md) |
| Motorola 6800 | [Load, add, and store](cpus/6800/examples/arithmetic.md); [logic and bit tests](cpus/6800/examples/logic.md); [signed word transformation](cpus/6800/examples/word-transform.md); [decimal addition and stack inspection](cpus/6800/examples/decimal.md) | — | [Nested calls and saved accumulators](cpus/6800/examples/stack.md) | [Addressing, carry, and borrow](cpus/6800/examples/addressing.md) | — | [Counted loop](cpus/6800/examples/counted-loop.md) |
| Motorola 6809 | [Load, add, and store](cpus/6809/examples/arithmetic.md); [sum of squares with stack locals](cpus/6809/examples/sum-of-squares.md) | — | [Two stack pointers](cpus/6809/examples/stack.md) | [Configurable direct page](cpus/6809/examples/addressing.md); [Indexed word copy](cpus/6809/examples/indexed-copy.md) | [Word addition through nested calls](cpus/6809/examples/word-addition.md) | [Counted loop](cpus/6809/examples/counted-loop.md) |
| Zilog Z80 | [Arithmetic and 8080 comparison](cpus/z80/examples/arithmetic.md); [two-byte checksum](cpus/z80/examples/checksum.md); [decimal total and alternate banks](cpus/z80/examples/decimal-total.md) | — | [Bit counting and nested calls](cpus/z80/examples/bit-count.md) | [Indexed buffer and block search](cpus/z80/examples/indexed-buffer.md) | [Buffer fill and readback](cpus/z80/examples/transfers.md) | [Counted loop](cpus/z80/examples/counted-loop.md) |
| Intel 8088 | [Word arithmetic and segmented addressing](cpus/8088/examples/arithmetic.md); [signed word transformation](cpus/8088/examples/word-transform.md) | — | — | — | [Byte and word registers](cpus/8088/examples/transfers.md) | [Loop with nested calls](cpus/8088/examples/control-flow.md) · [Masked word sum](cpus/8088/examples/word-sum.md) · [Segmented decimal buffer](cpus/8088/examples/decimal-buffer.md) |
| Motorola 68000 | [Long arithmetic and physical addressing](cpus/68000/examples/arithmetic.md); [immediate arithmetic and logic](cpus/68000/examples/alu.md); [word-buffer sums](cpus/68000/examples/word-sum.md); [masked buffer merge](cpus/68000/examples/logic.md); [word classification and multi-precision negation](cpus/68000/examples/unary.md); [packed samples and multi-word shifts](cpus/68000/examples/shifts.md); [register and byte bitmaps](cpus/68000/examples/bits.md); [multiword arithmetic and buffer comparison](cpus/68000/examples/extended.md) | — | [Stack frames and register lists](cpus/68000/examples/stack-frame.md) | [Mixed-size transfers and effective addresses](cpus/68000/examples/addressing.md) | [Data registers and quick immediates](cpus/68000/examples/transfers.md) | [Buffer processing through nested calls](cpus/68000/examples/control-flow.md) |

A dash means there is no separate example for that topic. Supported instructions
and processor features are tracked in the coverage document.

## Execution support

- [CPU runner](runtime/runner.md): bounded execution, completion and stopping
  rules, retained records, and CPU-specific result types.

## Machine definitions

- [Definition guide](machines/definitions.md): initial state and memory images,
  directory conventions, generated factories, and the editing/build workflow.
- [Language reference](machines/language.md): syntax, hexadecimal notation,
  CPU state fields, validation, and diagnostics.

## Reference notes

- [6502: applepy and dromaios-apple2](cpus/6502/reference-notes.md): implementation
  ideas, inspection pitfalls, and topics to revisit.
- [6809: dromaios-coco](cpus/6809/reference-notes.md):
  findings from the existing CoCo implementation and their limits.
- [8088: dromaios-pc](cpus/8088/reference-notes.md): register views, segmented
  addresses, reset differences, and independent hardware-test comparisons.
- [68000: dromaios-mac](cpus/68000/reference-notes.md): original-68000 state,
  big-endian accesses, reset, and instruction boundaries.

These notes record evidence and design ideas from earlier projects. The CPU
and example specifications cite hardware documentation for expected behavior.
Several reference repositories are private; their GitHub links require access.
