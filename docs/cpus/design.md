# CPU language design

Dromaios aims to describe a processor in a readable, executable guide: its
history, architecture, model contract, and formal behavior should explain one
another. The eight initial CPUs are authored this way. The
[language reference](literate-specifications.md) defines implemented notation;
the [coverage report](coverage.md) records current support and source footprint.
This document retains design rationale and open work. Proposals below are not
implemented syntax or a second task schedule; [ROADMAP.md](../../ROADMAP.md) owns
project priorities.

## Principles

**Keep hardware choices visible.** A compact definition is useful when it exposes
a real pattern. It is harmful when it hides different read order, flag rules,
address wrapping, or failure behavior behind a misleading common operation.
The implementation should help explain the processor.

**Separate pure calculations from ordered effects.** Arithmetic can share width,
carry, borrow, and overflow facts. Each CPU selects its flag policy and when
to apply it. Operand fetching, current-state reads, memory accesses, and
register updates occur at explicit points. The
[representation contract](instruction-semantics.md#primitive-meanings) defines
these distinctions; the [boundary probes](boundary-probes.md) supply hard cases.

**Store each value once.** Derived pairs, packed status, byte aliases, and banked
register views read the authoritative stored representation. Writes state
which bits change and when preserved bits are read. A resolved location and a
captured value have different lifetimes; sharing must respect both.

**Preserve encoding structure.** Fixed bits, selector fields, aliases, and
exceptions should be visible beside the operation they select. Named operands
can share meaningful address calculations without pretending that selecting
an encoded register number reads the register.

**Share mechanisms, declare policies.** Recording successful accesses, guarding
callbacks, copying state, and dispatching validated encodings are runtime
services. Interrupt masks, frame layouts, pending-update commits, and retirement
choices belong in specifications. Similar instruction sets alone do not justify
inheriting one CPU implementation from another.

**Keep definitions inspectable.** Generated code and explanations consume the
same typed data. The language has no host-code escape hatch. A missing capability
calls for a small, explicit addition with independent checks, not a hidden
processor-specific callback. No-escape authoring is also a readability test:
an opaque workaround does not qualify as a good specification.

**Measure the whole cost.** Count chapters, shared compiler/runtime code, scripts,
and generated expansion separately. Moving lines between files is not a
reduction. Measure generation time, memory use, and executable behavior before
accepting extra machinery for performance. Maintain source correspondence and
useful diagnostics as the implementation evolves.

## Reusable specification libraries and CPU families

Sources, policies, actions, operand groups, and width parameters already share
behavior within a chapter. Cross-chapter libraries and family derivation remain
design work. They should let related processors reuse definitions while keeping
the effective behavior readable in each processor's guide.

A useful family mechanism must explain what is shared and what differs: state,
address projection, encoding choices, instruction semantics, and external
connections. Avoid deep chains of overrides whose result can only be understood
by reading several ancestors. Imported definitions should retain source locations
and produce an inspectable expanded view of the resulting CPU.

The 8080/Z80 relationship can test reusable instruction families with differing
flags, registers, encodings, and retirement. The
[6507 probe](boundary-probes.md#6507-family-reuse-with-address-projection) tests a
smaller variant: retain the 6502's logical state and instruction behavior while
projecting all memory accesses onto thirteen address lines and omitting external
IRQ/NMI inputs. Software BRK remains part of that model. Neither proposal requires
subclassing generated public CPU classes.

## Proving specification-only additions

The current eight CPUs helped shape the vocabulary. Their successful generation
does not establish that a new architecture can be added with the language and
runtime held fixed. Use the 6507 and
[4004 probes](boundary-probes.md#4004-independent-widths-and-retained-selection) to test that claim.
They are design probes, not implemented CPUs or additions to the initial eight.

For each attempt:

1. Record the compiler/runtime version and the full agreed model scope:
   instructions, lifecycle, external connections, records, and fidelity.
2. Permit new CPU specifications and specification libraries while holding
   host-language semantic support fixed.
3. Inventory every required compiler/runtime extension and surrounding component
   model, explaining the behavior each supplies.
4. If the vocabulary is insufficient, identify the smallest coherent common
   addition, validate it independently, and repeat against a new fixed version.
   Record the first attempt as a discovered gap.
5. Check independent hardware expectations and review both the specification
   and generated implementation for clarity.

The 6507 should mostly demonstrate reuse. The 4004 tests a different architecture:
four-bit data, twelve-bit program addresses, separate spaces, and persistent
selection state. State schemas alone are insufficient; expressions, effects,
connections, and records must also express that behavior. A convenient subset
that omits the unfamiliar interactions does not pass the agreed test.

Both probes have influenced the design already. After them, choose another
architecture that did not shape the vocabulary before making broader claims
about generality.

## Component interfaces

Current memory, port, and device connections serve the existing models. A more
general component language should state access widths, named spaces, persistent
selection, external signals, and record ownership explicitly. CPU behavior must
not disappear into an adapter whose semantics other outputs cannot inspect.

The 4004's selection operations illustrate the boundary: a later transfer can
depend on a previously selected bank and register. Its specification must state
which component owns that selection and which effects are observable. This is
separate from cycle-accurate electrical modeling, which needs its own chosen
fidelity and acceptance criteria.

## Further outputs and source correspondence

The current pipeline produces executable modules and expanded instruction
explanations. The [reading site](../../site/README.md) also renders specifications,
Sauvignon diagrams, and state-derived storage maps. Future outputs may include
disassembly, debugger views, interactive lessons, and embedded emulators.

Those tools need stable correspondence between authored definitions, expanded
operand selections, generated handlers, and runtime events. Existing compiler
diagnostics retain document locations; richer execution/source mapping remains
open work. A new output should demonstrate a concrete use of the semantic data,
and clearly identify anything it cannot infer from that data.

## Acceptance of language changes

Evaluate a proposed construct against real definitions from several processors.
It should improve their explanations as well as their formal blocks. Preserve
independent CPU expectations when changing representation; do not regenerate
expected hardware results from the implementation under test.

The most useful open questions are how to express cross-chapter reuse without
obscuring differences, how to carry source correspondence through specialization,
and which additional widths/spaces/events a new architecture actually needs.
Resolve these through bounded examples and complete model checks, keeping the
current language reference separate from speculative notation.
