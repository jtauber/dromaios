# Literate CPU specifications

Executable chapters are maintained instruction sources:

- [MOS 6502: loading and storing the accumulator](../../src/components/cpus/specifications/6502-load-store.md)
  defines LDA/STA and the addressing catalogue and N/Z policy reused by the
  remaining 6502 definitions.
- [Intel 8008: transfers, arithmetic, and rotations](../../src/components/cpus/specifications/8008.md)
  defines register/memory transfers, immediate loads, all eight accumulator
  operations, register adjustments, and accumulator rotates. Each arithmetic
  family shares one body across register, memory, and immediate encodings.
- [Motorola 68000: moving a word](../../src/components/cpus/specifications/68000-word-transfers.md)
  defines word copies between data registers and word loads/stores through `(An)`.
  Its word-result flag policy also serves the remaining word definitions.

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
Names start with a letter and contain letters, digits, or underscores.
Declaration names are unique within a chapter, except that registers and flags
have separate namespaces: the 8008 declares both register C and flag C. Captures
and policy parameters start with a lowercase letter; captures are local to each
source or instruction.
Quoted descriptions use JSON string escaping.

| Construct | Meaning |
| --- | --- |
| `cpu "6502"` | Select the CPU schema supplied to the compiler. |
| `register A: 8`, `flag N` | Declare the state used here, checked against the schema. Uppercase names map to lowercase stored fields. |
| `source zeroPage "zero page": 16 { … }` | Ordered steps ending in a numeric `return`; each use has its own capture scope. |
| `offset = fetch` | Fetch and capture the next instruction byte. |
| `index = register X`, `carry = flag C` | Read and capture a register or flag at this point; the capture retains its numeric or flag type. |
| `address = source zeroPage` | Evaluate and capture a previously declared source. |
| `byte = memory(address)` | Read and capture one byte. |
| `pointer = add(offset, index)` | Capture a pure numeric expression. Addition wraps at the operands' equal width. |
| `A <- result`, `memory(address) <- byte` | Write the captured value to a register or byte memory location. |
| `result = operand s`, `operand d <- result` | Read or write a selected register/memory operand at this point. |
| `apply NZ(result)`, `apply ALU(result, carry(left, right))` | Apply a declared flag policy to typed numeric and flag expressions. |
| `address = resolve(16, mode, code)` | Ask the existing address decoder to resolve an operand of the stated width; mode and code are captured three-bit values. |
| `fault alignment read(address) if lowBit(address)` | Return an alignment fault when the captured predicate is true, before subsequent effects. `write` identifies a failed destination access. |
| `commit addresses` | Commit register updates staged by the existing address decoder. |

Numeric expressions are capture names, explicitly sized literals such as
`u8($01)` or `u16($FFFF)`, and these operations:

| Operation | Meaning |
| --- | --- |
| `add(left, right[, carry])`, `subtract(left, right[, borrow])` | Wrap at the operands' equal width; the optional third argument is a flag expression. |
| `and(left, right)`, `or(left, right)`, `xor(left, right)` | Bitwise operations on equal-width values. |
| `shiftLeft(value, bit)`, `shiftRight(value, bit)` | Shift one place, inserting the flag expression at the vacated end. |
| `concat(high, low)` | Join two equal-width values, with high first. |
| `extend(value, width)`, `truncate(value, width)` | Widen or narrow explicitly. |
| `highByte(word)`, `lowByte(word)` | Extract a byte from a sixteen-bit word. |

Calls can nest. Numbers are decimal unless prefixed with `$`; widths are decimal.
Captures and literals retain their widths, so zero-page wrapping follows from
eight-bit addition rather than a special 6502 operation. Expressions never
read state implicitly; register and flag reads remain separate statements.

A policy has zero or more typed parameters and named flag updates. Parameters
can be numeric widths or `flag`:

```text
policy ALU "8008 result S/Z/P/C" (result: 8, carry: flag) {
  S = negative(result)
  Z = zero(result)
  P = evenParity(result)
  C = carry
}
```

