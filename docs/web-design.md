# Web design and site structure

This is a working proposal for the eventual website, its shared exploration
workspace, and the steps toward it. Page names, layouts, and visual choices
remain open to review through concrete examples. The sitemap describes an
eventual destination; sections become visible as useful content is available.

The [project roadmap](../ROADMAP.md) owns the overall development stages and
hardware dependencies. The [pedagogical plan](pedagogy.md) owns teaching
principles and learning milestones. This note describes how people find and
use those experiences on the website.

## Current reading site

[microcomputer.world](../site/README.md) is the first delivered website slice:
a home page and all eight processor chapters, generated directly from their
executable Markdown sources. Ryland supplies page generation; Sauvignon draws
architecture diagrams authored in the chapters and storage maps derived from
the CPU compiler. Pages include section navigation, highlighted definitions,
and links back to repository material. They require no browser scripting.

This establishes the reading layout before interactive execution. The sitemap
and exploration workspace below remain the intended expansion, rather than
additional navigation entries without usable content.

## Organizing idea

Build a shared exploration workspace with several ways into it. Lessons,
experiments, and complete machines use the same underlying simulation models
and inspection tools. A learner can start with a guided explanation, open a
fuller view of the example, and follow links to the hardware reference.

The main navigation is **Learn · Explore · Reference · About**.

| Area | Purpose |
| --- | --- |
| Learn | Guided explanations and interactive activities, organized into learning paths, topics, and detailed software studies. |
| Explore | CPUs, program examples, complete machines, software, and architecture comparisons that people can investigate directly. |
| Reference | Definitions, hardware descriptions, instruction behavior, and the model's implemented behavior and limitations. |
| About | The project's purpose, background, development approach, roadmap, and source. |

The homepage could offer a small working example immediately, alongside clear
entry points into learning and exploration. What a new visitor should do in
their first minute remains an important design question.

## Eventual sitemap

```text
Home
│
├── Learn
│   ├── Start here
│   ├── Guided tutorial
│   │   └── Chapters linking lessons into a sequence
│   ├── Topics
│   │   ├── Numbers, bytes, and memory
│   │   ├── Registers and instructions
│   │   ├── Addressing
│   │   ├── Arithmetic and flags
│   │   ├── Branches, loops, and stacks
│   │   ├── Devices and interrupts
│   │   └── How complete computers fit together
│   ├── Software studies
│   │   └── Guided paths into software chapters
│   └── Individual interactive lessons
│
├── Explore
│   ├── CPUs
│   │   └── [CPU]
│   │       ├── Overview and distinctive features
│   │       ├── Examples
│   │       │   └── [Example] → interactive workspace
│   │       └── Open experiment workspace
│   ├── Machines
│   │   └── [Machine]
│   │       ├── Overview
│   │       ├── Run and inspect
│   │       └── Software and demonstrations
│   ├── Software
│   │   └── [Title and platform/version]
│   │       ├── Overview and how to run it
│   │       ├── Program architecture
│   │       ├── Guided chapters and subsystem analyses
│   │       ├── Annotated source or disassembly
│   │       ├── Algorithms and interactive demonstrations
│   │       └── Data structures, file formats, and memory maps
│   └── Comparisons
│       └── The same concept across different architectures
│
├── Reference
│   ├── Glossary
│   ├── CPUs
│   │   └── [CPU]
│   │       ├── Registers and flags
│   │       ├── Addressing and instruction reference
│   │       └── Implemented behavior and limitations
│   ├── Devices
│   │   └── [Device] → behavior, registers, and connections
│   └── Machines
│       └── [Machine] → architecture, memory map, and devices
│
└── About
    ├── Purpose and background
    ├── Project status and roadmap
    └── Development, contribution, and source
```

