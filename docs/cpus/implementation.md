# CPU source organization

CPU models under `src/components/cpus/` use a common reading order while
retaining each processor's encoding and behavior. This follows the source-code
priorities in [AGENTS.md](../../AGENTS.md#priorities-for-source-code): correctness,
clarity, elegance, then performance.

## Reading order

1. **Types and state descriptions.** Public flags, stored state, its runtime
   description, snapshots, instruction/access records, and outcomes come first.
   Keep internal instruction-context types and small snapshot-view helpers nearby.
2. **Stored fields and public API.** Start the class with its owned state and
   memory connection, then the constructor, `snapshot()`, `reset()`, and `step()`.
   A reader should be able to follow the execution contract before decoding details.
3. **Register and flag views.** Group derived register pairs and packed status
   getters/setters where the implementation needs them. Pure helpers that derive
   views from a copied register bank can stay with the snapshot helpers.
4. **Opcode selectors and construction.** Keep operand/operation selectors,
   the opcode table, and any family builders together. Order builders by their
   appearance in the table.
5. **Instruction behavior.** Group addressing, loads/stores/exchanges,
   control flow and stack operations, and arithmetic/logic/flags. Keep related
   helpers together even when their opcodes occupy different encoding groups.
6. **Recorded memory access.** Keep the RAM read/write wrappers together at the
   end of the class. Record the actual accesses made during execution.

Use short section comments where they help navigation. Omit sections that have
no implementation yet. Small cores can use explicit opcode entries throughout;
they do not need selector arrays or family builders merely to resemble a larger
core. Keep a CPU in one file while this organization remains easy to follow.

## Stored-state descriptions

Each CPU module exports a `cpu…StateDescription` beside its public state
interface. The description owns stored field names and constraints. The
[shared state helpers](../../src/components/cpus/state.ts) provide:

| Description | Meaning |
| --- | --- |
| `unsigned(bits)` | An unsigned register or selector of the given width |
| `flag` | A Boolean architectural flag |
| `boolean` | A Boolean control latch |
| `choices(0, 1, 2)` | An explicit set of permitted integer values |
| `array(8, unsigned(14))` | Eight unsigned 14-bit values in physical slot order |
| `group(fields)` | A nested group, such as flags or an alternate register bank |

`defineState(fields)` owns a readonly field map; the field helpers create
immutable descriptions. `satisfies StateDescription<Cpu…State>` checks fields
against the readable public interface, including nested types, tuple lengths,
and permitted-value types. Widths and hardware semantics still require
independent tests. The Z80 describes its register bank once and reuses that
description for both banks.

The descriptions have three consumers:

- Constructors use `readState(description, initialState)` to copy and validate
  caller state. It reads only declared fields, once each, including inherited
  and non-enumerable properties. Nested groups and arrays get separate storage;
  sparse arrays fail validation. Extra metadata and derived views are ignored.
- Snapshots use `copyState(description, storedState)` to detach known-valid
  state without repeating numeric and Boolean validation. Derived views remain
  explicit in each CPU's `snapshot()` method.
- The [machine parser](../../src/machines/machine-language.ts) imports those
  same descriptions to recognize fields and check values, array lengths, and
  choices. It retains ownership of hexadecimal notation, braces, capitalization,
  flag spelling, duplicate/missing-field checks, and source-location diagnostics.

The constructor helper reports `RangeError` for invalid numbers or choices,
and `TypeError` for invalid groups, array lengths, or Booleans, with a stored
field path such as `alternate.flags.c` or `addressStack[3]`. The parser reports
`SyntaxError` with the filename, line, column, and caret. Fixed-array diagnostics
use the declared count, for example `addressStack requires exactly 8 values`.

Descriptions cover stored state only. Derived register relationships, reset,
instruction semantics, and RAM requirements remain explicit CPU behavior.
The [helper tests](../../tests/components/cpus/state.test.ts) and
[type checks](../../tests/types/state.ts) exercise the shared contracts; CPU
and machine tests retain their independently authored hardware expectations.
This is a concrete step toward richer CPU descriptions. Their eventual
[literate form](../architecture.md#implementation-language-and-future-definition-languages)
remains open.

## Make the encoding visible

Use binary opcode values or explicit bit patterns, grouping meaningful fields
with underscores or spaces. Explain the bit positions, fixed bits, and selector
values beside the code. The [opcode definition experiment](opcode-definitions.md)
uses patterns throughout the 8008, 6502, 6800, 6809, 8088, and 68000 tables, with typed selector
mappings for families. Ordinary addresses, memory images, and arithmetic
constants can remain hexadecimal.

Choose the grouping from the CPU's encoding:

| Model | Organization in the current source |
| --- | --- |
| [8008](../../src/components/cpus/8008.ts) | Native `xx yyy zzz` groups; A is register selector `000`, M is `111`; preserve documented HLT exceptions |
| [8080](../../src/components/cpus/8080.ts) | `xx yyy zzz`; leading `xx` blocks, then `zzz` subgroups where it selects the family; split `yyy` into `pp q` for pair operations |
| [6502](../../src/components/cpus/6502.ts) | `aaa bbb cc`; `cc` groups, then the relevant `bbb` subgroups; explain the distinct meanings of implied and addressing forms |
| [6800](../../src/components/cpus/6800.ts) | Accumulator forms use `1 r mm oooo`; `r` selects A/B, `mm` the addressing mode, and `oooo` the operation; short branches use `0010 ttt p`, keeping the unused `21` explicit |
| [6809](../../src/components/cpus/6809.ts) | Opcode page and family-specific fields; the current A-register forms use `10 mm oooo`, while stack instructions use `001101 s p` and a separate register-mask postbyte |
| [Z80](../../src/components/cpus/z80.ts) | Unprefixed `xx yyy zzz` groups; preserve distinct prefix pages as support grows |
| [8088](../../src/components/cpus/8088.ts) | Family-specific fields: `00 ooo 10 w` for immediate accumulator arithmetic, `1010 00 d w` for direct accumulator transfers, and `1011 w rrr` for immediate register loads; keep logical instruction offsets distinct from physical data-word accesses |
| [68000](../../src/components/cpus/68000.ts) | Sixteen-bit operation words; MOVE encodes destination register/mode before source mode/register; ADDI uses a size field and source-independent effective address |

Keep each encoded subgroup contiguous, including its alternate selector cases
and exceptions. For example, the 8080's `11 pp q 001` group contains both the
generated POP forms and the explicit `q=1` operations. A shared construction
loop should not scatter that group across the table.

Keep individual opcode entries on one line where practical, with the pattern,
handler, and mnemonic together so readers can scan the encodings vertically.
Prefer this regular layout over wrapping a short handler solely to meet a line
length limit. Move substantial behavior into named methods so table entries
remain compact. Family definitions can span lines to show their selector
mappings clearly.

Keep instruction mnemonics next to their encodings. Explain exceptions and
relevant gaps in place, such as HLT occupying the 8080's MOV M,M slot. A bit
pattern describes a relationship; it does not establish that every combination
is documented or implemented. Never fill unsupported slots just to complete a
pattern. Distinguish opcode bytes from prefixes and operand postbytes, and
explain postbyte fields separately.

The complete support inventory belongs in [CPU implementation coverage](coverage.md).
This guide describes organization and does not replace the model contracts or
manufacturer references for instruction behavior.

## Keep construction separate from execution

Selector arrays map encoded values to operands or operations. Keep substantial
execution logic, especially arithmetic and flag rules, in named CPU-specific
methods beside the related operations. Small assignments may remain inline
when their effect is immediately clear.

Construct the dispatch table once per CPU instance. Preserve the initialization
order of fields it depends on: JavaScript initializes instance fields before
the constructor body, regardless of their textual position relative to it.
Family builders capture callbacks; they must not read live CPU state or access
RAM while building the table. Callbacks read registers and flags when the
instruction executes, so later instructions see current values.

Use family builders when they reveal an encoding relationship and remove useful
duplication. Keep them aligned with encoded subgroup boundaries and retain
explicit exceptional entries. This convention does not require a common decoder,
CPU base class, or definition language.

## Verify a reorganization

Preserve public contracts, supported encodings, flag effects, wrapping, reset,
unsupported-attempt behavior, and the order of actual memory accesses. Run the
existing independent CPU and example checks plus the build/type checks. Tests
should establish instruction behavior from independent expectations; avoid
tests that merely repeat a builder's encoding formula or prescribe private
method placement.
