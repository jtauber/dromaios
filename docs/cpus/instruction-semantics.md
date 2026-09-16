# Instruction semantics experiment

This implements the bounded executable review in
[stage 5 of the shared-building-blocks proposal](shared-building-blocks.md#5-execute-one-slice-and-produce-a-useful-second-output).
Typed definitions drive validation, a reproducible [expanded listing](semantic-examples.md),
and generated TypeScript instruction bodies used by the 6502, 6800, 8080, and 6809.
The public execution interfaces and supported opcode inventories are unchanged.

The experiment asks whether an instruction's meaning can be described clearly
enough for execution and explanation to share one source. The authored
[definitions](../../src/components/cpus/semantics/definitions.ts) pair prose with
structured bodies. This is a step toward the literate-programming aspiration;
it does not choose an external grammar or a document format for authoring CPUs.

## The review slice

| Definitions | What they challenge |
| --- | --- |
| 6502 CMP/CPX/CPY, every supported addressing form | Share subtraction without writeback; preserve V/D/I; C means no borrow |
| 8080 CPI and every CMP register/memory form | Immediate, register, and memory sources; parity and inverse half-borrow |
| 6809 CMPA/CMPB immediate; CMPX immediate/direct/extended and `,X++` | Byte/word widths; addressing changes the register that comparison subsequently reads |
| 6502 LDA/LDX/LDY, every supported addressing form | Reuse comparison sources; delay destination and N/Z updates until the source succeeds |
| All six 6502 register transfers and 8080 MOV B,A | Share read/write behavior while selecting N/Z or preserving every flag; SP transfers do not access the stack |
| All 6502 ASL/ROL/LSR/ROR forms | One resolved address, an original-value write, a captured incoming carry for rotates, and separate C and N/Z stages; accumulator forms share the operation |
| All 6502 memory INC/DEC and INX/INY/DEX/DEY | Share wrapping byte updates while preserving C and the same memory-write boundaries |
| 8080 RLC/RRC/RAL/RAR | Circular or through-carry rotation; write A before CY and preserve every other flag |
| 6809 LSR/ROR/ASR/ASL/ROL on A/B and memory | Zero, carry, or sign-bit insertion; N/Z/C before writeback; left shifts set V to N XOR C, right shifts preserve V; memory bodies receive a resolved address and retain flags on a failed write |
| 6809 NEG/COM/INC/DEC/CLR/TST on A/B and memory | Reuse the same unary construction and bindings; INC/DEC/TST preserve C, TST omits writeback, and CLR retains the original memory read |
| All eleven 6800 unary operations on A/B and memory | Share the 6809's construction and selector table; omit the CLR read, clear C for TST, and set V to N XOR C for right shifts too |

There are 156 bodies. All are generated and executable; 155 are bound into their
CPU's opcode table. MOV B,A remains a generated transfer test: adding a dispatch
hook for that one sample would complicate the shared 8080/Z80 transfer family.
Other 6809 comparison addressing forms and shifts on the remaining CPUs retain
their existing shared helpers. This is not a complete CPU migration.
Bodies start after opcode selection. `CMPX ,X++` starts after postbyte `81`
has selected that particular form; decoding or rejecting other postbytes is
not represented. Each 6809 memory-unary body starts after successful address
resolution and serves direct, indexed, and extended forms, including all legal
indexed postbytes. The 6800 memory bodies likewise serve every indexed displacement
and extended address after resolution. Both decoders remain handwritten. The existing
[boundary probes](boundary-probes.md#existing-models-executable-evidence) and
independent CPU tests are the behavioral baseline.

## Representation and authoring

[model.ts](../../src/components/cpus/semantics/model.ts) separates declarations,
pure expressions, and ordered statements. Its constructors return ordinary
readonly data. There is no instruction callback stored in a definition.

The authoring layers have separate homes:

| Location | Responsibility |
| --- | --- |
| [model.ts](../../src/components/cpus/semantics/model.ts) | Primitive expressions, statements, and CPU symbols |
| [builders.ts](../../src/components/cpus/semantics/builders.ts) | Shared sources, comparison/transfer/shift recipes, N/Z policies, and checked opcode inventories |
| [motorola.ts](../../src/components/cpus/semantics/motorola.ts) | Shared 6800/6809 unary definitions and explanations, parameterized by their read and flag differences |
| [definitions/6502.ts](../../src/components/cpus/semantics/definitions/6502.ts), [6800.ts](../../src/components/cpus/semantics/definitions/6800.ts), [8080.ts](../../src/components/cpus/semantics/definitions/8080.ts), [6809.ts](../../src/components/cpus/semantics/definitions/6809.ts) | CPU-specific sources, flag policies, instruction bodies, and authored explanations |
| [definitions.ts](../../src/components/cpus/semantics/definitions.ts) | Inventory consumed by executable generation and explanation |

Each CPU definition module follows sources, policies, instruction construction,
then instruction definitions and their selectors. Shared recipes return data built from the existing
vocabulary; they add no runtime callbacks or new language primitives. The
compiler and reporter expand their results just like directly authored bodies.

Statement constructors such as `fetchByte("low")`, `readRegister("index", X)`,
and `writeMemory(address, byte)` return the corresponding data nodes. They do
not execute effects or reorder statements. Their arguments retain the explicit
capture names, registers, addresses, and values used by validation and reporting.

The 6502 uses the existing `opcodeFamily` and `opcodePattern` helpers to construct
definitions in place of runtime callbacks. `instructionSet` rejects duplicate or
out-of-range opcodes before constructing the inventory. LDA and CMP share one
`bbb` operand selector; CPX/CPY and LDX/LDY share Y/X register selectors. The load
patterns explicitly select the other register for indexing. The definition's
opcode is also its generated method key, so there is no second list of method
names or handwritten per-instruction bindings. These are construction-time
families; the resulting definitions still contain only data.

`cpuSymbols(name, stateDescription)` imports the CPU's existing authority for
stored fields. It offers typed register and flag names and records register
widths from that schema. There is no second register-layout declaration.
Current symbols cover stored unsigned byte/word registers and the `flags`
group; slices, concatenated register views, banks, and computed views remain
future work. HL in the 8080 sample is explicitly read as H and L, then combined.

TypeScript distinguishes a register, a captured numeric expression, and a flag
expression. Registers and flags do not implicitly read themselves. A numeric
expression cannot be a flag formula or register destination. `readFlag` captures
a Boolean at an explicit statement boundary; `flagValue` refers to that capture.
Validation keeps Boolean and numeric captures distinct within the same lexical
scope, including source-local scopes. Schema-derived names catch
misspelled registers and flags at compile time. Runtime validation checks
CPU identity and widths; the current state-schema types do not retain literal
register widths in TypeScript, so the experiment does not promise compile-time
width checking.

An instruction may declare numeric `inputs`, such as `{ address: 16 }`. These
are captured values supplied at entry, before any body statement, and belong
to the body's initial scope. Their names and widths are validated, and a later
capture cannot redefine them. Sources and flag policies retain their separate
closed scopes; a policy receives an input only through an explicit argument.
This lets a body consume a resolved address without hiding address calculation
inside a callback or pretending it is a new memory-access primitive.

The shared `compare(register, source, policy)` construction function produces
four statements: read the source, read the register, capture subtraction,
and apply the policy. Source bodies and policies remain present as named,
inspectable data. The construction function itself is TypeScript, with typed
parameters; there is no general parameterized instruction-body call node yet.
We can judge the repeated pattern without first designing higher-order DSL
parameters for every operand role.

`transfer(destination, source, policy?)` captures its source as `result`, writes
the destination, and optionally applies a policy with that result parameter.
All 18 6502 load forms and six register transfers use this recipe; the 8080
MOV B,A sample uses it too. The 6502 selects its N/Z policy except for TXS,
which supplies no policy and preserves every flag. A source that fails never
reaches the destination write or flag update.

The 6502 describes effective addresses as word-valued sources. They perform
operand fetches and any pointer reads, then stop before the final data read.
`memorySource(address)` resolves that address once and reads its byte. Comparison
and load bodies use these byte sources; handwritten stores and generated memory
modifiers use the address sources directly. Zero-page indexing wraps the byte
address before widening; absolute indexing wraps the word address. LDX uses Y for
indexed modes, whereas LDY uses X.

`sources6502` groups eight named address sources and eight `bbb` operand sources.
The operand readers and generated LDA/CMP bodies use the same selector inventory.
This removes a second addressing implementation and operand list from the CPU.
Indirect JMP retains its explicit page-wrap helper, and JSR still fetches its
operand bytes separately around the stack writes.

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

The 6502's `updateByte` construction recipe captures `original`, expands an
operation that captures `result`, writes the result, and applies N/Z. Memory
targets first resolve one address and include the original-value write;
register targets read and write the selected register. The four shift/rotate
operations declare their carry stage before writeback. INC/DEC declare only
the wrapped arithmetic, preserving C. These are CPU-specific construction
recipes: the original-value write and flag schedule are not imposed on other
processors. Opcode fields select the operation and address source from one
inventory for the complete families.

The shared `shift(direction, incoming)` recipe consumes the caller's `original`
capture and produces `result`, plus an outgoing-carry expression. Its incoming
bit can be zero (logical shift), the original sign (arithmetic right shift),
the outgoing bit (circular rotation), or a CPU flag symbol (through-carry
rotation). Only the flag-symbol case emits a `readFlag("carry", ...)` statement.
The caller places these steps at the required point and schedules flags and
writeback separately. Extracting this recipe leaves the existing 6502 bodies
structurally unchanged.

The 8080 writes A before replacing CY and preserves S/Z/AC/P. The 6809 instead
updates N/Z/C before writing A, B, or memory; left shifts also replace V with N XOR C,
while right shifts preserve V. That XOR uses the captured original and result,
so the policy does not depend on assignments to live N or C. The 6502 retains
its separate carry-before-writeback and N/Z-after-writeback stages, including
the original-value memory write before a rotate reads incoming C.
The shared `motorolaUnary` construction covers all eleven byte unary operations
for the 6800 and 6809. It captures the original register or memory byte when
required, calculates a result using a pure expression or ordered steps, applies
N/Z and the operation's additional flag updates, and optionally writes the result.
INC/DEC preserve C; TST clears V and omits writeback. Each CPU's definition
declares three differences:

| Rule | 6800 | 6809 |
| --- | --- | --- |
| `clearReadsOperand` | No: CLR only writes | Yes: CLR reads before applying flags and writing |
| `testClearsCarry` | Yes | No: preserve C |
| `rightShiftSetsOverflow` | Yes: V = N XOR C | No: preserve V |

These choices affect construction only; generated bodies contain no CPU-model
branch. Both CPUs use the existing primitive vocabulary. The migration leaves
the existing 6502, 8080, and 6809 generated code byte-for-byte unchanged.

Every 6809 memory unary operation reads its operand once. Rotates capture
incoming C after that read; all operations except TST write once, including
unchanged values. A failed read leaves flags unchanged; a failed write retains
the completed flag updates. Address-register updates performed by the decoder
survive either failure.
The 6800 uses the same ordering except for CLR's omitted read. A failed CLR
write therefore retains its flag updates without any preceding data-memory read.

## Primitive meanings

This vocabulary deliberately supports unsigned **8- and 16-bit values**,
**Boolean flag captures**, and **16-bit byte memory addresses**. Widths are decimal;
numeric literals in expanded listings are hexadecimal, while flag constants
are `0:flag` and `1:flag`. There is no implicit truncation on a write.

| Expression | Meaning |
| --- | --- |
| `value(name)` | An already captured numeric value in the current lexical scope |
| `flagValue(name)` | An already captured Boolean flag in the current lexical scope |
| `flagLiteral(value)` | A Boolean constant; never a numeric zero or one |
| `literal(width, value)` | An unsigned constant that fits the width |
| `subtract(left, right)` | Binary subtraction modulo `2^width`, with no input borrow |
| `addWrap(left, right)` | Addition modulo `2^width` |
| `concat(high, low)` | Two bytes combined as `high * 256 + low`, yielding a word |
| `extend(value, width)` | Unsigned widening; narrowing and equal-width conversions are rejected |
| `shiftLeft(value, incoming)` | Shift left once at the operand's width, discard the outgoing high bit, and insert the Boolean incoming bit at bit 0 |
| `shiftRight(value, incoming)` | Shift right once at the operand's width, discard bit 0, and insert the Boolean incoming bit at the high bit |
| `negative(value)` | Whether the top bit at the value's width is set |
| `lowBit(value)` | Whether bit 0 is set |
| `zero(value)` | Whether the unsigned value is zero |
| `evenParity(value)` | Whether a byte has an even population count, including zero |
| `borrow(left, right)` | Whether unsigned `left < right` |
| `halfBorrow(left, right)` | Whether `(left mod 16) < (right mod 16)`, at either supported width |
| `overflow(left, right)` | Whether signed subtraction falls outside the signed range at that width |
| `not(value)` | Boolean negation |
| `xor(left, right)` | Boolean exclusive OR; true exactly when its two Boolean operands differ |

Binary arithmetic operands must have equal widths. Shift operands have distinct
roles: a byte/word value and a Boolean incoming bit; shifts do not update flags.
These arithmetic meanings correspond
to existing [ALU](../../src/components/cpus/alu.ts) contracts; generated code
uses those helpers for arithmetic facts and parity. The reporter uses explanatory spellings
such as `topBit`, `zeroExtend16`, and `halfBorrow4` to expose those meanings.

| Statement | Ordered effect or capture |
| --- | --- |
| `capture` | Evaluate a pure numeric expression and give the value a fresh, immutable name |
| `read-register` | Read the selected stored register now, capturing its value |
| `read-flag` | Read the selected stored flag now, capturing its Boolean value |
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

In memory shifts and rotates, the original-value write precedes the calculation
and any flag update. ROL/ROR capture incoming C after that write succeeds.
The original top bit supplies outgoing C for ASL/ROL; bit 0 supplies it for
LSR/ROR. The result write separates the C policy from the N/Z policy. A reporter
can locate each stage directly. Generated code preserves both writes even when
their values are equal, and leaves C committed if the final write fails.
Memory INC/DEC use the same two writes but preserve C throughout; accumulator
and index-register forms perform no data-memory access.

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
[Reader tests](../../tests/components/cpus/semantics/readers.test.ts) distinguish
address resolution from data reads, check byte/word wrapping and live index-read
order, and inject failures at each source access. CPU tests also check stores,
arithmetic, and memory modifiers through their ordinary opcode paths.
[Unary probes](../../tests/components/cpus/semantics/unary.test.ts) check every
word value in both directions and with either incoming bit, distinguish a
captured flag from later live-state changes, and inspect carry reads and updates
between the two memory writes. The 6502 tests cover every byte and incoming flag
combination for every modifying form, plus failure at every memory access.
Generated-body probes also inspect the 8080, 6800, and 6809 register/flag write order,
require incoming-carry reads only for through-carry rotations, and exercise
nested Boolean XOR over its complete truth table. They check the additional
6809 unary families' flag assignments, TST's missing write, and CLR's retained
read, including an unchanged zero result. Existing CPU tests exhaust
every byte and incoming flag combination for the newly migrated forms, using
independent bit-string rotations and integer shift/overflow expectations.
The [6800 CPU tests](../../tests/components/cpus/6800.test.ts) cover all unsigned
indexed displacements, wrapped and overlapping fetches, and failures at every
fetch, operand read, and result write. Generated-body probes distinguish its
CLR with no register or memory read, TST's cleared carry, and right-shift V.
The [6809 CPU tests](../../tests/components/cpus/6809.test.ts) also exercise all
217 legal indexed postbytes for every memory unary operation, retain rejection of all 39
undefined postbytes, and inject failure at each access in direct, extended,
auto-updated, and indirect examples. They check wrapping, code/pointer/data
overlap, S updates and NMI arming, exact completed accesses, and full state.

## Executable generation and integration

[generateInstructions](../../src/components/cpus/semantics/generate.ts) validates
and freezes its input before emitting code. Generated methods take the concrete
`Cpu6502State`, `Cpu6800State`, `Cpu8080State`, or `Cpu6809State`, followed by any numeric inputs
in declaration order, then only the callbacks their statements use, expressed
as a `Pick<ByteInstructionContext, ...>`. For example,
`rolMemory(state, address, { readByte, writeByte })` cannot fetch operands or
resolve the address again. Bindings must supply unsigned integers fitting the
declared widths; the generated internal functions do not coerce or validate
runtime inputs. Register-only
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
`src/components/cpus/generated/{6502,6800,8080,6809}.ts`. These files are ignored build
output and removed by `npm run clean`. Regenerate with `npm run generate:cpus`;
`npm run build` generates these bodies and the machine factories automatically.
The source-only check and ordinary compilation both type-check the generated
bodies. Reproducibility tests compare every module with fresh output and run the
native generator in a clean temporary tree from another working directory.

The four CPU-owned state declarations now live under
[`src/components/cpus/state/`](../../src/components/cpus/state), re-exported
through their original CPU modules. This lets definitions and generation load
schemas without importing execution or requiring generated files to exist.
The machine parser imports those schemas directly too, so machine generation
works independently of generated CPU output. There is still one authority for
each CPU's stored fields.

Opcode selection remains in the CPU tables. For the 6502,
`generateInstructions(..., { bindOpcodes: true })` also generates
`opcodeEntries(state)`, connecting every defined opcode to its body. The CPU
constructs its combined table after initializing state, and the ordinary
`opcodeTable` rejects any collision with its remaining handwritten entries.
Each instance binds its own state; no register or memory read occurs during
binding. Generated methods retain their precise callback types, while the
bound handlers accept the shared byte instruction context. Automatic opcode
bindings reject definitions with numeric inputs, since they cannot supply
those values; such bodies require an explicit CPU-owned binding.

The generator's `sources` option also emits `sourceReaders(state)`. These readers
use the same validation, lexical scopes, and statement compiler as instruction
bodies, returning the source's captured result. Each reader requires only the
callbacks it uses: a simple address needs fetching, an indirect address also
needs pointer reads, and a memory operand adds the final data read. The CPU
binds readers after initializing its state. Binding performs no register or
memory reads; each call observes live registers at their declared positions.
Remaining handwritten operations can therefore share the definitions before
their complete bodies are migrated.

This covers the complete 6502 comparison, load, shift/rotate, and byte
increment/decrement families, plus all six register transfers. The 8080 retains
named bodies for its nine CMP/CPI bindings and four accumulator rotates in the
shared 8080/Z80 family. The Z80's own bodies remain unchanged.
The 6800 and 6809 bind generated A/B and memory bodies through one
`motorolaUnaryOperations` selector table, including TST and CLR. Each CPU's static
inventory contains function references only; each invocation supplies the current
CPU state. CPU-owned wrappers resolve one address, with the 6809 rejecting
undefined postbytes before body entry. The handwritten unary calculations and
memory-modification paths are gone. JMP remains a separate address operation.
The 6809 binds immediate CMPA/B, three ordinary CMPX modes, and one indexed body:
it fetches the postbyte once, selects generated `,X++` for `81`, and delegates
other forms to its existing indexed decoder. Unsupported postbytes retain the
same rejection behavior. Generated definitions do not silently claim the rest
of that decoder.

## Decision and next review

The experiment demonstrates one meaning producing executable code and an
explanation. Its initial representation and compiler added authored machinery;
migration percentages alone do not establish a reduction in code or complexity.
The family cleanup removes the 6502's duplicate load/comparison binding arrays
and individual bindings. Shared address and operand readers then remove four
handwritten addressing helpers and the duplicate accumulator operand list.
Completing the shift/rotate and increment/decrement families removes the shift
selector, shift/adjust family builders, memory-modification wrapper, carry-result
wrapper, and index-adjustment helper. Independent encoding and CPU tests check
execution connections, effect order, and failure boundaries.

Measure the complete [source footprint](coverage.md#source-footprint), including
definitions and shared machinery, with generated output counted separately.
Moving code into a definition file does not count as source reduction. Review
whether family authoring, reusable sources, and explicit ordered statements
improve understanding. The shared shift recipe now serves the 6502, 6800, 8080, and
6809, with sign extension and circular rotation expressed using existing
primitives. Boolean XOR is the only new expression needed for this extension.
Their different flag and writeback schedules remain explicit. Completing all
6809 unary families removes the remaining handwritten selector and
memory-modification path. Declared numeric inputs let eleven memory bodies
share the existing address-decoder boundary, covering thirty-three memory
opcode forms. TST's read-only behavior and CLR's real memory read remain
explicit. Sharing these definitions and the unary selector table with the 6800
removes four unused runtime ALU helpers and its shift/test wrappers. With the
last caller migrated, the earlier `modifyByte` helper is also removed; generated
statements and CPU boundary tests retain its relevant access-order guarantees.
Total authored CPU source now falls modestly after accounting for the shared
builder and the newly separate 6800 state schema. This demonstrates useful
family reuse, but does not establish a large code reduction or justify new
semantic primitives on its own.

Subsequent migrations should also identify the handwritten helpers they can
retire. The 6502's result-writing, arithmetic, and stack helpers still serve
handwritten instructions. A later JSR slice remains a test of interleaved
fetching and stack writes, but adding that vocabulary alone would not establish
a source-reduction benefit.

General addressing decoders (such as the full 6809 postbyte decoder), register
views, branches, loops, stack bodies, instruction rejection, pending
commits, and exception delivery are not represented here. The 6502 JSR and 68000
MOVE traces still challenge later ordering vocabulary. The 6507 address-projection
and 4004 nibble/interface probes remain acceptance requirements, not capabilities
of this byte/word slice.
