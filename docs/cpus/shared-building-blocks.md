# CPUs assembled from shared building blocks

**Status: design exploration, 15 September 2026.** This note proposes a direction
for more extensive implementation reuse across the CPU models. It does not
change their behavior, instruction coverage, public interfaces, or development
milestones. The current-model examples describe constraints a refactor would
have to preserve; they are not a new hardware-reference audit. The future-CPU
examples identify language requirements, with hardware references for those
distinctions; they are not complete specifications of those processors.
All proposed API names, specification syntax, and generated-code examples
below are illustrative; no language or generator is implemented by this note.

The central idea is that a CPU module should become an **executable
specification**: declarations describe its state and encodings, expressions
describe calculations, and ordered instruction bodies describe effects.
Shared semantic definitions should express common behavior once. The
specification can select those definitions and state each processor's
differences directly.

This supports an eventual domain-specific language (DSL) and literate CPU
descriptions. A shared specification language could produce specialized,
straightforward CPU implementations. It does not require a universal runtime
engine with a large collection of configuration switches. The specification
vocabulary, its representation, and its execution strategy are separate
design decisions.

The eventual goal is to express **all declared CPU behavior in the DSL**,
including processor-specific instruction bodies and lifecycle rules, without
CPU-specific handwritten TypeScript in the compiler or runtime. This is a
design target to demonstrate, not a capability established by this note.

The [first bounded TypeScript experiment](shared-operation-blocks.md) records
the implemented flag calculations and memory sequence, preserved difficult
cases, and the limits of the resulting reuse. The subsequent
[boundary probes](boundary-probes.md) add failure checks and hand-worked
6507/4004 traces before choosing the next abstraction.

The staged approach begins with a **bounded shared-building-blocks refactor in
ordinary TypeScript**. Establish and test the meaning of those building blocks
before designing an executable DSL representation. Keep lightweight language
requirements and illustrative examples in view during that work; use the
results to decide which concepts deserve language support.

This develops the existing [opcode definition experiment](opcode-definitions.md)
and the architecture's [direction toward richer CPU descriptions](../architecture.md#implementation-language-and-future-definition-languages).
The [source organization guide](implementation.md) describes the current
implementation conventions. This proposal explores a broader boundary for
reuse; it does not replace that guide before an experiment has been reviewed.

## Contents

