# Pedagogical explorations

This design note describes a direction for teaching through small interactive
explorations. The examples are possibilities to develop and review, rather than
a feature checklist or a fixed lesson sequence. The first candidate below gives
us a concrete place to begin learning what works.

## Purpose

Dromaios can help learners understand values, operations, individual
instructions, and small programs before complete machines are available.
Existing arithmetic operations, CPU snapshots, execution records, and RAM-based
examples provide foundations for this work.

These explorations should also remain useful as full emulators develop. A
learner following an instruction in a running machine should be able to open
the same arithmetic or addressing instrument used in an introductory lesson.
This develops the browser and lesson work already described in the
[roadmap](../ROADMAP.md#3-make-the-examples-explorable-in-the-browser).

## Levels of exploration

Each level connects a visible result to the smaller ideas that explain it.
Learners should be able to move between levels as their questions require.

| Level | Possible explorations | Learning questions |
| --- | --- | --- |
| Bits and representation | Binary, hexadecimal, unsigned and signed values, character encodings, packed decimal, widths, truncation, and byte order | How can the same bits mean different values? How are the bytes of a wider value arranged in memory? |
| Operations | Addition, subtraction, masks, shifts, and rotates, with editable inputs | Why are carry and signed overflow different? Where does a shifted-out bit go? |
| Individual instructions | Instruction bytes, operand selection, effective addresses, register and flag effects, and memory accesses | How do these bytes determine an operation and its operands? Where did this address come from? |
| Small programs | Loops, multi-byte arithmetic, buffer copies, and subroutine calls | How does carry connect two additions into a wider sum? How does a return find the next instruction? |

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

Execution continues to belong to the existing component models. Instruments
present and explain their behavior, and lessons arrange the experience. The
first examples should help us discover useful shared views and descriptions;
specific UI components and interfaces can be chosen as those needs emerge.

## First candidate: arithmetic to instruction

Start with an eight-bit addition explorer that can connect to an instruction
on a selected CPU. A possible learner experience is:

1. Choose two eight-bit values and view their bits alongside unsigned and
   signed interpretations.
2. Predict the stored eight-bit result, carry, and signed overflow.
3. Inspect the result and the arithmetic that explains it. Compare the full
   mathematical sum with the value that fits in eight bits.
4. Change one input to cross a boundary, such as unsigned wraparound or signed
   overflow, and compare the two experiments.
5. Connect the operation to an instruction on the selected CPU. Make its
   incoming carry and arithmetic mode explicit where applicable, then inspect
   the actual instruction bytes, operands, and register and flag effects.
6. Follow a short program that adds the low and high bytes of a wider value,
   showing how carry passes between the two additions.

The initial aim is to learn whether the connections between representations,
arithmetic, and execution are understandable, and how much detail should be
visible at each point. This also gives us a small case for testing whether one
instrument works both independently and within a lesson.

The chosen CPU and exact program can be settled when specifying the first
implementation. Its initial state, expected behavior, and acceptance checks
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

These questions should guide review of the first exploration and remain open
to revision as we observe how it teaches.
