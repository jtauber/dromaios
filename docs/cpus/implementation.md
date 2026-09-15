# CPU source organization

CPU models under `src/components/cpus/` use a common reading order while
retaining each processor's encoding and behavior. This follows the source-code
priorities in [AGENTS.md](../../AGENTS.md#priorities-for-source-code): correctness,
clarity, elegance, then performance.

## Reading order

1. **State descriptions and types.** Stored-field descriptions, the state and
   flag types derived from them, snapshots, instruction/access records, and outcomes come first.
   Keep CPU-specific instruction-context extensions and small snapshot-view
   helpers nearby; import the shared contexts where they fit.
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
6. **Memory access.** Use the shared recorder for RAM reads and writes. Keep
   CPU-specific bus mapping and multi-byte access helpers together at the end
   of the class when needed.

Use short section comments where they help navigation. Omit sections that have
no implementation yet. Small cores can use explicit opcode entries throughout;
they do not need selector arrays or family builders merely to resemble a larger
core. Keep a CPU in one file while this organization remains easy to follow.

## Stored-state descriptions

Each CPU module exports a `cpu…StateDescription` beside its public state
type. The description owns stored field names, types, and constraints. The
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
immutable descriptions. `StateValues<typeof cpu…StateDescription>` derives the
mutable stored-state type, including nested groups, fixed tuple lengths, and
permitted-value unions. Public flag types select the state's `flags` field.
This avoids declaring each register and flag twice. Snapshots add readonly
guarantees and derived views explicitly; the 8008 also exposes its address
stack as readonly in caller-supplied state. Widths and hardware semantics still
require independent tests. The Z80 describes its register bank once and reuses
that description for both banks.

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
uses patterns throughout the 8008, 8080, 6502, 6800, 6809, 8088, and 68000 tables,
with typed selector mappings for families. Ordinary addresses, memory images, and arithmetic
constants can remain hexadecimal.

Choose the grouping from the CPU's encoding:

| Model | Organization in the current source |
| --- | --- |
| [8008](../../src/components/cpus/8008.ts) | Native `xx yyy zzz` groups; A is register selector `000`, M is `111`; preserve documented HLT exceptions |
| [8080](../../src/components/cpus/8080.ts) | `xx yyy zzz`; leading `xx` blocks, then `zzz` subgroups where it selects the family; split `yyy` into `pp q` for pair operations |
| [6502](../../src/components/cpus/6502.ts) | `aaa bbb cc`; `cc=01` groups `aaa` operations with shared `bbb` operand readers; `cc=00/10` retain `bbb` subgroups and their distinct implied/addressing forms |
| [6800](../../src/components/cpus/6800.ts) | Accumulator forms use `1 r mm oooo`; `r` selects A/B, `mm` the addressing mode, and `oooo` the operation; unary forms use `01 tt oooo`, with `tt` selecting A/B/indexed/extended; short branches use `0010 ttt p`, keeping the unused `21` explicit |
| [6809](../../src/components/cpus/6809.ts) | Base-page accumulator families use `1 r mm oooo`; unary groups use `0000 oooo`, `010r oooo`, `0110 oooo`, and `0111 oooo`; stack instructions use `001101 s p` and a separate register-mask postbyte |
| [Z80](../../src/components/cpus/z80.ts) | Unprefixed `xx yyy zzz` groups and a separate CB `xx yyy rrr` table; decode the complete supported encoding before committing state |
| [8088](../../src/components/cpus/8088.ts) | Family-specific fields: `00 ooo 0 d w` / `00 ooo 10 w` for ALU families, `mm ggg rrr` for ModR/M operands or operation extensions, `0101 p rrr` for register stacks, `0111 ttt p` for conditional jumps, and `1010 00 d w` / `1011 w rrr` for transfers; wrap byte offsets within the selected segment before mapping to the physical bus |
| [68000](../../src/components/cpus/68000.ts) | Sixteen-bit operation words; MOVE encodes destination register/mode before source mode/register; immediate ALU families encode operation, size, and a data-alterable effective address |

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

Construct dispatch tables independently of execution. Most cores bind handlers
once per instance; the 68000 shares a static table whose handlers receive the
executing CPU explicitly. This avoids rebuilding its thousands of transfer
encodings without capturing instance state. Preserve the initialization
order of fields a table depends on: JavaScript initializes instance fields before
the constructor body, regardless of their textual position relative to it.
Family builders capture callbacks; they must not read live CPU state or access
RAM while building the table. Callbacks read registers and flags when the
instruction executes, so later instructions see current values. In static
initializers use `this` for earlier static fields; instance methods refer to
the class explicitly.

Use family builders when they reveal an encoding relationship and remove useful
duplication. Keep them aligned with encoded subgroup boundaries and retain
explicit exceptional entries. This convention does not require a common decoder,
CPU base class, or definition language.

## Shared execution records

The [execution-record types](../../src/components/cpus/execution-records.ts)
provide the common fields used by all eight CPUs:

- `FetchedInstruction` contains the start `address` and actual fetched `bytes`.
- `StateTransition<Snapshot>` contains `before`, `after`, and ordered memory
  `accesses`. The supplied snapshot type retains its CPU's fields, derived
  views, and nested readonly guarantees.

CPU modules keep their public names as aliases, such as `Cpu6502Instruction`
and `Cpu6502ResetRecord`. Step records combine `StateTransition` with their
own instruction fields and outcome unions. Null instructions, rejection reasons,
and alignment faults remain specific to the CPU. Address conventions are still
documented beside the aliases, including the 8088's physical instruction
address and the 68000's full logical instruction address.

These types describe records; each CPU still constructs detached snapshots and
access lists. Existing [public type checks](../../tests/types) verify readonly
fields, concrete snapshot types, and outcome narrowing through the CPU exports.

## Shared instruction contexts

The [instruction-context types](../../src/components/cpus/instruction-context.ts)
describe the callbacks available to an opcode handler:

| Type | Callbacks |
| --- | --- |
| `ByteMemory` | `readByte`, `writeByte` |
| `ByteInstructionContext` | Byte-memory callbacks plus `fetchByte` |
| `WordInstructionContext` | Byte context plus `fetchWord` for a 16-bit operand |

`ByteMemory` lives beside the [memory recorder](../../src/components/cpus/memory-access.ts).
`RecordedMemory` extends it with an access log. Instruction contexts expose the
callbacks without exposing that log, and all callback properties are readonly.

The 8008, 8080, 6502, 6800, 6809, Z80, and 8088 import `WordInstructionContext`
as their local `InstructionContext`. The 8008 fetches a full two-byte operand
and masks it to a 14-bit address when jumping or calling. The 68000 currently
extends `ByteMemory` with `fetchWord`, `fetchLong`, `nextAddress`, and `jump`.
Fetching and jumps update a local cursor; a successful instruction commits it
to PC. Its word-based instruction stream, explicit extension-word PC bases,
and atomic alignment rejection differ from the byte-fetch contexts.
Contexts require the operations they advertise; unavailable operations are
absent rather than optional.

Instruction fetches track fetched bytes and advance PC according to the CPU's
execution policy, while data accesses leave the instruction stream alone.
The shared executor below constructs these callbacks for four CPUs; the others
construct them in `step()`. Each CPU selects byte order and keeps any special
address mapping, alignment, and rejection rules. Handler return types also
remain local, including the 68000's alignment fault.

[Type checks](../../tests/types/instruction-context.ts) cover required callbacks
and readonly inheritance. Existing CPU tests retain their independent execution
expectations.

## Shared byte-instruction execution

The [byte-instruction executor](../../src/components/cpus/execute-byte-instruction.ts)
shares the fetch/dispatch loop used by the 8080, 6502, 6800, and 6809:

```ts
executeByteInstruction(state, ram, handlers, readWordLE)
```

It attempts one byte opcode with a wrapping 16-bit PC and flat byte memory.
The CPU supplies its stored state, opcode table, and word reader (`readWordLE`
or `readWordBE`). An absent handler records the opcode read and preserves PC.
A supported opcode advances PC before invoking its handler. Operand fetches
read the current PC and RAM, advance only after a successful read, and append
only fetched instruction bytes. Handlers can interleave fetches with data
accesses or change PC, including the 6502's JSR operand/stack ordering.

The result contains the fetched instruction, ordered accesses, and whether a
handler executed. Each CPU's `step()` owns its before/after snapshots and
outcome; the 8080 checks HALT before calling the helper. A handler can return
`"unsupported"` after fetching an operand selector, as the 6809 does for an
undefined indexed postbyte. It must reject before changing other state or RAM;
the executor restores PC and retains the actual fetches. This is not general
rollback. RAM and handler errors
propagate without rolling back completed effects. Each call owns its records.

This contract fits those four CPUs. The 8008 retains its selected 14-bit address
register; the Z80 retains prefix decoding and refresh updates; the 8088 retains
segmented addresses and group rejection; the 68000 retains word opcodes and
alignment faults. Extending the helper should require another matching execution
contract, rather than CPU-specific switches or hooks.

[Helper tests](../../tests/components/cpus/execute-byte-instruction.test.ts)
check unsupported attempts, byte order, wraparound, live fetches, interleaved
accesses, record independence, and error propagation.
[Type checks](../../tests/types/execute-byte-instruction.ts) preserve readonly
records. Existing CPU and example tests retain independent hardware expectations.

## Shared binary helpers

The [binary helpers](../../src/components/cpus/binary.ts) interpret byte values
without owning CPU state:

- `signed8(byte)` interprets an unsigned byte as a signed integer in `-128–127`.
  The 6502, 6800, 6809, and Z80 use it for relative offsets; the 68000 uses it
  before extending a MOVEQ immediate to its 32-bit register representation.
- `readWordLE(nextByte)` reads two bytes, low first; `readWordBE(nextByte)` reads
  high first. Both return an unsigned 16-bit value. Each calls `nextByte`
  exactly twice on success and propagates a callback failure without further reads.

Inputs must already be unsigned bytes. The callback owns its cursor, address
mapping, recording, and other side effects. The seven CPUs with byte operand
fetches select a word reader when constructing their instruction context:

```ts
fetchWord: () => readWordLE(fetchByte),
```

Use a word reader when two consecutive byte fetches describe the operation.
The 6502's JSR retains separate low/high fetches around its stack writes, and
the 68000 retains its word-based cursor and fault handling. Stack-pointer
updates and reset-vector addresses remain visible in their CPU implementations.

[Helper tests](../../tests/components/cpus/binary.test.ts) compare every byte
and byte pair with native signed/unsigned interpretations, and check read
counts, current callback values, cursor ownership, and error propagation.
CPU tests retain their independently authored execution and access expectations.

## Shared memory-access recording

The [memory recorder](../../src/components/cpus/memory-access.ts) supplies
`recordMemory(ram)`, returning `{ accesses, readByte, writeByte }`. Each step
or reset that accesses RAM creates a fresh recorder. Its callbacks can be
passed directly into an instruction context:

```ts
const { accesses, readByte, writeByte } = recordMemory(this.#ram);
const opcode = readByte(address);
```

Creation performs no RAM access. Each callback calls RAM once, then appends
the completed byte access to its log. Repeated reads and unchanged-value
writes are recorded separately; failed RAM operations propagate their errors
without adding an entry. The log captures values at access time and is exposed
as readonly. Separate recorders own separate logs, so later steps and resets
do not alter earlier records.

All eight CPUs use this helper. Their existing `Cpu…MemoryAccess` type names
alias the common readonly `MemoryAccess` shape. The helper owns recording only:
instruction fetching and PC advancement belong to the executor or CPU;
CPU-specific address mapping, alignment checks, and step outcomes remain local.
The 68000 wraps the recorder's callbacks to map each byte address onto its 24-bit bus before it
reaches RAM or the log; the 8088 retains its segmented-address calculations.

A helper function fits this responsibility because it needs only RAM and a
local log. It requires neither a shared CPU base class nor a mixin with access
to CPU internals. [Recorder tests](../../tests/components/cpus/memory-access.test.ts)
check actual RAM calls, current values, log independence, and error propagation;
[type checks](../../tests/types/memory-access.ts) preserve the readonly contract.
Existing CPU and example tests independently verify each model's complete
records and memory behavior.

## Shared arithmetic

The [ALU helpers](../../src/components/cpus/alu.ts) express arithmetic facts
without reading CPU state or updating flags:

- `add(width, left, right, carryIn = 0)` returns an unsigned result, carry out,
  half carry, and signed overflow.
- `subtract(width, left, right, borrowIn = 0)` computes `left - right - borrowIn`
  and returns an unsigned result, borrow, half borrow, and signed overflow.
  Borrow means the unsigned subtraction fell below zero.
- `shiftLeft(width, value, incomingBit)` and `shiftRight(width, value, incomingBit)` move
  an unsigned operand by one bit, returning the wrapped result and the outgoing
  bit as `carry`. The required incoming bit is `0 | 1`; CPUs select zero, the
  sign bit, or current carry for their particular shift/rotate instruction.
- `evenParity8(byte)` reports whether an unsigned byte contains an even number
  of set bits, including zero. The 8088 explicitly selects the low byte of a
  word result before calling it.

Arithmetic widths are `8 | 16 | 32`; incoming carry and borrow are `0 | 1`.
Operands must already be unsigned integers within that width. Results wrap to
the selected width and remain unsigned, including 32-bit values with bit 31
set. Half carry and half borrow always describe the low nibble's boundary
between bits 3 and 4, even for wider operands.

All eight CPUs use shared addition and subtraction. The 8088 supplies its
selected byte/word width directly; the 68000 selects byte, word, or long.
CPU flag assignments remain beside the instruction:
the 6502 sets C when there is no borrow; the 8080 uses borrow for CY and inverted
half borrow for AC; the Z80 and 8088 use both borrow facts directly; the 6800
and 6809 preserve H during subtraction. The 68000 copies addition's carry or
subtraction's borrow to X and C, while comparison preserves X. Parity, flag
preservation, decimal corrections, and the NMOS 6502's intermediate flag rules
remain CPU behavior.

The 6800, 6809, Z80, and 8088 use the shift helpers. The 6800 sets V=N XOR C for
both directions; the 6809 sets V for left shifts and preserves it for right
shifts. The Z80's unprefixed accumulator rotates preserve S/Z/PV, while CB
rotates and shifts derive sign, zero, and parity from the result. The 8088
selects byte or word width, repeats the operation for its full CL count,
and distinguishes rotate flags from shift flags. These policies
remain visible in the CPU code; the shared helper only moves one bit.

[Helper tests](../../tests/components/cpus/alu.test.ts) exhaust every byte pair
and incoming carry/borrow against unsigned and signed range calculations.
For 16 and 32 bits, tests use independent `BigInt` ranges around every bit
boundary and across seeded operand pairs. Every parity byte is checked against
a binary-string count; shifts cover every byte/word and incoming bit, plus
unsigned-long samples and every bit position, against bit-string movement.
[Type checks](../../tests/types/alu.ts) check widths,
incoming bits, distinct carry/borrow names, and readonly results. Existing CPU
and example tests retain their independently authored expectations.

## Verify a reorganization

Preserve public contracts, supported encodings, flag effects, wrapping, reset,
unsupported-attempt behavior, and the order of actual memory accesses. Run the
existing independent CPU and example checks plus the build/type checks. Tests
should establish instruction behavior from independent expectations; avoid
tests that merely repeat a builder's encoding formula or prescribe private
method placement.