CPU and machine entries follow the [intended hardware scope](cpus/scope.md#intended-eventual-scope).
Their inclusion in this hierarchy does not establish implementation readiness.
Current support continues to be tracked in [CPU coverage](cpus/coverage.md).

## Page roles and connections

- A **lesson** explains a concept and guides an activity. Tutorial chapters and
  topic pages arrange and link lessons into different paths.
- A **software guide** connects a particular program version's architecture,
  subsystem analyses, and line-by-line commentary to interactive demonstrations
  and execution. Its chapters arrange lessons, annotated code, and instruments
  around that software, following the
  [pedagogical roadmap](pedagogy.md#7-understand-substantial-software-through-guided-execution).
- An **example** supplies a particular program and starting state, with its
  behavior and acceptance checks defined in the relevant example specification.
- A **workspace** supplies execution controls and inspection. Lessons and
  example pages arrange these views for their purpose.
- An **instrument** explains a particular operation or concept. It can appear
  within a lesson or alongside a recorded instruction, as described in the
  [pedagogical plan](pedagogy.md#reusable-instruments-and-lessons).
- A **reference page** explains hardware behavior and the model's limits.
  CPU and machine overview pages introduce what is interesting and what to try,
  with links to that detailed reference.

For example, a visitor could follow:

**Learn: loops → 6502 counted-loop example → 6502 branch reference → compare
loops on the 8080.**

A lesson about stacks could likewise open a CPU example, and a register in
that example could link to its explanation. The same example can participate
in several learning paths without acquiring separately maintained versions.

Machine software entries should link to relevant guides. A reader can follow
a visible program behavior into a subsystem chapter, an annotated routine,
and a lower-level instrument, then return with the program context intact.
The guide should keep its selected version, code locations, inspected data,
and execution aligned. Routine studies can be available before a complete
machine workspace supports the whole program.

Software is a peer of CPUs and Machines under Explore. Each entry identifies
a title, platform, and version, connecting its guide, code, demonstrations, and
reference material. Learn curates paths through those chapters, and machine
pages link to the same canonical software entries. This keeps one study
available from several starting points without duplicating its content.

Lessons, guide chapters, examples, and reference entries should have stable
URLs. Panel selection and other workspace settings can remain within those
pages; exact route names and state encoding remain to be chosen. Moving from
a lesson into fuller exploration should retain the current experiment.
Sharing an edited setup is a later capability, beyond linking to an example's
initial state.

Website explanations should stay grounded in the existing model contracts and
example specifications. CPU state, execution records, and reset contracts
remain in the executable CPU chapters; program behavior and acceptance criteria
remain in the example specifications. The site should expose that knowledge
without introducing independent support or progress lists.

## The exploration workspace

The central interaction is **take one step and understand what changed**.
Start with four parts:

| Part | Contents |
| --- | --- |
| Controls | Example selection, Step, Run/Pause, and Restart example. |
| Program | Addresses, instruction bytes, assembly, and short annotations. |
| State | Registers, flags, and relevant memory. |
| Explanation | What the last instruction did, why it matters, and the inputs or rules that explain the result. |

Highlight changed values, connect memory accesses to their addresses, and
clearly distinguish the instruction just executed from the next instruction.
Use captured execution facts for the completed step, following the
[observation boundary](architecture.md#model-contracts-and-example-specifications)
and [teaching principles](pedagogy.md#teaching-principles).

Restart example restores the example's original setup. If CPU reset is also
exposed, it needs a separate, clearly explained control that follows that CPU's
reset contract. Execution status should distinguish pausing, example completion,
CPU halt, and unsupported instructions. Explain the model's execution
granularity where it affects the interpretation of a view.

A lesson can give explanation more space and reveal inspectors progressively.
Free exploration can give program and state more space. Later, a complete
machine's display can occupy the main area, with inspectors alongside it.
These are arrangements of shared views; they should preserve hardware-specific
register relationships, stacks, addressing, and device behavior.

## Detailed software guides

An eventual goal is sustained analysis of substantial software such as
Ultima IV or Elite, including line-by-line explanation alongside interactive
demonstrations. The [software learning milestone](pedagogy.md#7-understand-substantial-software-through-guided-execution)
defines the learning goals and the relationship between original code and
conceptual demonstrations. The website should support four connected levels:

| Level | Guide content |
| --- | --- |
| Whole program | How major systems fit together and produce the visible experience. |
| Subsystem or algorithm | How one behavior works and which data structures support it. |
| Routine | Inputs, outputs, assumptions, and relationships to other routines. |
| Line by line | What each instruction does, linked to registers, memory, and visible results. |

A chapter could introduce a rendering routine, show its annotated instructions,
and offer a prepared experiment where the reader changes inputs and follows
execution. An isolated demonstration could introduce the algorithm before the
reader examines it inside the complete program. Each actual study will select
its title, platform, version, and source or disassembly before making claims
about particular routines.

### Reading and interaction

- Support long chapters with persistent chapter and section navigation, with
  interactive views alongside the text. Readers should be able to resume their
  reading position after investigating a detail.
- Link explanations, named routines, code locations, and execution. Selecting
  a passage or routine should expose the corresponding code and relevant state.
  Provide an explicit action to load or restart a prepared execution scenario.
- Let the reader step through a discussed routine and connect changes to the
  explanation. Show which instruction just executed and which will execute next.
- Add software inspectors for meaningful structures such as maps, objects, and
  variables, with a way to inspect their underlying memory representation.
- Keep the selected platform/version visible and bind annotations, symbols,
  addresses, data interpretations, and prepared scenarios to that version.
- Identify whether a demonstration executes original instructions or uses a
  conceptual model. Explain how its inputs and results correspond to the
  original implementation, including any simplifications.
- Retain the chapter, selected code location, and experiment context when
  opening an arithmetic or addressing instrument or consulting reference
  material. Inspecting a recorded event should preserve its captured facts.

These requirements should inform the first layout sketches. A guide can grow
one routine or subsystem at a time, with execution scenarios introduced when
the required CPU, memory, and device behavior is supported.

## Visual direction

The initial direction is a **quiet, precise technical notebook**:

- Readable prose and diagrams, with monospace for instructions and values.
- Neutral surfaces, restrained borders, and consistent colour for selection
  and activity. Visible values and labels should also communicate changes.
- Stable register positions so that stepping is easy to follow.
- Hardware-specific arrangements that make register pairs, overlapping
  registers, and stack conventions apparent.
- Enough personality in typography and small illustrations to make the site
  inviting.

Concrete typography, colours, panel layouts, and behavior on smaller screens
should be evaluated in the first page sketches. The static reading site uses
Ryland and stable processor paths. The interactive workspace implementation
remains open.

## Steps toward the site

These steps describe delivery of the website. They can overlap as useful
experiences emerge. In particular, the pedagogical plan prioritizes
[one calculation connected to a real CPU instruction](pedagogy.md#pedagogical-roadmap)
as the first major learning delivery. The counted loop below is a concrete
workspace design exercise and a candidate for the first complete program
workspace; it does not replace that teaching priority.

### 1. Establish the page designs

Sketch four representative pages:

1. A CPU overview: what it is, its distinctive features, and what to try.
2. An example workspace: program, registers, memory, controls, and explanation.
3. A lesson: readable narrative with an embedded workspace.
4. A substantial software-analysis chapter: sustained prose, chapter
   navigation, annotated code, and a connected interactive demonstration.

Use the addition explorer connected to a real instruction for the introductory
lesson sketch. The existing 6502 load-add-store example is a candidate, as
described in the pedagogical plan. Show the transition from guided reading to
the expanded workspace while keeping the current experiment.

Use the existing [6502 counted loop](cpus/6502/examples/counted-loop.md) to
exercise the workspace layout. It tests whether someone can see why the
branch stops when X reaches zero even though A still holds a nonzero sum.
Then try the layout with the 8080 and 6809 before settling shared conventions.

For the software chapter, choose one routine from a specific version of
Ultima IV or Elite and establish the source or disassembly reference before
writing its detailed analysis. The sketch should exercise the path from prose
to annotated code to a prepared demonstration and back to reading. It can
describe planned interactions before full-program execution is available.

**Review point:** The layout makes a complete instruction step understandable,
the three CPUs expose which arrangements can be shared, and the software
chapter keeps reading and execution understandable together. Review a small
set of linked wireframes, a proposed visual style, and a short interaction
specification before implementing the first browser experience.

### 2. Make one example usable in the browser

Build a small homepage, a CPU page, and a working example workspace. Coordinate
the first implementation with the addition explorer and instruction lesson
above, so the workspace and its explanatory instruments develop together.

Include stepping, controlled running and pausing, restarting the example,
visible state changes, and clear stopping messages. Establish the basic
typography, spacing, colours, and navigation in this slice.

**Review point:** Someone can open the page and explain how the program reaches
its result, connecting a real instruction to the calculation it performs.

### 3. Build a browsable CPU collection

Add the other CPUs and their existing examples. Give examples concise
descriptions and concept labels such as loops, stack, or addressing. Grow
shared inspection views while preserving hardware distinctions, and add the
reference material needed to explain what people are seeing.

**Review point:** Navigation and interaction conventions work across all eight
initial CPUs. This browser checkpoint is separate from the roadmap's CPU-only
capability checkpoint.

### 4. Build the first connected learning path

Turn a small selection of examples into a sequence, such as **load a value →
perform arithmetic → store a result → repeat with a loop**. Add explanations,
predictions, and small experiments. Let readers move from a guided lesson to
fuller exploration while retaining their current experiment. Learning paths
can develop alongside the CPU collection.

**Review point:** A newcomer can complete a short sequence without needing to
understand the whole interface upfront.

### 5. Extend exploration to devices and complete machines

After the project roadmap's [CPU-only checkpoint](../ROADMAP.md#cpu-only-checkpoint),
introduce a small composition with a device, then one complete machine with a
modest software target. Add displays, input controls, memory maps, and device
inspectors as the corresponding simulation capabilities arrive.

**Review point:** Someone can connect an observable machine behavior to the
CPU, memory, and device activity behind it.

### 6. Add comparison and richer experimentation

Expand architecture comparisons, editable experiments, shareable setups, and
specialist inspectors as the individual experiences mature. Useful individual
comparisons and editable instruments can develop earlier with the relevant
lessons, following the pedagogical plan. Expand the tutorial and machine
collection incrementally.

Add the Software collection, guide pages, and instruments that connect program
explanations, annotated code, and execution as those studies develop. Link
guides from Learn and the relevant machine pages. Reuse the lesson and workspace
views for individual routine studies, then connect chapters to complete program
execution when supported.

**Review point:** These capabilities reuse the established examples and views
coherently, helping learners transfer an idea to a different context.

## Next design decisions

- What should a new visitor do in their first minute on the site?
- Which controls, representations, and explanations are initially visible in
  a lesson and in free exploration?
- How should the workspace retain context when moving between a lesson, an
  example, an instrument, and reference material?
- Which title, platform/version, and routine should anchor the first software
  chapter sketch, and how should long-form reading and execution share space?

The example workspace is the first substantial design decision because it
informs lessons, CPU pages, comparisons, machine inspectors, and software
guides. Review it alongside an introductory lesson and a substantial software
chapter before expanding the design system.
