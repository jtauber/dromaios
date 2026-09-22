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
- [Motorola 6809: complete model and public interface](../../src/components/cpus/specifications/6809.md)
  owns all 268 instruction forms, stored fields, and D/CC views and writes.
  Named pages and byte matches own prefix/indexed/transfer decoding. Writable
  views preserve D/CC/S write rules; chapter actions share stack and interrupt-frame
  effects. Reset, execution, IRQ/FIRQ/NMI recognition, waiting/resume rules,
  and the public interface are chapter-owned; no handwritten implementation remains.
- [Zilog Z80: complete model and public interface](../../src/components/cpus/specifications/z80.md)
  owns both register banks, numeric interrupt-mode storage, pair/status views and
  writes, all 698 instruction forms and their prefix layouts, reset, PC/refresh
  commitment, retirement, and IRQ/NMI entry. Mixed named interrupt entries select
  direct vectors or supplied instructions. Its public class, bank types, and
  nested snapshot views are generated; no handwritten implementation remains.
- [Intel 8088: complete model and public interface](../../src/components/cpus/specifications/8088.md)
  owns stored state, writable byte aliases, physical PC and packed FLAGS views,
  and all 291 instruction forms, including strings, ports, WAIT/ESC, and software
  interrupts/IRET. Chapter actions also serve external entry and WAIT resumption.
  Reset, segmented fetching, prefix choices, trap/fault delivery, retirement,
  and ordered INTR/NMI offers are declared here. The class, connections, records,
  snapshots, and integration metadata are generated; no handwritten adapter remains.
- [Motorola 68000: state and ordinary transfers](../../src/components/cpus/specifications/68000.md)
  owns stored state, A7 and status views, every MOVE/MOVEA form, MOVEQ, EXT, SWAP,
  and EXG. Reusable byte/word/long transfers and data-register writes retain
  explicit access ordering. Its bank/status sources and result policies also
  serve the remaining native core and instruction builders.

This is an authoring-language prototype over the existing
[instruction representation](instruction-semantics.md), with a deliberately
small vocabulary. It now describes complete instruction-level 8008, 8080, 6502, 6800, 6809, Z80, and 8088 models;
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
| `group ENTRY = entry { … }` | Declare one nested group of stored fields, including choices and latches; references use `ENTRY.KIND` or `ENTRY.VECTOR`. |
| `bank ALTERNATE = alternate { … }` | Declare a separately stored bank of registers and flags inside `state`; refer to members as `ALTERNATE.B` or `ALTERNATE.C`. |
| `choice IM: 0, 1, 2` | Declare an exact set of numeric alternatives; `IM <- 2` writes one and `mode2 = choice IM = 2` tests it. |
| `choice WAIT: "none", "sync", "cwai" = waitMode` | Declare a stored field with an exact set of named alternatives. |
| `waiting = choice WAIT = "cwai"`, `WAIT <- "none"` | Capture a Boolean comparison or write one declared alternative; unknown choices are errors. |
| `source zeroPage "zero page": 16 { … }` | Ordered steps ending in a numeric `return`; each use has its own capture scope. |
| `view PC "selected PC": 14 { … }` | A named read-only state source, ending in a numeric `return`; it cannot access external devices. |
| `action setPC "set selected PC" (address: 16) { … }` | Ordered state effects with optional numeric inputs; no instruction fetching, memory, port, or boundary effects. |
| `execution { … }` | Bind the chapter's views, actions, and opcode families to a checked execution contract. |
| `interface Cpu8008 "description" { … }` | Generate the public class, concrete result types, and state aliases from owned state and an earlier execution contract. |
| `snapshot pc = PC`, `snapshot alternate.bc = BC_ALT` | Expose an earlier numeric state view under a top-level field or inside a stored group, inside `interface`. |
| `bank RegisterBank = alternate snapshot BankSnapshot` | Name a stored group type and its readonly snapshot type with derived fields; both names receive the public class prefix. |
| `offset = fetch`, `extension = fetch word` | Fetch and capture the next instruction byte or native instruction word. The connection owns word byte order and partial-fetch behavior. |
| `index = register X`, `carry = flag C` | Read and capture a register or flag at this point; the capture retains its numeric or flag type. |
| `address = source zeroPage`, `byte = source readAt(segment, offset)` | Evaluate a declared source with numeric arguments in parameter order, capturing its result. |
| `memory(projectAddress(segment, offset, 4, 20))` | Project a captured word pair onto a physical address bus; available only as a memory address. |
| `byte = program memory(address)` | Read one program-space byte at a 32-bit logical address, through the existing 68000 connection. |
| `byte = memory(address)`, `byte = port(selector)` | Read and capture one memory or port byte. Port selectors have sixteen-bit width. |
| `saved = array ADDRESS[slot]`, `stopped = latch STOPPED` | Capture an array element or latch at this point. |
| `pointer = add(offset, index)` | Capture a pure numeric expression. Addition wraps at the operands' equal width. |
| `A <- result`, `memory(address) <- byte`, `port(selector) <- byte` | Write to a register, byte memory location, or port. |
| `ADDRESS[slot] <- target`, `STOPPED <- 1` | Write an indexed stored register or a Boolean control latch; latch writes also accept captured flag expressions. |
| `ADDRESS[] <- u14($0000)` | Fill every physical array slot with the same width-checked value, without reading previous elements. |
| `result = operand s`, `operand d <- result` | Read or write a selected register, pair, writable view, or memory operand at this point. |
| `notify reti` | Request a device notification after successful architectural retirement; requires `notify reti after retire` in a preceding decode-before-execution contract. Actions need `using boundary` to request notification; lifecycle hooks retain their narrower contracts. |
| `high = sample test` | Capture the Boolean physical TEST level through the declared segmented coprocessor connection. |
| `send escape(opcode, postbyte) with memory(segment, offset, address, contents)` | Send a captured ESC request through the segmented connection; omit `with memory(…)` for a register form. This statement performs no operand read. |
| `report interrupt(vector)` | Record completed software interrupt delivery at a segmented boundary; vector reads and frame writes remain explicit preceding effects. |
| `defer irq` | Request one-boundary IRQ deferral on successful retirement; requires `retire irq into LATCH`. This does not immediately write stored state. |
| `defer intr`, `defer all` | Request INTR-only or all-interrupt recognition delay through the chapter-bound segmented runtime. The request commits only at successful retirement; these scopes are unavailable to other CPUs and views; actions require `using boundary`. |
| `exchange FLAGS, ALTERNATE.FLAGS` | Exchange complete flag objects with matching stored fields: read right, read left, write left, write right. Preserve identity without reading individual flags; allowed in actions but not views. |
| `replace PSW(status)` | Replace the complete flag object; the policy must define every flag in exactly one bank. |
| `apply NZ(result)`, `apply ALU(result, carry(left, right))` | Apply a declared flag policy to typed numeric and flag expressions. |
| `address = resolve(16, mode, code)` | Ask the existing address decoder to resolve an operand of the stated width; mode and code are captured three-bit values. |
| `fault alignment read(address) if lowBit(address)` | Return an alignment fault when the captured predicate is true, before subsequent effects. `write` identifies a failed destination access. |
| `fault alignment program read(address) if lowBit(address)` | Return a program-space alignment fault; writes cannot use program space. |
| `commit addresses` | Commit register updates staged by the existing address decoder. |
| `result = iterate(count, initial) { … return next }` | Execute 0–255 ordered iterations, retaining the initial width; the final `return` occupies its own line. |
| `quotient, remainder = divide(dividend, divisor, signed) otherwise "divide-error"` | Divide a double-width dividend by a byte/word; choose `signed` or `unsigned`; return the named outcome on zero or quotient overflow. |
| `reject "divide-error" if condition` | Return a named instruction outcome when the flag expression is true; omit `if` for unconditional rejection. |
| `when not(carry) { … }` | Execute a nested block only when its captured flag expression is true. |
| `when test c { … }` | Read the flag selected by a condition catalogue at this point, compare it with the required value, and conditionally execute the block. |

