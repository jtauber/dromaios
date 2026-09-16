# Instruction semantics experiment

This implements the bounded executable review in
[stage 5 of the shared-building-blocks proposal](shared-building-blocks.md#5-execute-one-slice-and-produce-a-useful-second-output).
Typed definitions drive validation, a reproducible [expanded listing](semantic-examples.md),
and generated TypeScript instruction bodies used by the 6502, 8080, and 6809.
The public execution interfaces and supported opcode inventories are unchanged.

The experiment asks whether an instruction's meaning can be described clearly
enough for execution and explanation to share one source. The authored
[examples](../../src/components/cpus/semantics/examples.ts) pair prose with
structured bodies. This is a step toward the literate-programming aspiration;
it does not choose an external grammar or a document format for authoring CPUs.

## The review slice

| Definitions | What they challenge |
| --- | --- |
| 6502 CMP/CPX/CPY, every supported addressing form | Share subtraction without writeback; preserve V/D/I; C means no borrow |
| 8080 CPI and every CMP register/memory form | Immediate, register, and memory sources; parity and inverse half-borrow |
| 6809 CMPA/CMPB immediate; CMPX immediate/direct/extended and `,X++` | Byte/word widths; addressing changes the register that comparison subsequently reads |
| 6502 TAX and 8080 MOV B,A | Similar transfers with different flag effects |
| 6502 ASL zero page | One resolved address, an original-value write, and two separate flag stages |

There are 32 bodies. All are generated and executable; 31 are bound into their
CPU's opcode table. MOV B,A remains a generated transfer test: adding a dispatch
hook for that one sample would complicate the shared 8080/Z80 transfer family.
Other 6809 comparison addressing forms and other shift forms retain their
existing shared helpers. This is not a complete CPU migration.
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
to existing [ALU](../../src/components/cpus/alu.ts) contracts; generated code
uses those helpers for arithmetic facts and parity. The reporter uses explanatory spellings
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
`fetch-byte` does not assert one universal PC-update rule for all CPUs. Generated
bodies receive each core's existing callbacks, including interrupt-supplied
fetching on the 8080. Word
data reads in this slice are two explicit byte reads with visible ordering and
address wrapping; no word-access primitive hides the partial-read boundary.

Statements execute in their listed order under this contract. A failed
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
stage directly. Generated code preserves both writes even when their values
are equal, and leaves C committed if the final write fails.

The 8080 comparisons explicitly have no destination write. The shared 8080/Z80
ALU table now binds complete instruction handlers; ordinary arithmetic still
uses the shared operand-and-accumulator helper. The 8080 selects generated
comparison bodies instead. Its old compare wrapper and redundant A assignment
are removed; the Z80 keeps its existing arithmetic behavior.

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
schema-derived names, distinct operand roles, concrete generated CPU-state
types, and the precise context capabilities each body needs. Execution tests
cover all byte operand pairs against independent arithmetic, word boundaries,
lexical scope isolation, source effects, and retained effects on failure. The
existing CPU tests remain the independent opcode, record, and rejection baseline.

## Executable generation and integration

[generateInstructions](../../src/components/cpus/semantics/generate.ts) validates
and freezes its input before emitting code. Generated methods take the concrete
`Cpu6502State`, `Cpu8080State`, or `Cpu6809State` and only the callbacks their
statements use, expressed as a `Pick<ByteInstructionContext, ...>`. Register-only
bodies have no context parameter. There is no interpreter or semantic dispatch
on the execution path.

Captures become uniquely named constants. Source scopes are expanded inline,
with separate name maps; only the result enters the caller's map. Policy
arguments are captured once, then all flag results are computed before any flag
assignment. No reads, writes, or policies move across one another. Widths select
the existing ALU helper arguments and sign bits. Widening a known unsigned byte
requires no JavaScript arithmetic. The output is deliberately unoptimized:
repeated subtraction facts remain separate calls rather than introducing an
optimization pass into this review.

The [generation script](../../scripts/generate-cpu-semantics.ts) produces
`src/components/cpus/generated/{6502,8080,6809}.ts`. These files are ignored build
output and removed by `npm run clean`. Regenerate with `npm run generate:cpus`;
`npm run build` generates these bodies and the machine factories automatically.
The source-only check and ordinary compilation both type-check the generated
bodies. Reproducibility tests compare every module with fresh output and run the
native generator in a clean temporary tree from another working directory.

The three CPU-owned state declarations now live under
[`src/components/cpus/state/`](../../src/components/cpus/state), re-exported
through their original CPU modules. This lets definitions and generation load
schemas without importing execution or requiring generated files to exist.
The machine parser imports those schemas directly too, so machine generation
works independently of generated CPU output. There is still one authority for
each CPU's stored fields.

Opcode selection remains in the CPU tables. The 6502 binds the complete
comparison families, TAX, and zero-page ASL. The 8080 binds all nine CMP/CPI forms.
The 6809 binds immediate CMPA/B, three ordinary CMPX modes, and one indexed body:
it fetches the postbyte once, selects generated `,X++` for `81`, and delegates
other forms to its existing indexed decoder. Unsupported postbytes retain the
same rejection behavior. Generated definitions do not silently claim the rest
of that decoder.

## Decision and next review

This slice demonstrates one meaning producing both executable code and an
explanation. It **adds authored machinery overall**, including the generator,
more explicit addressing sources, and integration bindings. Moving state
schemas and producing ignored output is not source reduction. The 6502 and
8080 handwritten comparison wrappers are removed, while shared arithmetic and
addressing helpers still serve instructions outside the migration. Review the
whole change, including definitions and generated output, rather than the CPU
module line counts alone.

The next decision is whether this extra structure earns its inspection benefit
before expanding the vocabulary. Keep the comparison and failure probes as
regressions. Improve definition readability where needed, then migrate another
small coherent group; do not jump to a general CPU grammar or whole-model rewrite.

General addressing decoders, register views, flag reads, branches, loops, stack
bodies, instruction rejection, pending commits, and exception delivery are not
represented here. The 6502 JSR and 68000 MOVE traces still challenge later
ordering vocabulary. The 6507 address-projection and 4004 nibble/interface probes
remain acceptance requirements, not capabilities of this byte/word slice.
