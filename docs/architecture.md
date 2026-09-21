# Architecture sketch

This describes the current simulation architecture and the planned browser and
teaching layers. Interfaces continue to develop through concrete examples.

The introductory examples were built for the **8080, 6502, and 6809**, in that
order. Their differences inform shared interfaces; see
[CPU scope](cpus/scope.md) for the selection rationale and intended targets.

## Implementation language and future definition languages

The implementation uses **TypeScript** for component models, shared instruction
definitions, validation, and generation. The `.machine` language describes
example state, byte images, and component wiring. Definitions already drive
state validation, execution, and explanations; disassembly and richer inspection
tools remain possible additional consumers. Expected behavior is checked
independently against hardware documentation.

A long-term aspiration for the CPU DSL is **literate programming**: a detailed
description of a CPU would combine explanations with formal definitions from
which its emulator is generated. The authored description would serve as both
readable documentation and implementation source. Typed definitions and code
generation provide a working foundation. The first
[literate chapter](cpus/literate-specifications.md) now compiles Markdown `cpu`
fences into that representation, with diagnostics tied to the document.
The 8008, 8080, 6502, and 6800 now have complete descriptions at their declared instruction-level
fidelity, including state, lifecycle policies, and generated public APIs.
Their chapters are the sole processor-specific implementation sources. Generalizing whole-CPU
authoring across the other architectures remains active work.