### Bounded iteration and arithmetic outcomes

Iteration names both its current value inside the block and its final value
outside it. The byte count and numeric initial value are captured once, before
any body effects. Each iteration has a fresh scope; local captures cannot escape
or shadow outer captures. Its final `return` must retain the initial width.
Zero iterations yield the initial value and perform no body effects.

```text
shifted = iterate(count, original) {
  incoming = flag CF
  result = shiftLeft(shifted, incoming)
  apply CARRY(negative(shifted))
  return result
}
```

This describes the 8088's unmasked CL count and per-bit carry updates without
an unbounded loop or host callback. Sources and actions may iterate within their
existing effect permissions; views still cannot write state, and memory effects
still require an explicit capability. Validation and capability inference inspect
nested iterations as well as their surrounding statements.

Division takes a 16-bit dividend and 8-bit divisor, or a 32-bit dividend and
16-bit divisor. It captures quotient and remainder at the divisor's width only
on success. Signed division truncates toward zero and gives the remainder the
dividend's sign. The language allows the full signed quotient range; the 8088
chapter explicitly rejects its chip-specific most negative quotient afterward.

```text
quotient, remainder = divide(dividend, divisor, signed) otherwise "divide-error"
reject "divide-error" if zero(xor(quotient, u8($80)))
```

Named outcomes return from the complete instruction, including inside `when`
or `iterate`, preserving earlier effects and skipping later ones. Sources and
composed actions cannot use division or named rejection; their existing
`otherwise unsupported` byte matches remain their only rejection path.
Flat byte execution contracts do not support these arithmetic outcomes. The
segmented contract names the entry action and vector for a declared fault; the
8088 chapter selects type 0. Other execution models need their own fault policy.
[Language tests](../../tests/components/cpus/semantics/literate-iteration.test.ts)
check arithmetic, zero/full counts, effects, lexical scopes, and those boundaries.

### State ownership

A complete state block contains `register`, `flag`, `array`, `latch`, `choice`,
`group`, and `bank` declarations. It must be nonempty, appear once after `cpu` and before other
declarations, and contain every stored field. Instruction bodies use those
declared names directly; do not redeclare them outside the block. Flags occupy
a `flags` group. A named `group` contains any stored field kind, with optional
flags; a `bank` is a narrower group of registers and flags.
Bank members use qualified names and may be registers or flags only. Groups and banks
cannot nest; banks must declare their own flags. Register C and flag C may coexist,
including inside a bank; their reading context determines the namespace. Two symbols
cannot declare the same stored field, and a field named `flags` cannot collide
with the architectural flag group. Arrays have positive safe-integer lengths;
register and element widths use the language's supported numeric widths.
Choices require one or more distinct values, either nonempty quoted strings
or nonnegative safe integers. A declaration cannot mix strings and numbers.
Spelling, case, and value type are significant. Choices generate a literal
union type and runtime validation. Reads compare against a declared value and
capture a Boolean; writes select one declared value. Named choices can also
control vector waiting and masked resume policies. Numeric choices currently
serve stored state and instruction actions, not those lifecycle clauses.

Stored references may select a named group, such as `choice ENTRY.KIND = "fault"`,
`latch ENTRY.VALID`, or `ENTRY.VECTOR <- u8(2)`. Register and flag references
may also select a named bank: `register ALTERNATE.B`,
`flag ALTERNATE.C`, and `ALTERNATE.B <- result`. Flag policies may update flags
in multiple banks using captured values. A `replace` policy must cover every
flag in one bank and replaces only that bank's flags object; it cannot span banks.

