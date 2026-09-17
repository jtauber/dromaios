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
| 6809 CMPA/B/D/X/Y/U/S, every addressing form | Byte/word widths, D as A:B, and addressing that changes the register subsequently compared |
| 6800 CMPA/CMPB/CPX, every addressing form, and CBA | Share comparison construction; original CPX derives N/V from high bytes without low-byte borrow, Z from the whole word, and preserves C |
| 6502 LDA/LDX/LDY, every supported addressing form | Reuse comparison sources; delay destination and N/Z updates until the source succeeds |
| 6502 STA/STX/STY, every supported addressing form | Resolve the address before capturing the source; one write without a destination read or any flag access |
| 6502 ORA/AND/EOR and BIT, every supported addressing form | Reuse byte sources and N/Z; BIT preserves A and derives N/V from memory, separately from the masked result used for Z |
| 6800/6809 AND/BIT/EOR/OR on A/B, every supported addressing form | Share logical construction and operand bindings; N/Z describe the result, V clears, and BIT omits writeback |
| All six 6502 register transfers and 8080 MOV B,A | Share read/write behavior while selecting N/Z or preserving every flag; SP transfers do not access the stack |
| All 6502 ASL/ROL/LSR/ROR forms | One resolved address, an original-value write, a captured incoming carry for rotates, and separate C and N/Z stages; accumulator forms share the operation |
| All 6502 memory INC/DEC and INX/INY/DEX/DEY | Share wrapping byte updates while preserving C and the same memory-write boundaries |
| 8080 RLC/RRC/RAL/RAR | Circular or through-carry rotation; write A before CY and preserve every other flag |
| 6809 LSR/ROR/ASR/ASL/ROL on A/B and memory | Zero, carry, or sign-bit insertion; N/Z/C before writeback; left shifts set V to N XOR C, right shifts preserve V; memory bodies receive a resolved address and retain flags on a failed write |
| 6809 NEG/COM/INC/DEC/CLR/TST on A/B and memory | Reuse the same unary construction and bindings; INC/DEC/TST preserve C, TST omits writeback, and CLR retains the original memory read |
| All eleven 6800 unary operations on A/B and memory | Share the 6809's construction and selector table; omit the CLR read, clear C for TST, and set V to N XOR C for right shifts too |

There are 242 bodies. All are generated and executable; 241 are bound into their
CPU's opcode table. MOV B,A remains a generated transfer test: adding a dispatch
hook for that one sample would complicate the shared 8080/Z80 transfer family.
Other instruction families retain their existing shared helpers. This is not a
complete CPU migration. Bodies start after opcode selection. Each 6809 memory
comparison or unary body starts after successful address resolution and serves
direct, indexed, and extended forms, including all legal indexed postbytes.
The 6800 memory comparisons likewise serve direct/indexed/extended forms, while
its unary operations have indexed/extended forms. Both decoders remain handwritten. The existing
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
| [builders.ts](../../src/components/cpus/semantics/builders.ts) | Shared sources, comparison/transfer/shift/logical recipes, N/Z policies, and checked opcode inventories |
| [motorola.ts](../../src/components/cpus/semantics/motorola.ts) | Shared 6800/6809 unary, comparison, and logical construction, with explicit operand-read and flag policies |
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
out-of-range opcodes before constructing the inventory. ORA/AND/EOR, LDA, and CMP
share one `bbb` operand selector, derived from the same address inventory used by STA.
The immediate slot has no address, so STA omits that encoding. CPX/CPY and
LDX/LDY/STX/STY share Y/X register selectors; indexed loads and stores explicitly
select the other register for indexing. The definition's
opcode is also its generated method key, so there is no second list of method
names or handwritten per-instruction bindings. These are construction-time
families; the resulting definitions still contain only data.

`cpuSymbols(name, stateDescription)` imports the CPU's existing authority for
stored fields. It offers typed register and flag names and records register
widths from that schema. There is no second register-layout declaration.
Current symbols cover stored unsigned byte/word registers and the `flags`
group; general declarations for slices, register views, and banks remain future
work. Composed reads already use ordinary sources: 8080 HL is explicitly read
as H then L, and the 6809's D as A then B, before combining the bytes.

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

