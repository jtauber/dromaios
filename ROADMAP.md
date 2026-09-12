# Roadmap

The destination is one pedagogical platform that can replace the existing
emulators and power the microcomputer tutorial through reusable components.

This is a direction of travel, not a schedule. Each stage will be divided into
small changes with time for review, questions, and revision. Finishing a change
is a point to discuss the next slice. Later stages are provisional.

The initial CPU sequence is **8080 → 6502 → 6809**. We will introduce small
examples for all three before settling shared CPU and inspection interfaces.
Implementation order is independent of the tutorial's historical teaching
order. See [CPU scope and early roadmap](docs/cpu-roadmap.md) for the rationale,
eventual targets, and current reference coverage.

## 0. Establish the starting point — current

- Review the purpose, design principles, and proposed repository structure.
- Specify a tiny 8080 program and its expected state after each instruction.
  Loading a number, adding another, and storing the result is the initial
  candidate; the exact program is still to be decided.
- Decide the initial language and minimal development/test setup.
- Sketch CPU–memory interaction, stepping, reset, visible state, and what
  happens when the CPU encounters an unsupported instruction.

**Review point:** We can explain the first example and the responsibilities of
its parts before implementing them.

## 1. Follow a tiny 8080 program

- Introduce RAM and the 8080, implementing instructions incrementally.
- Load a small program and advance it one instruction at a time.
- Expose the state and memory changes needed to explain each step.
- Check instruction behavior and the example's expected result independently
  of the browser UI.
- Add the MIT license alongside the first code.

**Review point:** We can account for what each instruction reads and changes.
The supported instruction subset and execution granularity are documented.

## 2. Test generalizations across three CPUs

- Introduce equivalent small programs on the 6502, then the 6809, in separate
  reviewable changes. Implement only the instruction subsets they need.
- Add focused examples that expose differences in register relationships,
  stack conventions, addressing, and memory or I/O access.
- Compare execution records and inspection needs across all three CPUs.
- Consolidate shared support where the examples justify it. Keep decoding,
  flags, addressing, and timing specific to each CPU where appropriate.

**Review point:** Three small examples run with explicit expected behavior and
documented limits. Proposed generalizations have been exercised against their
architectural differences, beyond simply running the same arithmetic example.

## 3. Make the examples explorable in the browser

- Add a small interface for stepping, resetting, and inspecting state.
- Introduce register, memory, and instruction views that serve the three
  examples while preserving each CPU's distinctions.
- Add controlled running and pausing, separating execution from display updates.
- Turn the examples into short lessons using the same simulation components.

**Review point:** A learner can follow the program and connect the explanation
to actual execution. Inspection does not alter the machine's behavior.

## 4. Prove reuse with another composition

- Put one of the existing CPU models and memory components in another small
  configuration. This tests machine composition as well as CPU conventions.
- Add a simple device and make its connection to the CPU visible.
- Reuse the inspection views where they fit.
- Revisit the interfaces using what the second example teaches us.

**Review point:** Both examples use the same components. Their differences can
be explained through configuration, connections, and any necessary glue code.

## 5. Build the first complete machine incrementally

- Choose a machine and a clear, modest software target.
- Add the required instructions, memory mapping, devices, and timing in small
  steps, with an explanation and appropriate checks for each addition.
- Introduce ROM or program loading and input/output as needed.
- Identify the existing emulator behavior that the new machine can replace.

**Review point:** The target software runs with understood limitations, and
users can inspect the relevant internal activity.

## 6. Broaden the platform

- Add CPU models and variants from the intended scope, testing shared execution
  and inspection conventions against each new case. The order beyond the
  initial three remains open.
- Add machines in an order we choose as the component library develops.
- Grow reusable device models, teaching views, and specialist instruments.
- Bring tutorial examples onto the same components used by complete machines.

**Review point for each addition:** The new case works, existing cases still
work, and shared abstractions remain understandable.

## 7. Replace the existing projects gradually

For each emulator and tutorial section, agree what replacement requires:
software behavior, input/output, inspection features, and learning experience.
Validate those requirements before treating that part of the migration as done.

The migration order will follow what we learn. The end state is a single
Dromaios platform with machine compositions, reusable components, and lessons
that expose how those machines work.