The compiler returns the schema along with the instruction families. The build
generates an immutable state description and a `StoredState` type derived from
it. A chapter with a public `interface` also generates its public state types;
other CPUs may retain those types in their state modules. Initial values, reset effects, derived register views,
fetching, and interrupt delivery are separate contracts, not implied by storage.

Chapters without owned state instead receive an external schema and use top-level state
declarations to name the fields they need. They cannot also define a `state`
block. The compiler validates their field kinds, widths, and array lengths
against that schema; it does not emit a replacement schema for them.

### Conditional values

`select(condition, yes, no)` selects between captured numeric expressions.
When obtaining a value requires conditional reads or other ordered effects,
`choose` supplies two scoped branches, exactly one of which executes:

```text
pointer = choose supervisor : 32 {
  then {
    stack = register SSP
    return stack
  }
  else {
    stack = register USP
    return stack
  }
}
```

The condition is a captured flag expression. Both branches must end with a
numeric `return` of the declared width. Outer captures are visible inside;
branch-local captures do not escape. Only `pointer` becomes available afterward.
Every branch is validated, even when the condition is constant. Views may use
`choose` for conditional reads; they still cannot hide writes, memory accesses,
or rejection inside either branch. Actions and execution bindings likewise
check both branches against their permitted effects. Unlike a byte-pattern
match, a conditional value has no implicit unsupported outcome.

### Numeric source and family inputs

Sources can declare numeric parameters after their description, with lowercase
names and explicit widths. Calls supply exactly those arguments in declaration
order; every argument is captured in the caller's scope before the source's
first effect. Parameters are visible within that source, while caller captures
and source locals remain isolated. A matching source forwards its arguments to
the shared generated decoder and propagates `unsupported` to the whole caller.
Standalone source readers expose the same numeric inputs before any context.

```text
source readAt "segmented byte" (segment: 16, offset: 16): 8 {
  byte = memory(projectAddress(segment, offset, 4, 20))
  return byte
}
family load (segment: 16) "10001000" {
  byte = source readAt(segment, u16($FFFF))
  A <- byte
}
```

Family parameters follow the family name, before the encoding or multi-encoding
body. The native adapter supplies them at execution time; current shared opcode
bindings accept only their declared page operands, so arbitrary family inputs
require an explicit adapter. Page operand names cannot duplicate these inputs.
The 8088 segmented contract binds three explicit family signatures: no inputs,
`(overridden: 8, segmentOverride: 16)`, or those inputs followed by
`repeatMode: 8, startIP: 16`. No temporary prefix fields enter stored CPU state.

`projectAddress(base, offset, shift, bits)` is an address expression, not a
register value. Base and offset must be 16-bit numbers; shift is a constant
0–16 and bus width is a constant 1–32. It computes `(base * 2^shift + offset)`
modulo `2^bits`. Each byte of a word must wrap its logical offset before
projection. Numeric inputs, projections, and byte matches also work with an
unrelated CPU name and schema; [language tests](../../tests/components/cpus/semantics/literate-inputs.test.ts)
check scope, widths, rejection propagation, and partial effects.

### Views and state actions

`view` uses the same ordered captures and final `return` as `source`, with an
uppercase name and explicit result width. Its body can read registers, array
elements, flags, and latches, and perform pure calculations. It cannot write
state or touch external devices. A view is also available as `source NAME` to
later bodies; each use reads current state with its own capture scope.

`action` defines a named operation on stored state. Optional inputs are numeric
values with lowercase names and explicit widths, available throughout that
action; sources see them only through explicit arguments. An action can read and
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

An action can separately declare `using boundary` for TEST sampling, ESC delivery,
software-delivery reporting, interrupt deferral, or RETI notification. Combine
capabilities explicitly as `using memory, boundary` when both are needed; the
order does not matter, and duplicates or unknown capabilities are errors.
Capabilities permit only effects valid for the CPU's instruction context. No
action may fetch instruction bytes, access ports, or resolve native addresses.

