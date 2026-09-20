# Literate CPU specifications

Executable chapters are maintained CPU sources:

- [MOS 6502: the complete model](../../src/components/cpus/specifications/6502.md)
  owns stored state, packed status, all 151 documented forms, reset vector reads,
  ordinary execution, IRQ/NMI entry, and the generated public interface. Its
  chapter also owns the public contracts and hardware references; no separate
  model document or handwritten 6502 implementation remains.
- [Intel 8008: the complete model](../../src/components/cpus/specifications/8008.md)
  defines every documented instruction, including control flow, restarts,
  halts, and port transfers. The chapter owns behavior, encodings, and stored-state
  declarations, PC/HL views, reset effects, and ordinary/interrupt execution
  policies, and the public interface. Generated modules connect those policies
  to shared runtime services; no handwritten 8008 implementation remains. Its
  API contracts, hardware references, checks, and limitations also live in the
  chapter; there is no separate model document.
- [Intel 8080: the complete model](../../src/components/cpus/specifications/8080.md)
  owns stored fields, register-pair views, reset, normal execution, interrupt
  recognition and EI retirement, every instruction, and its generated public
  interface. Its API contracts and hardware guide live in the same chapter; no
  handwritten 8080 implementation remains.
- [Motorola 6800: the complete model](../../src/components/cpus/specifications/6800.md)
  owns the complete stored schema, packed condition codes, and all 197 instruction
  forms with their addressing and encodings. Composed actions share stack and
  interrupt-frame effects with external entry. Reset, IRQ/NMI recognition,
  WAI suspension and wake-up, and the public interface are chapter-owned too.
  Its model contracts and hardware guide live beside the formal definitions;
  no handwritten 6800 implementation remains.
- [Motorola 68000: moving a word](../../src/components/cpus/specifications/68000-word-transfers.md)
  defines word copies between data registers and word loads/stores through `(An)`.
  Its word-result flag policy also serves the remaining word definitions.

