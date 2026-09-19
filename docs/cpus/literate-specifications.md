# Literate CPU specifications

Executable chapters are maintained instruction sources:

- [MOS 6502: loading and storing the accumulator](../../src/components/cpus/specifications/6502-load-store.md)
  defines LDA/STA and the addressing catalogue and N/Z policy reused by the
  remaining 6502 definitions.
- [Intel 8008: moving bytes between registers and memory](../../src/components/cpus/specifications/8008-transfers.md)
  defines register/memory transfers and immediate loads, including their runtime
  opcode bindings. Its H:L address source also serves the arithmetic definitions.

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
declaration. All chapters must compile successfully before any existing output
is removed. There is no host-language evaluation or TypeScript escape hatch.

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
| `result = operand s`, `operand d <- result` | Read or write a selected register/memory operand at this point. |
| `apply NZ(result)` | Apply a declared flag policy to a captured argument. |

Numeric expressions are capture names, explicitly sized literals such as
`u8($01)` or `u16($FFFF)`, and `add(left, right)`, `and(left, right)`,
`concat(high, low)`, or `extend(value, width)`. `and` is bitwise AND on
equal-width values. Calls can nest. Numbers are decimal unless prefixed
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
with a quoted operand label and `register A`, `memory sourceName`, or
`value sourceName`. For this slice, memory sources return sixteen-bit addresses
and memory accesses transfer one byte. Every mode supplies `.read`; only a memory
mode supplies `.address`. A family can select a source view from a catalogue:

```text
family LDA "101 bbb 01" for b in accumulator.read {
  result = source b
  A <- result
  apply NZ(result)
}
```

The existing [opcode-pattern rules](opcode-definitions.md) expand the bits.
Each selector must match its encoding field's cardinality. `.address` excludes
non-memory modes, which explains the missing immediate STA form. Duplicate
opcodes are rejected, including collisions between families. With one selector,
the default instruction name is the family name followed by its operand label.

A family can also bind several fields independently. A catalogue without a
source-view suffix binds an operand, preserving its register or memory identity:

```text
family transfer "11 ddd sss" for d in bytes, s in bytes named "L{d}{s}" except "11 111 111" {
  result = operand s
  operand d <- result
}
```

The first statement captures the source; the second writes the destination.
A memory operand resolves its address at the statement that accesses it. Thus
a store reads its address registers after capturing the source, and never reads
the destination byte. Value-only operands can be read but cannot be written.
Address sources keep their own capture scope. Compiler-created address captures
cannot collide with, or be referenced by, authored names.

`named` provides an instruction-name template, required for multiple selectors.
Braced placeholders select operand labels; unknown placeholders are errors.
Labels are inserted literally, with no recursive substitution or host evaluation.
`except` accepts one or more comma-separated fixed/alias opcode patterns, where
`x` is ignored. Exclusions must belong to the family, must not overlap, and
must leave at least one instruction. The 8008 excludes its HLT encoding here;
HLT remains implemented separately.

These expanded opcode entries also supply the 8008's selected runtime bindings.
The build does not maintain a second transfer-encoding table in the CPU core.

## Boundaries and next evidence

The CPU state schema remains authoritative for storage and public TypeScript
types. Chapter declarations describe and validate the subset used here; they do
not yet generate that schema. Native opcode fetching, execution records, reset,
interrupt recognition, and retirement remain in the existing CPU core. Most
instruction families are still authored in TypeScript.

The 8008 chapter adds register selectors, ordered operand reads/writes, and
14-bit address masking. It does not yet describe the three-bit address-stack
selector or the stack array. A 68000 word-transfer chapter should next challenge
widths and ordered effects before we migrate a complete CPU. The later milestone
is a whole CPU description, including its state and lifecycle contracts, that needs no CPU-specific compiler changes.
These chapters establish an executable authoring path, not a percentage
estimate of the work remaining toward that goal.

The [6502 language tests](../../tests/components/cpus/semantics/literate.test.ts)
and [8008 language tests](../../tests/components/cpus/semantics/literate-8008.test.ts)
check inventories, runtime integration, document diagnostics, malformed selectors
and exclusions, capture isolation, and formal edits that change execution.
Independent CPU tests retain their expected values, wrapping, access-order,
live-state, and failure-boundary checks. The 8008 migration also compared the
old and new generated execution, including every transfer and memory ALU form.
The chapter replaces the maintained transfer definitions and encoding table.
