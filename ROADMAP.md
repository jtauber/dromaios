# Roadmap

The destination is one pedagogical platform that can replace the existing
emulators and power the microcomputer tutorial through reusable components.

This is a direction of travel, not a schedule. Each stage will be divided into
small changes with time for review, questions, and revision. Finishing a change
is a point to discuss the next slice. Later stages are provisional.

## 0. Establish the starting point — current

- Review the purpose, design principles, and proposed repository structure.
- Choose the first CPU and a tiny program that demonstrates a useful concept.
- Decide the initial language and minimal development/test setup.
- Sketch CPU–memory interaction, stepping, reset, and visible state.

**Review point:** We can explain the first example and the responsibilities of
its parts before implementing them.

## 1. Follow a tiny program

- Introduce RAM and the chosen CPU, implementing instructions incrementally.
- Load a small program and advance it one instruction at a time.
- Expose the state and memory changes needed to explain each step.
- Check instruction behavior and the example's expected result independently
  of the browser UI.

**Review point:** We can account for what each instruction reads and changes.
The supported instruction subset and execution granularity are documented.

## 2. Make the example explorable in the browser

- Add a small interface for stepping, resetting, and inspecting state.
- Introduce register, memory, and instruction views as the example needs them.
- Add controlled running and pausing, separating execution from display updates.
- Turn the example into a short lesson using the same simulation components.

**Review point:** A learner can follow the program and connect the explanation
to actual execution. Inspection does not alter the machine's behavior.

## 3. Prove reuse with a second composition

- Put the same CPU and memory components in another small configuration.
- Add a simple device and make its connection to the CPU visible.
- Reuse the inspection views where they fit.
- Revisit the interfaces using what the second example teaches us.

**Review point:** Both examples use the same components. Their differences can
be explained through configuration, connections, and any necessary glue code.

## 4. Build the first complete machine incrementally

- Choose a machine and a clear, modest software target.
- Add the required instructions, memory mapping, devices, and timing in small
  steps, with an explanation and appropriate checks for each addition.
- Introduce ROM or program loading and input/output as needed.
- Identify the existing emulator behavior that the new machine can replace.

**Review point:** The target software runs with understood limitations, and
users can inspect the relevant internal activity.

## 5. Broaden the platform

- Add another CPU architecture and test the shared execution and inspection
  conventions against its differences.
- Add machines in an order we choose as the component library develops.
- Grow reusable device models, teaching views, and specialist instruments.
- Bring tutorial examples onto the same components used by complete machines.

**Review point for each addition:** The new case works, existing cases still
work, and shared abstractions remain understandable.

## 6. Replace the existing projects gradually

For each emulator and tutorial section, agree what replacement requires:
software behavior, input/output, inspection features, and learning experience.
Validate those requirements before treating that part of the migration as done.

The migration order will follow what we learn. The end state is a single
Dromaios platform with machine compositions, reusable components, and lessons
that expose how those machines work.