This is an authoring-language prototype over the existing
[instruction representation](instruction-semantics.md), with a deliberately
small vocabulary. It now describes complete instruction-level 8008, 8080, 6502, and 6800 models;
other execution architectures still need language and runtime support.
Current counts and milestone evidence belong in the
[coverage report](coverage.md#literate-authoring-milestone).

## Reading and building a chapter

A complete chapter is the CPU's model contract as well as its implementation
source. It should also teach the chip: its historical setting, architecture,
physical interfaces, instruction encodings, and how a program executes. Cite
historical and hardware sources, and distinguish physical behavior from the
emulator's chosen level of detail. Use worked explanations to connect the prose
to formal definitions, linking to example specifications for complete program
images and acceptance traces.

Keep hardware references, state and execution contracts, failure behavior,
model choices, and limitations beside the definitions they explain. When a
chapter takes over a CPU, merge any remaining material from its `model.md`,
remove that separate document, and update incoming links. Partial chapters
still rely on their CPU's model document for the wider contract. Example
programs retain their own behavior and acceptance specifications, and shared
language and runtime documentation stays in the common guides.

A chapter is ordinary Markdown with executable `cpu` fences. Prose explains
the hardware and the model's choices. The paragraph immediately before a family
fence supplies that family's generated explanation; wrap it freely across
lines, without inserting a paragraph break. Other prose and other fenced code
are not executable. Opening backtick or tilde fences must be unindented;
block quotes and indented code, including fences inside lists, are not executed.

The optional [Zed extension](../../editors/zed/README.md) highlights the `cpu`
fences alongside the surrounding Markdown, and also supports `.cpu` snippets.

The build discovers Markdown files directly under `specifications/` in filename
order and takes each model's identity from its `cpu` declaration. CPU identifiers
contain lowercase letters or digits. Complete chapters need no handwritten
registration entry; chapters without their own state still have explicit
external-schema bindings.
Chapter filenames use lowercase letters, digits, and single hyphen separators;
`catalogue`, `interfaces`, and `state` are reserved output names. Duplicate complete
models are rejected before replacing chapter output.

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
Chapters with a `state` block also generate small schema/type modules under
`semantics/generated/state/`. These modules import only the shared state helpers,
so runtime consumers need not load the expanded instruction data. Chapter
generation takes no pre-existing schema for these CPUs and writes their state
modules before the instruction registry is loaded. All chapters and schemas
are checked before replacing existing output.
An `execution` contract also generates `generated/<chapter>-execution.ts`,
binding named views/actions and the instruction table to the shared byte runtime.
Chapters with owned state and execution generate instruction catalogue entries
automatically. During a partial migration, the registry may combine a chapter's
forms with its remaining TypeScript definitions.
An `interface` declaration also generates `generated/<chapter>-cpu.ts`, the
public class and result types, plus public state aliases in the schema module.
A small generated `interfaces.ts` manifest supplies class names, module paths,
state schemas and caller types, RAM sizes, and public-PC bounds. A stored
unsigned `pc` supplies those bounds directly; a derived snapshot `pc` uses its
view width. The shared
[model catalogue](../../src/components/cpus/models.ts) combines those entries
with integration metadata for handwritten cores. Machine parsing, flat and
composed machine generation, and CPU test selection use that catalogue.
`catalogue.ts` integrates complete chapters into the instruction registry. Both live under `semantics/generated/`.
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
own line, within the same fence; conditional blocks can nest. Blank lines and `//` comments are allowed.
Declarations precede their uses; forward references and recursion are absent.
Names start with a letter and contain letters, digits, or underscores.
Declaration names are unique within a chapter, except that registers and flags
have separate namespaces: the 8008 declares both register C and flag C. Captures
and policy parameters start with a lowercase letter; captures are local to each
source or instruction.
Quoted descriptions use JSON string escaping.

| Construct | Meaning |
| --- | --- |
| `cpu "6502"` | Identify the CPU whose chapter is being compiled. |
| `state { … }` | Define the complete stored-state schema before instruction declarations; requires no external schema. |
| `register A: 8`, `flag N` | Declare stored fields inside `state`, or reference an external schema in a partial chapter. Uppercase names map to lowercase stored fields unless an explicit `= field` mapping follows. |
| `register SELECTOR: 3 = stackIndex`, `array ADDRESS: 14[8] = addressStack` | Name stored fields explicitly; widths and array lengths define storage inside `state` and must match the external schema otherwise. |
| `latch STOPPED = halted` | Declare a Boolean control latch, distinct from an architectural flag. |
| `source zeroPage "zero page": 16 { … }` | Ordered steps ending in a numeric `return`; each use has its own capture scope. |
| `view PC "selected PC": 14 { … }` | A named read-only state source, ending in a numeric `return`; it cannot access external devices. |
| `action setPC "set selected PC" (address: 16) { … }` | Ordered state effects with optional numeric inputs; no instruction fetching, memory, port, or boundary effects. |
| `execution { … }` | Bind the chapter's views, actions, and opcode families to a checked execution contract. |
| `interface Cpu8008 "description" { … }` | Generate the public class, concrete result types, and state aliases from owned state and an earlier execution contract. |
| `snapshot pc = PC` | Expose an earlier numeric state view under a public snapshot field, inside `interface`. |
| `offset = fetch` | Fetch and capture the next instruction byte. |
| `index = register X`, `carry = flag C` | Read and capture a register or flag at this point; the capture retains its numeric or flag type. |
| `address = source zeroPage` | Evaluate and capture a previously declared source. |
| `byte = memory(address)`, `byte = port(selector)` | Read and capture one memory or port byte. Port selectors have sixteen-bit width. |
| `saved = array ADDRESS[slot]`, `stopped = latch STOPPED` | Capture an array element or latch at this point. |
| `pointer = add(offset, index)` | Capture a pure numeric expression. Addition wraps at the operands' equal width. |
| `A <- result`, `memory(address) <- byte`, `port(selector) <- byte` | Write to a register, byte memory location, or port. |
| `ADDRESS[slot] <- target`, `STOPPED <- 1` | Write an indexed stored register or a Boolean control latch; latch writes also accept captured flag expressions. |
| `ADDRESS[] <- u14($0000)` | Fill every physical array slot with the same width-checked value, without reading previous elements. |
| `result = operand s`, `operand d <- result` | Read or write a selected register, pair, or memory operand at this point. |
| `defer irq` | Request one-boundary IRQ deferral on successful retirement; requires `retire irq into LATCH`. This does not immediately write stored state. |
| `replace PSW(status)` | Replace the complete flag object; the policy must define every stored flag. |
| `apply NZ(result)`, `apply ALU(result, carry(left, right))` | Apply a declared flag policy to typed numeric and flag expressions. |
| `address = resolve(16, mode, code)` | Ask the existing address decoder to resolve an operand of the stated width; mode and code are captured three-bit values. |
| `fault alignment read(address) if lowBit(address)` | Return an alignment fault when the captured predicate is true, before subsequent effects. `write` identifies a failed destination access. |
| `commit addresses` | Commit register updates staged by the existing address decoder. |
| `when not(carry) { … }` | Execute a nested block only when its captured flag expression is true. |
| `when test c { … }` | Read the flag selected by a condition catalogue at this point, compare it with the required value, and conditionally execute the block. |

### State ownership

A complete state block contains only `register`, `flag`, `array`, and `latch`
declarations. It must be nonempty, appear once after `cpu` and before other
declarations, and contain every stored field. Instruction bodies use those
declared names directly; do not redeclare them outside the block. Flags occupy
a `flags` group; the other declarations describe top-level fields. Two symbols
cannot declare the same stored field, and a field named `flags` cannot collide
with the architectural flag group. Arrays have positive safe-integer lengths;
register and element widths use the language's supported numeric widths.

The compiler returns the schema along with the instruction families. The build
generates an immutable state description and a `StoredState` type derived from
it. A chapter with a public `interface` also generates its public state types;
other CPUs may retain those types in their state modules. Initial values, reset effects, derived register views,
fetching, and interrupt delivery are separate contracts, not implied by storage.

Chapters without owned state instead receive an external schema and use top-level state
declarations to name the fields they need. They cannot also define a `state`
block. The compiler validates their field kinds, widths, and array lengths
against that schema; it does not emit a replacement schema for them.

### Views and state actions

`view` uses the same ordered captures and final `return` as `source`, with an
uppercase name and explicit result width. Its body can read registers, array
elements, flags, and latches, and perform pure calculations. It cannot write
state or touch external devices. A view is also available as `source NAME` to
later bodies; each use reads current state with its own capture scope.

`action` defines a named operation on stored state. Optional inputs are numeric
values with lowercase names and explicit widths, available throughout that
action but absent from sources' independent scopes. An action can read and
write stored state, apply flag policies, and use nested conditions. Fields it
does not write are preserved. Chapter bodies or execution bindings supply inputs
and select when it runs; input widths are compile-time contracts, as for other
generated helpers, rather than new runtime argument validation.

Views and plain state actions reject instruction fetching, memory, ports,
address decoding, and CPU-boundary effects. An action can explicitly add
`using memory` after its parameters (or description if it has no parameters):

```text
action reset "read the reset vector" using memory {
  low = memory(u16($FFFC))
  high = memory(u16($FFFD))
  PC <- concat(high, low)
}
```

Such actions can read/write memory and state, but still cannot fetch instructions,
access ports, or invoke CPU-boundary effects. Restrictions follow sources, performed actions, and
nested branches, including constant-false branches, with diagnostics at the
calling statement. Counter writes, retirement, and supplied-instruction acceptance
still require state-only actions; vector reset/entry may use memory. Views reject
all writes and external effects, keeping snapshot inspection pure.

`perform NAME(arguments)` expands an earlier action at that statement. Arguments
are numeric expressions in declaration order, with exactly the declared widths;
all are captured in the caller's scope before the first action effect. Each
expansion has its own scope: it sees its parameters, not caller captures, and
its locals do not escape. Calls may nest but cannot reference a later action or
recurse. A source, instruction, or action may perform another action. A pure view
may only perform an action whose entire body is pure; a plain state action cannot
hide a memory access inside another action or a constant-false condition.

```text
action pushWord "push a word onto a descending stack" (word: 16) using memory {
  perform pushByte(lowByte(word))
  perform pushByte(highByte(word))
}
```

Here `pushByte` must already declare its byte input and ordered stack effects.
The 6800 chapter uses this composition for pushes, calls, and interrupt frames.
Generated bodies inline the checked effects; they need no opaque runtime callback.
A failure stops subsequent effects and retains earlier ones, including inside
nested actions. Expanded descriptions retain action boundaries and show their
bodies. [Composition tests](../../tests/components/cpus/semantics/literate-actions.test.ts)
check isolated scopes, argument order, transitive capabilities, and failures.

`ARRAY[] <- value` fills the existing array in ascending slot order. The value
must match the declared element width; old slot contents are never read. It
lowers to the shared `fill-array` effect. Ordinary indexed writes still use
`ARRAY[index] <- value` and retain their index-range checks.

The generated 8008 adapter binds PC/HL readers and calls generated `setPC` and
`reset` actions. PC writes explicitly truncate a sixteen-bit supplied address
to fourteen bits. Reset explicitly clears registers and slots, selects slot
zero, and sets STOPPED; its omitted flags retain their values under the declared
model policy. Shared runtime services guard reset and record before/after snapshots.
These helpers use the existing instruction generator in `generated/8008-state.ts`;
they have no opcode bindings and earn no instruction-coverage credit.

### Execution contracts

The [8008 execution section](../../src/components/cpus/specifications/8008.md#execution-and-interrupt-acceptance)
declares how its instruction bodies run. The current contract supports a flat
byte-memory connection, one-byte opcode dispatch, a stopped latch, and
instructions supplied by an acknowledgement callback. The
[8080 section](../../src/components/cpus/specifications/8080.md#instruction-boundaries-and-interrupt-acceptance)
adds enable/deferral recognition and an instruction-local retirement request.
The [6502](../../src/components/cpus/specifications/6502.md#reset-and-instruction-boundaries)
adds memory-only execution with no halt state, reset bus reads, and named external
entries. The [6800](../../src/components/cpus/specifications/6800.md#reset-and-instruction-boundaries)
reuses vector execution with a waiting latch and chapter-defined frame reuse
on wake-up. Each chapter has one `execution` block. Fields below are required except the
callback-validation policy; references must name earlier declarations.

| Field | Contract |
| --- | --- |
| `memory 14` | Exact RAM size is 2 to this power; supported widths are 1–16 bits. Memory is checked before initial-state getters are read. |
| `counter PC write setPC` | Read the named state view and write through an action with one 16-bit input. The view must fit the memory width. Sequential arithmetic wraps at 16 bits; the writer may impose a narrower wrap. |
| `stopped STOPPED` | Read this latch before an ordinary step; a set latch returns a halted record without fetching. Read it again after successful execution to select the outcome. `stopped none` instead declares no stopped outcome for vector execution; `stopped WAITING as waiting` selects waiting records for that runtime. |
| `word little` | Supply a little-endian `fetchWord`; `big` supplies high-byte-first fetching. Explicit byte fetches in instruction bodies retain their own order. |
| `opcode advance on dispatch` | Advance the captured initial PC by one only if an opcode handler exists. `on read` advances after the successful read, before lookup, including undefined opcodes. |
| `operand advance after read` | Fetch from live PC, then advance the captured address by one only after the read succeeds. This is the only supported operand-advance policy. |
| `failure retain` | Propagate thrown failures, retain completed effects, return no record, and release the guard. Rollback is unsupported. |
| `reset action reset` | Invoke the input-free action between reset snapshots under the same guard. Vector execution records any memory effects declared by the action. |
| `retire none` | No additional retirement effects. `retire action NAME` invokes an input-free state action after a successful handler, including HLT, before the after-snapshot. `retire irq into LATCH` instead writes whether that instruction requested `defer irq`, consuming an old delay or renewing it. Halted, undefined, or failed attempts skip retirement. |

A nested `interrupt` block without `vectors` declares supplied-instruction delivery:

| Field | Contract |
| --- | --- |
| `accept always with resume` | Capture the before-snapshot, then invoke the input-free state action before requesting any byte. No pending queue or automatic call is implied. `accept when ENABLED unless DEFERRED with accept` instead checks named latches first: clear enable returns `ignored`/`disabled`; set deferral returns `ignored`/`deferred`. The `unless` clause is optional. Ignored offers have no effects or acknowledgements. |
| `callback validate on offer` | Optional, and the default: reject a non-callable acknowledgement before the before-snapshot. `on read` defers failure until an accepted offer invokes it, retaining acceptance effects. This preserves the distinct existing 8008 and 8080 host-argument contracts. |
| `bytes acknowledge` | Obtain and validate every instruction byte through acknowledgement, with its own access records and no invented RAM instruction address. Data memory and ports use their usual connections. |
| `counter preserve` | Supplied bytes leave PC untouched. `advance` instead increments live PC after each successful acknowledgement, including an undefined opcode. |
| `unknown retain` | An undefined supplied opcode reports unsupported, retaining acceptance and completed fetch effects. It requests no operands and performs no retirement action. |

A declared retirement destination also grants IRQ deferral to the chapter's
instruction representation; validation and generated context types do not infer
that capability from the CPU name. The declaration must precede families that
request deferral.

Ordinary and supplied-instruction paths select the chapter's same opcode table. Stored-state operations still
use the instruction representation; the execution declaration generates only
bindings to [shared runtime code](../../src/components/cpus/byte-execution.ts).
The runtime supplies chronological memory/port/acknowledgement recording,
snapshot assembly, and a guard shared by step, reset, and interrupt. Each call
owns its records; snapshots remain callable inside device callbacks.

Vector entry is a distinct interrupt contract:

```text
interrupt vectors {
  source irq unless flag I with enter($FFFE)
  source nmi always with enter($FFFA)
}
```

Each source name becomes part of the public `interrupt(source)` union. A set
mask flag returns `ignored` / `masked` without effects; `always` accepts without
reading a mask. An accepted offer invokes its named action with the listed
constant numeric arguments, checked against the action's input widths. The
chapter action owns stacking, vector reads, and state changes. The runtime adds
snapshots, chronological accesses, and `instruction: null`; it never fabricates
an opcode or acknowledgement. Unknown source values throw before snapshots or
memory access. Source names must be unique; an empty catalogue is rejected.

The [vector runtime](../../src/components/cpus/vector-execution.ts) reuses the
same byte fetch/dispatch engine, recorder, and reentrancy guard as other models.
Its current contract requires `stopped none` or `stopped LATCH as waiting`,
`retire none`, and memory-only instruction bodies. These limits are checked even inside hidden sources and
untaken branches. Reset/entry actions cannot fetch or use ports. No processor
name, vector, stack convention, or mask bit is built into the runtime.

A waiting policy checks its latch before fetching and after successful execution.
An already waiting step has `instruction: null` and no accesses; an instruction
that sets the latch retains its fetched instruction and accesses in the waiting
record. The runtime does not clear the latch when accepting an interrupt. Wake-up
effects and saved-frame reuse belong to the entry action; masked offers preserve
waiting. Without this policy, the generated step type has no waiting outcome.
`as waiting` requires a declared latch and vector delivery; it cannot be combined
with `stopped none` or the supplied-instruction contract.

Unknown fields, duplicate or missing policies, wrong references or action
signatures, and opcodes wider than a byte fail at Markdown locations. Priority
arbitration, prefixes, segmented fetches, and bus wait cycles remain outside these
execution contracts. Further CPUs should supply evidence before extending them.

### Public interfaces

A complete chapter can expose its model directly:

```text
interface Cpu8008 "Instruction-level Intel 8008." {
  snapshot pc = PC
  snapshot hl = HL
}
```

The declaration requires chapter-owned state and an earlier supported execution
contract. Its class name starts with `Cpu` followed by an uppercase letter or
digit, then letters or digits. Each `snapshot` entry names an earlier numeric
view. Fields must be unique and must not replace stored fields. An empty block
exposes stored state alone. Descriptions supply generated comments, never code.
Unknown entries, invalid names, missing views, and repeated interfaces report
Markdown locations.

Shared interface conventions supply construction, `snapshot()`, `reset()`,
`step()`, and either `interrupt(acknowledge)` for supplied instructions or
`interrupt(source)` for vector entry.
Construction validates RAM before initial-state getters, validates and copies
state, then binds execution. Snapshots copy all stored state and evaluate the
listed views in declaration order. The generated methods delegate to the same
execution services selected by the chapter; no CPU-name branch or handwritten
adapter is needed.

The class name prefixes `State`, `StoredState`, `Snapshot`, and the concrete
instruction, access, reset, step, and interrupt record types. Interrupt records
include ignored outcomes only when the execution contract declares recognition
conditions. Vector interfaces expose their declared `InterruptSource` union,
memory-only records, and no halted step outcome; only masked source names can
appear in an ignored record. A lowercased first letter names the schema export, such as
`cpu8008StateDescription`. Internal
stored state is mutable. Caller state accepts readonly fixed arrays; snapshots
and records are recursively readonly. Array/group fields also receive aliases
formed by capitalizing their first letter (`addressStack` becomes
`Cpu8008AddressStack`). Alias collisions with other aliases or standard types
are rejected. These conventions belong to shared generation; the chapter
supplies the processor's fields, constraints, names, and view selections.

Public modules import only generated execution, small state modules, and shared
runtime helpers. They never parse Markdown or load expanded chapter data at
runtime. Import the generated entry point after building; there is no maintained
compatibility wrapper at the old handwritten path.

For machine integration, RAM size is derived from the execution contract's
`memory` width. Completion bounds are derived from the width of the view exposed
as snapshot `pc`, or of a directly stored `pc` field, independently of RAM size.
Without either, the model can still run but `.machine` rejects an `end` declaration. Generated
caller-state types retain fixed tuples and readonly arrays in parsed machine
types; generated RAM-size literals remain associated with the model discriminant.
The manifest imports only small schemas, never executable CPU modules or expanded
instruction data. [Integration tests](../../tests/scripts/chapter-model-integration.test.ts)
change chapter declarations and exercise the production parser and generators,
including automatic addition and removal of another model.

### Expressions and policies

Numeric expressions are capture names, explicitly sized literals such as
`u8($01)` or `u16($FFFF)`, and these operations:

| Operation | Meaning |
| --- | --- |
| `add(left, right[, carry])`, `subtract(left, right[, borrow])` | Wrap at the operands' equal width; the optional third argument is a flag expression. |
| `and(left, right)`, `or(left, right)`, `xor(left, right)` | Bitwise operations on equal-width values. |
| `shiftLeft(value, bit)`, `shiftRight(value, bit)` | Shift one place, inserting the flag expression at the vacated end. |
| `select(condition, yes, no)` | Choose between two equal-width numeric expressions using a flag expression. |
| `concat(high, low)` | Join two equal-width values, with high first. |
| `extend(value, width)`, `signExtend(value, width)`, `truncate(value, width)` | Widen unsigned, widen signed, or narrow explicitly. |
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
| `and(left, right)`, `or(left, right)`, `xor(left, right)` | Combine flag expressions; numeric contexts use the bitwise versions. |
| `not(flag)` | Negate a captured flag expression. |
| `negative(value)`, `zero(value)`, `lowBit(value)` | Test the top bit at the value's width, zero, or bit zero. |
| `evenParity(byte)` | Test even parity of a byte, including zero. |
| `carry(left, right[, incoming])`, `borrow(left, right[, incoming])` | Test unsigned carry or borrow at the operands' equal width, with an optional incoming flag. |
| `addOverflow(left, right[, incoming])`, `overflow(left, right[, incoming])` | Test signed addition or subtraction overflow at the operands' equal width; the optional incoming carry/borrow is a flag expression and defaults to zero. |
| `halfCarry(left, right[, incoming])`, `halfBorrow(left, right[, incoming])` | Test carry or borrow from the low nibble of equally sized operands, including an optional incoming flag. The 8080 chapter explicitly negates half-borrow for its subtraction AC rule. |

Flag constants use `0` and `1`, not spelled-out booleans. Updates take effect
together. `apply` preserves unlisted flags and the current flag object; `replace`
requires all stored flags and creates a new flag object. Duplicate parameters
and duplicate flag updates are rejected. Policy expressions use only their parameters and
literals; they cannot refer to source names or capture names in an instruction
that applies the policy. These same typed predicates can appear in instruction
expressions and alignment-fault conditions.

A declaration such as `operands bytes { … }` lists every binary selector value
in numeric order, each with a quoted operand label and `register A`,
`pair B C`, `memory sourceName`, or `value sourceName`. A pair requires two byte
registers, high then low: reads capture both in order, and writes split a
sixteen-bit value in that same order. This is an operand rule, not additional
storage. Value-only operands cannot be written. For this slice, memory sources return
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

Expanded entries supply the 8008's runtime bindings. All documented forms now
come from the chapter, with no separate TypeScript control/port inventory or
instruction body. The CPU core maintains no second instruction-encoding table.

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

These entries are read-only numeric operands. By default, their values and
width come from the binary codes. Every code must appear in order, and the
result width must be supported by the instruction representation. Labels supply instruction
names; they do not declare or read stored registers. The 68000 reads the selected
three-bit value with `code = operand r`, then uses `resolve(16, u3(2), code)`
for address-register indirect mode. This keeps A7's bank selection in the existing
decoder. Word size, address checks, byte order, destination preservation, and
flag timing remain explicit in the chapter.

A code catalogue can declare a different result width and explicit values:

```text
codes vectors: 14 {
  000 "00" = $00
  001 "08" = $08
  010 "10" = $10
  011 "18" = $18
  100 "20" = $20
  101 "28" = $28
  110 "30" = $30
  111 "38" = $38
}
```

The bits still select entries by ordinal; each right-hand value must fit the
result width. Omitting `= value` retains the ordinal. Thus `codes ports: 16`
can describe all thirty-two five-bit port selectors while yielding sixteen-bit
values. Neither selection nor declaration reads state or accesses a device.

## Conditions and stored control state

A condition catalogue maps each selector to one flag and the required value:

```text
conditions branches {
  000 "FC" = flag C = 0
  001 "FZ" = flag Z = 0
  010 "FS" = flag S = 0
  011 "FP" = flag P = 0
  100 "TC" = flag C = 1
  101 "TZ" = flag Z = 1
  110 "TS" = flag S = 1
  111 "TP" = flag P = 1
}
```

Families select conditions with `for c in branches`; labels supply native
mnemonic suffixes such as `named "J{c}"`. Conditions have no numeric `.read`
or `.address` view. Selection performs no state read. The explicit test is
an ordered effect:

```text
family conditionalJump "01 ccc 000" for c in branches named "J{c}" {
  target = source targetAddress
  when test c {
    slot = register SELECTOR
    ADDRESS[slot] <- target
  }
}
```

This fetches the complete target before reading the selected flag, then reads
SELECTOR only on a taken path. Unconditional forms omit the test entirely.
A `when` block can instead test a captured flag expression, including a latch
read, without rereading its state. Blocks have lexical scope: outer captures
are visible inside, but inner captures do not escape. Every branch is checked,
including constant-false branches. Compiler-created condition captures remain
inaccessible to authored statements. Nested errors retain the offending
statement's Markdown location.

Register, array, latch, and flag names remain uppercase; `= field` maps them to
stored fields with exact spelling. Flags refer to the schema's flags
group; the other declarations name top-level stored fields. Array indices must
be provably in range: constants name a valid slot, while every value representable
by a dynamic index's width must fit the array. A three-bit SELECTOR can index
an eight-element array; an unrestricted byte cannot. Reads and writes retain the
element width. The [state ownership rules](#state-ownership) determine whether
these declarations define storage or validate references to an external schema.

Port reads/writes lower to the existing byte-transfer effects. Inputs capture
the returned byte before a later register write; outputs consume a previously
captured byte. The CPU boundary still owns device connection, byte validation,
and access recording. Exceptions stop later effects without rolling back earlier
ones. No CPU-specific behavior is added to the language compiler.

## Native address-decoder boundary

`resolve`, `commit addresses`, and alignment faults lower to existing IR effects,
whose validator currently requires the 68000 address/exception boundary.
They add no decoder or exception-delivery implementation to the compiler.
Ordinary `memory` reads and writes still transfer one byte, including at 32-bit
logical addresses on the 68000. Its core projects them onto the physical bus.
Word transfers explicitly combine or split those bytes. A false fault condition
continues normally; a true one returns the fault to the CPU boundary without
undoing completed effects. Value sources cannot contain instruction rejection.

## Review of the three chapters

The initial three examples support a common vocabulary without hiding their different
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

The 8008 chapter now generates its authoritative stored-state schema and type,
derived PC/HL views, state actions, and bindings for ordinary and interrupt
execution, plus its public class, snapshot assembly, state aliases, and
instruction catalogue bindings. No processor-specific TypeScript implementation
remains; the chapter supplies all of its model and public-interface choices.
Shared runtime services enforce the declared execution contract. Chapters
without owned state validate declarations against an external schema; most
other instruction families remain authored in TypeScript.

The five chapters now exercise contrasting widths, ordered effects, and
interrupt-recognition policies. The 6502 now owns its complete state, status
view/restoration, and all 151 documented instruction forms. Existing selector/source
bindings express its irregular index-load/store encodings and cross-indexing.
ADC/SBC retain explicit digit correction; memory updates retain two writes and
separate carry/N/Z stages. Branches use signed widening, JSR interleaves its final
operand fetch with pushes, and RTI restores flags before PC. The chapter also
owns reset bus effects, ordinary execution, named IRQ/NMI entry, and its public
interface. No handwritten 6502 implementation remains.
The 8008 now expresses its address-stack selector, array, and port effects;
the 68000 still uses its native effective-address decoder, including A7 banking
and pending auto-updates. Its 192 chapter encodings select generated bodies
before the broader MOVE catalogue's shared bodies; those shared bodies still
serve other sizes and addressing modes. Only the chapter-owned forms earn
literate coverage.

The 8008 supplies the first whole-CPU description at its declared instruction-level
fidelity. The 8080 now reuses its execution services with chapter-defined
interrupt enable, delayed recognition, and retirement. It also owns all word,
stack/control, and status instructions, its generated public interface, and
the full model contract. Both CPUs have zero handwritten implementation.
The 6502 now supplies that different execution architecture: reset and interrupt
vector reads, masked named entry, no acknowledgement stream, and no halted state.
The 6800 reuses that boundary with explicit WAI waiting and wake-up rules. Its
reset, stack frame, and vector actions remain visible in the chapter; its public
class and records are generated without a handwritten adapter.
A differently named test CPU already exercises different storage, address width, views, and
actions through the same compiler and runtime. This is evidence for the current
contract, not proof that it covers the remaining architectures. Each further
slice should replace its corresponding maintained TypeScript, preserve explicit
hardware differences, and retain independent execution tests.
These chapters establish an executable authoring path, not a percentage
estimate of the work remaining toward that goal.

The [6502 language tests](../../tests/components/cpus/semantics/literate.test.ts),
[6502 control/stack chapter tests](../../tests/components/cpus/semantics/literate-6502-control.test.ts),
[6502 lifecycle chapter tests](../../tests/components/cpus/semantics/literate-6502-lifecycle.test.ts),
[6800 lifecycle chapter tests](../../tests/components/cpus/semantics/literate-6800-lifecycle.test.ts),
[state-authoring tests](../../tests/components/cpus/semantics/literate-state.test.ts),
[8008 transfer tests](../../tests/components/cpus/semantics/literate-8008.test.ts),
[8008 arithmetic language tests](../../tests/components/cpus/semantics/literate-8008-arithmetic.test.ts),
[8008 control/port language tests](../../tests/components/cpus/semantics/literate-8008-control.test.ts),
[8008 view/reset tests](../../tests/components/cpus/semantics/literate-8008-state.test.ts),
[execution-language tests](../../tests/components/cpus/semantics/literate-execution.test.ts),
and [68000 language tests](../../tests/components/cpus/semantics/literate-68000.test.ts)
check inventories, runtime integration, document diagnostics, malformed selectors
and exclusions, capture isolation, and formal edits that change execution.
Independent CPU tests retain their expected values, wrapping, access-order,
live-state, and failure-boundary checks. The 8008 migration also compared the
old and new CPU execution across all 256 opcode slots, flags, address-stack
selectors, ordinary and supplied instruction streams, and transfer failures.
The chapter replaces every maintained 8008 instruction definition and encoding
inventory. Its control/port tests also mutate formal conditions, vectors, ports,
and latches, and check nested scopes, array bounds, and schema diagnostics.
The 68000 checks include independent ordered-effect expectations, failure at
each observable stage, live upper-word preservation, both A7 banks, physical
projection, and formal edits that change byte order and flag behavior.
