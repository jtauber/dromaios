# Web design and site structure

This is a working proposal for the eventual website, its shared exploration
workspace, and the steps toward it. Page names, layouts, and visual choices
remain open to review through concrete examples. The sitemap describes an
eventual destination; sections become visible as useful content is available.

The [project roadmap](../ROADMAP.md) owns the overall development stages and
hardware dependencies. The [pedagogical plan](pedagogy.md) owns teaching
principles and learning milestones. This note describes how people find and
use those experiences on the website.

## Organizing idea

Build a shared exploration workspace with several ways into it. Lessons,
experiments, and complete machines use the same underlying simulation models
and inspection tools. A learner can start with a guided explanation, open a
fuller view of the example, and follow links to the hardware reference.

The main navigation is **Learn · Explore · Reference · About**.

| Area | Purpose |
| --- | --- |
| Learn | Guided explanations and interactive activities, organized into learning paths and topics. |
| Explore | CPUs, program examples, complete machines, and architecture comparisons that people can investigate directly. |
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

Lessons, examples, and reference entries should have stable URLs. Panel
selection and other workspace settings can remain within those pages; exact
route names and state encoding remain to be chosen. Moving from a lesson into
fuller exploration should retain the current experiment. Sharing an edited
setup is a later capability, beyond linking to an example's initial state.

Website explanations should stay grounded in the existing model contracts and
example specifications. CPU state, execution records, and reset contracts
remain in the CPU model documents; program behavior and acceptance criteria
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
should be evaluated in the first page sketches. The framework and routing
implementation remain open.

## Steps toward the site

These steps describe delivery of the website. They can overlap as useful
experiences emerge. In particular, the pedagogical plan prioritizes
[one calculation connected to a real CPU instruction](pedagogy.md#pedagogical-roadmap)
as the first major learning delivery. The counted loop below is a concrete
workspace design exercise and a candidate for the first complete program
workspace; it does not replace that teaching priority.

### 1. Establish the page designs

Sketch three representative pages:

1. A CPU overview: what it is, its distinctive features, and what to try.
2. An example workspace: program, registers, memory, controls, and explanation.
3. A lesson: readable narrative with an embedded workspace.

Use the existing [6502 counted loop](cpus/6502/examples/counted-loop.md) to
exercise the workspace layout. It tests whether someone can see why the
branch stops when X reaches zero even though A still holds a nonzero sum.
Then try the layout with the 8080 and 6809 before settling shared conventions.

**Review point:** The layout makes a complete instruction step understandable,
and the three CPUs expose which arrangements can be shared.

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

**Review point:** These capabilities reuse the established examples and views
coherently, helping learners transfer an idea to a different context.

## Next design decisions

- What should a new visitor do in their first minute on the site?
- Which controls, representations, and explanations are initially visible in
  a lesson and in free exploration?
- How should the workspace retain context when moving between a lesson, an
  example, an instrument, and reference material?

The example workspace is the first substantial design decision because it
informs lessons, CPU pages, comparisons, and machine inspectors. Review the
concrete page sketches before expanding the design system.
