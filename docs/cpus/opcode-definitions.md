# Opcode definition experiment

The [opcode helpers](../../src/components/cpus/opcodes.ts) are a small experiment
in describing existing encodings within TypeScript. The goal is to make the
hardware easier to read while preserving each CPU's execution behavior. The
8008, 6502, 6800, and 6809 tables use patterns throughout, with typed selector
mappings for families. These examples exercise several encoding relationships:

| CPU | Pattern | Meaning |
| --- | --- | --- |
| [8008](../../src/components/cpus/8008.ts) | `00 xxx 111`, `01 xxx 100`, `01 xxx 110` | RET, JMP, and CAL ignore bits 5–3, giving eight aliases each |
| [6502](../../src/components/cpus/6502.ts) | `ff v 100 00` | `ff` selects N/V/C/Z; `v` selects the value required to branch |
| [6800](../../src/components/cpus/6800.ts) | `0010 ttt p` | Seven conditional pairs expand `p`; BRA is explicit because `21` is unused |
| [6809](../../src/components/cpus/6809.ts) | `0010 ttt p` | `ttt` selects a condition; `p` selects whether to invert it |

The helper describes encodings; each CPU still defines supported instructions,
public types, flags, reset, wrapping, and recorded memory accesses. The other
CPU models retain their existing tables.

## Explicit entries and families

`opcodeTable<OpcodeHandler>(entries)` constructs the dispatch table from an
ordered list of `[opcode, handler]` pairs. Entries can be written directly or
expanded from patterns and families. Keep meaningful bit grouping and nearby
mnemonics, with each definition at its place in the CPU's encoding order.

The list preserves every entry until validation. Duplicate opcode bytes throw
an error, including an overlap between an explicit instruction and a family,
or two definitions with the same handler. Entries cannot silently replace one
another. Byte values must be integers from `00` through `FF`; absent entries
remain unsupported.

`opcodePattern(pattern, handler)` binds the same handler to every encoding of
a pattern. Fixed bits describe one opcode; ignored bits describe aliases. For
example, the 8008 uses `00 000 100` for ADI, `00 000 00x` for the adjacent
`00`/`01` HLT encodings, and `00 xxx 111` for the RET aliases `07`, `0F`, `17`,
`1F`, `27`, `2F`, `37`, and `3F`. The same notation serves all three cases.

`opcodeFamily(pattern, selectors, bind)` maps encoded fields to typed values
and binds a handler for each combination. The 6502 branch definition is:

```typescript
...opcodeFamily("ff v 100 00", {
  f: ["n", "v", "c", "z"],
  v: [false, true],
}, ({ f: flag, v: value }) => ({ fetchByte }: InstructionContext) =>
  this.#branch(fetchByte(), this.#state.flags[flag] === value)),
```

The first arrow binds a flag name and required value during table construction.
The second arrow fetches the operand and checks the CPU's current flag when
the instruction executes. TypeScript infers `flag` as the four literal flag
names and `value` as Boolean. The instruction context remains CPU-specific.

## Pattern rules

- A pattern describes exactly one eight-bit opcode, most significant bit first.
  Spaces, other whitespace, and underscores are ignored for grouping.
- `0` and `1` are fixed bits. `x` is a reserved marker for ignored bits and has
  no selector binding.
- Other lowercase letters name fields. All occurrences of a letter belong to
  that field, read most significant first, even if separated in the pattern.
- Each field has a selector array in numeric encoding order. A two-bit field
  requires four entries; a three-bit field requires eight. Missing, extra, or
  sparse mappings fail during construction.
- Selector values can be register names, Booleans, or functions such as the
  6809's condition tests. Construction binds these values without evaluating
  the condition functions.

Every combination in a family becomes an entry. Use families only where all
those encodings are supported. Keep exceptions and incomplete groups explicit,
or split them into disjoint supported patterns. In particular, an omitted
selector entry does not mean an unsupported instruction. Prefixes and operand
postbytes are outside this experiment.

The 6800 demonstrates such a gap within `0010 ttt p`. Its CPU-local
`#branchPair` binds the two values of `p` to a condition and its inverse,
keeping each pair on one table line. BRA has an explicit pattern, so the unused
`21` never enters the table. This uses the existing helper without an exclusion
mechanism or the 6809's additional BRN instruction.

## Execution and verification

Construct tables once per CPU instance. Binding functions capture selectors;
they must not read live CPU state or access RAM. The CPU retains ownership of
state, instruction fetching, addressing, flags, control flow, and recorded
accesses. This follows the [source organization guide](implementation.md).

The existing CPU and program tests retain their independent expected results.
[Helper tests](../../tests/components/cpus/opcodes.test.ts) check literal opcode
lists, selector bindings, ignored bits, execution-time state reads, invalid
definitions, and overlaps. [Type checks](../../tests/types/opcodes.ts) check
selector inference and preservation of CPU-specific handler contexts.

## What this leaves open

This is a review point for the readability of typed encoding definitions.
Broader register, addressing, or instruction-semantic definitions should grow
from further CPU work, including the 8088 and 68000. Instruction completion is
not a prerequisite for another useful experiment.

The longer-term [literate programming direction](../architecture.md#implementation-language-and-future-definition-languages)
remains open: a detailed CPU description could eventually supply the definitions
that generate its emulator. Document format, external language syntax, tooling,
and generation of other outputs can wait. This experiment does not choose them.
