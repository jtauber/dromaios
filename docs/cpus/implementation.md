# CPU implementation guide

CPU behavior is authored in executable Markdown under
[`src/components/cpus/specifications/`](../../src/components/cpus/specifications).
The [language reference](literate-specifications.md) describes that notation;
the [representation contract](instruction-semantics.md) describes the typed data
it produces. This guide explains how those sources become public CPU modules
and where to change the compiler and shared runtime.

Follow the source priorities in [AGENTS.md](../../AGENTS.md#priorities-for-source-code):
correctness, clarity, elegance, then measured performance. Hardware choices
belong in the specifications; shared TypeScript implements their declared effects.

## Generation pipeline

```text
Executable Markdown
  → located cpu declarations
  → validated, immutable semantic data
  → generated chapter modules, state types, and catalogues
  → generated instruction bodies, lifecycle bindings, and public classes
  → compiled JavaScript
```

1. [`generate-cpu-chapters.ts`](../../scripts/generate-cpu-chapters.ts) discovers
   Markdown files directly under `specifications/` in filename order. The `cpu`
   declaration supplies model identity. Filenames use lowercase letters, digits,
   and single hyphen separators; `catalogue`, `interfaces`, and `state` are reserved.
2. [`compile.ts`](../../src/components/cpus/semantics/literate/compile.ts) extracts
   declarations with document locations, resolves names and operand selections,
   and validates types, scopes, effects, and encodings. Diagnostics retain the
   Markdown filename, line, and column. There is no host-language evaluation.
3. [`chapter-data.ts`](../../src/components/cpus/semantics/literate/chapter-data.ts)
   serializes shared definitions into typed constants. The chapter stage also
   emits small stored-state modules, instruction registration, and public-interface
   metadata under `semantics/generated/`. All chapters are compiled and duplicate
   complete model identities rejected before this stage replaces its output.
4. [`generate-cpu-semantics.ts`](../../scripts/generate-cpu-semantics.ts) loads the
   generated catalogue through [`definitions.ts`](../../src/components/cpus/semantics/definitions.ts).
   It emits instruction bodies, state readers/actions, reset and execution bindings,
   event delivery, and public CPU classes under `generated/`. It prepares and
   checks module names before replacing that directory.
5. TypeScript compiles generated and shared sources. Runtime execution imports
   ordinary modules; it needs neither a Markdown parser nor filesystem access.

`npm run generate:cpus` performs both generation stages. `npm run build` also
regenerates machines and checks types; `npm test` builds before running the full
suite. Use the Node version in `.nvmrc`. The complete commands and filtered-test
workflow are in [Development](../../README.md#development).

Generated directories and `dist/` are ignored, disposable build products.
Edit the originating specification or shared implementation, never their output.
The tracked [expanded instruction listing](semantic-examples.md) is the exception:
refresh it with `node scripts/describe-cpu-semantics.ts` when definitions or their
explanations change. That command refreshes chapter data too; `--check` checks
listing freshness. The ordinary build does not rewrite the listing.

### Following the 8008 files

The repeated CPU name identifies different outputs of one specification:

| Path under `src/components/cpus/` | Role |
| --- | --- |
| `specifications/8008.md` | Authored hardware guide, model contract, and executable definitions |
| `semantics/generated/8008.ts` | Validated chapter data and instruction registration |
| `semantics/generated/state/8008.ts` | Stored-state schema, derived TypeScript types, and public aliases |
| `generated/8008.ts` | Executable instruction bodies and opcode bindings |
| `generated/8008-state.ts` | Executable register views and state actions |
| `generated/8008-execution.ts` | Chapter-selected execution policies bound to the shared runtime |
| `generated/8008-cpu.ts` | Public `Cpu8008` class and result types |

Other models can generate additional modules for operand groups, reset, or
external events. These are outputs of the same pipeline, not additional authored
CPU implementations. Small schema and interface modules let runtime and machine
consumers obtain metadata without importing the expanded instruction catalogue.
[`models.ts`](../../src/components/cpus/models.ts) exposes the generated model
catalogue to machine parsing, generation, and CPU test selection.

## Contributor map

Paths below are relative to `src/components/cpus/`.

| Responsibility | Main sources |
| --- | --- |
| Markdown extraction and diagnostics | `semantics/literate/document.ts`, `compile.ts` |
| Language expressions and ordered statements | `semantics/literate/expressions.ts`, `statements.ts`, `choose.ts`, `iterations.ts`, `matches.ts` |
| State, reset, execution, and interface declarations | Corresponding modules under `semantics/literate/` |
| Typed representation and ownership | `semantics/model.ts`, `builders.ts`, `validate.ts` |
| Instruction emission and descriptions | `semantics/generate.ts`, `generate-pages.ts`, `describe.ts` |
| Opcode expansion and page layouts | `opcodes.ts`, `semantics/opcode-pages.ts` |
| Stored-state validation and copying | `state.ts` |
| Access recording and guarding | `memory-access.ts`, `port-access.ts`, `coprocessor-access.ts`, `execution-boundary.ts` |
| Byte fetching and decoding | `byte-execution.ts`, `decoded-execution.ts`, `execute-byte-instruction.ts` |
| Vector entry and supplied instructions | `vector-execution.ts`, `vector-offers.ts`, `interrupt-entries.ts`, `interrupt-instruction.ts` |
| Segmented execution | `segmented-execution.ts` |
| Word execution and modeled faults | `word-execution.ts`, `word-runtime.ts`, `word-memory.ts`, `word-events.ts`, `register-updates.ts` |
| Shared result shapes | `execution-records.ts`, `instruction-context.ts` |

The runtime implements mechanics such as recording a successful transfer,
guarding reentrant calls, or retaining pending register writes. The chapter
selects recognition gates, flag policies, fetch commitment, frame order, vectors,
and retirement. Do not add a CPU-name switch to shared machinery to bypass a
missing declaration; make the needed behavior explicit and independently test it.

## Reading order

Specifications introduce stored state and views before the sources, policies,
actions, instruction families, and lifecycle contracts that use them. Group
related families by encoding and behavior; explain meaningful exceptions next
to the pattern. See the [authoring guidance](literate-specifications.md#reading-and-building-a-chapter).

For generated public modules and shared runtime code, use this order where the
corresponding material exists:

1. State and record types, execution contexts, and small snapshot helpers.
2. Stored fields and the public constructor, `snapshot()`, `reset()`, `step()`,
   and external-event methods.
3. Derived register/status views and their writes.
4. Opcode selectors, table construction, and family bindings.
5. Decoding, lifecycle, retirement, and event orchestration.
6. Memory mapping and multi-byte access mechanics.

Omit empty sections and unnecessary wrappers. Construction binds inert data;
execution reads the current instance state. A handler created while constructing
a table must not capture a register's current value as an instruction operand.

## Stored-state descriptions

Chapter `state` blocks generate immutable descriptions using
[`state.ts`](../../src/components/cpus/state.ts):

| Description | Meaning |
| --- | --- |
| `unsigned(bits)` | Unsigned register or selector |
| `flag` | Boolean architectural flag |
| `boolean` | Boolean control latch |
| `choices(0, 1, 2)` | Exact permitted integer alternatives |
| `namedChoices("none", "sync", "cwai")` | Exact named alternatives |
| `array(8, unsigned(14))` | Fixed array of unsigned values |
| `group(fields)` | Nested stored fields |

`defineState(fields)` owns the readonly description. `StateValues<Description>`
derives mutable state, including tuple lengths and choice unions;
`ReadonlyState<State>` describes recursively readonly snapshots. Public CPU
modules re-export their generated descriptions and types.

Construction validates and copies declared fields, including nested arrays and
groups. It reads each declared field once, accepts inherited/non-enumerable
fields, ignores extra metadata and derived views, and rejects sparse arrays.
Invalid numbers or choices produce `RangeError`; invalid groups, array lengths,
or Booleans produce `TypeError`, with a stored-field path. Snapshots use
`copyState` to detach known-valid state and then add chapter-defined views.
They do not access RAM.

The [machine parser](../../src/machines/machine-language.ts) uses the same schemas
for field names and constraints. It owns machine-language notation and source
locations, rather than duplicating CPU state definitions. Stored schemas alone
do not specify reset, register relationships, or execution; those belong in the
chapter's other declarations. [State tests](../../tests/components/cpus/state.test.ts)
and [type checks](../../tests/types/state.ts) establish the shared contract.

## Opcode patterns

The chapter language's [encoding notation](literate-specifications.md#expressions-and-policies)
uses the same expansion rules as [`opcodes.ts`](../../src/components/cpus/opcodes.ts).
Patterns are eight or sixteen bits, read most significant bit first. Spaces
and underscores only separate fields. `0` and `1` are fixed, `x` is ignored,
and other lowercase letters name selector fields. Repeated letters form one
value in significance order, including noncontiguous bits.

`opcodePattern(pattern, handler)` binds one handler to every matching encoding.
`opcodeFamily(pattern, selectors, bind)` selects operands and invokes `bind` for
each encoding. A selector needs exactly `2 ** fieldWidth` dense entries; missing,
extra, and sparse selectors are errors. The binder receives fresh selections.
The pattern cache retains encoding structure, never caller selectors, handlers,
or instance state.

`opcodeTable(entries, bits)` checks the permitted integer range and rejects
all duplicate entries, even if handlers match. Eight bits is the default;
sixteen-bit words and twenty-four-bit page inventory keys are also supported.
Explicit exceptional encodings must be disjoint from their families; ordering
is not an override mechanism. [Opcode tests](../../tests/components/cpus/opcodes.test.ts)
and [type checks](../../tests/types/opcodes.ts) exercise these contracts.

## Runtime effects and records

Fetching, memory, ports, and device connections record successful effects in
order. Failed accesses are not invented in a success log. Instruction-byte
capture is distinct from ordinary memory access recording. Guards prevent an
external callback from recursively entering a CPU operation while its state is
partially updated; guards must release on failure.

[`execution-records.ts`](../../src/components/cpus/execution-records.ts) shares
fetched-instruction and before/after/access shapes while preserving each CPU's
concrete snapshot and outcomes. Generated interfaces select ordinary, halted,
waiting, interrupt, and fault results. Address meaning, partial failures,
no-fetch entries, and retirement rules belong to the CPU specification, not
a blanket promise that a failed instruction rolls back.

Keep multi-byte order, address progression, and register commitment separate.
For example, segmented words advance the logical offset before physical
projection; word execution can retain pending address-register updates until
an explicit commit. Memory-mapped device effects follow the same ordered access
path as RAM. The [boundary probes](boundary-probes.md) explain why these
mechanisms cannot be collapsed into one transactional read/modify/write helper.

## Safe sharing and performance

The chapter compiler owns finalized sources, policies, and the current CPU
declaration before instruction families use them. Composed actions reuse their
owned bodies. New execution capabilities replace the CPU declaration while
earlier definitions retain their original contract. See the
[ownership boundary](instruction-semantics.md#representation-and-ownership).

Within one encoding declaration, the chapter compiler reuses an immutable body
when operand and condition selections match. Ignored bits can add aliases
without recompiling that body; exclusions and collisions still check every
opcode. Reuse does not cross declarations or compilations.

Chapter serialization compares ordered plain data before formatting shared
constants and emits dependencies before users. Equality includes field order
and execution capabilities, not just names. Only model bindings pass between
generation stages, allowing the first stage's large instruction graphs to be
reclaimed before the generated registry loads.

Keep these optimizations local and behavior-preserving. The
[footprint report](coverage.md#source-footprint) records measurements and their
method; do not infer runtime speed from fewer authored lines. Compare generated
output when changing emission or sharing, and require measurements before
adding complexity for performance.

## Validation

Language changes need positive and negative cases for types, scopes, source
locations, and effect ordering. Generator changes need independent expected
behavior through the public CPU, including aliases, wrapping, preserved state,
partial failures, records, and retained snapshots. A generated listing or an
interpreter using the same definitions is useful evidence of correspondence,
but is not an independent hardware oracle.

Use focused tests while iterating, then the full `npm test` regression check for
code changes. CPU filters omit shared semantics/helper tests. Use `test:built`
only with current compiled output. Documentation-only changes need link and
example checks, not a full emulator regression run.
