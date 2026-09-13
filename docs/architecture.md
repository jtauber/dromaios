# Architecture sketch

This is a starting vocabulary and proposed layout. Interfaces and implementation
details will be worked out through the first small examples.

The first examples use the **8080, 6502, and 6809**, in that order. Their
differences will inform the shared interfaces; see the
[CPU roadmap](cpu-roadmap.md) for the selection rationale and scope.

## Implementation language and future definition languages

The implementation uses **TypeScript**, including the CPU and other component
models. Domain-specific languages (DSLs) for defining CPUs or other components
remain a possible later direction.

For example, definitions might describe registers and their relationships,
instruction encodings and behavior, device registers, or component connections.
Where useful, the same definitions could support execution, disassembly,
inspection, and explanations. Expected behavior would still be checked
independently against hardware documentation.

The first forms could be typed data or helper functions within TypeScript.
Custom syntax, interpretation, or code generation can follow when concrete
examples demonstrate a benefit. Some behavior may remain ordinary TypeScript.

The rule of three applies to these generalizations too. We will use the 8080,
6502, and 6809 examples to discover useful common descriptions while preserving
their hardware distinctions. Definitions for other component types should
likewise develop through concrete examples. No CPU or component DSL syntax or
processing model is being chosen upfront.

## The pieces

**Components** model CPUs, memory, and devices. Each owns its relevant state and
exposes the operations and connections that other components need. A CPU's
registers, flags, instruction semantics, and timing remain specific to that CPU.

**Machine compositions** select components and connect them. They describe
memory maps, device connections, clock relationships, and initial state where
needed. Configuration may include small amounts of machine-specific code.
Making a machine a configuration does not require expressing all behavior as
data or inventing a configuration language upfront.

The current flat-RAM examples use [defineRamExample](../src/machines/ram-example.ts)
to share setup code. Each definition supplies a concrete CPU constructor,
initial state, addressed byte blocks (including any reset vector), and an
optional caller completion address. The helper creates fresh 64 KiB RAM and
CPU instances without reset or execution; each CPU constructor still owns
copying and validating its state. Example exports retain their concrete CPU
types. More complex machine wiring can use ordinary TypeScript as it develops.

The flat-RAM setups are [machine definitions](machine-definitions.md) written in a
small language for CPU state and hexadecimal byte images. A build step validates
the definitions and generates calls to the same helper; TypeScript checks those
calls against the selected CPU's state type. The generated factories are ordinary
ES modules, so loading a machine requires no parser, file access, or asynchronous
initialization.

**Execution support** coordinates stepping, running, pausing, and eventually
emulated time. Browser display updates should not define the machine's timing.
The execution granularity and fidelity of each model need to be explicit.

**Inspection** exposes state and activity for exploration. Common views should
work across components where meaningful, with specific views for distinctive
hardware. Reading a device for inspection must not accidentally trigger the
side effects of a CPU access, such as clearing an interrupt. The CPU models
expose detached state snapshots and instruction access records; device
inspection will develop as devices are added.

**The browser interface** presents controls, displays, inspectors, and
explanations. Components should be usable without the DOM or a browser render
loop. Specialist instruments, such as an Applesoft BASIC inspector, can add
software knowledge through the inspection interface.

**Lessons** combine small programs, machine compositions, views, and explanatory
content. A lesson can expose only the parts needed for its concept while using
the same underlying models as a complete machine.

## Proposed repository layout

The implementation has RAM, 8080, 6502, and 6809 CPU subsets, example setup, and
tests. The other source paths show where code and content could go as we
introduce them; their names can change with experience. No package or framework
boundaries are implied by this tree. Build and test commands are in the
[development instructions](../README.md#development).

```text
dromaios/
├── AGENTS.md
├── README.md
├── ROADMAP.md
├── docs/
│   ├── architecture.md
│   ├── cpu-roadmap.md
│   ├── cpu-coverage.md
│   ├── 8080-example.md
│   ├── 6502-example.md
│   ├── 6502-reference-notes.md
│   └── 6809-example.md
├── src/
│   ├── components/
│   │   ├── cpus/          CPU models, grouped by architecture
│   │   ├── memory/        Reusable memory models
│   │   └── devices/       Peripheral and controller models
│   ├── machines/          Component selection, configuration, and wiring
│   ├── runtime/           Execution controls and emulated time
│   ├── inspection/        Shared observation support and descriptions
│   └── ui/                Browser shell, controls, and reusable views
├── lessons/               Teaching scenarios, programs, and explanations
└── tests/
    ├── components/        CPU, memory, and device behavior
    ├── machines/          Small integration checks and software targets
    └── fixtures/          Small programs and expected results
```

A component should belong to its hardware model rather than to the first
machine that uses it. Machine wiring belongs with the composition. Presentation
belongs with the UI; explanations belong with the relevant lesson or docs.
We will give specialist instruments a home when we introduce the first one.

## Generalization through three CPUs

Use small programs on the 8080, 6502, and 6809 to exercise the differences that
a shared interface must represent: register widths and aliases, stack
conventions, addressing modes, and distinct memory or I/O accesses.

Shared CPU and inspection interfaces remain provisional until these three
cases provide evidence for them. RAM and straightforward helpers can be shared
as soon as useful. The rule of three does not require every operation to have
a common implementation or every helper to have three users. Decoding, flags,
addressing, and timing can retain the structure that explains each CPU best.

Three examples are a review point, not a claim of universality. Later CPU
models, variants, and machine compositions can still require revisions.

## Example specifications

The introductory [8080](8080-example.md), [6502](6502-example.md), and
[6809](6809-example.md) examples are complete. Each example's document records
its state, program, execution contract, and acceptance checks.
The [coverage tracker](cpu-coverage.md) records current CPU implementation support.
These questions also guide review of the focused examples that come next:

1. Which instructions and program demonstrate the example, and what is
   the expected state after each instruction?
2. How does the CPU access memory, and which object owns each piece of state?
3. What does one step mean, and what execution information does it return?
4. How are initial state, CPU reset, and restarting the lesson defined?
5. How do we inspect state and accesses without changing execution?
6. What happens on an unsupported instruction, and how is it reported?

Execution records should describe the accesses that occurred while stepping.
Re-reading memory or devices afterward cannot reliably reconstruct them. The
record must make its granularity clear; an instruction-level model does not
automatically provide a complete cycle-by-cycle bus trace.

The concrete `Cpu8080`, `Cpu6502`, and `Cpu6809` models each take a 64 KiB
`Ram` instance and explicit initial state. They copy only declared state fields,
including flags, and expose `snapshot()` and `step()`. Public snapshots and
records have readonly TypeScript types and own detached values. Internal CPU
state stays mutable. Each model uses a discriminated union for step outcomes
and retains no execution history. Restarting an example creates fresh components.

Reset behavior, step outcomes, and lesson completion remain specific to each
CPU and example. Their specifications describe the implemented behavior and
planned additions. These types remain CPU-specific while we gather experience
for shared execution and inspection interfaces through the focused examples.

Checks use small programs with explicit expected behavior.
Existing emulator implementations can help identify cases to examine; their
outputs should be checked against the relevant hardware documentation before
being treated as correctness references.

## Decisions to defer

Worker placement, performance optimizations, cycle-level bus simulation,
save states, reverse execution, a public plugin API, CPU and component DSLs,
and declarative descriptions of more complex machine wiring can be considered
when concrete examples justify them.
