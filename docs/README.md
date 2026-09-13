# Documentation

Dromaios documentation covers the platform's design, implemented CPU behavior,
small example programs, and machine definitions. For setup and test commands,
see the [development instructions](../README.md#development).

## Design and scope

- [Project roadmap](../ROADMAP.md): development stages and review points.
- [Architecture](architecture.md): component responsibilities, execution and
  inspection boundaries, and the implementation language.
- [CPU scope](cpus/scope.md): intended CPU targets, existing reference work,
  and the reasons for testing generalizations across three architectures.
- [CPU implementation coverage](cpus/coverage.md): current opcode percentages,
  supported forms and features, and remaining gaps across all CPUs.

## CPU models

- [Intel 8080](cpus/8080/model.md)
- [MOS 6502](cpus/6502/model.md)
- [Motorola 6809](cpus/6809/model.md)
- [Zilog Z80](cpus/z80/model.md)

Each model contract defines stored state, initialization, snapshots, execution
records, unsupported-instruction policies, and CPU reset. Coverage stays in
the combined tracker; concrete instruction behavior belongs with the examples.

## CPU examples

Each specification defines its program, initial state, expected records, and
acceptance checks, and links to its model contract, machine definition, and tests.
The arithmetic examples provide a starting point for following execution.

| CPU | Arithmetic | Register pairs | Stack | Addressing | Transfers | Control flow |
| --- | --- | --- | --- | --- | --- | --- |
| Intel 8080 | [Load, add, and store](cpus/8080/examples/arithmetic.md); [carry, borrow, and logic](cpus/8080/examples/alu.md) | [HL and register views](cpus/8080/examples/register-pairs.md) | [Save and restore BC](cpus/8080/examples/stack.md) | [Memory through HL](cpus/8080/examples/addressing.md) | [Registers, memory, and exchanges](cpus/8080/examples/transfers.md) | [Loop and subroutine](cpus/8080/examples/control-flow.md); [counted loop](cpus/8080/examples/counted-loop.md) |
| MOS 6502 | [Load, add, and store](cpus/6502/examples/arithmetic.md) | — | [Save and restore A](cpus/6502/examples/stack.md) | [Zero page](cpus/6502/examples/addressing.md) | — | — |
| Motorola 6809 | [Load, add, and store](cpus/6809/examples/arithmetic.md) | — | [Two stack pointers](cpus/6809/examples/stack.md) | [Configurable direct page](cpus/6809/examples/addressing.md) | — | — |
| Zilog Z80 | [Arithmetic and 8080 comparison](cpus/z80/examples/arithmetic.md) | — | — | — | — | — |

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

These notes record evidence and design ideas from earlier projects. The CPU
and example specifications cite hardware documentation for expected behavior.
Several reference repositories are private; their GitHub links require access.
