# Roadmap

The destination is one pedagogical platform that can replace the existing
emulators and power the microcomputer tutorial through reusable components.

This is a direction of travel, not a schedule. Each stage will be divided into
small changes with time for review, questions, and revision. Finishing a change
is a point to discuss the next slice. Later stages are provisional.
Every commit requires maintainer review and an explicit go-ahead.

The introductory examples were built in the order **8080 → 6502 → 6809**.
All eight initial targets now have **complete documented opcode coverage** and
use shared instruction definitions that generate execution and explanations.
The [capability audit](docs/cpus/completion.md#cpu-only-checkpoint-review) records
the earlier CPU-only checkpoint; [CPU implementation coverage](docs/cpus/coverage.md)
tracks current support, source footprint, and remaining fidelity limits.

Current CPU work tests literate authoring on top of those definitions and shared code.
Reusable memory and byte-I/O compositions also work in simulation; the browser
interface and complete historical machines remain ahead. The stages overlap:
browser work can build on these foundations while CPU and component work continues.
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

[Editor tooling](editors/zed/README.md) has its own build and CI checks, allowing
language support to develop alongside the machine format and eventual CPU DSL.

## 1. Follow a tiny 8080 program — complete

- Introduce RAM and the 8080, implementing instructions incrementally.
- Load a small program and advance it one instruction at a time.
- Expose the state and memory changes needed to explain each step.
- Check instruction behavior and the example's expected result independently
  of the browser UI.
- Add the MIT license alongside the first code.

**Review point:** We can account for what each instruction reads and changes.
The initial instruction subset and execution granularity are documented.

Current support is tracked in [CPU implementation coverage](docs/cpus/coverage.md).
Acceptance checks are defined in the [8080 example specification](docs/cpus/8080/examples/arithmetic.md).

## 2. Develop literate CPU specifications — current

Opcode expansion and instruction-definition migration are complete for the
initial eight CPUs. The next work is to make a readable CPU description the
maintained source of its formal behavior, while preserving each processor's
contracts. The [literate specification guide](docs/cpus/literate-specifications.md)
describes the working chapter prototype; the
[coverage report](docs/cpus/coverage.md#literate-authoring-milestone) owns its progress.

- Reduce repeated definition construction and remove obsolete helpers where
  this improves clarity. Measure total authored source, including definitions,
  shared support, and generation machinery; keep generated output separate.
- Preserve native encodings, register relationships, flags, addressing,
  access order, and partial-failure behavior. Check shared behavior against
  independently authored expectations, including boundary cases.
- Compare execution records and inspection needs across the CPUs as examples
  and browser views develop. The [shared CPU runner](docs/runtime/runner.md)
  already supports bounded execution, completion addresses, halt/wait outcomes,
  unsupported attempts, and retained CPU-specific records.
- Prove an executable literate chapter from prose and formal rules through
  validation, generated execution, and document diagnostics. Replace the
  corresponding handwritten definitions rather than keeping two authorities.
- Challenge the language with contrasting families and whole-CPU migrations,
  including state, decoding, lifecycle, and generated public interfaces. The
  completed chapters are tracked in the coverage report; each further migration
  tests another execution architecture.
  Keep the final language shape open to what those examples teach us.
- Address remaining accuracy and machine-integration needs in reviewable
  changes, with explicit model contracts and documented limits. Keep their
  detailed status in the coverage tracker.

**Review points:** Behavior remains independently checked, and definitions and
generated explanations make the order of effects clear. Shared construction
reduces duplication without hiding hardware distinctions. Judge changes by
[correctness, clarity, elegance, then performance](AGENTS.md#priorities-for-source-code).

### CPU-only checkpoint

The initial eight targets are **Intel 8008, Intel 8080, Motorola 6800, MOS 6502,
Zilog Z80, Motorola 6809, Intel 8088, and Motorola 68000**. Each now has:

- Explicit state, detached snapshots, instruction stepping, and a defined reset
  contract.
- Representative loads and stores, arithmetic, and logic.
- Branches, calls and returns, and the CPU's own stack conventions.
- A useful combined CPU-and-RAM program with independently checked execution
  records and bounded running through the shared runner.

The [checkpoint audit](docs/cpus/completion.md#cpu-only-checkpoint-review)
records passing evidence for all eight. This was an intermediate capability
milestone; interrupts and I/O were deferred until after it. Their subsequent
implementation is recorded in the
[CPU completion sequence](docs/cpus/completion.md#completion-sequence).

The [example catalog](docs/README.md#cpu-examples) links to the introductory
and combined programs, their behavior specifications, and acceptance checks.
Further examples can continue to test the models and their shared interfaces.

### Complete opcode coverage for all eight

This milestone is complete for all eight, including their documented I/O,
interrupt-control, and system instructions. The models also provide explicit
interrupt and exception delivery and the external connections required by
their declared contracts. The [completion sequence](docs/cpus/completion.md#completion-sequence)
records that work; the [coverage inventory](docs/cpus/coverage.md) owns current
counts and limitations.

Timing, signal scheduling, full bus behavior, and other processor features
remain separate work. Complete opcode coverage establishes the instruction
inventory at the declared modeling fidelity; machine accuracy still needs
validation against each machine's requirements.

### Shared instruction definitions

Instruction-definition migration is now complete for all eight documented
instruction inventories. The [typed definitions](docs/cpus/instruction-semantics.md)
generate execution and explanations. Chapter execution contracts bind decoding,
reset, and retirement policies to shared runtimes; native cores retain policies
that have not yet migrated. Completing this across all eight architectures and
refining the literate authoring format remain ongoing work; the
[shared-building-blocks proposal](docs/cpus/shared-building-blocks.md) records
the broader goal. Neither further language work nor another CPU target is a
prerequisite for browser or machine development.

## 3. Make the examples explorable in the browser

Browser implementation is planned. It can begin with the existing examples,
shared runner, and machine compositions while CPU consolidation continues.

The [pedagogical roadmap](docs/pedagogy.md#pedagogical-roadmap) defines the
learning milestones and review points, beginning with an arithmetic explorer
connected to a real CPU instruction and extending into device work and
guided analysis of substantial software.
The [web design plan](docs/web-design.md) proposes the sitemap and shared
workspace, with delivery steps from page sketches and one working example to
learning paths and machine exploration. Its browser checkpoints develop
alongside the learning milestones and build on the composition work below.

- Review page sketches for an introductory instruction lesson and a substantial
  software-analysis chapter alongside the CPU overview and example workspace.
  Exercise both short explanations and sustained reading connected to execution.
- Add a small interface for stepping, resetting, and inspecting state.
- Introduce register, memory, and instruction views that serve the
  examples while preserving each CPU's distinctions.
- Add controlled running and pausing, separating execution from display updates.
- Turn the examples into short lessons using the same simulation components.

**Review point:** A learner can follow the program and connect the explanation
to actual execution. Inspection does not alter the machine's behavior.

## 4. Prove reuse with another composition

The simulation milestone is complete; browser inspection remains planned.
The [ROM-boot example](docs/cpus/68000/examples/rom-boot.md) connects separate
ROM and RAM through a fixed memory map. The
[8080](docs/cpus/8080/examples/echo.md) and
[68000](docs/cpus/68000/examples/echo.md) echo examples reuse the same byte-input
and byte-output devices through port and memory-mapped connections.
[Machine definitions](docs/machines/definitions.md) now describe these
components, images, connections, and reset behavior.

- Make those connections and device interactions visible in the browser.
- Reuse inspection views where they fit, without triggering device reads or
  other side effects during inspection.
- Revisit the interfaces when another concrete device or composition exposes
  a new requirement.

**Review point:** Shared components retain their behavior across compositions.
Learners can explain the differences through configuration and connections,
and follow their effects during execution.

## 5. Build the first complete machine incrementally

- Choose a machine and a clear, modest software target.
- Connect the CPU, memory, and devices, adding machine-specific behavior and
  timing in small steps with explanations and appropriate checks.
- Build on existing ROM, program-image, and input/output support, extending
  loading and device behavior as the target software requires.
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
- Develop [detailed software guides](docs/pedagogy.md#7-understand-substantial-software-through-guided-execution)
  that connect program and subsystem analysis, line-by-line commentary, and
  interactive demonstrations to execution. Individual routine studies can
  begin earlier as their requirements become available.

**Review point for each addition:** The new case works, existing cases still
work, and shared abstractions remain understandable.

## 7. Replace the existing projects gradually

For each emulator and tutorial section, agree what replacement requires:
software behavior, input/output, inspection features, and learning experience.
Validate those requirements before treating that part of the migration as done.

The migration order will follow what we learn. The end state is a single
Dromaios platform with machine compositions, reusable components, and lessons
that expose how those machines work.
