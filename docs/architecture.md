# Architecture sketch

This is a working vocabulary and proposed layout. Interfaces and implementation
details continue to develop through small examples.

The introductory examples were built for the **8080, 6502, and 6809**, in that
order. Their differences inform shared interfaces; see
[CPU scope](cpus/scope.md) for the selection rationale and intended targets.

## Implementation language and future definition languages

The implementation uses **TypeScript**, including the CPU and other component
models. Domain-specific languages (DSLs) for defining CPUs or other components
remain a possible later direction.

For example, definitions might describe registers and their relationships,
instruction encodings and behavior, device registers, or component connections.
Where useful, the same definitions could support execution, disassembly,
inspection, and explanations. Expected behavior would still be checked
independently against hardware documentation.

A long-term aspiration for the CPU DSL is **literate programming**: a detailed
description of a CPU would combine explanations with formal definitions from
which its emulator is generated. The authored description would serve as both
readable documentation and implementation source. The document format, language
syntax, and generation tooling remain open. Keep this direction in mind as
definitions develop; choosing its concrete shape can wait.

The first forms could be typed data or helper functions within TypeScript.
Custom syntax, interpretation, or code generation can follow when concrete
examples demonstrate a benefit. Some behavior may remain ordinary TypeScript.

The current [stored-state descriptions](cpus/implementation.md#stored-state-descriptions)
are one such example: CPU-owned fields and constraints drive constructor
validation, snapshot copying, machine parsing, and public state types. The
types are derived from those descriptions; snapshot views remain explicit TypeScript.

The [instruction-semantics experiment](cpus/instruction-semantics.md) now
represents all eight documented instruction sets as typed definitions paired
with prose. Validation and generation produce both expanded explanations and
typed TypeScript bodies. CPU tables bind those bodies to stored state and narrow
execution contexts. Native decoders, recording, retirement, and exception-entry
orchestration remain in the cores; the complete literate authoring format is
still open.

The rule of three applies to these generalizations too. We will use the 8080,
6502, and 6809 examples to discover useful common descriptions while preserving
their hardware distinctions. Definitions for other component types should
likewise develop through concrete examples. No CPU or component DSL syntax or
processing model is being chosen upfront.

The [Zed extension](../editors/zed/README.md) uses a separate Tree-sitter grammar
for editing machine definitions. The application parser and CPU state descriptions
own validation; editor tooling recognises syntax and is built independently.

## The pieces

**Components** model CPUs, memory, and devices. Each owns its relevant state and
exposes the operations and connections that other components need. A CPU's
registers, flags, instruction semantics, and timing remain specific to that CPU.

**Machine compositions** select components and connect them. They describe
memory maps, device connections, clock relationships, and initial state where
needed. Configuration may include small amounts of machine-specific code.
Making a machine a configuration does not require expressing all behavior as
data or inventing a configuration language upfront.

For example, the Apple II and BBC Micro are intended to share the 6502
component, with their memory maps and devices defined by their machine
compositions.

The current flat-RAM examples use [defineRamExample](../src/machines/ram-example.ts)
to share setup code. Each definition supplies a concrete CPU constructor,
initial state, RAM size, addressed byte blocks (including any reset vector),
and an optional caller completion address. The helper creates fresh RAM and
CPU instances without reset or execution; each CPU constructor still owns
copying and validating its state. Example exports retain their concrete CPU
types. More complex machine wiring can use ordinary TypeScript as it develops.

The setups are [machine definitions](machines/definitions.md) written in a small
language for CPU state, hexadecimal byte images, and component wiring. Definitions
and their tests are grouped by CPU; generated factories mirror their folders.
A build step validates the definitions, generating calls to the shared helper
for flat RAM or direct constructors and connections for composed machines. The
parser imports stored-state descriptions from the CPU modules. TypeScript
checks generated calls against the selected CPU and component types. The
generated factories are ordinary ES modules, so loading a machine requires no
parser, file access, or asynchronous initialization.

The [first mapped composition](cpus/68000/examples/rom-boot.md) connects
owned ROM and RAM through a [fixed memory map](machines/memory-map.md). Regions
translate physical addresses into local component addresses; holes and ROM
writes report bus errors. The map owns routing and components own storage.
Its `.machine` definition names the components, loads local byte images, and
declares their map. The same language supports the 8080's directional byte-port
connections and explicit machine reset and 68000 device-reset lists. Host output
callbacks are named factory arguments; input offers and execution remain host
operations. More elaborate devices and interrupt wiring can still use TypeScript.

The [byte-output device](devices/byte-output.md) uses the same memory connection.
It owns a single register and notifies a host callback on each write; the host
owns the output stream. The [ROM-output composition](cpus/68000/examples/output.md)
maps the register and connects the CPU's RESET instruction to device reset.

**Execution support** coordinates stepping, running, pausing, and eventually
emulated time. Browser display updates should not define the machine's timing.
The execution granularity and fidelity of each model need to be explicit.
The [CPU runner](runtime/runner.md) provides synchronous execution with an
explicit step budget, caller completion addresses, and CPU-specific records.
It stops on completion, halt, unsupported attempts, or the step limit.

**Inspection** exposes state and activity for exploration. Common views should
work across components where meaningful, with specific views for distinctive
hardware. Reading a device for inspection must not accidentally trigger the
side effects of a CPU access, such as clearing an interrupt. The CPU models
expose detached state snapshots and instruction access records. Byte output
likewise exposes a detached snapshot without reading its bus register or
emitting output.

**The browser interface** presents controls, displays, inspectors, and
explanations. Components should be usable without the DOM or a browser render
loop. Specialist instruments, such as an Applesoft BASIC inspector, can add
software knowledge through the inspection interface.

**Lessons** combine small programs, machine compositions, views, and explanatory
content. A lesson can expose only the parts needed for its concept while using
the same underlying models as a complete machine.

**Software guides** connect program architecture and line-by-line source or
disassembly analysis to lessons, instruments, and execution. Guides own their
program-version associations, symbols, data interpretations, and annotations;
CPU and device models retain their hardware responsibilities. Isolated routine
studies use explicit starting states and execution requirements, while
explanations of completed steps use captured records. The
[pedagogical roadmap](pedagogy.md#7-understand-substantial-software-through-guided-execution)
describes how these studies can grow into comprehensive guides.

Software inspectors interpret state as program structures such as maps,
objects, and variables, with links to their underlying memory representation.
Their interpretations and prepared execution scenarios belong to the selected
software version. Navigation between prose, annotated code, and instruments
should preserve reading and experiment context; loading or restarting a
scenario is an explicit execution action. The
[software-guide design](web-design.md#detailed-software-guides) describes these
interactions and their layout requirements.

The [web design plan](web-design.md) proposes Learn, Explore, Reference, and
About as the site's main navigation, with CPUs, Machines, and Software as
peers under Explore. Lessons, examples, machine pages, and software guides
arrange shared workspace views around those same models and inspection tools.
It describes page roles, visual direction, and delivery steps; concrete UI
interfaces and route names remain open to review through the first examples.

## Proposed repository layout

The implementation has CPU models, memory components, byte output, example setup, and tests. The other
source paths show where code and content could go as we introduce them; their names can change with experience. No package or framework
boundaries are implied by this tree. Build and test commands are in the
[development instructions](../README.md#development).

```text
dromaios/
├── AGENTS.md
├── README.md
├── ROADMAP.md
├── docs/                  Design, CPU specifications, examples, and machine guides
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

The [documentation index](README.md) provides navigation within `docs/`.

A component should belong to its hardware model rather than to the first
machine that uses it. Machine wiring belongs with the composition. Presentation
belongs with the UI; explanations belong with the relevant lesson or docs.
We will give specialist instruments a home when we introduce the first one.

## Generalization through three CPUs

Use small programs on the 8080, 6502, and 6809 to exercise the differences that
a shared interface must represent: register widths and aliases, stack
conventions, addressing modes, and memory accesses. Interrupts and I/O follow
the roadmap's [CPU-only checkpoint across eight CPUs](../ROADMAP.md#cpu-only-checkpoint).

Shared CPU and inspection interfaces remain provisional until these three
cases provide evidence for them. RAM and straightforward helpers can be shared
as soon as useful. The rule of three does not require every operation to have
a common implementation or every helper to have three users. Decoding, flags,
addressing, and timing can retain the structure that explains each CPU best.

Three examples are a review point, not a claim of universality. Later CPU
models, variants, and machine compositions can still require revisions.

The 8080 and Z80 share an internal [8080-family core](../src/components/cpus/8080-family.ts)
for common encodings, register operands, loads, and control flow. They are sibling
implementations: each supplies its flag rules, packed status word, state contract,
and lifecycle. The Z80 adds its other instructions and prefix decoding. Paired
programs expose common encodings alongside their different flag semantics.
The 6800 and 6809 share accumulator operations and ALU helpers while retaining
their distinct addressing and stack rules. These boundaries follow specific
family relationships; other CPUs continue to share smaller helpers.

The [CPU source organization guide](cpus/implementation.md) defines a common
reading order and encoding-table conventions while preserving each processor's
distinct decoding and execution rules.

## Model contracts and example specifications

The introductory [8080](cpus/8080/examples/arithmetic.md), [6502](cpus/6502/examples/arithmetic.md),
[6809](cpus/6809/examples/arithmetic.md), [Z80](cpus/z80/examples/arithmetic.md),
[8008](cpus/8008/examples/arithmetic.md), [6800](cpus/6800/examples/arithmetic.md),
[8088](cpus/8088/examples/arithmetic.md), and [68000](cpus/68000/examples/arithmetic.md)
examples are complete.
Each example's document records its program, initial state, instruction behavior, expected execution,
and acceptance checks. The [CPU model contracts](README.md#cpu-models) define
state ownership, record formats, unsupported-instruction policies, and reset.
The [coverage tracker](cpus/coverage.md) records current CPU implementation support.
These questions guide review of the focused examples as they develop:

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

The concrete CPU models take explicit initial state and memory. `Cpu8008`
requires 16 KiB RAM; `Cpu8088` requires 1 MiB; `Cpu8080`, `Cpu6502`, `Cpu6800`,
`Cpu6809`, and `CpuZ80` require 64 KiB. `Cpu68000` takes a 16 MiB
[MemoryConnection](../src/components/memory/connection.ts), which plain `Ram`
also satisfies. A connection can return an explicit `"bus-error"` result; thrown
host errors propagate. Other cores still accept `Ram` directly.
They copy only declared state
fields, including flags and any nested banks or address arrays, and expose
`snapshot()` and `step()`.
Public snapshots and records have readonly TypeScript types and own detached values. Internal CPU
state stays mutable. Each model uses a discriminated union for step outcomes
and retains no execution history. The 8008 derives PC from its selected internal
address register. The 8088 derives physical PC from CS:IP and byte-register
views from word registers; records use physical RAM addresses and retain the
logical registers in their snapshots. The 68000 preserves its full 32-bit PC,
uses the low 24 bits for RAM access, and derives A7 from USP/SSP and supervisor
mode. The runner compares each model's `snapshot().pc`; a 68000 completion
address therefore retains all 32 bits. Alignment faults and reported memory
failures enter the 68000's address-error and bus-error vectors. Its model contract
defines the shared extended frame, retained partial effects, and terminal halt
on failed error/reset entry. Snapshots preserve pending entry context through
the first handler fetch.
Restarting an example creates fresh components.

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