The current [stored-state descriptions](cpus/implementation.md#stored-state-descriptions)
are one such example: CPU-owned fields and constraints drive constructor
validation, snapshot copying, machine parsing, and public state types. The
types are derived from those descriptions. Chapters can also define read-only
snapshot views and actions on stored state, using the same ordered representation
and generator as instructions. Runtime boundaries invoke those operations and
assemble public snapshots and records.

The [instruction definitions](cpus/instruction-semantics.md) cover all eight
documented instruction sets, pairing formal behavior with prose. Validation
and generation produce both expanded explanations and
typed TypeScript bodies. CPU tables bind those bodies to stored state and narrow
execution contexts. Native decoders and exception-entry orchestration remain in
the cores unless a chapter execution contract covers them. The 8008's contract
generates bindings to shared byte execution, recording, and boundary guards;
the runtime has no processor-name branches. Complete chapter state blocks generate stored-state
schemas and types; partial chapters validate references to externally supplied schemas.
Schema generation precedes instruction generation and machine parsing, while
runtime consumers load small schema modules separately from expanded instruction data.

The rule of three applies to these generalizations too. The 8080, 6502, and
6809 examples established the first comparisons; all eight CPUs now exercise
the shared definitions. Further language and component descriptions should
likewise develop through concrete examples that preserve hardware distinctions.

The [Zed extension](../editors/zed/README.md) uses a separate Tree-sitter grammar
for editing machine definitions. The application parser and CPU state descriptions
own validation; editor tooling recognises syntax and is built independently.

## The pieces

**Components** model CPUs, memory, and devices. Each owns its relevant state and
exposes the operations and connections that other components need. A CPU's
registers, flags, instruction semantics, and timing remain specific to that CPU.

**Machine compositions** select components and connect them. Current definitions
describe memory maps, device connections, reset wiring, and initial state.
Clock relationships and scheduling remain future work. Configuration can use
machine-specific TypeScript where the definition language does not yet express
the required wiring.

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
The [byte-input device](devices/byte-input.md) owns a pending-byte latch with
readiness and consuming reads. The [8080](cpus/8080/examples/echo.md) and
[68000](cpus/68000/examples/echo.md) echo examples reuse both devices through
port and memory-mapped connections. Host code supplies input and retains output
history; machine reset and CPU-only reset have distinct effects.

**Execution support** coordinates stepping, running, pausing, and eventually
emulated time. Browser display updates should not define the machine's timing.
The execution granularity and fidelity of each model need to be explicit.
The [CPU runner](runtime/runner.md) provides synchronous execution with an
explicit step budget, caller completion addresses, and CPU-specific records.
It stops on completion, halt, waiting, unsupported attempts, or the step limit.

**Inspection** exposes state and activity for exploration. Common views should
work across components where meaningful, with specific views for distinctive
hardware. Reading a device for inspection must not accidentally trigger the
side effects of a CPU access, such as clearing an interrupt. The CPU models
expose detached state snapshots and instruction access records. Both byte devices
likewise expose detached snapshots without consuming input or emitting output.

**The planned browser interface** will present controls, displays, inspectors, and
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

The tree combines existing directories with explicitly marked planned paths.
CPU definitions and generated bodies are separate from the cores that bind them.
No package or framework boundaries are implied. Build and test commands are in the
[development instructions](../README.md#development).

```text
dromaios/
├── AGENTS.md
├── README.md
├── ROADMAP.md
├── docs/                  Design, CPU specifications, examples, and machine guides
├── editors/zed/           Machine-language editor support and its own toolchain
├── scripts/               CPU/machine generation, explanations, and test selection
├── src/
│   ├── components/
│   │   ├── cpus/          CPU cores, encoding inventories, and shared helpers
│   │   │   ├── state/     Stored-state declarations and derived types
│   │   │   ├── semantics/ Authored definitions, builders, validation, and generation
│   │   │   └── generated/ Generated instruction bodies (ignored by Git)
│   │   ├── memory/        RAM, ROM, memory connections, and fixed maps
│   │   └── devices/       Byte-input and byte-output models
│   ├── machines/          .machine definitions, parser, setup, and generated factories
│   ├── runtime/           Bounded CPU runner
│   ├── inspection/        Planned: shared observation tools and descriptions
│   └── ui/                Planned: browser shell, controls, and reusable views
├── lessons/               Planned: teaching scenarios, programs, and explanations
└── tests/
    ├── components/        CPU, memory, and device behavior
    ├── machines/          Parser, generation, and example integration checks
    ├── runtime/           Runner and example execution
    └── types/             Public TypeScript contracts
```

The [documentation index](README.md) provides navigation within `docs/`.

A component should belong to its hardware model rather than to the first
machine that uses it. Machine wiring belongs with the composition. Presentation
belongs with the UI; explanations belong with the relevant lesson or docs.
We will give specialist instruments a home when we introduce the first one.

## Generalization through three CPUs

The 8080, 6502, and 6809 examples first exercised the differences that a shared
interface must represent: register widths and aliases, stack conventions,
addressing modes, and memory accesses. All eight models subsequently met the
[CPU-only checkpoint](../ROADMAP.md#cpu-only-checkpoint) and completed their
documented instruction inventories, including I/O and interrupt controls.
Their model contracts describe implemented delivery policies and timing limits.

Continue testing shared execution and inspection conventions against those
differences. The rule of three does not require every operation to have
a common implementation or every helper to have three users. Decoding, flags,
addressing, and timing can retain the structure that explains each CPU best.

Three examples are a review point, not a claim of universality. Later CPU
models, variants, and machine compositions can still require revisions.

The 8008 and 8080 bind chapter-defined state and execution policies to shared
[byte execution](../src/components/cpus/byte-execution.ts). The 8080 chapter
selects interrupt recognition and EI retirement and defines its complete
instruction inventory. The 6502 and 6800 select [named vector entry](../src/components/cpus/vector-execution.ts),
with reset bus reads, mask decisions, and stacking defined in their chapters.
The 6800 also declares WAI suspension and frame reuse on wake-up. The 6809
uses the same vector runtime with named wait modes, NMI arming, and masked
SYNC release; chapter actions choose full/short frames and reuse CWAI frames. Both
execution paths reuse byte fetch/dispatch and recording, with distinct interrupt
APIs and record types. The [Z80 chapter](../src/components/cpus/specifications/z80.md)
owns its complete model and public interface, including all prefix layouts and
both banks' snapshot views. Shared decoded execution validates complete encodings
before committing PC/refresh. Chapter-defined interrupt entries combine direct
NMI vectors, IRQ mode selection, and supplied instructions through that same
decoder and retirement boundary. Paired programs expose common encodings alongside
their different flag semantics.
The 6800 and 6809 chapters express accumulator operations,
transfers, and control flow through the same instruction representation, retaining
their distinct addressing and stack rules. Shared arithmetic, status, memory, and stack construction also serves
other CPUs where their effect sequences agree. Reuse follows those relationships
and explicit CPU policies rather than requiring a common inheritance hierarchy.

The [CPU source organization guide](cpus/implementation.md) defines a common
reading order and encoding-table conventions while preserving each processor's
distinct decoding and execution rules.

## Model contracts and example specifications

The [example catalog](README.md#cpu-examples) links to program specifications
and acceptance checks. Each records initial state, instruction behavior, and
expected execution. The [CPU model contracts](README.md#cpu-models) define
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
state stays mutable. Models use CPU-specific step records and retain no execution
history. Outcome unions and optional exception metadata reflect each model's
contract. The 8008 derives PC from its selected internal
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
planned additions. Shared record fields and the runner retain CPU-specific
types; focused examples continue to test execution and inspection conventions.

Checks use small programs with explicit expected behavior.
Existing emulator implementations can help identify cases to examine; their
outputs should be checked against the relevant hardware documentation before
being treated as correctness references.

## Decisions to defer

Worker placement, performance optimizations, cycle-level bus simulation,
complete machine save states, reverse execution, a public plugin API, the
final form of the literate CPU language, and richer device and wiring descriptions
remain open. CPU snapshots, typed instruction definitions, the first executable
chapter, and the current `.machine` language already provide foundations; extend them when concrete examples
justify the next capability.
