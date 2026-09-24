# Instruction representation contract

The literate compiler lowers CPU definitions into typed, inspectable data.
Validation, executable generation, and the [expanded instruction listing](semantic-examples.md)
consume that representation. CPU authors should use the
[language reference](literate-specifications.md); compiler contributors should
also read the [implementation guide](implementation.md).

This document defines the meaning and ownership of the intermediate data.
Individual CPU behavior, hardware references, and fidelity limits belong in
[the executable specifications](../README.md#cpu-models), not in a second set
of implementation notes.

## Representation and ownership

[`model.ts`](../../src/components/cpus/semantics/model.ts) defines CPU declarations,
state references, pure expressions, ordered statements, value sources, flag
policies, actions, and instruction definitions. These are data nodes, not
callbacks that execute host code. TypeScript builders remain useful for shared
construction and tests; the production CPU definitions come from the chapters.

A CPU declaration identifies its stored-state schema and permitted boundary
capabilities. Register, flag, array, latch, and choice references name fields
in that schema. A reference identifies a location; it does not read it.

`defineInstruction` validates and owns its data. It clones and deeply freezes
plain definitions, rejecting functions, accessors, class instances, and cycles.
Shared nodes within a copied graph retain sharing. Validated immutable nodes
already owned by the semantic model may be reused; merely freezing a caller's
object does not establish validation or ownership. Mutating a builder's input
must not change a definition after construction.

Construction is inert: validation and binding never perform CPU memory or device
accesses. Generated handlers obtain live state only when executed. Shared
sources and policies therefore describe behavior without sharing mutable CPU
instance state.

## Types, scopes, and arguments

Numeric values have explicit widths: currently 3, 8, 14, 16, or 32 bits.
Boolean values have type `flag`; they are not numeric zero or one. Arithmetic
operations support the widths declared by their validators, with explicit
extension, sign extension, or truncation where widths change. Stored-state
width support alone does not imply that every semantic operation supports it.

An instruction or source's `inputs` declare captured values supplied by its
caller. Captures cannot redefine inputs or other names in their scope.
Expressions read captured values only. Reading live registers, flags, choices,
latches, array elements, memory, or ports requires an ordered statement.

Sources and actions have closed scopes. They receive only their explicit
arguments; no capture from the caller becomes visible implicitly. Arguments are
evaluated in parameter order, once, before the called body's effects. A source
returns one typed value. Branch-local captures do not escape their branch;
a value-producing choice or match explicitly returns the selected result.

Schema validation checks field kind, width, bank, and CPU identity. Array
indices must be in bounds: a constant is checked directly; a dynamic index's
whole representable range must fit the array. Choice reads/writes use declared
alternatives. Unknown names and incompatible widths are errors, not runtime
coercions.

## Primitive meanings

### Captures and pure calculations

A capture retains the value at that point in the ordered body. Later changes
to the original register or RAM do not change it. Pure expressions combine
captures and typed literals without additional reads or writes. Arithmetic
results wrap at their declared widths; carry, borrow, overflow, parity, and
half-carry are separately expressed facts.

Keep three concepts distinct:

- A **view** computes from current stored state when invoked.
- A **resolved location** identifies where a later access will occur.
- A **captured value** records a completed read or calculation.

For example, resolving a memory destination before changing its address register
must not retarget that destination. Conversely, a register value deliberately
read after an address update must observe the updated register.

### Ordered effects and failure

Statements execute in listed order. A failed or rejected effect stops the
remaining body; earlier completed effects remain unless an explicit execution
contract defines a different commitment rule. There is no general instruction
transaction or automatic rollback.

Fetch statements request instruction bytes or words at their actual position
in the body. They must not be moved ahead of writes that can overlap code.
A word fetch's cursor and partial-transfer rules come from its connection;
ordinary multi-byte data transfers explicitly order byte accesses. Endianness,
logical-address progression, physical projection, and state commitment are
separate choices.

A memory or port read captures a returned byte; a write supplies a byte and
records the completed access. Connection failures propagate through the selected
execution boundary. Modeled word-bus/alignment faults are distinct from arbitrary
host exceptions. Fault delivery and any retained state are chapter contracts.

The [boundary probes](boundary-probes.md#existing-models-executable-evidence)
exercise overlapping JSR operands, segmented wrapping, live register aliases,
and staged word transfers with independent state and access expectations.

### Flag policies and scheduling

A flag policy calculates named updates from explicit typed inputs. Unlisted
flags are preserved. Calculation and assignment order are separate: placing
the same policy before or after a memory write changes observable failure
behavior.

An `update-flags` statement changes only the listed fields. A `replace-flags`
statement requires the complete target flag group and installs fresh storage.
Do not retain an old live flag-group reference across an external callback or
replacement. Exchange operations swap the named groups while preserving their
schema and instance ownership.

This distinction matters for the 6502 memory shifts: carry changes between
the original-value write and the final write, while N/Z change after the final
write. A failing final write must not acquire N/Z merely because another CPU
uses a superficially similar arithmetic operation.

### Branches, iteration, and arithmetic outcomes

A conditional executes only its selected body. Match/dispatch cases describe
disjoint masked byte patterns, with local captures. Value-producing branches
must supply the declared result type.

Iteration is bounded by an unsigned byte count, at most 255. Each iteration
has its own captures. Multiple iteration values calculate their next values
from the current iteration before any of them is replaced; declaration order
must not introduce accidental dependencies. This mechanism expresses a bounded
instruction algorithm, not an unbounded execution loop. Repeated string/block
instructions still follow their chapter's retirement and resumption contract.

Division rejects a zero divisor through its named error outcome. Quotient
overflow either follows the same outcome or becomes an explicit Boolean capture
for the body to handle. Named outcomes propagate to the execution boundary;
they are not implicit writes or blanket rollback requests.

### State actions, stacks, and pending writes

State-only views and actions cannot fetch instructions or access external
connections. Composed instruction actions can express explicitly ordered stack,
frame, and memory behavior where their permitted effects allow it. Parameters
are captured before the action begins; later live reads remain visible in its
body. Push/pop order, pointer wrapping, and flag restoration therefore remain
part of the specification, even when several instructions share an action.

Pending-register statements use a word execution boundary's retained updates.
A pending read sees an earlier staged value in that scope; staging is distinct
from a stored write. An explicit commit applies the selected writes. Alignment
checks and instruction-specific writeback determine where that commit belongs.
This is a narrow mechanism for address updates, not a generic transaction over
all state and devices.

## Execution capabilities

Instruction bodies operate within declared connections and execution policies.
Validation rejects effects whose required capability is absent. Examples include
IRQ deferral, segmented TEST/ESC and interrupt reporting, word address resolution
and device reset, and RETI notification after retirement.

Reset, fetching, dispatch, stopping, retirement, interrupt recognition, and
exception delivery also have declarative contracts, described in the
[language reference](literate-specifications.md#execution-contracts). Shared
runtimes enforce those contracts; CPU-specific gates, frames, vectors, and
failure choices are generated from the chapter. Public interfaces select
concrete records and connections rather than exposing one universal CPU result.

## Validation and generated explanations

[`validate.ts`](../../src/components/cpus/semantics/validate.ts) checks structural
meaning: declared state, widths, scopes, legal effects, branch results, and
arguments. This proves neither the instruction's hardware formula nor its
intended access order. Independent CPU and program tests supply those
expectations, including boundary and failure cases.

[`generate.ts`](../../src/components/cpus/semantics/generate.ts) emits executable
statements; [`describe.ts`](../../src/components/cpus/semantics/describe.ts) emits
readable expansions of those same nodes. The listing expands named sources,
substitutes policy inputs, and identifies preserved flags. Authored explanations
supply intent and hardware context; generated prose exposes the represented
effects. Neither substitutes for the other.

The paragraph immediately before a chapter's family fence supplies its authored
explanation. It should identify that operation and stand on its own when
expanded outside the chapter. See the [build workflow](implementation.md#generation-pipeline)
for regeneration and freshness checks.