- [Objectives and success criteria](#objectives-and-success-criteria)
- [Starting point](#starting-point)
- [Build shared semantics before the language](#build-shared-semantics-before-the-language)
- [Proposed architecture](#proposed-architecture)
- [State and register views](#state-and-register-views)
- [Operands and addressing](#operands-and-addressing)
- [Arithmetic, flag policies, and operations](#arithmetic-flag-policies-and-operations)
- [Execution order and instruction recipes](#execution-order-and-instruction-recipes)
- [Memory and stacks](#memory-and-stacks)
- [Decoding and execution support](#decoding-and-execution-support)
- [Configuration and specialized components](#configuration-and-specialized-components)
- [Construction, types, and inspection](#construction-types-and-inspection)
- [Future CPUs and the boundary of the DSL](#future-cpus-and-the-boundary-of-the-dsl)
- [Staged roadmap](#staged-roadmap)
- [Verification](#verification)
- [Open design questions](#open-design-questions)

## Objectives and success criteria

The source priorities remain correctness, clarity, elegance, and performance,
in that order. The objective is to make each instruction's behavior easy to
follow through a small vocabulary of meaningful operations. A shared
abstraction earns its place when it captures a hardware relationship and
reduces the total explanation needed to check the implementation.

Where instruction semantics match, the proposed division should make these
changes straightforward:

- Adding an addressing form connects an existing operand description to an
  existing operation.
- Adding another destination register selects another register view.
- Changing a flag rule changes the operation's flag policy.
- Implementing another encoding for an existing operation supplies another
  opcode mapping.
- Supporting another CPU reuses the mechanics of instructions and supplies
  its own register layout, encodings, policies, and ordered bodies in the DSL.

The long-term acceptance criterion is:

> At the declared modeling fidelity, a new CPU should be implementable through
> specifications and libraries written in the DSL, without CPU-specific changes
> to the compiler or runtime.

"No custom code" means no handwritten host-language implementation of that
CPU's behavior. A new CPU can require substantial new DSL definitions; a close
variant may need only a small family binding. Language expressiveness and
library reuse are separate measures. Low reuse of existing instruction bodies
does not imply that a processor needs a host-code escape.

This criterion includes the declared fetch, reset, halt, rejection, and other
execution rules as well as instruction handlers. A handwritten CPU wrapper
that merely adapts a public API is compatible with it; one that supplies
unrepresented CPU semantics is not. Record the supported behavior alongside
any escape count: zero escapes for a small subset does not demonstrate a
complete CPU specification.

Evaluate the whole authored system: CPU specifications, shared definitions,
types, validation, execution support, and any generation machinery. A shorter
CPU file or a higher proportion of shared calls is not an independent success
criterion. The current 6502 comparison already uses shared subtraction and
then directly updates its flags. Replacing those few statements with operand
descriptions, flag expressions, factories, and binding rules needs a benefit
that exceeds the cost of learning and maintaining those concepts.

The DSL goal broadens that benefit. One inspectable definition could drive
execution, a flag-effects explanation, and operand information for tools. That
can justify an abstraction even when its direct TypeScript equivalent is short.
The initial shared-building-blocks refactor must improve the existing
TypeScript implementations on its own. The later DSL experiment should
demonstrate a concrete second use where it claims that additional benefit;
possible future consumers alone cannot justify arbitrary machinery.

Clarity has several audiences:

| Reader | What must remain clear |
| --- | --- |
| CPU specification author | Registers, encodings, instruction behavior, and processor differences |
| Shared-definition maintainer | The meaning, effects, and limits of each reusable operation |
| Emulator debugger | The actual order of reads, writes, checks, and state changes |

For representative instructions, each reader should be able to determine what
is read and when, which flags change, where a result is written, and what has
changed if execution stops partway through. Count the definitions and implicit
conventions needed to answer those questions. Compare both the specification
and its resulting implementation against a version using ordinary shared
functions and explicit instruction sequences.

There should be less independently maintained semantic duplication. Moving
methods to another file does not establish that. Repetition in generated code
is acceptable when one authored definition owns the rule and regeneration
reproduces it. Conversely, a useful definition can initially serve one CPU
if it captures a coherent behavior used by many instruction forms.

The target is an instruction-level implementation. This proposal neither adds
cycle accuracy nor assumes that an instruction recipe is a cycle-by-cycle
description. It should preserve recorded access order at the existing model
boundary and leave room to revisit timing separately.

## Starting point

The implementation already has much of the foundation:

| Existing building block | Responsibility | Opportunity to extend the idea |
| --- | --- | --- |
| [State descriptions](../../src/components/cpus/state.ts) | Stored fields, constraints, validation, copying, and derived TypeScript types | Describe register relationships and compose lifecycle support |
| [Register pairs](../../src/components/cpus/register-pairs.ts) and [packed flags](../../src/components/cpus/flags.ts) | Named word views and status-bit layouts | Generalize pairs, slices, selected storage, and view composition |
| [Opcode patterns](../../src/components/cpus/opcodes.ts) | Fixed encodings, aliases, selector families, duplicate detection | Bind reusable operations and operand descriptions |
| [ALU](../../src/components/cpus/alu.ts) and [binary helpers](../../src/components/cpus/binary.ts) | Arithmetic facts, shifts, parity, signed bytes, and word assembly | Reuse instruction behavior above these primitives |
| [Memory recording](../../src/components/cpus/memory-access.ts) | Actual, ordered, completed byte accesses | Compose logical addressing and multi-byte access policies |
| [Byte execution](../../src/components/cpus/execute-byte-instruction.ts) | Fetching, dispatch, and limited opcode rejection | Share more lifecycle mechanics while selecting execution strategies |
| [8080 family](../../src/components/cpus/8080-family.ts) | Common 8080/Z80 encodings, operand handling, transfers, and control flow | Reuse its existing boundary and compare any proposed replacement against it |
| [Motorola helpers](../../src/components/cpus/motorola.ts) | Common conditions, byte ALU behavior, and accumulator operations | Separate reusable operation semantics from their encoding selectors |
| [Call stack](../../src/components/cpus/call-stack.ts) | 8080/Z80 stack accesses, calls, and returns | Separate stack mechanics from call and return recipes |

Candidate repetition sits between primitives and opcodes: obtain an operand,
perform arithmetic, interpret flags, write a result, and record the step.
Some of it is already confined to a few direct statements; other cases share
substantial instruction structure. Assess the remaining common work family
by family instead of assuming that the entire middle layer should move into
a generic framework.

There are also several promising abstractions inside individual CPUs. The
[8088](../../src/components/cpus/8088.ts) represents resolved operands with
`read` and `write` callbacks. The [68000](../../src/components/cpus/68000.ts)
separates operand kinds and holds pending address updates while validating an
instruction. These offer concrete starting points for testing the vocabulary
against more than the simpler byte CPUs.

## Build shared semantics before the language

Separate discovering useful semantic contracts from choosing how a language
represents them. A contract describes inputs, outputs, permitted effects,
effect order, and behavior on failure. It can first be implemented and checked
as an ordinary TypeScript function. Experience using it across CPUs should
inform the later language design.

### What to build first

Begin with a few representative families: comparisons, transfers, and memory
modification. Extract register views, pure calculations, operand handling, and
small named sequences only where those examples demonstrate a useful boundary.
Keep processor-specific effect order visible in the caller or a named body
with a narrow contract. Existing shared helpers remain the starting point.

The first review should judge the complete TypeScript implementation: what it
shares, how its callers expose differences, and how much explanation is needed
to check a real instruction. A shorter CPU file alone is insufficient. The
refactor should remain worthwhile even if the DSL experiment is deferred.

### What to decide about the DSL now

Keep these requirements explicit during the refactor:

- All declared CPU behavior should eventually be expressible without
  handwritten host-language handlers.
- Pure calculations and effectful operations have different contracts.
- Reads capture values at specified points; effects have an explicit order.
- Register, calculation, instruction-unit, and interface widths are distinct.
- Component interfaces identify their operations and ownership of retained state.
- Shared definitions expose enough meaning to be represented and inspected later.

A few illustrative specification examples can test those requirements before
a grammar, parser, semantic representation, or generator is implemented. The
6507 and 4004 should challenge assumptions early, through bounded models or
explicit traces. This anticipates their needs without building their complete
CPU implementations as prerequisites for the first refactor.

Ordinary callbacks can implement a narrow contract, such as reading a resolved
location. A callback with unrestricted access to the CPU can conceal reads,
writes, and ordering that the caller needs to understand. Review its actual
contract now. A TypeScript signature or effect annotation alone does not make
the function inspectable by a future language tool.

### When to start the language experiment

Start once a few shared families have improved the current code and survived
the difficult sequencing and future-CPU probes. The review can still narrow or
reject a proposed abstraction. Completing a universal framework or migrating
every CPU to new helpers is unnecessary and would make later changes costly.

The library API is evidence for the language vocabulary, not its grammar.
Some helpers will remain implementations of common primitives; others will
become DSL definitions or disappear when a clearer body can be generated.
Do not require a language construct for every helper or force every unusual
instruction through the available configuration options.

When a semantic definition moves into the DSL, keep one maintained source of
its behavior: replace its handwritten implementation with the generated or
interpreted definition. A temporary old/new comparison is useful during
migration, but maintaining both indefinitely would recreate semantic
duplication. Independently authored expected results and contract tests remain.

## Proposed architecture

### A specification language can produce specialized implementations

After the shared-building-blocks review, the language experiment can give the
authored specification and the running emulator different representations:

```text
CPU specification: prose, declarations, expressions, ordered bodies
                              |
                              v
             inspectable semantic representation
                   /                       \
                  v                         v
       specialized CPU code       documentation and tool metadata
```

The semantic representation is structured data describing meaning: registers,
operand roles, calculations, effects, and their order. It could first be
authored through TypeScript builders. External syntax and a literate document
format can follow without changing the underlying vocabulary.

Execution could use direct handlers assembled from definitions, an interpreter
for the representation, or generated TypeScript specialized for a processor.
The DSL goal does not choose among these. Generation is a particularly useful
candidate because known widths, register selections, and flag policies can
be resolved ahead of execution, leaving direct code with no corresponding
runtime configuration machinery.

Generation has its own costs: validation, diagnostics, reproducibility, and
source correspondence. Generated handlers should retain the identity and
source location of their instruction definitions, including named shared
bodies. A debugger must be able to move between a specification and the code
that implements it. Generated output should be reproducible and treated as
derived output, with corrections made to its authored source.

### Language primitives, DSL libraries, and CPU specifications

There are three levels of authored meaning:

| Level | Responsibility |
| --- | --- |
| Language primitives | Fixed-width values, arithmetic, bit selection, state access, conditions, ordered effects, and component interfaces |
| Libraries written in the DSL | Named calculations, addressing and access bodies, instruction semantics, and CPU-family definitions |
| CPU specifications | State and interfaces, encodings, library bindings, and processor-specific bodies and lifecycle rules |

The compiler gives primitives their meaning. Libraries and CPU specifications
compose those primitives in the same inspectable language. A new instruction
can have a short, direct DSL body before it has another consumer or deserves
a shared library name. Distinctive behavior does not inherently require a
language extension, and library growth need not change the compiler.

This keeps expressiveness separate from a catalogue of predefined CPU options.
The 6507 should test reuse of a family library; the 4004 should test whether
new behavior can be expressed through the common vocabulary. Neither test
is passed by moving an opaque processor implementation behind a new builtin.

### Declarations, expressions, and ordered bodies

The vocabulary should distinguish three forms:

1. **Declarations** describe stored state, register relationships, opcode
   mappings, supported operand roles, and reusable definitions.
2. **Expressions** calculate values and flag facts without accessing memory
   or mutating state. A register value enters an expression through an explicit
   read or an already captured input.
3. **Ordered bodies** fetch bytes, resolve operands, read and write locations,
   apply flag updates, check conditions, commit specified pending effects,
   and invoke other named bodies.

An ordered body is an instruction recipe. The same vocabulary can describe
ordinary comparison and 6502 JSR; an unusual sequence does not inherently
require escaping to arbitrary host code. Reusable bodies may call other bodies,
but expansion must reveal one unambiguous order of effects. Pure expressions
can be shared and simplified without treating effectful reads as expressions.

This provides a path to mostly declarative CPU modules while retaining direct
procedural descriptions where order carries meaning. It does not require
encoding every sequence as a set of configuration options.

### Semantic ownership

The instruction body owns the order in which effects occur. A named operand,
stack, or other effectful body owns its documented internal sequence; invoking
it expands that sequence at a specific point in the caller. A flag policy
calculates a proposed update, and an explicit statement applies it. Execution
support owns the surrounding fetch/record contract and only the commit behavior
that its strategy declares. It must not rearrange instruction effects.

The intended reusable responsibilities are:

| Shared semantic responsibility | Processor description supplies |
| --- | --- |
| State ownership and snapshots | Stored-state schema and derived views |
| Register access | Widths, slices, pairs, selected banks, and write behavior |
| Operand resolution | Address expressions, permitted operand roles, and update rules |
| Arithmetic and logic | Operation, width, carry input, and flag policy |
| Transfers and modification | Source/destination selection and access recipe |
| Memory access | Byte order, logical progression, bus mapping, and alignment rules |
| Stack mechanics | Pointer selection, movement, wrapping, and transfer order |
| Control flow | Conditions, target calculation, saved return address, and repetition rules |
| Execution records | Fetch/commit strategy, supported outcomes, and step boundary |
| Reset support | Ordered vector reads and explicit reset effects |

Each definition should have a narrow contract. Prefer inputs such as a register
view, captured value, or memory interface over unrestricted access to an entire
CPU instance. Fixed processor choices can be bound or generated once; live
choices such as incoming carry and active register banks remain execution-time
reads at specified points. A small direct implementation of a contract is a
valid result; it need not become a separately allocated runtime component.

The eventual CPU module would have four main sections:

1. Stored-state and register-view declarations.
2. Shared semantic definitions and processor-specific policies.
3. Operand selectors and opcode mappings in the processor's encoding order.
4. Ordered instruction and reset bodies where mappings to shared bodies
   are insufficient.

Public CPU classes can remain wrappers around handwritten or generated
implementations. Their size is an outcome of useful sharing, not a target.
Changing the public construction API is not a prerequisite for this experiment.

## State and register views

### One stored representation

The current state descriptions should remain the authority for stored values.
A view describes how to observe or update that storage; it does not introduce
another field that must be kept synchronized.

Useful view constructors include:

| View | Examples |
| --- | --- |
| Stored field | 6502 A, 6809 X, 68000 D0 |
| Concatenated fields | 8080 BC from B/C; 6809 D from A/B |
| Slice of a field | 8088 AL/AH from AX; low word of 68000 D0 |
| Selected field | 68000 A7 from USP/SSP according to S |
| Selected array element | 8008 PC from `addressStack[stackIndex]` |
| Computed inspection value | 8088 physical PC from CS:IP; 68000 physical PC |
| Packed flags | 8080 PSW flags, 6502 status, Z80 F |

Read-only computed values should remain read-only. A physical PC view, for
example, does not imply that assigning a physical address can uniquely recover
the corresponding logical registers.

### Reads and writes have explicit contracts

A byte-slice write preserves the other bits of its stored word. A concatenated
view splits a value into its constituent fields. A 68000 word write to a data
register preserves its upper word, while MOVEA.W sign-extends into the entire
address register. The latter is an instruction conversion, not a universal
meaning of writing a 16-bit value.

Avoid making every register write silently apply whatever arithmetic seems
appropriate for its destination width. Initialization validation, arithmetic
wrapping, truncation, partial replacement, and sign extension are distinct
contracts. Their placement should be evident from the operation and view.

Register selection also has a lifetime. A reusable A7 description must consult
the active bank at execution time, but a particular resolved operand may need
to retain the physical register it selected for the duration of an instruction.
The API should distinguish a live selector from an already resolved location.
The same distinction matters for the 8008's changing PC slot.

Snapshots should derive views from the copied stored state. Reading aliases
must not cause RAM access or leave snapshots attached to live CPU storage.
Existing constructor behavior, including reading each declared caller field
once and copying nested values, remains part of the contract.

## Operands and addressing

### Separate descriptions, resolved locations, and values

These are different objects with different lifetimes:

- An **operand description** says how to obtain an operand, such as an
  immediate byte, a selected register, or memory indexed by X. It can be shared
  by opcode mappings and contains no instruction-local address or value.
- A **resolved location** identifies the particular register or memory address
  selected during one instruction. Resolution may fetch extension bytes,
  read an indirect pointer, or request a register update.
- A **value** is captured by a read at a particular point in the recipe.

For read/modify/write, resolution ordinarily happens once and the resulting
location is reused for the write. Resolving it again could fetch another
operand, increment a register twice, or write to a different address.

Resolution does not imply a data read. Address-only instructions, stores,
comparisons, and modifying instructions require different capabilities:

| Capability | Meaning | Example |
| --- | --- | --- |
| Readable value | Obtain a value | Immediate source |
| Writable location | Accept a result | Store destination |
| Readable/writable location | Read and then update the same location | Memory increment |
| Address | Obtain the effective address itself | LEA or JMP |

These capabilities should be reflected in types where practical. Immediate
destinations should not type-check. An address-only operation should not need
a data-read callback just to satisfy a generic operand interface.

### Addressing consists of reusable pieces

Candidate primitives include fetching a displacement, sign extension,
base-plus-index arithmetic, fixed-page selection, configurable direct-page
selection, pointer reads, predecrement, and postincrement. Addressing components
can compose those primitives while preserving their processor's encoding.

For example, the current 6502 model uses page-wrapped pointer reads for both
zero-page indirection and NMOS indirect JMP. The same mechanism can have
different callers without embedding instruction identities in the reader.
The 6800's unsigned indexed byte and the 6809's signed indexed forms can share
addition and wrapping while selecting different displacement interpretations.

The 8088 ModR/M decoder and 68000 effective-address decoder still deserve named
components. They describe substantial, coherent encoding systems. A general
operand interface allows their results to feed shared operations without
requiring one universal addressing decoder.

### Address updates affect other operands

Operand resolution must account for aliases and ordering. In the 6809,
`CMPX ,X++` compares the updated X with the fetched word. A store using X as
both index and source also observes the addressing update. A word load into
that same register overwrites the update with the loaded value. See the
[6809 implementation](../../src/components/cpus/6809.ts) and
[indexed tests](../../tests/components/cpus/6809.test.ts).

Accordingly, a generic comparison cannot always read its left register before
resolving its right operand. A suitable recipe for these forms resolves and
reads the source, then reads the comparison register. Put those steps in the
body of the shared comparison recipe. An option such as `sourceThenRegister`
can conceal exactly what it orders: resolution, an indirect pointer read,
the final data read, and a register update are distinguishable effects.

The 68000 adds another requirement: pending source address updates must be
visible while resolving the destination, even though a later alignment fault
must leave stored registers unchanged under the current model. A small
instruction-local overlay for pending register updates is a possible
mechanism. Keep it local to the 68000 execution contract initially. Its users
must specify which reads consult the overlay and when it commits; it should
not silently change every register read's meaning. Generalizing it requires
another concrete consumer with the same visibility and commit rules.

## Arithmetic, flag policies, and operations

### Arithmetic returns facts

The current ALU already has a good boundary: addition and subtraction return
facts without changing CPU state. A shared operation can then combine:

1. Operand values at a declared width.
2. A pure arithmetic or logical calculation.
3. A flag policy.
4. A result destination, or explicit absence of writeback.

Flag policies may need the original operands, incoming flags, result, carry,
borrow, overflow, or an explicitly named intermediate value. Keeping the
inputs available avoids recomputing arithmetic inside each CPU module.

Width is part of the operation. JavaScript's signed 32-bit bitwise behavior
must not leak into the unsigned 32-bit model. Reuse should preserve the
existing independent tests for full-width results and wrapping.

The current ALU's half-carry facts always describe the bit-3/bit-4 boundary.
Z80 word operations also need a bit-11/bit-12 fact. A boundary-aware helper or
explicit additional calculation would be needed there; merely changing the
main arithmetic width does not change the existing half-carry definition.

### Flags are operation policies

Flag spelling does not establish meaning. Z80 N describes subtraction, while
Motorola N describes a negative result. Z80 PV uses overflow for arithmetic
and parity for several logical operations. The same flag can receive different
expressions in different operations.

For comparison, the current implementations provide this useful contrast:

| Model | Result flags | Carry/borrow | Other effects |
| --- | --- | --- | --- |
| 8008 | S/Z and byte parity P | C means borrow | No half-carry flag |
| 8080 | S/Z and byte parity P | CY means borrow | AC is inverse half-borrow |
| 6502 | N/Z | C means no borrow | Preserve V and decimal flag; comparison remains binary |
| 6800/6809 byte comparison | N/Z/V | C means borrow | Preserve H |
| Z80 | S/Z and overflow PV | C means borrow | H means half-borrow; set N |
| 8088 | SF/ZF/OF and low-byte parity PF | CF means borrow | AF means half-borrow |
| 68000 | N/Z/V | C means borrow | Preserve X for comparison |

The original 6800's word CPX is a separate case: N/V come from high-byte
subtraction without low-byte borrow propagation, Z compares the entire word,
and C is preserved. It should remain a named algorithm assembled from shared
primitives. It is not obtained by widening ordinary byte comparison.

Small reusable flag expressions could include sign, zero, low-byte parity,
overflow, carry, borrow, inverse borrow, constants, and expressions combining
old flags with new facts. Unlisted flags can mean preserve, provided this
default is explicit and consistently tested.

Policies must be defined per operation. For example, 68000 SUB changes X while
CMP preserves it. INC may preserve carry even when ADD does not. A transfer
can change flags in one instruction and preserve them in another. These
differences should be visible at the operation declaration.

Incoming carry interpretation is separate from output carry interpretation.
6502 SBC supplies the inverse of C as a borrow input; 8080 SBB supplies CY
directly. A single option named `invertCarry` would obscure which boundary it
controls.

### Calculate flag updates separately from scheduling them

A flag policy is a pure calculation against captured arithmetic facts and
incoming flag values. Within one explicit update statement, evaluate all
right-hand sides before assigning any flag. This prevents one expression from
accidentally reading another expression's newly written value. Sticky zero
and decimal correction can refer to an explicitly captured old flag.

The instruction body schedules each update statement. It may update one
subset of flags before a memory write and another subset afterward. There is
no rule that all flags of an instruction, or all consequences of an arithmetic
operation, must commit together. The memory-shift example below requires this
distinction under the existing implementation's failure behavior.

Repeated shifts may intentionally feed each outgoing carry into the next
one-bit operation. Their body must show the progression and distinguish flags
captured before the loop from flags read during each iteration.

Hardware-undefined flags require an explicit model choice, such as preserving
or clearing them. Ordinary preservation and preservation chosen because a
flag is undefined may execute identically, but the declaration and supporting
documentation should retain the reason. Reuse must not silently normalize
different processors' existing policies.

Flag accessors must read the current flag object at execution time. Several
existing instructions replace a packed-status-derived flag object; a component
that captured the earlier object would continue updating stale storage.

### Example: a specification and its resulting implementation

The following is schematic specification syntax, not a proposed grammar or
an implemented API. It makes the shared body's order visible independently
of its flag expressions:

```text
body compareSourceToRegister(width, register, source, flagPolicy) {
    let right = read(source)
    let left = read(register)
    let facts = subtract(width, left, right)
    updateFlags(flagPolicy(facts))
}

policy compare6502Flags(facts) {
    n = (facts.result & 0x80) != 0
    z = facts.result == 0
    c = !facts.borrow
}

opcode "110 bbb 01", b = accumulatorOperands =>
    compareSourceToRegister(8, A, b, compare6502Flags)  // CMP
```

Here `read(source)` invokes the selected source's ordered reader once. Its
definition contains any resolution, extension fetches, pointer reads, and
address updates. Those effects finish before `read(register)`; expanding the
body must expose them in that order. The flag policy has no state effects by
itself. `updateFlags` applies its selected assignments, preserving unlisted
flags under the declared default.

For the immediate form, an illustrative generated handler body, after opcode
fetch, could be:

```ts
const operand = instruction.fetchByte();
const { result, borrow } = subtract(8, state.a, operand);
state.flags.n = (result & 0x80) !== 0;
state.flags.z = result === 0;
state.flags.c = !borrow;
```

This output is shown by hand to explain the intended correspondence; no
generator has produced it. The later DSL experiment must include the types,
binding or generation logic, and validation behind the specification as well
as its resulting code. An attractive call site alone cannot demonstrate
overall simplicity.

CPX and CPY select other registers. 8080 CMP/CPI select their flag policy.
6809 comparisons select their widths and source readers, including indexed
readers that update the compared register. Matching forms share one authored
subtraction-and-discard body. That body may expand into multiple specialized
handlers; runtime sharing of the entire comparison is not an acceptance
requirement.

Comparison should explicitly request no destination write. Returning the
original accumulator to an unconditional writeback path hides that distinction
and becomes problematic when the operand is memory or a more complex view.

### Other reusable operation families

The same split suggests a small vocabulary:

- Transfer a value, optionally converting it and updating flags.
- Transform one operand and write the result back.
- Combine two operands and write a result.
- Test or compare without writing a result.
- Exchange two captured original values.
- Obtain an effective address without reading its data.
- Set, clear, or complement selected flags.
- Branch according to a predicate and a target recipe.

These are semantic operations, independent of mnemonic spelling and encoding
family. Both shared 8080/Z80 encodings and different 6502/Motorola encodings
can select the same operation components.

## Execution order and instruction recipes

The hard boundary is sequencing. Equal final registers do not establish equal
execution: a different read or write order can change the result when operands,
stack, and instruction bytes overlap.

Ordered bodies are a first-class part of the specification vocabulary. They
should express both common sequences and distinctive instructions directly.
The executor or generator must preserve every declared effect, including
same-value writes and failed-access boundaries. Resolving a read early,
repeating it, or eliminating it because its value appears unused requires a
semantic justification; it cannot follow from ordinary expression rewriting.

### 6502 JSR requires demand-driven fetching

After the opcode fetch, the existing recipe is:

1. Fetch the low target byte.
2. Read the PC pointing at the high target byte.
3. Push that return address's high byte, then low byte.
4. Fetch the high target byte from current RAM.
5. Set PC to the assembled target.

A stack write can replace the high target byte before step 4. The
[6502 tests](../../tests/components/cpus/6502.test.ts) explicitly exercise this
case. Fetching the entire instruction before running its handler would change
the target and the recorded bytes.

A specialized recipe can still use shared components. For example, assuming
the surrounding executor has already fetched the opcode:

```ts
function jsr6502(context) {
  const low = context.fetchByte();
  const returnAddress = context.pc.read();
  context.stack.pushByte(returnAddress >>> 8);
  context.stack.pushByte(returnAddress & 0xff);
  const high = context.fetchByte();
  context.pc.write(low | (high << 8));
}
```

This is TypeScript pseudocode showing the required order. The DSL should be
able to represent the same sequence as structured statements invoking shared
fetch, PC, and stack definitions. Keeping the order visible does not require
leaving this instruction as opaque host code. Page mapping and recording can
still be supplied by the invoked definitions.

### Read/modify/write has more than one access pattern

The 6502 memory-modification helper reads a byte, writes its original value,
then writes the transformed result. The 6800 and 6809 modifying helpers use a
single result write. In the current models, 6800 memory CLR writes without a
data read, while 6809 memory CLR reads first.

These differences require explicit access recipes, such as read/write,
read/write-original/write-result, and write-only. The recipe also fixes when
the arithmetic and flag effects occur relative to writes. Same-value writes
must still occur and be recorded.

Start with named complete access bodies and share their common suboperations.
Expose a parameter only when the allowed variations and their interactions
are clear. The body must reveal the sequence behind its name; a label alone
is not a substitute for specifying the accesses.

### Flag updates can straddle a failing write

The current [6502 implementation](../../src/components/cpus/6502.ts) has this
sequence for an ASL memory operand, after its address is obtained:

1. Read the original byte.
2. Write the original byte.
3. Calculate the shift and set C to the outgoing bit.
4. Write the shifted result.
5. Set N/Z from that result.

If the final write throws, C has changed but N/Z retain their previous values.
An isolated check with a failing RAM subclass confirmed this behavior. For
an original byte of `80`, with C clear, N set, and Z clear, the failed attempt
leaves C set, N set, Z clear, and the original memory byte intact.

This is observable host-error behavior of the current implementation, not a
claim about a hardware exception or cycle boundary. The initial refactor
should preserve it and include an explicit regression case. Any decision to
narrow the supported host-error contract belongs in a separately reviewed
model change; a refactor must not make that choice accidentally.

An ordered body can calculate the shift, apply a C-only update, attempt the
write, and apply an N/Z update. The pure shift calculation can remain shared.
Applying all flags before the write would change N/Z too early; applying all
flags afterward would leave C unchanged on failure. This is why effect order
belongs in a body and a flag policy only calculates an update.

### 68000 MOVE requires validation between observable reads

The current model resolves and validates the source, reads it, then resolves
and validates the destination. Source address updates are available to later
address calculations but commit only after the required checks pass. The
destination write can overwrite an update to the same register.

An odd destination can therefore reject after source data has already been
read. Those reads remain in the record. Prevalidating every address before any
read would alter the model's access sequence; committing all source updates
immediately would alter its rejection behavior. See the
[effective-address contract](68000/model.md#effective-addresses).

The vocabulary should allow this recipe to invoke explicit pending-update
and validation operations with a documented 68000 contract. It should not
impose that mechanism on simpler CPUs or promise a universal transaction
around an instruction. Reads cannot generally be undone, especially once
devices are connected, and replaying reads would not reconstruct their
original values.

## Memory and stacks

### Separate value layout, access sequence, and address progression

An endian setting answers how bytes form a value. It does not fully describe
the order or addresses of bus accesses.

For a word access, the semantic definition may need to describe:

1. The byte significance at each logical address.
2. The sequence in which those addresses are accessed.
3. How the logical address advances and wraps.
4. How each logical byte address maps to RAM.
5. Alignment checks and when they occur.

These are questions the definition must answer, not necessarily independently
selectable settings on a runtime object. Several small, named access bodies
may express the actual supported combinations more clearly than a universal
configurable memory-access engine.

For the 8088, each byte's offset wraps within its segment before translation.
At `1234:FFFF`, a word uses physical addresses `2233F` and `12340`. A helper
that translated the first address and then incremented the physical address
would be wrong. This is part of the existing
[logical-address contract](8088/model.md#logical-and-physical-addresses).

For the 68000, logical registers retain 32 bits and the physical bus uses
24 bits. Alignment faults report a logical address, whereas memory accesses
record physical addresses. A generic address must retain the information
needed for both jobs. Byte, word, and long alignment requirements also differ;
a long requires an even address, not necessarily an address divisible by four.

For the existing byte-memory models, callbacks should continue to feed the
existing recorder. Instruction fetching additionally appends fetched bytes
and advances its own cursor; ordinary data access must do neither. The future
language must also describe other access units and interfaces. Those require
an explicit recording contract, as discussed in the
[future-CPU examples](#future-cpus-and-the-boundary-of-the-dsl), without changing
the current public records as a side effect of the initial refactor.

### Stack mechanics are reusable independently of calls

Several current conventions illustrate the required axes:

| Model | Pointer and push behavior | Word push access order |
| --- | --- | --- |
| 6502 | Eight-bit SP selects page one; write byte, then decrement | JSR pushes high, then low |
| 6800 | Sixteen-bit SP; write byte, then decrement | Low, then high |
| 6809 | Selected S/U; decrement before each byte write | Low, then high |
| 8080/Z80 | Sixteen-bit SP; decrement before each byte write | High, then low |
| 8088 | Decrement SP by two, then access SS:SP | Low, then high |

The 8008's circular address-register stack is a separate component: a call
selects another physical address slot rather than writing a return address to
RAM. The 68000's active stack, alignment validation, and long transfers can
compose memory and register-view components through their own recipes.

Stack primitives should handle pointer movement and accesses. Call recipes
choose what return address is saved and when the target is obtained. Return
recipes choose whether to adjust the popped address or discard parameters.
This allows 6502 JSR/RTS and ordinary 8080 calls to reuse mechanisms while
preserving their different return conventions.

Aliasing remains explicit: original-8088 PUSH SP saves its decremented value,
and POP SP replaces the incremented pointer with the popped value. A generic
push that always captures the source before moving SP would need an explicit
recipe for PUSH SP. These cases belong in the component contract tests, not
in hidden checks of a processor's name.

## Decoding and execution support

### Preserve the processor's encoding structure

The current `opcodePattern`, `opcodeFamily`, and `opcodeTable` helpers can
remain the foundation. Tables should continue to show native bit fields,
selector order, mnemonics, legal combinations, and exceptions.

Opcode mapping and behavior are separate dimensions. An ADD operation can be
used by unrelated encoding families; the shared 8080/Z80 family can select
different flag policies for the same encoded instruction. The existing
shallow family hierarchy already expresses this distinction through explicit
hooks. Retain it as a comparison point; composition is not intrinsically
clearer merely because it replaces inheritance.

During migration, the family base can delegate to components incrementally.
Replacing the hierarchy is not a prerequisite for the initial refactor.
Eventually, a family builder could accept registers, operations, and conditions
and return mappings without owning CPU lifecycle or requiring subclasses.
Such a replacement should address a concrete difficulty in the current
design and be reviewed together with its complete binding code and types.
If it only replaces a few clear hooks with a larger callback bundle, keep
the existing structure. A future generator may also preserve that structure.

Shared builders must preserve unsupported slots. A regular bit pattern is not
evidence that every combination exists. Construction-time legality checks and
runtime postbyte validation remain distinct. Rejected encodings must fetch
only the bytes the current contract requires.

### Share lifecycle mechanics while selecting execution strategies

The current models suggest several strategies:

| Strategy | Existing examples and constraints |
| --- | --- |
| Byte opcode with live operand fetching | 8008, 8080, 6502, 6800, 6809; 6809 can reject after a postbyte fetch |
| Prefix decoding before PC/R changes | Z80; opcode fetches and operand reads have different R effects |
| Segmented prefix stream | 8088; segment/repeat state is local to the attempt and IP wraps within CS |
| Word instruction stream with local cursor | 68000; alignment checks, extension-word bases, and PC commit on success |

Snapshots, access recording, fetched-byte collection, and result construction
can be shared without forcing every strategy into the same loop. The first
iteration should reuse existing executors and introduce only the capabilities
the selected instruction experiment needs.

The shared byte executor currently restores PC on supported-handler rejection;
it does not roll back arbitrary state changes or RAM. The 6809 validates
unsupported indexed forms before other changes. The 8088 similarly validates
rejected cases before architectural mutation other than its recoverable IP
advance; divide errors may retain operand reads. The 68000 uses a local cursor
and pending updates for its supported fault checks.

These are explicit model policies, not general hardware exception delivery.
An execution component must preserve them and distinguish a reported rejection
from a thrown RAM or handler error. Existing errors must not silently become
successful rollbacks or synthesized unsupported-opcode outcomes.

### Reset, halt, and repetition remain selected behavior

Reset recipes can reuse field assignments, vector reads, and recording. They
must preserve each CPU's specified effects and fields intentionally left
unchanged. Construction must not acquire an implicit reset or RAM access.

Halt support should be selected only by models that expose it. An already
halted attempt must retain its current fetch-free record where specified.
The public outcome type should not claim outcomes that a CPU cannot produce.

Z80 block instructions and 8088 REP currently perform one iteration or element
per step. They can share counting and repetition mechanisms, while supplying
different conditions, pointer adjustments, flag rules, and restart addresses.
Replacing them with an internal loop over the entire block would change the
runner's stopping points and execution records.

## Configuration and specialized components

Begin with complete semantic definitions that have concrete consumers. Share
their common calculations or bodies, then expose parameters for variations
that have a small, intelligible meaning:

- Operand width and carry input source.
- Individual flag expressions and preservation.
- Byte order and logical address wrapping.
- Predecrement versus postdecrement stack movement.
- Fixed versus register-selected pages or segments.
- Read/write versus write-only access patterns.
- Branch predicates and displacement interpretation.

These dimensions are often coupled. PUSH SP connects source capture with
pointer movement; CMPX with auto-update connects addressing with another
operand's read; byte A7 addressing connects register identity with width;
memory shifts connect flags with writes. A configuration interface must
either express those dependencies clearly or select a complete named body
that already owns them. Its type and validation burden counts toward the
cost of the abstraction.

Processor-specific names are appropriate for processor-specific contracts.
Prefer a small number of coherent definitions over independently selectable
options that admit combinations no supported model uses. The DSL can express
the details directly without requiring a generic runtime object for each one.

Use named algorithms when the behavior has a materially different sequence
or calculation:

- NMOS 6502 decimal ADC/SBC and JSR.
- Original 6800 CPX.
- Z80 prefix decoding, refresh-register updates, and decimal adjustment.
- 8088 ModR/M addressing, decimal adjustment, and far transfers.
- 68000 effective-address decoding and register-list transfers.
- 8008 circular address-stack operations.

These specialized algorithms should still call shared primitives and feed
shared operations wherever their contracts permit. Specialization belongs at
the smallest level that explains the difference. A processor need not receive
an entirely separate arithmetic subsystem because one instruction differs.
In the eventual language, these are named DSL definitions, including algorithms
used by only one processor. Their specialized names do not imply handwritten
host-code implementations or new compiler primitives.

For example, NMOS 6502 decimal ADC derives flags from both binary and partially
corrected values. A flag policy looking only at the final decimal result is
insufficient. It needs either a named decimal calculation returning the
relevant intermediates, or a named operation that owns that calculation. A
large collection of loosely related decimal-mode switches would make the
algorithm harder to inspect.

This is also why a CPU-wide profile cannot be the only configuration unit.
Profiles can provide named operation defaults, but instruction families must
be able to select a different operation or policy directly. Avoid deep chains
of profile inheritance that hide the final rule from a reader.

## Construction, types, and inspection

### Definitions are inert; instances own state

Authored definitions and opcode mappings must not read live registers or RAM
when constructed, inspected, or compiled. In the later language experiment,
a builder callback may construct structured statements from symbolic inputs;
its result must remain inspectable data. Executing an instruction is a separate
operation with an explicit CPU instance and memory context.

Reusable definitions must not retain one CPU instance's state or one step's
resolved operands. An implementation may bind handlers per instance, but a
static handler must never share mutable state between instances. Ordinary
closures remain a valid implementation technique; their existence alone
does not make their behavior available to specification tools.

The 68000 already shares its large opcode table with handlers receiving the
executing CPU. Preserve that possibility. Binding or generation can resolve
fixed register selectors, widths, and policies once. The proposal does not
require allocating a full table or a hierarchy of objects for every instance
or instruction. Representation and caching choices should follow clarity
first and performance measurements when needed.

### Inspectable semantics and opaque extensions

Tools cannot generally infer the meaning of an arbitrary TypeScript callback.
For a definition to drive execution and another output reliably, its relevant
meaning must be represented explicitly. The later DSL experiment needs a
structured representation of the expressions and ordered statements that it
claims to share with tools. The initial TypeScript refactor establishes
contracts and reuse without claiming this machine-inspectable meaning.

The representation should distinguish pure calculations from reads, writes,
flag application, control flow, and other effects. Named bodies should expose
their parameters and expansion. Semantic facts belong to that representation;
the display syntax can remain ordinary typed TypeScript builders initially.
No parser or general-purpose optimizing compiler is required to test the idea.

Before the language experiment, the ordinary TypeScript implementations are
the baseline. Once CPU behavior is authored through the DSL, a custom host-code
extension can remain available with explicit inputs, outputs, and a documented
effect contract. Treat every CPU-specific extension as a visible gap against the
eventual goal, with the unsupported semantic requirement identified. It does
not count as a completed DSL definition merely because a DSL statement calls
it. The target CPU examples should ultimately require none.

Tools must report where they cannot inspect an extension's behavior. An
annotation describing its effects is a separate assertion to test; it is not
evidence obtained by analyzing the function. Do not generate detailed
explanations from assumptions about an opaque callback's internals.

The compiler and runtime necessarily implement language primitives in host
code. Those primitives need explicit, common semantics and independent checks.
A CPU-specific handler or special compiler branch disguised as a primitive
does not satisfy the goal. A newly encountered behavior may justify a common
language extension, but it must be reported as language development rather
than a successful specification-only addition.

The initial refactor can use pure TypeScript flag functions. When the DSL
version claims inspectable flag formulas, represent those formulas as
structured expressions and actually consume them in another output. Preserve
the independent flag expectations when changing their representation.

### Keep useful TypeScript guarantees

The implementation should retain:

- Concrete register and flag names, including nested banks.
- Readonly, detached public snapshots and execution records.
- Valid operand widths and read/write capabilities.
- CPU-specific handler contexts and outcome narrowing.
- Immutable descriptions with mutable state owned by an instance.
- A distinction between physical memory addresses and logical fault or
  instruction addresses where those differ.

Do not erase these guarantees behind pervasive `any`, an untyped string-keyed
CPU object, or optional callbacks that ordinary operations must repeatedly
check. Some construction-time validation remains appropriate: opcode overlap,
selector completeness, view widths, and illegal combinations are not all
convenient to express through types alone.

A useful public factory could eventually derive a CPU from a description, but
the initial refactor can preserve existing exported classes and aliases.
The machine parser should continue importing stored-state descriptions from
their current CPU-facing exports.

### Multiple outputs and source correspondence

Register relationships, addressing names, operand roles, and flag policies
could support disassembly, inspection, and explanations alongside execution.
That is part of the motivation for an eventual DSL, rather than just a benefit
of reducing runtime duplication. A small flag-effects summary is sufficient
as a second consumer in the later DSL experiment; a complete disassembler or UI
would add unnecessary scope.

Keep specification queries separate from execution. A tool reading an opcode
description must not invoke its effectful operand reader. Decoding memory for
inspection also needs its own safe access contract, independent of executing
an instruction. Actual execution records remain evidence of what happened;
static descriptions cannot replace captured bytes and accesses by re-reading
current memory afterward.

Generated implementations should retain a route back to the originating CPU
definition and any shared body it uses. Diagnostics should name that context
instead of exposing only anonymous generated functions or helper internals.
The authored prose and semantic definitions can eventually form a literate
document; external syntax and document tooling remain open.

## Future CPUs and the boundary of the DSL

Refactoring existing CPUs only shows that the vocabulary fits behavior we
already used to design it. Future processors provide a separate test of
whether CPU authors can work within the language. The MOS 6507 and Intel 4004
are useful contrasting examples: a close family variant and a substantially
different architecture. They are proposed design probes here, not additions
to the implementation schedule or claims of current support.

### MOS 6507: reuse a family specification

The 6507 belongs to the software-compatible 6500 family, exposes thirteen
address lines for an 8 KiB external address range, and has no external IRQ or
NMI inputs. These distinctions are documented in the
[MOS Technology data catalog](https://bitsavers.org/components/mosTechnology/_dataBooks/1982_MOS_Technology_Data_Catalog.pdf),
in the family overview and 6507 pinout and features.

A DSL family binding should retain the NMOS 6502 instruction semantics and
16-bit logical PC while projecting memory addresses onto thirteen external
lines. That projection applies to instruction, data, stack, and vector
accesses. For example, logical reset-vector address `FFFC` reaches physical
address `1FFC`; the mapping does not truncate the PC itself. Unavailable
external interrupt inputs do not remove the software `BRK` instruction.

The author should select the family behavior and declare the interface
differences in one small, inspectable definition. The resulting specification
must expose the complete effective rules without requiring a reader to follow
a deep chain of overrides. Shared family tests and variant-specific boundary
checks should both apply. Any additional family behavior needed for the
declared scope should itself be written in the DSL.

Success means reusing the family semantics with no new CPU-specific host-code
handlers or address adapters. A common mapping mechanism can implement the
declared address projection. The present 6502 RAM construction and recording
contracts are implementation constraints to resolve, not language rules that
every family member must inherit.

### Intel 4004: express a different architecture

The 4004 combines 4-bit arithmetic and registers, a 12-bit PC, byte-oriented
instruction storage, and a three-level internal return stack. Its data memory,
status characters, and I/O ports have distinct access mechanisms. `DCL` and
`SRC` establish selection that affects subsequent accesses. See the
[Intel MCS-4 programming manual](https://bitsavers.trailing-edge.com/components/intel/MCS4/MCS-4_Assembly_Language_Programming_Manual_Dec73.pdf),
sections 2.1–2.6 and 3.10, for these hardware distinctions.

The proposed language requirements inferred from this example are:

| Capability | Design implication |
| --- | --- |
| Independently specified widths | Register, arithmetic, instruction-unit, logical-address, and physical-interface widths cannot be one CPU-wide setting |
| Register arrays and views | Declare stored elements, selections, and pairs without bespoke host accessors |
| Ordered state changes | Describe an internal stack directly, including wrapping and overwritten entries, rather than forcing it through a RAM stack abstraction |
| Named memory and I/O interfaces | Give each interface explicit access units and operations instead of treating every access as a byte in one flat RAM |
| Stateful interactions | Express selection and later access as distinct ordered effects with an explicit owner for retained state |

There are concrete gaps between this vocabulary and our current helpers.
[State fields](../../src/components/cpus/state.ts) already accept widths such
as four and twelve, but the [ALU](../../src/components/cpus/alu.ts) accepts only
8, 16, and 32. [Memory access and recording](../../src/components/cpus/memory-access.ts)
assume bytes and carry no address-space identity. Supporting another width in
state declarations alone therefore does not demonstrate executable support.
The language must define calculation widths and conversions, and records must
identify the interface, access unit, value, and order needed to explain an
actual access. Host storage can use bytes without making a nibble access
semantically a byte access.

Success can involve substantial new DSL code: state, encodings, calculations,
and ordered bodies. Those definitions should execute through common language
support. A builtin such as `execute4004Instruction`, or a collection of opaque
helpers that collectively implement it, would leave the central problem
unsolved. Prefer a clear processor-specific DSL body to either an opaque
handler or an elaborate configuration scheme.

### CPU behavior and surrounding components

The CPU specification describes the operations it issues and how it responds
to values and signals. Connected components implement their side of those
interfaces. Selection state must belong to the component that owns it in the
chosen model; externally latched state should not silently become an invented
CPU register. An instruction-level component interface can abstract physical
signaling, provided the retained state and observable ordering are explicit.

A completely DSL-defined CPU still needs memory and peripheral models.
Implementing a new surrounding component can require separate work, potentially
in host code until component specifications are supported. Report that work
alongside the CPU result. The claim of no CPU-specific host code must not hide
instruction decoding or CPU state transitions in a supposedly external device.

The criterion applies at a stated fidelity. Expressing instruction behavior
does not establish cycle or pin timing; those would require additional
language and component contracts if adopted. Define the intended behavioral
scope before an experiment, and report missing behavior as missing. Do not
shrink the scope afterward to claim that no extensions were necessary.

## Staged roadmap

Each stage consists of small, separately reviewable changes. These stages
govern shared-code and language experiments; [completing opcode coverage for
all eight CPUs](../../ROADMAP.md#complete-opcode-coverage-for-all-eight) remains
an independent milestone. Language representation, generation, and broader
migration follow only if the preceding review supports them. Neither this
sequence nor a finished DSL is a prerequisite for completing the current cores.

The [capability audit](completion.md#cpu-only-checkpoint-review) found that all
eight CPUs meet the checkpoint. Interrupt and I/O implementation now follows
the [completion sequence](completion.md#completion-sequence), alongside these
design probes and browser work. Later executable device-interface experiments
can use that evidence. The DSL must not become a prerequisite for continuing
to use the current CPU interfaces.

### 1. Specify contracts and difficult cases

Select the bounded instruction families and record their independently checked
behavior before moving responsibilities between helpers and CPUs. Begin with
comparisons across 6502, 8080, and 6809, plus representative transfer and memory
modification forms. Identify the existing helpers they already share and the
remaining repetition that might justify another abstraction.

For each proposed contract, state:

- The inputs, widths, outputs, and permitted operand roles.
- When values are captured and which selected locations remain stable.
- The reads, writes, flag changes, and their order.
- Which completed effects remain if an access fails or execution rejects.
- The processor differences the caller supplies and the combinations allowed.

Use the aliasing and access-order cases in this note as evidence. Reuse existing
independent expectations and add focused checks for important gaps, including
the 6502 memory shift's failing final write. Keep model changes separate from
refactoring an existing contract.

**Review point:** The proposed boundary and its difficult cases can be explained
without a framework or a language implementation. We know which behavior the
refactor must preserve and which duplication it is intended to remove.

### 2. Refactor a bounded set of shared building blocks

Implement the useful contracts in ordinary TypeScript. Comparisons provide
the first cross-architecture slice:

- 6502 CMP/CPX/CPY, with immediate and memory operands.
- 8080 CMP/CPI, with registers, memory through HL, and immediate operands.
- 6809 CMPA/CMPB and a representative word comparison such as CMPX, including
  an indexed source that updates the compared register.

Comparison already shares subtraction and has no result writeback. Include
small transfer and memory-modification examples before judging the overall
approach. Use them to examine flag-changing versus flag-preserving transfers,
exactly-once operand resolution, original-value writes, and the 6800/6809 CLR
access distinction. Extract a register view or an address calculation when
those examples need it; a general register or addressing framework is not a
prerequisite.

Keep current state schemas, public classes, opcode patterns, executors, and
the memory recorder. Prefer pure arithmetic and flag functions, narrow operand
contracts, and small named sequences. Preserve live reads where required;
avoid capturing a value early merely to simplify a function signature.

A callback can implement an explicit operation such as reading an already
resolved location. The signature and caller must make its effect contract
clear. An unrestricted callback that can change the whole CPU does not explain
which behavior has actually been shared. Representing callbacks as structured
DSL statements belongs to the later language experiment.

**Review point:** The full refactor is clearer or more coherent than the previous
implementation, with preserved independent expectations and useful types.
Judge the callers, helpers, tests, and cross-references together. Keep only
changes with a demonstrated benefit in the current TypeScript code. A smaller
CPU module and a possible future tool consumer are insufficient by themselves.

### 3. Review the boundaries and probe future CPUs

Challenge the extracted concepts before spreading them across the repository:

- 6502 memory ASL: C and N/Z change at different stages around a failing write.
- 6502 JSR: stack writes can alter a target byte that has not yet been fetched.
- 6809 CMPX: an addressing update can change the later comparison-register read.
- 8088 word access: logical wrapping precedes each physical address mapping.
- 68000 MOVE: source reads, pending address updates, and destination validation
  have different visibility and failure rules.

For migrated behavior, run executable checks. Other cases can initially use
complete ordered traces with every invoked effect specified; mark unimplemented
mechanisms explicitly. Keep substantial decoders and the 68000 pending-update
mechanism local while investigating their contracts. These probes do not
require migrating those entire cores.

Bring future architectures into this review now:

- A small 6507 family-binding and address-projection example should distinguish
  internal logical state from the external interface.
- Small 4004 models or traces should cover narrow arithmetic, register pairs,
  internal return-stack behavior, and selection followed by distinct memory
  and I/O operations, within the project's checkpoint constraints above.

Use a few illustrative DSL bodies to ask whether the contracts could be stated
clearly in a language. Such sketches are design probes, not evidence that an
executable DSL exists. Address the width and interface assumptions they expose;
a complete future CPU is unnecessary at this stage.

**Review point:** A few shared families work across distinct architectures,
and their limits are explicit. Reviewers can locate each value capture,
mutation, and failure boundary without following a large set of implicit
rules. Narrow the abstractions if they accumulate coupled switches, hide
processor differences, or need unrestricted state access to remain usable.
This is the point to consider a language experiment; a universal library and
an all-CPU refactor are not entry requirements.

### 4. Design a minimal DSL representation

Use the reviewed contracts to select a small vocabulary of declarations,
pure expressions, and ordered statements. Work through the same instruction
examples, including their difficult effect sequences. Specify operand roles,
widths and conversions, named-body parameters, captured-value lifetimes, and
how invalid combinations are rejected.

Distinguish the authored meaning from the current helper API. A language
statement may expand into several helpers or direct code. A specialized
instruction can be a short DSL body even when it has no shared library name.
The representation should make its effects inspectable without requiring one
language construct per TypeScript function.

Typed TypeScript builders are a useful initial authoring option. Compare the
cost of direct binding, interpretation, and a small TypeScript generator for
this bounded vocabulary. A generator is a promising first implementation:
known selectors and widths can yield straightforward code, and the repository
already has a [generation workflow](../machines/definitions.md#generated-factories).
Choose one executable approach for the first DSL experiment. External grammar and
a full literate authoring format can follow the semantic evidence.

**Review point:** The proposed representation expresses the selected contracts
clearly and identifies what a tool can inspect. Every claimed effect has a
meaning; the design exposes remaining gaps and the machinery required to
execute it. A diagram or attractive call site alone does not establish that
the language is worth adopting.

### 5. Execute one slice and produce a useful second output

The [current executable experiment](instruction-semantics.md#executable-generation-and-integration)
generates and binds comparison bodies across the three CPUs, plus 6502 loads,
register transfers, and zero-page ASL. It shares its definitions with the explanatory listing. The
JSR and 68000 probes below remain requirements for later vocabulary; they are
not yet represented by this byte/word slice. Whole-model migration remains a
separate decision.

The 6502 now authors these migrated instructions as encoding families and
generates their execution bindings too. Assess this cleanup against the complete
[authored-source footprint](coverage.md#source-footprint), including shared
machinery, before treating migration percentages as evidence of simpler code.

Implement the representation on the bounded comparison slice across the three
CPUs. Include at least one complete typed path from opcode mapping through
register binding, operand resolution, calculation, flag application, and
rejection handling. Exercise the indexed comparison and the 6502 memory-shift
failure sequence as executable tests of ordering. Carry the earlier JSR and
68000 traces through the same representation and make their implementation
status explicit.

Show all supporting types, validation, and execution machinery alongside the
resulting CPU code. If generation is chosen, include actual reproducible output
with correspondence to its CPU and shared-body definitions. Keep public CPU
interfaces and existing expectations as the comparison point.

Generate one useful explanatory output, such as a flag-effects summary, from
the same represented meaning. Independently check it. A hand-maintained
annotation or an opaque flag callback does not establish this benefit.

Compare this result with the ordinary TypeScript implementation from stage 2.
Count total authored concepts and cross-references, including validation and
debugging support. The DSL can justify additional machinery through a concrete
inspection or explanation benefit, provided the whole result remains clear.
When a definition is adopted into the DSL, retire its duplicate handwritten
semantic source and keep its independently authored tests. Remove temporary
old/new comparison fixtures when they no longer serve the migration.

**Review point:** Behavior and types are preserved, the implementation is
traceable to its specification, and the second output demonstrates a real
advantage. Stop or narrow the language if it merely wraps callbacks, needs
more ordering switches, or makes an instruction harder to explain without
sufficient benefit. Useful TypeScript sharing can remain even if the language
experiment is deferred.

### 6. Migrate one whole model, then prove specification-only additions

#### First complete existing model

Use the 6502 first: it has substantial independent expectations and supplies
the family behavior needed by the 6507. Migrate in reviewable groups of
comparisons and transfers, arithmetic and shifts, addressing and control flow,
and lifecycle behavior. This includes state construction, snapshots, fetching,
reset, and execution outcomes as well as instruction bodies.

Preserve the supported model while changing its implementation. Extend named
arithmetic algorithms, flag policies, and stack bodies as actual migrated
instructions require them. Keep decimal behavior and exceptional sequences
explicit. The target is all currently supported behavior represented in the
language, with no handwritten CPU semantics hidden in the public wrapper;
this is distinct from completing the hardware's instruction set.

#### Add the 6507 and 4004 with language support held fixed

After the initial complete-model migration, test the future-CPU examples
against a recorded, fixed version of the compiler, runtime, and language
primitives. Generated CPU output may change; it remains derived from the
specifications and DSL libraries through that fixed implementation.

For each attempt:

1. State supported instructions, lifecycle behavior, external interfaces,
   recording contract, and fidelity before implementation.
2. Permit new CPU specifications and libraries written in the DSL while
   holding host-language semantic support fixed.
3. Inventory required host-code extensions or compiler changes, the behavior
   each supplies, and any new surrounding component models.
4. Where the language is insufficient, review the smallest coherent common
   addition. Record that attempt as exposing a gap, then repeat against a new
   fixed version after the addition has been independently checked.
5. Verify behavior against independent reference expectations and inspect both
   the specification and its executable implementation.

The early probes from stage 3 are the starting point. Cover the full agreed
behavior now, including the unfamiliar interactions; a convenient subset does
not pass this stage. The 6507 should mostly reuse its family definition. The
4004 can require substantial new DSL definitions while using common language
support. Report coverage, host-code gaps, and surrounding component work
alongside the result.

**Review point:** The existing model and both agreed future-CPU models are
represented without CPU-specific host semantics, and their definitions remain
readable. An unreadable DSL workaround does not qualify merely because its
escape count is zero. These CPUs already influenced the design; test another
architecture that did not shape the initial vocabulary before making broader
claims.

### Later authoring and migration work

Once substantial specifications have established the semantic representation,
add external syntax, useful diagnostics, and a first literate CPU document
whose formal definitions produce its implementation. This can overlap the
later complete-model work when the representation is stable. Preserve source
correspondence and reproducible output as the authoring experience develops.

Migrate the remaining CPUs in reviewable groups: 8080/Z80 for family sharing,
6800/6809 for related operations with different conventions, 8008 for another
internal stack design, and then the broader 8088/68000 models. Earlier probes
should already have challenged their difficult cases. Each full migration
still needs its own independent checks and clarity review. Neither a universal
CPU factory nor replacement of the existing family hierarchy follows
automatically from language adoption.

When an architectural change is adopted, update the project roadmap,
architecture, and source organization guidance to describe the actual boundary.
Keep CPU model contracts and example specifications in their existing homes.
Coverage updates remain necessary when supported behavior changes; this note
should not become another implementation-progress list.

## Verification

The primary requirement is preservation of independently specified behavior.
Sharing implementation increases the reach of a bug, so a shared component
must not also become the sole source of expected test results.

### Shared component tests

Test actual contracts rather than mirroring implementation steps:

- Arithmetic facts against independent unsigned/signed range calculations,
  including exhaustive byte inputs and wider boundary cases. When another
  width is introduced, test its actual range and conversions independently;
  the proposed four-bit operations permit exhaustive input checks too.
- Flag updates against independently stated truth tables, including all
  preserved flags, incoming carry interpretation, and sticky behavior.
- Register views against byte conversion and masking expectations, including
  aliases, selected storage, and preservation of unrelated fields.
- Operand resolution against independently listed addresses and access traces,
  including exactly-once updates and reuse of a captured location.
- Memory and stack policies against explicit boundary addresses and ordered
  calls, including partial effects if an underlying access throws.
- Opcode construction against literal supported encodings, missing forms,
  duplicate rejection, and absence of construction-time state access.

The existing [ALU tests](../../tests/components/cpus/alu.test.ts) already use
independent range calculations and BigInt checks. Existing
[type checks](../../tests/types) provide a starting point for preserving
public and helper contracts.

### Specification and implementation correspondence

An inspectable representation needs checks of its own: operand widths and
roles, name binding, captured-value lifetime, declared effect order, and
unsupported combinations. Errors should identify the authored instruction
or shared definition responsible.

For generated code, check that regeneration is deterministic and that source
identities survive expansion. Exercise reads and writes that would expose
accidental reordering, duplication, or elimination. Include same-value writes,
overlapping instruction bytes, and errors between stages of an instruction.
For a bound or interpreted implementation, test the same semantic properties.

If an interpreter and generator share the same specification, agreement tests
can check their implementations against each other. They cannot establish
that the shared specification is correct. Retain independent CPU expectations
and independently check any claimed tool output, such as a flag-effects
summary. Generating both a handler and its expected test result from one
definition would conceal errors in that definition.

### Future-CPU acceptance checks

The future-CPU experiment needs independent expectations for both reused
behavior and the newly expressed distinctions. Proposed checks include:

- 6507 address projection for fetches, data, stack, and vector reads while
  retaining the full logical PC; shared family instruction behavior, including
  `BRK`; and declared behavior for available and unavailable external signals.
- 4004 arithmetic boundaries, register-pair views, internal return-stack
  behavior beyond its capacity, and selection followed by accesses to data,
  status, and I/O interfaces. Include consecutive instructions that expose
  incorrectly placed or prematurely discarded selection state.
- Access records that distinguish interfaces and access units without adding
  speculative reads, and isolation between CPU and component instances.
- An audit of authored host-code changes and opaque definitions. Zero
  CPU-specific extensions must cover the complete declared behavior, including
  lifecycle rules; device adapters and compiler branches cannot conceal them.

These are requirements for a future implementation experiment, not tests added
or passed by this note. Independent expectations must come from the selected
processor references and declared model contracts. Reusing a family library
can reuse appropriate tests, but it cannot replace tests of a variant's own
interface and boundary behavior.

### Retain CPU and program expectations

CPU tests must continue to check concrete opcodes, exact state and flag changes,
fetched instruction bytes, RAM contents, and ordered accesses. Do not generate
their expected flags or opcode lists from the definitions under test. Small
programs should continue to check composition across instructions and repeated
steps.

Particularly useful regression cases are:

| Case | What it protects | Existing evidence |
| --- | --- | --- |
| 6502 JSR stack writes overlap target bytes | Demand-driven fetching and captured bytes | [6502 tests](../../tests/components/cpus/6502.test.ts) |
| 6502 modification writes original and final values | Actual accesses, including same-value writes | [6502 tests](../../tests/components/cpus/6502.test.ts) |
| 6502 memory shift fails at either write | Separate C and N/Z update stages | [6502 regression tests](../../tests/components/cpus/6502.test.ts); also checked against the pre-refactor source |
| 6809 indexed load/store/compare aliases its index | Resolution order, live values, single updates | [6809 tests](../../tests/components/cpus/6809.test.ts) |
| 8080 and Z80 comparisons produce different auxiliary flags | Explicit operation policies | [8080 tests](../../tests/components/cpus/8080.test.ts), [Z80 tests](../../tests/components/cpus/z80) |
| 8088 word accesses cross a segment boundary | Logical progression before physical mapping | [8088 tests](../../tests/components/cpus/8088) |
| 8088 PUSH SP and POP SP | Source-capture and writeback order | [8088 tests](../../tests/components/cpus/8088) |
| 68000 source/destination auto-updates and alignment rejection | Pending effects and retained reads | [68000 tests](../../tests/components/cpus/68000.test.ts) |
| 8008 nested calls wrap the address slots | Selected PC storage and non-memory stack behavior | [8008 tests](../../tests/components/cpus/8008.test.ts) |
| Z80 block and 8088 REP operations step one element at a time | Runner boundaries, refetches, and records | [Z80 tests](../../tests/components/cpus/z80), [8088 tests](../../tests/components/cpus/8088) |

During migration, running old and new implementations against the same cases
can help find regressions. Agreement is evidence of preservation, not proof
that either implementation matches hardware. Independently authored model
expectations and reference-based checks remain necessary.

No new performance complexity should be justified by the expected overhead
of abstraction alone. Measure representative workloads if allocation or
dispatch becomes a concern. Static descriptions and direct handlers leave
several implementation choices available without choosing an optimizer now.

## Open design questions

The immediate question is which shared contracts improve the ordinary
TypeScript CPUs. The later language experiment should distinguish declarations,
pure expressions, and ordered effects; keep represented semantics inspectable;
and judge specifications together with their resulting implementations. The
stages should answer these questions in that order:

1. **First shared contracts:** which boundaries improve the current code on
   their own, and which are clearer left as explicit processor-local behavior?
   Have the hard cases taught us enough to begin the language experiment?
2. **Initial semantic representation:** which statements and expression forms
   suffice for the bounded examples, with clear operand lifetimes and useful
   diagnostics? How are independent widths and conversions represented? How
   much do TypeScript builders help author them?
3. **Execution strategy:** does direct binding, interpretation, or generation
   best demonstrate the vocabulary? What is the total cost of each approach,
   including validation and debugging?
4. **Operand implementation:** should resolved locations use callbacks, tagged
   data, or both? How do those execution choices implement the same specified
   reads and writes without changing their order?
5. **Named bodies:** which sequences have multiple consumers and deserve shared
   names, and which are clearest written directly in a processor specification?
   How can a family variant expose its effective rules without deep overrides?
6. **Specialized effects:** how should a 68000 body declare pending updates
   and commit checks while retaining their local contract? Is there evidence
   for a broader reusable mechanism?
7. **Temporary opaque extensions:** what semantic gaps remain, how are extension
   claims tested, and how do tools expose the limits of their understanding?
   What common language capability would eliminate each required escape?
8. **Source correspondence:** how should diagnostics and debugging connect
   expanded operations and generated handlers to their authored definitions?
9. **Adoption threshold:** what demonstrated clarity or tool benefit warrants
   the additional language machinery compared with ordinary shared functions?
10. **Component interfaces:** how are access units, named spaces, selection
    state, and external signals declared, owned, and recorded at the chosen
    fidelity without hiding CPU behavior in component adapters?
11. **Further architecture tests:** after the 6507 and 4004 probes, which CPU
    would provide independent evidence that authors can add specifications
    without changing the compiler or runtime?

The [first TypeScript experiment](shared-operation-blocks.md) supplies narrow
shared contracts and independent checks. Review those boundaries and complete
the staged probes before choosing an executable DSL representation. The later language
experiment must demonstrate its own benefit through clear execution and a
useful second output. The eventual target remains all declared CPU behavior
expressible without CPU-specific host-code extensions, tested through complete
models and future architectures. The vocabulary and runtime should grow from
that evidence rather than a framework built in advance.