The shared `compare(left, right, policy)` construction function produces four
statements: capture the right operand, read the left register or source, capture
subtraction, and apply the policy. The right operand may be a source or a pure
expression over values already captured by the body. The left may be a stored
register or a source that reads a view such as D. All right-operand effects finish
before the left is read. Source bodies and policies remain present as named,
inspectable data. The construction function itself is TypeScript, with typed
parameters; there is no general parameterized instruction-body call node yet.
We can judge the repeated pattern without first designing higher-order DSL
parameters for every operand role.

`motorolaComparison` constructs immediate and resolved-memory bodies for each
compared register or view. Its default policy applies N/Z/V/C at the operand's
width, with C meaning borrow. The original 6800 CPX instead supplies a named
policy using `highByte(left)` and `highByte(right)` for N/V, whole-word subtraction
for Z, and no C assignment. Its explanation accompanies the policy in the 6800
definition. CBA uses the same `compare` recipe with B as its register source.

`transfer(destination, source, policy?)` captures its source as `result`, writes
the destination, and optionally applies a policy with that result parameter.
All 18 6502 load forms and six register transfers use this recipe; the 8080
MOV B,A sample uses it too. The 6502 selects its N/Z policy except for TXS,
which supplies no policy and preserves every flag. A source that fails never
reaches the destination write or flag update.

The 6502 describes effective addresses as word-valued sources. They perform
operand fetches and any pointer reads, then stop before the final data read.
`memorySource(address)` resolves that address once and reads its byte. Comparison,
load, and logical bodies use these byte sources; generated stores and memory
modifiers use the address sources directly. Zero-page indexing wraps the byte
address before widening; absolute indexing wraps the word address. LDX uses Y for
indexed modes, whereas LDY uses X.

`sources6502` groups eight named address sources and eight `bbb` operand sources.
The operand readers and generated accumulator bodies use the same selector inventory.
This removes a second addressing implementation and operand list from the CPU.
Indirect JMP retains its explicit page-wrap helper, and JSR still fetches its
operand bytes separately around the stack writes.

All thirteen STA/STX/STY forms use one store construction: read the address
source, read the source register, and write its captured byte once. There is no
destination read or flag statement. Failed address resolution prevents the
register read and write; a failed write retains completed fetches and pointer
reads while leaving every flag unchanged. The existing vocabulary expresses
these effects without a new primitive, target abstraction, or compiler path.

All 24 ORA/AND/EOR forms use the shared `logical` construction: read the operand,
capture A, combine the captured bytes, write A, then apply the existing N/Z
policy. 6502 BIT has a separate read-only definition and named flag policy: N is
memory bit 7, V is memory bit 6, and Z tests whether A AND memory is zero.
Both BIT modes reuse the same address sources. None of these operations reads
incoming flags or changes C/D/I; ORA/AND/EOR also preserve V. Decimal mode has
no effect. A failed source read prevents all later register and flag updates.

`logical(register, source, operation, policy, writeBack)` also serves the 6800
and 6809. It captures a source or already-read expression before the accumulator,
calculates the result, optionally writes it back, and applies its result policy.
The operation constructor runs only while building data. Each Motorola CPU uses
one shared family construction for AND/BIT/EOR/OR on A/B, with separate immediate
and resolved-memory bodies. N/Z describe the result, V clears, and C/H/control
flags are preserved. Motorola BIT passes `false` for writeback; unlike 6502 BIT,
it derives N from the masked result and always clears V. The original 6800's
ORAA/ORAB spelling is retained, while both CPUs use the same internal body keys.

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
branch. Both CPUs use the existing primitive vocabulary. Sharing unary
construction left the existing 6502, 8080, and 6809 generated code byte-for-byte unchanged.

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
| `bitAnd(left, right)`, `bitOr(left, right)`, `bitXor(left, right)` | Bitwise AND, OR, and exclusive OR on equal-width unsigned numbers, preserving that width; distinct from Boolean `xor` |
| `concat(high, low)` | Two bytes combined as `high * 256 + low`, yielding a word |
| `highByte(value)` | Extract bits 15–8 of a captured word as a byte; byte operands and live register symbols are rejected |
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