Restrictions follow sources, performed actions, and nested branches, including
constant-false branches. An outer action must declare every capability its
nested effects require. Counter writes, retirement, and supplied-instruction
acceptance still require state-only actions; vector reset/entry may use memory.
Those bindings recheck their narrower contracts even if an action declares
`boundary`. Views reject all writes and external effects, keeping snapshot
inspection pure. [Boundary-language tests](../../tests/components/cpus/semantics/literate-boundary.test.ts)
check captured arguments, failed callbacks, CPU/width errors, capability
composition, lifecycle restrictions, and keyword capture names.

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
byte-memory connection, byte opcode dispatch with optional named pages, a stopped latch, and
instructions supplied by an acknowledgement callback. The
[8080 section](../../src/components/cpus/specifications/8080.md#instruction-boundaries-and-interrupt-acceptance)
adds enable/deferral recognition and an instruction-local retirement request.
The [6502](../../src/components/cpus/specifications/6502.md#reset-and-instruction-boundaries)
adds memory-only execution with no halt state, reset bus reads, and named external
entries. The [6800](../../src/components/cpus/specifications/6800.md#reset-and-instruction-boundaries)
reuses vector execution with a waiting latch and chapter-defined frame reuse
on wake-up. The [6809](../../src/components/cpus/specifications/6809.md#execution-and-public-interface)
adds a named wait choice, latch-gated recognition, and masked wake-up. The
[Z80](../../src/components/cpus/specifications/z80.md#reset-and-execution) validates
the entire opcode before committing PC and its declared fetch effects.
Each chapter has one `execution` block. Fields below are required except the
callback-validation and RETI-notification policies; references must name earlier declarations.

| Field | Contract |
| --- | --- |
| `memory 14` | Exact RAM size is 2 to this power; supported widths are 1–16 bits. Memory is checked before initial-state getters are read. |
| `counter PC write setPC` | Read the named state view and write through an action with one 16-bit input. The view must fit the memory width. Byte dispatch wraps sequential arithmetic at 16 bits; the writer may impose a narrower wrap. Decode-before-execution wraps to the declared memory width. |
| `stopped STOPPED` | Read this latch before an ordinary step; a set latch returns a halted record without fetching. Read it again after successful execution to select the outcome. `stopped none` instead declares no stopped outcome for vector execution; `stopped WAITING as waiting` selects waiting records for that runtime. `stopped choice WAIT unless "none" as waiting` waits whenever the named choice differs from the declared value. |
| `word little` | Supply a little-endian `fetchWord`; `big` supplies high-byte-first fetching. Explicit byte fetches in instruction bodies retain their own order. |
| `opcode advance on dispatch` | Advance the captured initial PC by one only if an opcode handler exists. `on read` advances after the successful read, before lookup, including undefined opcodes. `on decode with action NAME` validates the full encoding first, then commits PC and invokes the one-byte-input state action with the opcode-fetch count. Unsupported encodings leave PC and fetch effects untouched. |
| `operand advance after read` | Fetch from live PC, advance only after the read succeeds. Byte dispatch increments the captured address; decode-before-execution increments the live counter after the callback returns. |
| `failure retain` | Propagate thrown failures, retain completed effects, return no record, and release the guard. Rollback is unsupported. |
| `reset action reset` | Invoke the input-free action between reset snapshots under the same guard. Vector execution records any memory effects declared by the action. |
| `retire none` | No additional retirement effects. `retire action NAME` invokes an input-free state action after a successful handler, including HLT, before the after-snapshot. `retire irq into LATCH` instead writes whether that instruction requested `defer irq`, consuming an old delay or renewing it. Decode-before-execution also permits `retire irq into LATCH then action NAME`, committing the request before running the state action. Halted, undefined, or failed attempts skip retirement. |

A plain `interrupt { … }` block declares supplied-instruction delivery:

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
request deferral. The separate 8088 `intr` and `all` scopes target the segmented
retirement action; they do not extend flat byte execution contracts.

Ordinary and supplied-instruction paths select the chapter's same opcode table. Stored-state operations still
use the instruction representation; the execution declaration generates only
bindings to [shared runtime code](../../src/components/cpus/byte-execution.ts).
The runtime supplies chronological memory/port/acknowledgement recording,
snapshot assembly, and a guard shared by step, reset, and interrupt. Each call
owns its records; snapshots remain callable inside device callbacks.

The [decoded runtime](../../src/components/cpus/decoded-execution.ts) separates
encoding reads from operand execution. `opcode advance on decode with action NAME`
supports `interrupt entries`, described below, or `interrupt external` for a
partial model whose native adapter still owns entry. Both share the runtime's
guard, decoder, fetch action, and retirement. This contract requires a stopped latch and
a state-only reset action. It supports flat opcodes and named prefix pages,
including interposed displacement reads and their fetch classifications. Fetch
actions receive an eight-bit count and may change only stored state.

Its optional `notify reti after retire` policy grants notification to instruction
bodies without testing the CPU's name. The request stays local until successful
retirement; a failing instruction discards it. The optional device callback runs
after retirement under the same guard, and its failure retains completed effects.
A public `interface` requires chapter-owned entry; it rejects `interrupt external`.
Matches and dispatches with unsupported operand fallbacks are currently rejected
for this runtime: opcode validity must be established before commitment.

Named mixed entries combine direct entry and mode-selected delivery under the
decoded runtime, as in the [Z80](../../src/components/cpus/specifications/z80.md#execution-and-public-interface):

```text
interrupt entries {
  source irq acknowledge {
    when latch ENABLED otherwise "disabled"
    unless latch DEFERRED otherwise "deferred"
    accept action acceptIrq
    select MODE {
      case 0 supplied
      case 1 action enterVector
      case 2 action enterVector
    }
  }
  source nmi {
    accept action acceptNmi
    enter action enterNmi
  }
}
```

Sources are arbitrary names. Recognition gates run in declaration order; the
first failed `when` or satisfied `unless` supplies the ignored reason. Gates
precede one input-free, state-only acceptance action and one delivery policy.
An acknowledged source requires a callback, validated before snapshots or gates.
After acceptance it reads one validated byte, then selects the current stored
choice. Cases must cover every numeric or string choice exactly once.
`supplied` decodes that byte as the first opcode and obtains every later
instruction byte from acknowledgement, preserving PC during fetching. The
acceptance action owns the first opcode-fetch effect; subsequent opcode fetches
invoke the declared fetch action before acknowledgement. Operand and displacement
reads follow their declared fetch classification. Execution shares ordinary
retirement and optional RETI notification.

An acknowledged action receives the byte as its only eight-bit input. Direct
`enter action NAME` has no inputs and requests no acknowledgement. Either entry
action may access memory, but cannot fetch instructions, use ports, or retire.
Entry actions own stacking, vector reads, and CPU state changes; the shared
[entry runtime](../../src/components/cpus/interrupt-entries.ts) only records and
dispatches those choices under the execution guard. Acceptance and completed
effects remain after failure. Direct/vector entries report `accepted`; supplied
instructions report `executed`, `halted`, or `unsupported`. Declined entries
report `ignored` with the declared reason, no instruction, and no accesses.

Vector entry is a distinct interrupt contract:

```text
interrupt vectors {
  source irq unless flag I with enter($FFFE)
  source nmi always with enter($FFFA)
}
```

Each source name becomes part of the public `interrupt(source)` union. A set
mask flag normally returns `ignored` / `masked` without effects; `always` accepts without
reading a mask. An accepted offer invokes its named action with the listed
constant numeric arguments, checked against the action's input widths. The
chapter action owns stacking, vector reads, and state changes. The runtime adds
snapshots, chronological accesses, and `instruction: null`; it never fabricates
an opcode or acknowledgement. Unknown source values throw before snapshots or
memory access. Source names must be unique; an empty catalogue is rejected.

A source can instead require an arming latch, or resume a particular wait mode
when masked:

```text
source nmi when latch NMIARMED otherwise "unarmed" with enter($FFFC, $50, $01)
source irq unless flag I with enter($FFF8, $10, $01) resume when choice WAIT = "sync" with resumeSync()
```

A clear arming latch returns `ignored` with the declared nonempty reason, without
running the entry action. A masked source with a matching resume choice invokes
its input-free, state-only resume action and returns `resumed` / `masked`.
Neither path accesses memory. The resume clause is valid only for flag-masked
sources; its value must belong to the declared choice. An unmasked offer always
runs the entry action, without running the resume action. The generated record
type retains the permitted sources and reasons for each outcome.

The [vector runtime](../../src/components/cpus/vector-execution.ts) reuses the
same byte fetch/dispatch engine, recorder, and reentrancy guard as other models.
Its current contract requires `stopped none`, `stopped LATCH as waiting`, or
`stopped choice CHOICE unless "value" as waiting`,
`retire none`, and memory-only instruction bodies. These limits are checked even inside hidden sources and
untaken branches. Reset/entry actions cannot fetch or use ports. No processor
name, vector, stack convention, or mask bit is built into the runtime.

A waiting policy checks its latch or choice before fetching and after successful execution.
An already waiting step has `instruction: null` and no accesses; an instruction
that sets the latch retains its fetched instruction and accesses in the waiting
record. The runtime does not clear the latch when accepting an interrupt. Wake-up
effects and saved-frame reuse belong to the entry action; masked offers preserve
waiting unless a matching resume clause explicitly changes it. Without this policy, the generated step type has no waiting outcome.
`as waiting` requires a declared latch or choice and vector delivery; it cannot be combined
with `stopped none` or the supplied-instruction contract.

Unknown fields, duplicate or missing policies, wrong references or action
signatures, and unpaged opcodes wider than a byte fail at Markdown locations. Priority
arbitration, repeated prefixes, segmented fetches, and bus wait cycles remain outside these
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
view. Fields must be unique and must not replace stored fields. A dotted field
such as `alternate.bc` adds a view inside an existing stored group; deeper paths
are not supported. An empty block
exposes stored state alone. Descriptions supply generated comments, never code.
Unknown entries, invalid names, missing views, and repeated interfaces report
Markdown locations.

Shared interface conventions supply construction, `snapshot()`, `reset()`,
`step()`, and either `interrupt(acknowledge)` for supplied instructions or
`interrupt(source)` for vector entry. Mixed named entries generate one overload
per source, requiring an acknowledgement argument only for acknowledged sources.
A declared RETI notification adds optional `onReti` after the optional port connection
in the constructor.
Construction validates RAM before initial-state getters, validates and copies
state, then binds execution. Snapshots copy all stored state and evaluate the
listed views against that detached copy in declaration order. The generated methods delegate to the same
execution services selected by the chapter; no CPU-name branch or handwritten
adapter is needed.

The class name prefixes `State`, `StoredState`, `Snapshot`, and the concrete
instruction, access, reset, step, and interrupt record types. Interrupt records
include ignored outcomes only when the execution contract declares recognition
conditions. Vector interfaces expose their declared `InterruptSource` union,
memory-only records, and no halted step outcome. Only gated source names can
appear in an ignored record, and only sources with a resume clause can appear
in a resumed record. Vector constructors require stored state, omitting derived
snapshot fields from their input type. A lowercased first letter names the schema export, such as
`cpu8008StateDescription`. Internal
stored state is mutable. Caller state accepts readonly fixed arrays; snapshots
and records are recursively readonly. Array/group fields also receive aliases
formed by capitalizing their first letter (`addressStack` becomes
`Cpu8008AddressStack`). A bank declaration such as
`bank RegisterBank = alternate snapshot BankSnapshot` additionally exports
`CpuZ80RegisterBank` for the stored group and `CpuZ80BankSnapshot` for its
recursively readonly fields and derived views. Public bank names must start
with an uppercase letter and contain letters or digits. Alias collisions with other aliases or standard types
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
| `multiply(left, right, signed)` | Full double-width product of equal byte/word operands, interpreted as two’s-complement values. Omit the third argument or use `unsigned` for unsigned multiplication. |
| `and(left, right)`, `or(left, right)`, `xor(left, right)` | Bitwise operations on equal-width values. |
| `shiftBits(value, left, count)`, `shiftBits(value, right, count)` | Logical shift with zero insertion and unchanged width; count is a constant from zero through that width. Shifting by the full width yields zero. |
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
storage. A `view CC write writeCC` operand pairs an earlier pure view with an
action taking exactly one numeric input of the same width. Reads evaluate the
view; writes capture their value and perform that action. This keeps complete
flag replacement and S-write NMI arming beside their declared behavior.
An `unsupported` entry marks a reserved selector slot; family and match expansion
omit combinations selecting that slot. No dummy source or write is generated.
Value-only operands cannot be written. For this slice, memory sources return
sixteen-bit addresses and memory accesses transfer one byte. Every supported operand
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
for address-register indirect mode. The native decoder now consumes the
chapter's address-register selection source, including A7 banking. Word size, address checks, byte order, destination preservation, and
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
group; other declarations name stored fields, optionally within a named group. Array indices must
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

## Opcode pages

A named page assigns a nonzero prefix byte to a separate eight-bit opcode space:

```cpu
page secondary = $10
```

Add `on secondary` after an encoding's pattern, before its selectors or source
bindings. It works in a single-pattern family header or on individual encodings
within a shared family:

```cpu
family branchNEPair {
  encoding "0010 011 p" for p in branchNE.read with d = byteDisplacement named "{p}"
  encoding "0010 011 p" on secondary for p in branchNE.read with d = immediateWord named "L{p}"
  offset = source d
  z = flag Z
  inverse = source p
  when xor(not(z), lowBit(inverse)) {
    pc = register PC
    PC <- add(pc, offset)
  }
}
```

The unprefixed and prefixed branches share their condition and effects; their
sources determine displacement width and sign extension. Exclusions apply to
the eight-bit pattern within the selected page. Declarations precede uses;
page names and prefixes must be unique. Duplicate opcodes within a page and
collisions between a prefix and a base opcode are errors, with Markdown locations.
The same opcode byte may appear in different pages.

A short page declaration has one nonzero prefix (`$01`–`$FF`) followed by
an opcode fetch. A nested page can select an earlier root page and describe
ordinary byte reads before the final opcode:

```cpu
page DD = $DD
page FD = $FD
page DDCB = $CB on DD {
  displacement:8 = read
  opcode = read
}
```

This reads `DD CB displacement opcode`. Each capture becomes an eight-bit input
to families on that page; it is not fetched again by the instruction body.
`opcode = fetch` classifies the final byte as an opcode fetch; `opcode = read`
classifies it as an ordinary read. The Z80 uses that distinction for R.
Decoding neither reads nor writes stored CPU state. The selected body can read
the live index after the core has committed its execution boundary.

Layouts currently allow at most two prefixes. A nested page requires an earlier
root page without captures. Prefix paths must be unique and cannot collide
with instruction slots; captures have distinct names and cannot shadow stored
state or declarations. Repeated/ignored prefixes and word-opcode patterns mixed
with byte pages are unsupported. Expanded keys concatenate prefix/opcode bytes,
omitting captured operands: `DD CB d 06` has key `$DDCB06`. These are inventory
keys, not word fetches; each encoded byte is still read and recorded separately.

Chapter generation exports page layouts with the families. The instruction
generator provides three bindings:

- `opcodePages(state, additional)` binds base entries and named page tables.
  Page handlers take their captured bytes in declaration order, followed by
  their instruction context. Binding and table lookup have no state or bus effects.
- `opcodeDecoder(state, additional)` returns a decoder taking the initial opcode
  and `nextByte(opcodeFetch)`. It reads the declared layout and returns a bound
  handler (or `undefined`) and the opcode-fetch count, including the initial byte.
  The Z80 uses it for both memory and interrupt-supplied decoding. Its chapter
  selects ordinary PC/R commitment, retirement, interrupt acceptance, and
  delivery; the shared entry runtime applies supplied fetch timing.
- `opcodeEntries(state, additional)` binds ordinary fetch-and-dispatch wrappers
  for complete byte-execution chapters. Existing callbacks retain PC, recording,
  and failure policies; the same decoder selects the body or `unsupported`.

Flat opcode catalogues also expose `opcodeDecoder(state)`, reporting one opcode
fetch without executing the selected body.

During partial migration, optional additional bodies can occupy unused slots
under declared page names. Changing a prefix also moves those bodies. Duplicates,
out-of-range opcodes, and collisions with nested prefixes are rejected. The
complete 6809 and Z80 instruction chapters need no native additions.

An encoding can also bind a stored register as a writable operand:

```cpu
family INCIndex {
  encoding "0010 0011" on DD with i = register IX named "INC {i}"
  encoding "0010 0011" on FD with i = register IY named "INC {i}"
  original = operand i
  operand i <- add(original, u16(1))
}
```

Register bindings are distinct from source bindings (`with a = addressSource`):
`operand i` exposes both reads and writes. The alias can appear in the instruction
name template. Neither kind reads state during family expansion or binding.

## Byte-pattern matches

A `match` captures an eight-bit selector once and selects a disjoint case. Its
value form yields a numeric result; its statement form performs effects. Both
use the same bit vocabulary as opcode families: `0`/`1` fix bits, `x` ignores
bits, and lowercase selector fields expand an operand catalogue. For example,
a source can select X/Y/U/S while retaining the complete captured postbyte:

```cpu
result = match postbyte: 16 {
  case "0 rr xxxxx" for r in indexedRegisters {
    base = operand r
    offset = and(postbyte, u8($1F))
    signed = select(borrow(offset, u8($10)), extend(offset, 16), or(extend(offset, 16), u16($FFE0)))
    return add(base, signed)
  }
  otherwise unsupported
}
```

Every pattern has eight bits, ignoring spaces and underscores. In the value
form, each case must end in `return` with the declared result width. There must
be at least one case.
Cases must be disjoint after selector expansion. Ignored bits remain masks,
rather than expanding to duplicate bodies. A case inherits outer captures and
selected operands, but its local captures and new selectors cannot escape.
Nested matches can further decode the same captured byte.

An effect match has no result capture, width, or `return`:

```cpu
match postbyte {
  case "10 ss 10 dd" for s in transferBytes, d in transferBytes {
    original = operand s
    operand d <- original
  }
  otherwise unsupported
}
```

After a supported case, execution continues after the match. Unsupported
selector entries are omitted before case expansion. The 6809 uses effect matches
to validate same-width EXG/TFR pairs before either register is read.

The last line is always `otherwise unsupported`. If no case matches, the
containing source or instruction returns that outcome immediately, retaining
completed fetches, memory accesses, and state changes. It does not yield a value
or execute later effects. Sources, instruction bodies, and composed actions
may contain matches; nested action rejection stops the enclosing instruction.
Views cannot reject. Actions selected by an execution contract (counter writes,
reset, retirement, acceptance, or external entry) also reject matches, including
through source or nested action calls, because those boundaries cannot consume
an instruction's unsupported result.

The [6809 indexed source](../../src/components/cpus/specifications/6809.md#indexed-postbytes)
uses nested matches for base selection, mode decoding, and optional indirection.
It makes auto-updates, S arming, and high-first indirect reads explicit. Generation
shares a source with a top-level match as one decoder function within its output
module, with a `number | "unsupported"` result and only its required capabilities.
Instruction callers and any exported source readers reuse that function. Ordinary
straight-line sources still inline; this is generated-code sharing, with no
CPU-specific decoder built into the language.

## Native address-decoder boundary

`resolve`, `commit addresses`, and alignment faults lower to existing IR effects,
whose validator currently requires the 68000 address/exception boundary.
They add no decoder or exception-delivery implementation to the compiler.
Ordinary `memory` reads and writes still transfer one byte, including at 32-bit
logical addresses on the 68000. Its core projects them onto the physical bus.
Word transfers explicitly combine or split those bytes. A false fault condition
continues normally; a true one returns the fault to the CPU boundary without
undoing completed effects. Value sources cannot contain explicit fault/rejection
statements; byte matches can return the fixed `unsupported` outcome described above.

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

The 68000 now uses named data-register write actions for its remaining MOVE
forms. Their calls occur at writeback, after pending address updates commit;
the actions explicitly read and preserve the live upper bits. Ordered memory
sources/actions expose every transferred byte. Keep the native address resolver,
pending-update commit, and fault return visible until a chapter owns their
definitions. Alignment faults stay at instruction level because sources and
composed actions cannot return these faults.

When multiple encodings have identical named definitions, chapter generation
serializes that definition once. The instruction-alias builder rejects a name
reused with different behavior. Generated opcode aliases select these shared
bodies without performing effects; native word decoding still supplies captured
EA fields. This changes neither instruction coverage nor the authored patterns.

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
without owned state validate declarations against an external schema; the
68000 retains most of its instruction definitions in TypeScript.

The eight chapters now exercise contrasting widths, ordered effects, and
interrupt-recognition policies. The 6502 now owns its complete state, status
view/restoration, and all 151 documented instruction forms. Existing selector/source
bindings express its irregular index-load/store encodings and cross-indexing.
ADC/SBC retain explicit digit correction; memory updates retain two writes and
separate carry/N/Z stages. Branches use signed widening, JSR interleaves its final
operand fetch with pushes, and RTI restores flags before PC. The chapter also
owns reset bus effects, ordinary execution, named IRQ/NMI entry, and its public
interface. No handwritten 6502 implementation remains.
The 8008 now expresses its address-stack selector, array, and port effects;
the 68000 now owns its schema, register operations, A7 selection, and status
packing/restoration. Its native effective-address decoder consumes the chapter
selection source and retains pending auto-updates. Shared TypeScript bodies still
serve the remaining addressing modes and instruction families. Only complete
chapter-owned forms earn literate coverage.

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
The 6809 adds named-choice storage for its three wait modes. Its chapter supplies
the complete stored schema, D/CC views and writes, base-page operand families,
unary operations, register/flag operations, every branch, LEA, and
calls/jumps/returns, plus prefixed word comparisons and transfers. Byte-pattern matches now describe its indexed decoder,
including unsupported postbytes, auto-updates, and indirect pointer reads.
Unsigned `multiply` exposes the existing full-width multiplication expression.
Named pages supply prefix dispatch, including SWI2/SWI3. Effect matches and
writable view operands describe transfer postbytes and their special writes.
Chapter actions now express all masked stacks and software frames, and named
choice reads/writes express SYNC/CWAI waiting. All 268 instruction forms are
chapter-owned. Its execution contract now also owns reset, IRQ/FIRQ/NMI gates,
masked SYNC release, CWAI frame reuse, and FIRQ short frames. Named-choice
waiting and latch gates extend the shared vector runtime without CPU-name
branches. Public types and snapshots are generated, and the complete contract
and hardware background live in the chapter. No handwritten 6809 implementation
or separate model document remains.
The Z80 also owns its complete model. Its execution contract selects full-encoding
validation, refresh effects, retirement, and mixed named IRQ/NMI entries.
Chapter actions define acceptance, stacking, and mode-specific vector reads;
mode 0 shares its chapter decoder. Public bank types and nested snapshot views
are declared alongside the interface, and its complete contract lives in the
chapter. No handwritten Z80 implementation remains.
The 8088 also owns its complete model: segmented fetching and prefix captures,
WAIT and trap/fault boundaries, ordered external vector offers, and its public
interface. Its chapter now includes the hardware and host contracts, and its
class, types, state schema, and integration metadata are generated.
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
[6809 chapter tests](../../tests/components/cpus/semantics/literate-6809.test.ts),
[6809 lifecycle tests](../../tests/components/cpus/semantics/literate-6809-lifecycle.test.ts),
[state-authoring tests](../../tests/components/cpus/semantics/literate-state.test.ts),
[8008 transfer tests](../../tests/components/cpus/semantics/literate-8008.test.ts),
[8008 arithmetic language tests](../../tests/components/cpus/semantics/literate-8008-arithmetic.test.ts),
[8008 control/port language tests](../../tests/components/cpus/semantics/literate-8008-control.test.ts),
[8008 view/reset tests](../../tests/components/cpus/semantics/literate-8008-state.test.ts),
[execution-language tests](../../tests/components/cpus/semantics/literate-execution.test.ts),
[named-entry language tests](../../tests/components/cpus/semantics/literate-interrupt-entries.test.ts),
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
projection, exhaustive status restoration, and formal edits that change bank
selection, byte order, and flag behavior. Named-group and conditional-value tests
also check generated storage, isolated captures, and transitive effect limits.

## Segmented execution

The [8088 lifecycle](../../src/components/cpus/specifications/8088.md#reset-and-execution-lifecycle)
uses `execution segmented { … }`. It selects the
[shared segmented runtime](../../src/components/cpus/segmented-execution.ts)
through [validated bindings](../../src/components/cpus/semantics/literate/segmented-execution.ts).
`cpu "8088" boundary segmented` declares the available instruction effects:
`intr`/`all` deferral, software delivery reporting, and TEST/ESC connections.
The subsequent `execution segmented` contract must match that declaration.
These capabilities depend on the declared boundary, not the CPU name. The
binding supports three family signatures and this connection shape; arbitrary
device APIs remain outside its scope.

| Declaration | Meaning |
| --- | --- |
| `memory 20`, `segment CS shift 4` | Validate RAM size and project the selected word register plus counter onto the declared bus. Supported bus widths are 16–24 bits; the shift must keep the full segment within that width. |
| `counter IP write setIP` | Read a top-level word register; use the one-word state action when restoring an unsupported attempt's original offset. |
| `record address PC` | Label an instruction with a parameterless 32-bit view captured before effects; this does not select its fetch address. |
| `fetch action advanceIP` | Invoke an input-free state action after each successful instruction-byte read. Operand word ordering remains explicit in chapter sources. |
| `prefixes limit 65536 { … }` | Bound prefix/opcode scanning to 1–65536 reads; operand fetches follow the selected body. Each `segment $26 ES` captures a word register after that byte; `repeat $F3 1` selects a nonzero byte mode; `ignore $F0` only consumes the prefix. Later prefixes of each kind replace earlier ones. Prefix bytes must be unique and cannot collide with families. |
| `stopped STOPPED` | Return halted without fetching, after checking pending entry. |
| `waiting WAITING with pollWait(1)` | Call a one-byte continuation action without fetching. It may change state, sample TEST, and request deferral; it cannot reject, access memory/ports, send ESC, or report software delivery. |
| `pending "trap" vector 1 when TRAPPENDING unless RECOGNITIONDEFERRED with beginTrap then enterInterrupt` | Before stopping or waiting, run the input-free state action, then the one-byte memory entry action with the vector. Records retain the declared source and vector. An owed latch also keeps waiting/halted outcomes runnable. |
| `fault "divide-error" vector 0 with enterInterrupt` | Deliver this named instruction outcome using the one-byte memory entry action, then retire. `opcode` and `unsupported` remain rejections; other instruction outcomes require a matching fault declaration. |
| `reset action resetState` | Input-free, state-only reset with an empty access list. |
| `retire action retireInstruction sampling flag TF, latch TRAPPENDING` | Capture the selected flags/latches before instruction or continuation effects. After success, pass two byte values for requested INTR/all deferral, then one byte per sample, to a state-only action. |
| `unsupported restore counter`, `failure retain` | Skip retirement on rejection or thrown callbacks; restore only the counter on rejection, while throws retain every completed effect and produce no record. |
| `interrupt offers { … }` | Declare source names, ordered flag/latch gates, acceptance actions, and fixed or acknowledged byte vectors. Entry shares the step/reset guard. |

Lifecycle actions are checked transitively against their narrower role even
when their declarations permit broader effects. Byte matches cannot hide a
rejection inside reset, fetch advancement, retirement, or entry hooks. Regular
families retain their documented operand rejection, memory, port, device, and
software-reporting effects. Prefix captures remain local to each attempt;
repeated bodies receive the original counter and execute at most one element.

[Language and runtime checks](../../tests/components/cpus/semantics/literate-segmented-execution.test.ts)
exercise policy edits, live fetch callbacks, delayed samples, retained failures,
and invalid contracts. [Public integration checks](../../tests/scripts/8088-chapter-integration.test.ts)
edit a copied chapter and verify that the CPU class follows its reset, fetch,
prefix, retirement, memory-size, and vector declarations.

### Fixed and acknowledged vector offers

A segmented contract declares every external source explicitly:

```cpu
interrupt offers {
  source intr acknowledge {
    unless latch RECOGNITIONDEFERRED otherwise "deferred"
    unless latch INTRDEFERRED otherwise "deferred"
    when flag IF otherwise "masked"
    accept action acceptInterrupt
    enter action enterInterrupt
  }
  source nmi vector 2 {
    unless latch RECOGNITIONDEFERRED otherwise "deferred"
    accept action acceptInterrupt
    enter action enterInterrupt
  }
}
```

The [offer runtime](../../src/components/cpus/vector-offers.ts) validates the
source, captures the before snapshot, and evaluates gates in declaration order.
The first failed gate returns its quoted reason without any effects or callback
validation. An eligible acknowledged offer requires a callback **before** its
input-free, state-only acceptance action runs. It then calls the callback once,
validates and records its byte, and invokes the entry action with that vector.
A fixed-vector source skips acknowledgement. Entry actions take one byte and
may access memory; neither action may hide other boundary effects. Errors retain
completed effects and release the execution guard. Records distinguish accepted
vectors from ignored reasons and contain no fetched instruction.

This differs from decoded `interrupt entries`: those validate callback presence
on offer and may select a mode or execute supplied instruction bytes. Keeping
the contracts distinct preserves their observable ordering.

The ordinary `interface` declaration also generates segmented models. Their
constructor accepts independently optional ports, TEST, and ESC connections;
the shared recorder copies outgoing ESC requests and validates TEST samples.
The chapter's WAIT body chooses the meaning of the sampled level. Ports are
selected at each active step, after its before snapshot. Snapshots and public
type names follow the same schema/view rules as other chapters. Integration
metadata uses the segmented bus width for the physical runner-PC bound.
[Public mutation tests](../../tests/components/cpus/semantics/literate-vector-offers.test.ts)
change gates, masks, vectors, acceptance effects, names, and views, including a
renamed model with the same device contract.
