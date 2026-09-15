# Roadmap

The destination is one pedagogical platform that can replace the existing
emulators and power the microcomputer tutorial through reusable components.

This is a direction of travel, not a schedule. Each stage will be divided into
small changes with time for review, questions, and revision. Finishing a change
is a point to discuss the next slice. Later stages are provisional.
Every commit requires maintainer review and an explicit go-ahead.

The introductory examples were built in the order **8080 → 6502 → 6809**.
The current priority is a **CPU-only capability checkpoint across eight CPUs**,
expanding existing cores while introducing the remaining targets. Interrupts
and I/O wait until all eight reach that checkpoint. Browser work can proceed
alongside CPU development; the stages below otherwise allow overlapping work.
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
  the implemented CPU examples. It has an explicit step budget,
  stops before a caller completion address or after a halt or unsupported
  attempt, and returns captured records and the reason for stopping while
  preserving CPU-specific types.
- Expand opcode support in reviewable instruction-family batches: control flow,
  loads and transfers, arithmetic and logic, and stack operations.
  Use independent expected behavior and exhaustive checks where practical.
- Continue focused comparisons with the 6502 and 6809, expanding their support
  as we exercise register relationships, stacks, addressing, and memory access.
- Compare execution records and inspection needs across the current CPUs.
- Consolidate shared support where the examples justify it. Keep decoding,
  flags, addressing, and timing specific to each CPU where appropriate.
- Extend the initial Z80 slice, now using the same RAM setup and runner with
  its own state and flags. Paired 8080/Z80 programs test common encodings and
  different semantics. Use further related instruction families to judge which
  implementation details should be shared.
- Extend the initial 8008 slice, exercising its native encodings, 14-bit
  addresses, and internal address stack.
- Extend the initial 6800 slice with further addressing, control-flow, and
  stack operations while checking its distinctions from the 6809.
- Extend the initial 8088 slice, exercising its word and byte register views,
  segmented addresses, and instruction forms.
- Extend the initial 68000 slice, exercising long registers, word encodings,
  effective addresses, and separate user and supervisor stacks.

**Review points:** The runner handles each CPU's stopping behavior correctly.
Instruction-family additions have explicit expected behavior and documented
limits. Each of the eight CPUs reaches the capability checkpoint below;
generalizations remain open to revision as their instruction families expand.

### CPU-only checkpoint

The initial eight targets are **Intel 8008, Intel 8080, Motorola 6800, MOS 6502,
Zilog Z80, Motorola 6809, Intel 8088, and Motorola 68000**. Each should have:

- Explicit state, detached snapshots, instruction stepping, and a defined reset
  contract.
- Representative loads and stores, arithmetic, and logic.
- Branches, calls and returns, and the CPU's own stack conventions.
- A useful combined CPU-and-RAM program with independently checked execution
  records and bounded running through the shared runner.

These are capability criteria. They do not require equal opcode percentages or
nearly complete instruction sets. Coverage continues to use the full documented
opcode totals, including instructions deferred from this checkpoint; timing and
interrupt delivery remain separate measures.

Defer interrupt delivery, interrupt-specific control instructions (including
`DI`/`EI`), port I/O, and memory-mapped devices across all eight until the
checkpoint is met. Existing architectural flags and ordinary memory and
status-register operations remain in scope. The 8080 can pause at **240/244
forms (98.4%)**, with `DI`, `EI`, `IN`, and `OUT` deferred.

All eight now have initial slices. Expand them in reviewable instruction-family
batches, and revisit interrupts and I/O once all eight meet the checkpoint.

The introductory [8080](docs/cpus/8080/examples/arithmetic.md), [6502](docs/cpus/6502/examples/arithmetic.md),
[6809](docs/cpus/6809/examples/arithmetic.md), [Z80](docs/cpus/z80/examples/arithmetic.md), [8008](docs/cpus/8008/examples/arithmetic.md),
[6800](docs/cpus/6800/examples/arithmetic.md), [8088](docs/cpus/8088/examples/arithmetic.md),
and [68000](docs/cpus/68000/examples/arithmetic.md) examples are complete. Their specifications
define behavior and acceptance checks; the [coverage tracker](docs/cpus/coverage.md)
records current support. Focused examples are extending this comparison;
the [example catalog](docs/README.md#cpu-examples) lists the completed programs.
Further examples and comparison of the models continue within this stage.

## 3. Make the examples explorable in the browser

This work can begin with the existing examples and shared runner, alongside
opcode expansion and the introduction of further CPUs.

The [pedagogical roadmap](docs/pedagogy.md#pedagogical-roadmap) defines the
learning milestones and review points, beginning with an arithmetic explorer
connected to a real CPU instruction and extending into later device work.

- Add a small interface for stepping, resetting, and inspecting state.
- Introduce register, memory, and instruction views that serve the
  examples while preserving each CPU's distinctions.
- Add controlled running and pausing, separating execution from display updates.
- Turn the examples into short lessons using the same simulation components.

**Review point:** A learner can follow the program and connect the explanation
to actual execution. Inspection does not alter the machine's behavior.

## 4. Prove reuse with another composition

Device integration follows the [CPU-only checkpoint](#cpu-only-checkpoint).

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

- Add further CPU models and variants from the [intended scope](docs/cpus/scope.md#intended-eventual-scope),
  beyond the initial eight. Test shared execution and inspection conventions
  against each new case; their implementation order remains open.
- Add machines in an order we choose as the component library develops,
  using the selected software targets in [CPU scope](docs/cpus/scope.md#intended-eventual-scope)
  to guide each machine's milestones.
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