Binary arithmetic and bitwise operands must have equal widths. Shift operands have distinct
roles: a byte/word value and a Boolean incoming bit; shifts do not update flags.
These arithmetic meanings correspond
to existing [ALU](../../src/components/cpus/alu.ts) contracts; generated code
uses those helpers for arithmetic facts and parity. Numeric bitwise expressions
compile to parenthesized JavaScript operators; the supported byte/word widths
keep their results unsigned without extra masking. The reporter uses explanatory spellings
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

In `CMPX ,X++`, the existing address decoder captures old X and writes
`old X + 2` modulo 65536. The generated body receives the captured address,
reads the high byte there, then the low byte at `old X + 1` modulo 65536.
Only then does it read the updated X for comparison. Thus a second-read
failure retains the increment and performs no comparison flag update. Moving
that register read earlier would change the definition, not just its formatting.
The same boundary serves every indexed postbyte and compared register. CMPD
reads A then B after both operand bytes, so addressing through A, B, or D does
not move the comparison-register capture ahead of the memory reads.

The original 6800 CPX deliberately does not use whole-word N/V. Comparing
`0100` with `0101` leaves N clear: the high bytes are equal, and the low-byte
borrow does not enter their subtraction. Z is clear because the whole words
differ, and C retains its previous value. A high-byte extraction expression
makes this rule visible without a CPU-specific primitive or opaque callback.

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
Store probes cover all thirteen generated forms, changing the source register
during address resolution to detect early captures. They reject any flag access,
extra destination read, or register write, and inject failures at every fetch,
pointer read, and write. Existing CPU tests exhaust all byte values and flag
combinations, verify unchanged-value writes and overlapping code/pointers, and
retain exact completed accesses on failure. Literal encoding expectations also
exclude immediate STA and undocumented STX/STY modes.
[Logical probes](../../tests/components/cpus/semantics/logic.test.ts) check numeric
bitwise expressions against individual bit truth tables for every byte pair,
word bit boundaries, and nested formulas. All 26 generated logical forms are
checked for operand-before-A ordering, absence of incoming flag reads, and
termination at each failed read. ORA/AND/EOR writeback precedes N/Z updates;
BIT never writes A. Existing CPU tests exhaust the ORA/AND/EOR and BIT operand
pairs with D clear/set and verify all addressing
forms, preserved flags, and complete access records. The CPU failure probe also
covers both BIT forms. Type and validation checks distinguish numeric bitwise
expressions from Boolean XOR and reject mixed operand widths.
Motorola probes exercise every generated logical body, including read failures,
operand-before-register capture, replaced flag objects, writeback before N/Z/V,
and BIT without writeback. CPU tests retain their literal opcode expectations
and bit truth tables. The 6800 failure probe covers all four addressing modes
and every indexed offset; the 6809 checks every legal indexed postbyte, A/B/D
offset aliases, pointer/code overlap, wrapping, and S auto-updates. Selected
6809 auto-update and indirect forms fail at every read, retaining exact completed
accesses. Its existing undefined-postbyte checks also cover the logical families.
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
Comparison tests cover all unsigned indexed offsets, wrapped and overlapping
fetches/data reads, and failure at every read in boundary cases. CPX retains its
exhaustive independent high-byte-pair tests with equal and unequal low bytes.
Generated-body probes verify operand-before-register ordering and no writeback
for CMPA/CMPB/CPX and CBA. Compiler probes check `highByte` for every word and
after wrapped arithmetic; validation rejects non-word inputs and wrong-width
uses of its byte result.
The [6809 CPU tests](../../tests/components/cpus/6809.test.ts) also exercise all
217 legal indexed postbytes for every memory unary operation and all seven
comparisons, retain rejection of all 39 undefined postbytes, and inject failure
at each access in direct, extended,
auto-updated, and indirect examples. They check wrapping, code/pointer/data
overlap, S updates and NMI arming, exact completed accesses, and full state.
Generated comparison probes change the compared register during operand reads
and require its capture only after the last successful read. These cover every
register in immediate and memory bodies, D's A-then-B read order, and failures
before either operand byte completes.

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