Flag expressions are captured flags or policy parameters, literal `0`/`1`, or:

| Predicate | Meaning |
| --- | --- |
| `negative(value)`, `zero(value)`, `lowBit(value)` | Test the top bit at the value's width, zero, or bit zero. |
| `evenParity(byte)` | Test even parity of a byte, including zero. |
| `carry(left, right[, incoming])`, `borrow(left, right[, incoming])` | Test unsigned carry or borrow at the operands' equal width, with an optional incoming flag. |

Flag constants use `0` and `1`, not spelled-out booleans. Updates take effect
together, and unlisted flags are preserved. Duplicate parameters and duplicate
flag updates are rejected. Policy expressions use only their parameters and
literals; they cannot refer to source names or capture names in an instruction
that applies the policy. These same typed predicates can appear in instruction
expressions and alignment-fault conditions.

A declaration such as `operands bytes { … }` lists every binary selector value
in numeric order, each with a quoted operand label and `register A`,
`memory sourceName`, or `value sourceName`. For this slice, memory sources return
sixteen-bit addresses and memory accesses transfer one byte. Every operand
supplies `.read`; only a memory operand supplies `.address`. A family can select
a source view from a catalogue:

```text
family LDA "101 bbb 01" for b in accumulator.read {
  result = source b
  A <- result
  apply NZ(result)
}
```

The existing [opcode-pattern rules](opcode-definitions.md) expand the bits.
Each selector must match its encoding field's cardinality. `.address` excludes
non-memory operands, which explains the missing immediate STA form. Duplicate
opcodes are rejected, including collisions between families. With one selector,
the default instruction name is the family name followed by its operand label.
A fixed instruction, such as `family RLC "00 000 010" { … }`, needs no selector
and defaults to the family name.

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
must leave at least one instruction in each encoding. The 8008 excludes its
HLT encoding here; HLT remains implemented separately.

A family can declare several encodings followed by one shared body:

```text
family AC {
  encoding "10 001 sss" for s in bytes.read named "AC{s}"
  encoding "00 001 100" with s = immediateByte named "ACI byte"
  right = source s
  carry = flag C
  left = register A
  result = add(left, right, carry)
  apply ALU(result, carry(left, right, carry))
  A <- result
}
```

`with` binds a local name to a declared source; it does not evaluate that source
until the body reads it. Each encoding has its own selectors and source aliases,
so this body reads either a register, memory, or the next instruction byte at
the same explicit point. Aliases cannot shadow declarations or selectors.
Encoding lines precede all body statements, and each must contribute at least
one opcode. The compiler checks collisions both within and between families.

Expanded entries supply the 8008's runtime bindings. Chapter-owned definitions
and the remaining TypeScript control/port definitions form one checked opcode
inventory; the CPU core maintains no second instruction-encoding table.

An encoded value catalogue uses `codes` rather than `operands`:

```text
codes addressRegisters {
  000 "A0"
  001 "A1"
  010 "A2"
  011 "A3"
  100 "A4"
  101 "A5"
  110 "A6"
  111 "A7"
}
```

These entries are read-only numeric operands whose values come from the binary
codes. Every code of the selector width must appear, in order, and that width
must be supported by the instruction representation. Labels supply instruction
names; they do not declare or read stored registers. The 68000 reads the selected
three-bit value with `code = operand r`, then uses `resolve(16, u3(2), code)`
for address-register indirect mode. This keeps A7's bank selection in the existing
decoder. Word size, address checks, byte order, destination preservation, and
flag timing remain explicit in the chapter.

`resolve`, `commit addresses`, and alignment faults lower to existing IR effects,
whose validator currently requires the 68000 address/exception boundary.
They add no decoder or exception-delivery implementation to the compiler.
Ordinary `memory` reads and writes still transfer one byte, including at 32-bit
logical addresses on the 68000. Its core projects them onto the physical bus.
Word transfers explicitly combine or split those bytes. A false fault condition
continues normally; a true one returns the fault to the CPU boundary without
undoing completed effects. Value sources cannot contain instruction rejection.

