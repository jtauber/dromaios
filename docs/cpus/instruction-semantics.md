# Instruction semantics experiment

This implements the representation review in
[stage 4 of the shared-building-blocks proposal](shared-building-blocks.md#4-design-a-minimal-dsl-representation).
It supplies typed definitions, validation, and a reproducible
[expanded listing](semantic-examples.md). The eight CPU implementations and
their execution interfaces are unchanged. There is **no interpreter, emulator
code generator, opcode binding, or execution through these definitions yet**.

The experiment asks whether an instruction's meaning can be described clearly
enough for execution and explanation to share one source. The authored
[examples](../../src/components/cpus/semantics/examples.ts) pair prose with
structured bodies. This is a step toward the literate-programming aspiration;
it does not choose an external grammar or a document format for authoring CPUs.

## The review slice

| Definitions | What they challenge |
| --- | --- |
| 6502 CMP/CPX/CPY, immediate and absolute | Share subtraction without writeback; preserve V/D/I; C means no borrow |
| 8080 CPI, CMP B, CMP M | Immediate, register, and memory sources; parity and inverse half-borrow |
| 6809 CMPA/CMPB immediate, CMPX `,X++` | Byte/word widths; addressing changes the register that comparison subsequently reads |
| 6502 TAX and 8080 MOV B,A | Similar transfers with different flag effects |
| 6502 ASL zero page | One resolved address, an original-value write, and two separate flag stages |

These are fifteen illustrative bodies, not complete addressing-mode inventories.
Bodies start after opcode selection. `CMPX ,X++` starts after postbyte `81`
has selected that particular form; decoding or rejecting other postbytes is
not represented. The existing
[boundary probes](boundary-probes.md#existing-models-executable-evidence) and
independent CPU tests are the behavioral baseline.

## Representation and authoring

[model.ts](../../src/components/cpus/semantics/model.ts) separates declarations,
pure expressions, and ordered statements. Its constructors return ordinary
readonly data. There is no instruction callback stored in a definition.

`cpuSymbols(name, stateDescription)` imports the CPU's existing authority for
stored fields. It offers typed register and flag names and records register
widths from that schema. There is no second register-layout declaration.
Current symbols cover stored unsigned byte/word registers and the `flags`
group; slices, concatenated register views, banks, and computed views remain
future work. HL in the 8080 sample is explicitly read as H and L, then combined.

TypeScript distinguishes a register, a captured numeric expression, and a flag
expression. A register does not implicitly read itself. A numeric expression
cannot be a flag formula or register destination. Schema-derived names catch
misspelled registers and flags at compile time. Runtime validation checks
CPU identity and widths; the current state-schema types do not retain literal
register widths in TypeScript, so the experiment does not promise compile-time
width checking.

The shared `compare(register, source, policy)` construction function produces
four statements: read the source, read the register, capture subtraction,
and apply the policy. Source bodies and policies remain present as named,
inspectable data. The construction function itself is TypeScript, with typed
parameters; there is no general parameterized instruction-body call node yet.
We can judge the repeated pattern without first designing higher-order DSL
parameters for every operand role.

A `ValueSource` has a name, result width, ordered body, and pure result expression.
Its captures live in a fresh scope; only its yielded value enters its caller's
scope. Sources can explicitly update registers or access memory. Nothing about
the word “source” makes its body pure. A resolved memory address is an immutable
captured word used by later reads/writes, not a callback that can resolve again.

A `FlagPolicy` declares numeric parameters and Boolean assignments. Each
invocation binds exactly those parameters from captured caller values. Policies
cannot reference caller-local names implicitly, access live registers, or
perform memory operations. `unlisted: "preserve"` is mandatory. All assignments
within one invocation are simultaneous: evaluate every expression first, then
apply the updates. Distinct invocations remain at their declared positions in
the instruction body.

## Primitive meanings

This vocabulary deliberately supports unsigned **8- and 16-bit values** and
**16-bit byte memory addresses**. Widths are decimal; literals in expanded
listings are hexadecimal. There is no implicit truncation on a write.

| Expression | Meaning |
| --- | --- |
| `value(name)` | An already captured value in the current lexical scope |
| `literal(width, value)` | An unsigned constant that fits the width |
| `subtract(left, right)` | Binary subtraction modulo `2^width`, with no input borrow |
| `addWrap(left, right)` | Addition modulo `2^width` |
| `concat(high, low)` | Two bytes combined as `high * 256 + low`, yielding a word |
| `extend(value, width)` | Unsigned widening; narrowing and equal-width conversions are rejected |
| `negative(value)` | Whether the top bit at the value's width is set |
| `zero(value)` | Whether the unsigned value is zero |
| `evenParity(value)` | Whether a byte has an even population count, including zero |
| `borrow(left, right)` | Whether unsigned `left < right` |
| `halfBorrow(left, right)` | Whether `(left mod 16) < (right mod 16)`, at either supported width |
| `overflow(left, right)` | Whether signed subtraction falls outside the signed range at that width |
| `not(value)` | Boolean negation |

Binary operands must have equal widths. These arithmetic meanings correspond
to existing [ALU](../../src/components/cpus/alu.ts) contracts; the representation
does not implement or evaluate them yet. The reporter uses explanatory spellings
such as `topBit`, `zeroExtend16`, and `halfBorrow4` to expose those meanings.

| Statement | Ordered effect or capture |
| --- | --- |
| `capture` | Evaluate a pure numeric expression and give the value a fresh, immutable name |
| `read-register` | Read the selected stored register now, capturing its value |
| `fetch-byte` | Request one byte from the instruction context's fetch interface and capture it after success |
| `read-memory` | Read one byte at an explicit word address; capture it after success |
| `write-register` | Replace the stored register with an equal-width unsigned value |
| `write-memory` | Write one byte at an explicit word address, including unchanged values |
| `read-source` | Expand and perform the named source body once in its own scope, then capture its result |
| `update-flags` | Bind a named policy's pure parameters and apply its assignments at this point |

The current cores still own fetch-cursor behavior, PC commitment, access
recording, exception handling, and instruction boundaries. In particular,
`fetch-byte` does not assert one universal PC-update rule for all CPUs. A future
execution binding must preserve each core's existing context contract. Word
data reads in this slice are two explicit byte reads with visible ordering and
address wrapping; no word-access primitive hides the partial-read boundary.

Statements execute in their listed order under the proposed contract. A failed
effect stops the body; prior completed effects remain. There is no implicit
transaction or rollback. This describes the selected cores' existing host-error
behavior. Hardware fault delivery and cycle timing are separate contracts.

## Why the difficult cases remain visible

In `CMPX ,X++`, the source captures old X, writes `old X + 2` modulo 65536,
reads the high byte at old X, then the low byte at `old X + 1` modulo 65536.
The comparison register read follows all four effects. Thus a second-read
failure retains the increment and performs no comparison flag update. Moving
that register read earlier would change the definition, not just its formatting.

In ASL, the original-value write precedes any flag update. Doubling the byte
modulo 256 describes the result; the original top bit supplies C. The result
write separates the C policy from the N/Z policy. A reporter can locate each
stage directly, and an eventual executor must preserve both writes even when
their values are equal.

The 8080 comparison sample explicitly has no destination write. Its current
ALU path returns A to a common assignment, producing an assignment of A to
itself. Omitting that internal assignment retains the architectural behavior;
the later integration must check the existing records and independent tests.

## Validation and generated explanations

[defineInstruction](../../src/components/cpus/semantics/validate.ts) copies and
deeply freezes the description, then validates it. It rejects host functions,
accessor properties, class instances, and cycles without invoking accessors. Reused input objects are copied without freezing
the caller's objects. Definitions retain neither live CPU state nor an
instruction's runtime captures.

Validation rejects unknown/cross-CPU symbols, wrong widths, out-of-range
constants, undeclared or duplicate captures, escaping source locals, missing
or extra policy arguments, duplicate flag assignments, and unsupported
conversions. Diagnostics identify the CPU, instruction, statement, and named
source or policy. This is a typed authoring API, not a parser for arbitrary JSON.
Validation establishes structural correctness; it cannot establish that the
author chose the hardware's correct effect order or formulas.

[describeInstruction](../../src/components/cpus/semantics/describe.ts) expands
source bodies and substitutes policy arguments. It also derives the flags
preserved throughout the body from the schema and actual update statements.
Those lists are not hand-maintained annotations. Explanatory prose remains
authored text and is visibly separate from the generated operations.

Regenerate the committed [review artifact](semantic-examples.md) with:

```sh
node scripts/describe-cpu-semantics.ts
```

Add `--check` to verify it without writing. The normal test suite also compares
the artifact with fresh output. Source changes require regeneration; the ordinary
build does not silently rewrite this documentation.

[Tests](../../tests/components/cpus/semantics) independently specify expected
expansions and ordering, probe validation errors and ownership, and check
reproducibility. [Type checks](../../tests/types/instruction-semantics.ts) cover
schema-derived names and distinct operand roles. They test the representation
and reporting, not execution or equivalence to the existing CPUs.

## Decision and next review

The representation adds machinery and duplicates a small set of instruction
meanings during the experiment. No production instruction has been migrated,
and this change claims no source reduction. The useful result so far is that
operand order and CPU-specific flag formulas produce readable explanations
without inspecting host callbacks. Review the authored definitions, validator,
and reporter together with the output when judging that benefit.

For the next executable slice, prefer a small **TypeScript generator**. It can
emit direct ordered statements and use existing arithmetic helpers, while
keeping the result inspectable alongside its definition. Direct binding would
need an adapter for each represented operation; interpretation would put that
dispatch on the execution path. Generation fits the repository's existing build
workflow. Keep it unoptimized initially and retain correspondence to definitions.

That next slice must bind the actual CPU state/context types, preserve opcode
selection and rejection behavior, and pass the existing independent comparison
tests. It must also execute the indexed-read and ASL-write failure cases.
Only after that evidence should migrated handwritten semantics be removed.

General addressing decoders, register views, flag reads, branches, loops, stack
bodies, instruction rejection, pending commits, and exception delivery are not
represented here. The 6502 JSR and 68000 MOVE traces still challenge later
ordering vocabulary. The 6507 address-projection and 4004 nibble/interface probes
remain acceptance requirements, not capabilities of this byte/word slice.