This covers the complete 6502 comparison, load/store, logical, shift/rotate, and
byte increment/decrement families, plus all six register transfers. The 8080 retains
named bodies for its nine CMP/CPI bindings and four accumulator rotates in the
shared 8080/Z80 family. The Z80's own bodies remain unchanged.
The 6800 and 6809 bind generated A/B and memory bodies through one
`motorolaUnaryOperations` selector table, including TST and CLR. Each CPU's static
inventory contains function references only; each invocation supplies the current
CPU state. CPU-owned wrappers resolve one address, with the 6809 rejecting
undefined postbytes before body entry. The handwritten unary calculations and
memory-modification paths are gone. JMP remains a separate address operation.
The 6800 and 6809 share `motorolaOperandBindings` for comparison and logical
families, with the 6809 using it across its three opcode pages for comparisons.
Each register has an immediate body that fetches its operand and a memory body
that receives the decoder's resolved address. This covers CMPA/B/D/X/Y/U/S in
all four addressing modes, with no special indexed postbyte path. Unsupported
postbytes retain the same rejection behavior before body entry. The 6809's
word-arithmetic helper now serves only ADDD/SUBD. The 6800 binds CMPA/CMPB/CPX
through the same wrapper and CBA directly.
The shared accumulator table no longer includes CMP, so the 6809 no longer needs
to filter it out. The original 6800 CPX helper is gone. Binding captures a state
getter without reading it until execution, and resolves each memory address once
before entering its body. Address decoding remains outside the generated definitions.

`motorolaLogicalBindings` selects AND/BIT/EOR/OR and A/B from the native
`1 r mm oooo` encoding. Each resolved-memory body serves direct, indexed, and
extended forms, with no new addressing path. The shared handwritten accumulator
table now contains only SUB/SBC/LD/ADC/ADD; its four logical selectors and the
single-use load wrapper have been removed.

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

Completing the 6809 comparison family replaces its partial indexed sample and
separate direct/extended definitions with one memory body per compared register.
Explicit byte reads and concatenation express D without a new register-view
primitive. All 28 comparison forms use the same construction, and total authored
source falls again after including the definitions and bindings.

Sharing comparison construction and bindings with the 6800 completes its thirteen
comparison forms. CPX motivates one narrow `highByte` expression, with width
validation, executable generation, and an explanatory spelling. Existing 6502,
8080, and 6809 generated bodies remain byte-for-byte unchanged. The CPU modules
and CPU-specific definitions shrink, but this step increases total authored
source after accounting for shared construction and the expression. Its benefit
is explicit hardware meaning and family reuse; the footprint report records the
cost rather than treating migration credit as source reduction.

The 6502 store migration consolidates thirteen handwritten bindings around one
three-statement body and the shared accumulator address inventory. Existing
definitions and address/operand sources remain structurally unchanged. It needs
no new language or generator support, and total authored CPU source is unchanged
after including its definition and binding costs.

Migrating ORA/AND/EOR and BIT adds three numeric bitwise expressions and reuses
the existing addressing and N/Z definitions. The CPU loses its BIT helper and
logical bindings; BIT's distinct flag policy stays separate from accumulator
writeback. All earlier definitions and address/operand sources remain unchanged.
The CPU module shrinks by 14 lines, while definitions and shared expression
support add 41, a net increase of 27 authored lines. Reusing this vocabulary
across further CPU families remains the next opportunity to reduce duplication.

The 6800/6809 logical migration uses that vocabulary without further primitives
or compiler changes. Its shared recipe also replaces the 6502's local statement
sequence without changing any earlier definition. The former comparison-only
binding is renamed to reflect its general immediate/resolved-memory role.
The 32 new bodies cover 64 complete opcode forms. Shared construction, bindings,
and CPU integration cost 41 net authored lines after removals; the footprint
report records this increase alongside the reuse across three CPUs.

Subsequent migrations should also identify the handwritten helpers they can
retire. The 6502's result-writing, arithmetic, and stack helpers still serve
handwritten instructions. A later JSR slice remains a test of interleaved
fetching and stack writes, but adding that vocabulary alone would not establish
a source-reduction benefit.

General addressing decoders (such as the full 6809 postbyte decoder), general
register-view declarations, branches, loops, stack bodies, instruction rejection, pending
commits, and exception delivery are not represented here. The 6502 JSR and 68000
MOVE traces still challenge later ordering vocabulary. The 6507 address-projection
and 4004 nibble/interface probes remain acceptance requirements, not capabilities
of this byte/word slice.
