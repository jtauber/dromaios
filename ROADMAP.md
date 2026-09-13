# Roadmap

The destination is one pedagogical platform that can replace the existing
emulators and power the microcomputer tutorial through reusable components.

This is a direction of travel, not a schedule. Each stage will be divided into
small changes with time for review, questions, and revision. Finishing a change
is a point to discuss the next slice. Later stages are provisional.
Every commit requires maintainer review and an explicit go-ahead.

The introductory examples were built in the order **8080 → 6502 → 6809**.
The current priorities are shared execution support, substantial opcode
expansion, and the **Z80 as the fourth CPU**. Browser work can proceed alongside
CPU development; the stages below are not strict prerequisites for one another.
Implementation order is independent of the tutorial's historical teaching
order. See [CPU scope](docs/cpus/scope.md) for the rationale,
eventual targets, and current reference coverage.

## 0. Establish the starting point — complete

- Review the purpose, design principles, and proposed repository structure.
- Review the [8080 example specification](docs/cpus/8080/examples/arithmetic.md): an eight-byte
  8080 program with its complete expected state changes and access records.
- Choose the minimal development/test setup for TypeScript, the selected
  implementation language.
- Review its CPU–memory interaction, stepping, reset versus lesson restart,
  visible state, and unsupported-instruction behavior.

**Review point:** We can explain the first example and the responsibilities of
its parts before implementing them.

The 8080 example specification has been reviewed. Development uses TypeScript
compiled to ES modules, npm, and Node.js 24's built-in test runner.

## 1. Follow a tiny 8080 program — complete

- Introduce RAM and the 8080, implementing instructions incrementally.
- Load a small program and advance it one instruction at a time.
- Expose the state and memory changes needed to explain each step.
- Check instruction behavior and the example's expected result independently
  of the browser UI.
- Add the MIT license alongside the first code.

**Review point:** We can account for what each instruction reads and changes.
The supported instruction subset and execution granularity are documented.

Current support is tracked in [CPU implementation coverage](docs/cpus/coverage.md).
Acceptance checks are defined in the [8080 example specification](docs/cpus/8080/examples/arithmetic.md).

## 2. Expand CPU support and test generalizations — current

- Use the [shared CPU runner](docs/runtime/runner.md), now exercised against
  the existing examples on all three CPUs. It has an explicit step budget,
  stops before a caller completion address or after a halt or unsupported
  attempt, and returns captured records and the reason for stopping while
  preserving CPU-specific types.
- Expand opcode support in reviewable instruction-family batches: control flow,
  loads and transfers, arithmetic and logic, remaining stack operations, and I/O.
  Use independent expected behavior and exhaustive checks where practical.
- Make a complete documented 8080 instruction set the next substantial CPU
  milestone. Track timing and interrupt delivery as separate milestones.
- Continue focused comparisons with the 6502 and 6809, expanding their support
  as we exercise register relationships, stacks, addressing, and memory or I/O
  access.
- Compare execution records and inspection needs across all three CPUs.
- Consolidate shared support where the examples justify it. Keep decoding,
  flags, addressing, and timing specific to each CPU where appropriate.
- Introduce the Z80 once the 8080 instruction set is substantially established.
  Use it to test how related processors should share implementation. Its start
  does not depend on completing the other CPUs or building a complete machine.

**Review points:** The runner handles each CPU's stopping behavior correctly.
Instruction-family additions have explicit expected behavior and documented
limits, with progress toward complete documented 8080 opcode coverage.
Generalizations are exercised against the initial three architectures and,
when introduced, the Z80.

The introductory [8080](docs/cpus/8080/examples/arithmetic.md), [6502](docs/cpus/6502/examples/arithmetic.md),
and [6809](docs/cpus/6809/examples/arithmetic.md) examples are complete. Their specifications
define behavior and acceptance checks; the [coverage tracker](docs/cpus/coverage.md)
records current support. Focused examples are extending this comparison;
the [example catalog](docs/README.md#cpu-examples) lists the completed programs.
Further examples and comparison of the three models continue within this stage.

## 3. Make the examples explorable in the browser

This work can begin with the existing examples and shared runner, alongside
opcode expansion and the introduction of the Z80.

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

- Add further CPU models and variants from the intended scope, testing shared
  execution and inspection conventions against each new case. The order after
  the Z80 remains open.
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