## Review of the three chapters

The three examples support a common vocabulary without hiding their different
access rules. `operands` replaces the prototype's `modes` keyword: it describes
6502 addressing choices, 8008 byte registers and memory, and 68000 data registers
equally well. `codes` remains distinct because selecting an encoded register
number does not read the register. All three chapters use the new spelling;
there is no compatibility alias for the prototype keyword.

Keep effects and captures explicit. The 6502 resolves a store's address before
reading A; the 8008 captures the source before resolving a memory destination.
The 68000 reads the destination's preserved upper bits only at writeback.
A shorter assignment notation that conceals these reads would make those
differences harder to see. Sized literals and explicit width conversions also
make wrapping and byte order visible.

The 68000's upper-word merge expression repeats twice. Leave it expanded for
now: a register-view or writeback abstraction could conceal the timing of the
preserved-bit read. If later arithmetic chapters justify reusable pure
expressions, their arguments should be captured values, with state reads still
visible at the call site. Keep the native address resolver, pending-update
commit, and fault return visible until a chapter owns their definitions.

Family explanations should describe their particular operation and stand on
their own in the expanded listing. The 8008 transfer and immediate-load families
now have separate explanations, without repeating the same general paragraph.
Author feedback follows the same principle of locality: unknown declarations
are rejected before searching for a body, and policy expression errors point
to their flag update rather than the policy header.

## Boundaries and next evidence

The CPU state schema remains authoritative for storage and public TypeScript
types. Chapter declarations describe and validate the subset used here; they do
not yet generate that schema. Native opcode fetching, execution records, reset,
interrupt recognition, and retirement remain in the existing CPU core. Most
instruction families are still authored in TypeScript.

The three chapters now exercise contrasting widths and ordered effects.
The 8008 still lacks its address-stack selector and array in the language;
the 68000 still uses its native effective-address decoder, including A7 banking
and pending auto-updates. Its 192 chapter encodings select generated bodies
before the broader MOVE catalogue's shared bodies; those shared bodies still
serve other sizes and addressing modes. Only the chapter-owned forms earn
literate coverage.

The 8008 is the first whole-CPU target: its small instruction set provides a
bounded way to develop the remaining language. Its arithmetic and flags now
exercise shared encoding bodies, typed carry inputs, parity, and ordered
writeback. Next, use its address stack and control flow to test state and
lifecycle definitions; port effects also remain outside the language. Each
chapter should replace its corresponding maintained TypeScript definitions
and retain independent execution tests. The destination
is a whole CPU description, including its state and lifecycle contracts, that
needs no CPU-specific compiler changes.
These chapters establish an executable authoring path, not a percentage
estimate of the work remaining toward that goal.

The [6502 language tests](../../tests/components/cpus/semantics/literate.test.ts),
[8008 transfer tests](../../tests/components/cpus/semantics/literate-8008.test.ts),
[8008 arithmetic language tests](../../tests/components/cpus/semantics/literate-8008-arithmetic.test.ts),
and [68000 language tests](../../tests/components/cpus/semantics/literate-68000.test.ts)
check inventories, runtime integration, document diagnostics, malformed selectors
and exclusions, capture isolation, and formal edits that change execution.
Independent CPU tests retain their expected values, wrapping, access-order,
live-state, and failure-boundary checks. The 8008 migration also compared the
old and new CPU execution across all 256 opcode slots, flags, address-stack
selectors, ordinary and supplied instruction streams, and transfer failures.
The chapter replaces the maintained transfer, ALU, adjustment, and rotate
definitions; the generated table replaces their handwritten encoding bindings.
The 68000 checks include independent ordered-effect expectations, failure at
each observable stage, live upper-word preservation, both A7 banks, physical
projection, and formal edits that change byte order and flag behavior.
