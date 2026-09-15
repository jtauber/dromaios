# Pedagogical explorations

This design note describes teaching through small interactive explorations and
a roadmap measured by what a learner can explain and do. The milestones and
examples are provisional, with review of each exploration informing the next.
Learners can follow different paths through the resulting instruments and lessons.

## Purpose

Dromaios can help learners understand values, operations, individual
instructions, and small programs before complete machines are available.
Existing arithmetic operations, CPU snapshots, execution records, and RAM-based
examples provide foundations for this work.

The eventual goal also includes understanding how substantial real software is
constructed, through detailed guides and interactive demonstrations. Studies of
programs such as Ultima IV or Elite should connect whole-program design,
algorithms, and data structures to individual instructions and bits. Running a
program and explaining its implementation are separate deliverables.

These explorations should also remain useful as full emulators develop. A
learner following an instruction in a running machine should be able to open
the same arithmetic or addressing instrument used in an introductory lesson.
This develops the browser and lesson work already described in the
[roadmap](../ROADMAP.md#3-make-the-examples-explorable-in-the-browser).
The [web design plan](web-design.md) describes site navigation, page roles,
and workspace layouts through which learners reach these instruments and
lessons. Its delivery steps coordinate with the learning priorities below.

## Levels of exploration

Each level connects a visible result to the smaller ideas that explain it.
Learners should be able to move between levels as their questions require.

| Level | Possible explorations | Learning questions |
| --- | --- | --- |
| Bits and representation | Binary, hexadecimal, unsigned and signed values, character encodings, packed decimal, widths, truncation, and byte order | How can the same bits mean different values? How are the bytes of a wider value arranged in memory? |
| Operations | Addition, subtraction, masks, shifts, and rotates, with editable inputs | Why are carry and signed overflow different? Where does a shifted-out bit go? |
| Individual instructions | Instruction bytes, operand selection, effective addresses, register and flag effects, and memory accesses | How do these bytes determine an operation and its operands? Where did this address come from? |
| Small programs | Loops, multi-byte arithmetic, buffer copies, and subroutine calls | How does carry connect two additions into a wider sum? How does a return find the next instruction? |
| Software systems | Program architecture, subsystems, algorithms, data structures, and line-by-line analysis connected to execution | How does this visible behavior arise from the program's routines and data? What would change if this part worked differently? |

Representation views should make their interpretation explicit. A byte's bits
do not change when the learner switches between signed and unsigned readings.
Character and packed-decimal views need to identify their encoding and show
when a value has no valid interpretation under that encoding.

## Teaching principles

- **Connect representations.** Relate instruction bytes, memory locations,
  bit patterns, and interpreted values. Selecting an operand should make its
  role and corresponding values visible across the relevant views.
- **Explain causes as well as results.** Show the inputs and rule behind a
  flag result, address calculation, or branch decision. A highlighted change
  is a starting point for explanation.
- **Support prediction and experimentation.** Let learners predict a result,
  execute, change one input, and compare. Boundary cases should be easy to
  explore deliberately.
- **Preserve processor distinctions.** Separate mathematical facts, such as
  a borrow, from the rules a particular CPU uses to update its flags. Shared
  views should make meaningful differences visible.
- **Label explanatory detail accurately.** Unpacking addition into bit
  operations can explain the arithmetic without modeling a processor's
  internal circuitry. Instruction-level records describe the modeled
  execution; they do not establish clock cycles or a complete bus trace.
- **Build execution explanations from captured facts.** Use the instruction
  bytes, before/after state, and accesses recorded for the completed step.
  Do not execute it again or reread current memory to reconstruct its history.
  Previewing a future instruction is a separate activity and requires
  inspection without execution side effects.

The [architecture](architecture.md#model-contracts-and-example-specifications)
defines the observation boundary. The
[6502 reference notes](cpus/6502/reference-notes.md#explanations-and-inspection-preserve-captured-facts-now-add-views-later)
give a concrete example of why inspection must preserve machine behavior.

## Reusable instruments and lessons

An instrument is an interactive view of a particular concept, such as arithmetic
or address calculation. It could be used independently with editable inputs,
within a guided lesson, or alongside an instruction in a running machine.
When examining a recorded step, changing inputs should begin a separate
experiment and leave the recorded event intact.

A lesson supplies the learning question, initial setup, prompts, and any
program or annotations. It can expose only the controls and state needed for
that question, then reveal more detail as the learner progresses. Labels such
as `result` or `buffer` belong with the lesson or instrument that knows their
meaning; the CPU continues to work with addresses and values.

A software guide arranges analyses and lessons around a particular program and
version. It can connect an overview to subsystem chapters, annotated routines,
and experiments, reusing the same instruments at each level. Symbols, data
interpretations, and code annotations belong with the guide or its instruments.

Execution continues to belong to the existing component models. Instruments
present and explain their behavior, and lessons arrange the experience. The
first examples should help us discover useful shared views and descriptions;
specific UI components and interfaces can be chosen as those needs emerge.

## Pedagogical roadmap

Each milestone should produce a useful exploration and a short guided lesson.
The first five can develop alongside CPU support using the relevant implemented
behavior. Device work follows the project roadmap's
[CPU-only checkpoint](../ROADMAP.md#cpu-only-checkpoint).
Software studies in milestone 7 can begin with isolated routines as their
execution requirements become available, then grow into comprehensive guides.

The immediate priority is milestones 1 and 2 together: make one addition
understandable from its bits through a real CPU instruction. This forms the
first major delivery checkpoint and gives later instruments a concrete
foundation. The sequence guides development; comparisons and supporting tools
can develop alongside other milestones as learning needs emerge.

### 1. Understand one calculation completely

Build an eight-bit addition explorer with editable operands, linked binary,
hexadecimal, and decimal views, signed interpretations, carry, and overflow.
Introduce representations as they become relevant to the calculation.

Begin with ordinary addition, unsigned wraparound, and signed overflow. Show
the full mathematical sum alongside the result that fits in eight bits. Let
the learner predict the result, inspect the explanation, change one input,
and compare the experiments.

**Review point:** Given unfamiliar inputs, the learner can predict the stored
result and explain why carry and signed overflow may disagree.

### 2. Connect a calculation to a real instruction

Connect instruction bytes, operands, before/after CPU state, and the arithmetic
explorer. Make the chain visible: the bytes select an instruction, the
instruction obtains its inputs, the operation uses those values, and registers
and flags receive the results. Make incoming carry and arithmetic mode explicit
where applicable.

The 6502 is a candidate for the first instruction because its arithmetic exposes
both carry and signed overflow. Its existing
[load, add, and store example](cpus/6502/examples/arithmetic.md) could provide
the surrounding program. The CPU choice remains open until we specify this
milestone's implementation.

**Review point:** The learner can explain a complete instruction, including
what it preserves, and distinguish the mathematical operation from the CPU's
flag rules. Together with milestone 1, this provides a coherent learning
experience spanning bits through actual execution.

### 3. Make memory and addressing understandable

Build connected memory, instruction, and address-calculation views. Use a tiny
array or buffer to give the addresses meaning, and introduce questions such as:

- Is this byte the value itself, or part of an address?
- Which bytes form a wider value, and in what order?
- How does an index select an element?
- How does a pointer lead to another location?

Use memory labels and links between views to connect instruction operands,
address calculations, and the locations accessed.

**Review point:** Before executing an unfamiliar load or store, the learner
can identify the relevant locations and predict what will be read or written.

### 4. Explain how instructions become programs

Build short lessons supported by execution history, relevant state changes,
and views of loops and stacks. Start with three complementary programs:

| Program | Central idea |
| --- | --- |
| Add a value wider than one register | Information passes between instructions through carry. |
| Sum or copy a small buffer | Addresses, state changes, and branches produce repetition. |
| Call a subroutine, including a nested call | Saved return information connects a call to its continuation. |

Extend explanation from what changes in a single step to what stays true
across a sequence of steps. Keep the surrounding program available when
opening an instrument to examine one operation.

**Review point:** The learner can explain the program's result, predict the
effect of a small modification, and locate a deliberately introduced mistake.

### 5. Compare architectures through familiar problems

Build paired explorations of the same concept on different CPUs. Introduce
comparisons individually: arithmetic flags, register relationships, addressing,
stack conventions, and instruction encodings. Compare meaningful points in
the computation, since equivalent programs need not take the same number of
instructions.

This work can begin alongside earlier milestones once a concept is understood
on one CPU. Use the comparisons to check that shared instruments preserve the
hardware distinctions that matter.

**Review point:** The learner can distinguish a general computing idea from
one processor's particular implementation.

### 6. Follow interactions beyond the CPU

Build small device explorations as the project's device work becomes available,
then carry the instruments into complete machines. A modest input or output
device can introduce the relationship between a CPU access and an external
effect. Later lessons can cover polling, interrupts, and timing as their models
become available.

Device integration follows the CPU-only checkpoint linked above. A small device
exploration can still precede a complete historical machine, and each lesson
must make its model's supported behavior and granularity clear.

**Review point:** The learner can follow a causal chain from a program
instruction, through a device, to an observable result.

### 7. Understand substantial software through guided execution

Produce detailed analyses of particular programs, such as Ultima IV or Elite,
combining:

- **Program overviews:** explain how major subsystems fit together.
- **Algorithm and data-structure guides:** explain what the program represents
  and how it operates on that representation.
- **Line-by-line commentary:** connect source or annotated disassembly to
  explanations of individual instructions, routine behavior, and design choices.
- **Connected execution:** let the reader step through the discussed routine
  while seeing relevant variables, memory, and visible effects.
- **Interactive demonstrations:** isolate an algorithm, change its inputs, and
  connect the demonstration back to the original implementation.

Readers should be able to move in both directions through:

**Visible behavior → subsystem → routine → instruction → arithmetic or hardware
operation.**

The arithmetic, addressing, and other instruments introduced earlier become
explanatory tools embedded in these larger guides. A reader should retain the
surrounding software context when opening an instrument or returning to the
program's execution.

Each guide should identify the program's platform and version, and the source
or disassembly used. Code locations, symbols, and explanations must refer to
that version. Demonstrations should make clear whether they execute an original
routine or illustrate its algorithm with a separate conceptual model. Both
should explain how the demonstrated behavior relates to the original program.

Develop these studies incrementally. A selected routine can be explored with
explicit inputs and a small execution environment before the entire program
runs. Specify its initial state, required memory and services, and expected
results. Those studies can later become chapters in a comprehensive guide,
connected to the complete emulator. Support for a full program and completion
of its explanatory guide should each be reviewed on their own criteria.

**Review point:** The learner can explain how a substantial subsystem works
and predict the effect of a change, connecting the written analysis to code
and observed execution.

## Developing and reviewing each milestone

Develop each milestone through small, reviewable explorations. A substantial
software guide can grow one routine or subsystem study at a time. Each
exploration should have:

- One clear learning question.
- One working exploration and a short guided path through it.
- A new case the learner can tackle without the explanation giving away the
  answer.
- A review of both behavioral correctness and how understandable the
  experience is.

Try early versions with learners before expanding them. Use those reviews to
decide how much detail should be visible and whether an instrument works both
independently and within a lesson.

Grow supporting tools as lessons need them: masks and shifts for bit
manipulation, width and byte-order views for memory, and stack views for calls.
Gate diagrams or full-adder explanations could form an optional deeper path,
explicitly identified as conceptual models.

Each chosen program's initial state, expected behavior, and acceptance checks
belong in an [example specification](README.md#cpu-examples). CPU state and
execution contracts remain in the relevant model document. Expected arithmetic
and instruction behavior must still be checked independently of the code that
produces the explanation.

## Open questions

- How should free exploration and guided progression fit together? When should
  prediction be an invitation, and when should it be part of a lesson step?
- Which representations and details should appear initially, and which should
  learners reveal when they need them?
- How much arithmetic decomposition helps understanding? When do bit diagrams
  or animation add something beyond a clear expression and before/after values?
- When do comparisons between CPUs clarify a concept, and when do they add too
  many unfamiliar details at once?
- How should a learner move between an isolated experiment, a recorded
  instruction, and its surrounding program while keeping that context clear?
- Which routine or subsystem should begin the first substantial software guide,
  and which platform and version should anchor its analysis?

These questions should guide review of the first exploration and remain open
to revision as we observe how it teaches.
