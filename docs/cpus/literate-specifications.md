# Literate CPU specifications

The first executable chapter is
[MOS 6502: loading and storing the accumulator](../../src/components/cpus/specifications/6502-load-store.md).
It is the maintained source for LDA, STA, their addressing catalogue, and the
shared N/Z flag policy. The remaining 6502 definitions import those shared
descriptions rather than maintaining another copy.

This is an authoring-language prototype over the existing
[instruction representation](instruction-semantics.md), with a deliberately
small vocabulary. It is not yet a language for describing an entire CPU.
Current counts and milestone evidence belong in the
[coverage report](coverage.md#literate-authoring-milestone).

## Reading and building a chapter

A chapter is ordinary Markdown with executable `cpu` fences. Prose explains
the hardware and the model's choices. The paragraph immediately before a family
fence supplies that family's generated explanation; wrap it freely across
lines, without inserting a paragraph break. Other prose and other fenced code
are not executable. Opening backtick or tilde fences must be unindented;
block quotes and indented code, including fences inside lists, are not executed.

The build proceeds through:

```text
Markdown chapter
  → extracted cpu blocks with document locations
  → validated instruction representation
  → generated chapter data imported by existing CPU definitions
  → generated instruction bodies and expanded explanations
```

`npm run generate:cpus` performs both generation stages; `npm run build` and
`npm test` include them. Chapter data is generated under
`src/components/cpus/semantics/generated/`; executable bodies remain under
`src/components/cpus/generated/`. Both directories are ignored and disposable.
`node scripts/describe-cpu-semantics.ts` also refreshes chapter data before
generating the tracked explanation listing; add `--check` to check that listing.
No Markdown parser or filesystem access is required to execute a CPU.

The [front end](../../src/components/cpus/semantics/literate/compile.ts) lowers
formal statements into the same typed representation as TypeScript-authored
definitions. It uses the existing width, scope, state-reference, and ordered
effect validator. Diagnostics include the Markdown filename, line, and column.
Statement errors identify the statement; declaration-wide errors identify the
declaration. A malformed chapter stops generation before existing output is
removed. There is no host-language evaluation or TypeScript escape hatch.

## Syntax in this slice

Each declaration or statement occupies one line. Braced bodies close on their
own line, within the same fence. Blank lines and `//` comments are allowed.
Declarations precede their uses; forward references and recursion are absent.
Names start with a letter and contain letters, digits, or underscores. Names
are unique within a chapter. Captures are local to each source or instruction.
Quoted descriptions use JSON string escaping.

| Construct | Meaning |
| --- | --- |
| `cpu "6502"` | Select the CPU schema supplied to the compiler. |
| `register A: 8`, `flag N` | Declare the state used here, checked against the schema. Uppercase names map to lowercase stored fields. |
| `source zeroPage "zero page": 16 { … }` | Ordered steps ending in a numeric `return`; each use has its own capture scope. |
| `offset = fetch` | Fetch and capture the next instruction byte. |
| `index = register X` | Read and capture the register at this point. |
| `address = source zeroPage` | Evaluate and capture a previously declared source. |
| `byte = memory(address)` | Read and capture one byte. |
| `pointer = add(offset, index)` | Capture a pure numeric expression. Addition wraps at the operands' equal width. |
| `A <- result`, `memory(address) <- byte` | Write the captured value to a register or byte memory location. |
| `apply NZ(result)` | Apply a declared flag policy to a captured argument. |

Numeric expressions are capture names, explicitly sized literals such as
`u8($01)` or `u16($FFFF)`, and `add(left, right)`, `concat(high, low)`, or
`extend(value, width)`. Calls can nest. Numbers are decimal unless prefixed
with `$`; widths are decimal. Captures and literals retain their widths, so
zero-page wrapping follows from eight-bit addition rather than a special
6502 operation.

A policy has one typed numeric parameter and named flag updates:

```text
policy NZ "6502 result N/Z" (result: 8) {
  N = negative(result)
  Z = zero(result)
}
```

`negative` tests the top bit at the value's width; `zero` tests for zero. Updates
take effect together, and unlisted flags are preserved. Duplicate flag updates
are rejected. These are the first supported flag expressions, not the intended
limit of the language.

A `modes` declaration lists every binary selector value in numeric order, each
with a quoted operand label and either `memory sourceName` or `value sourceName`.
For this slice, memory sources return sixteen-bit addresses and reads fetch one
byte. Each memory mode supplies `.read` and `.address`; a value mode supplies
only `.read`. A family binds a single named encoding field to that catalogue:

```text
family LDA "101 bbb 01" for b in accumulator.read {
  result = source b
  A <- result
  apply NZ(result)
}
```

The existing [opcode-pattern rules](opcode-definitions.md) expand the bits.
The selector must match the pattern's cardinality. `.address` excludes
value-only modes, which explains the missing immediate STA form. Duplicate
opcodes are rejected, including collisions between families. Family names plus
operand labels become the instruction names.

## Boundaries and next evidence

The CPU state schema remains authoritative for storage and public TypeScript
types. Chapter declarations describe and validate the subset used here; they do
not yet generate that schema. Native opcode fetching, execution records, reset,
interrupt recognition, and retirement remain in the existing CPU core. Most
instruction families are still authored in TypeScript.

The next language experiments should use contrasting instruction families,
such as the 8008's narrow state and the 68000's word operations and ordered
effects. Use their requirements to revise the vocabulary before migrating a
complete CPU. The later milestone is a whole CPU description, including its
state and lifecycle contracts, that needs no CPU-specific compiler changes.
This first chapter establishes an executable authoring path, not a percentage
estimate of the work remaining toward that goal.

The [language tests](../../tests/components/cpus/semantics/literate.test.ts)
check the fifteen encodings, production integration, prose, malformed syntax,
width and scope errors, and a formal edit that changes generated execution.
Existing independent 6502 tests continue to cover values, wrapping, read/write
order, live state changes, and failure boundaries. The initial migration also
compared every definition and generated module with the pre-chapter baseline;
no parallel handwritten LDA/STA implementation is retained.
