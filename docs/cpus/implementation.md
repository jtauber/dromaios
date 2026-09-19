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
type. For all eight CPUs, the declaration and derived types live in
CPU-owned modules under [`state/`](../../src/components/cpus/state) and are
re-exported by the original CPU module. This lets instruction generation load
schemas without loading execution or its generated imports. The description
owns stored field names, types, and constraints. The
[shared state helpers](../../src/components/cpus/state.ts) provide:

| Description | Meaning |
| --- | --- |
| `unsigned(bits)` | An unsigned register or selector of the given width |
| `flag` | A Boolean architectural flag |
| `boolean` | A Boolean control latch |
| `choices(0, 1, 2)` | An explicit set of permitted integer values |
| `namedChoices("none", "sync", "cwai")` | Named alternatives with a literal string union |
| `array(8, unsigned(14))` | Eight unsigned 14-bit values in physical slot order |
| `group(fields)` | A nested group, such as flags or an alternate register bank |

`defineState(fields)` owns a readonly field map; the field helpers create
immutable descriptions. `StateValues<typeof cpu…StateDescription>` derives the
mutable stored-state type, including nested groups, fixed tuple lengths, and
permitted-value unions. Public flag types select the state's `flags` field.
This avoids declaring each register and flag twice. `ReadonlyState<State>`
supplies recursive readonly snapshots, retaining nested groups and fixed tuple
lengths; CPU snapshots add their derived views. The 8008 also exposes its address
stack as readonly in caller-supplied state. Widths and hardware semantics still
require independent tests. The Z80 describes its register bank once and reuses
that description for both banks.

The descriptions have these consumers:

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
- The [instruction-semantics experiment](instruction-semantics.md) uses the
  same schemas for register/flag symbols and generated state types.

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
| [8080](../../src/components/cpus/8080.ts) | Shared [8080-family table](../../src/components/cpus/8080-family.ts): `xx yyy zzz`; leading `xx` blocks, then `zzz` subgroups where it selects the family; split `yyy` into `pp q` for pair operations |
| [6502](../../src/components/cpus/6502.ts) | `aaa bbb cc`; `cc=01` groups `aaa` operations with shared `bbb` operand readers; `cc=00/10` retain `bbb` subgroups and their distinct implied/addressing forms |
| [6800](../../src/components/cpus/6800.ts) | Accumulator forms use `1 r mm oooo`; `r` selects A/B, `mm` the addressing mode, and `oooo` the operation; unary forms use `01 tt oooo`, with `tt` selecting A/B/indexed/extended; short branches use `0010 ttt p`, keeping the unused `21` explicit |
| [6809](../../src/components/cpus/6809.ts) | Base-page accumulator families use `1 r mm oooo`; unary groups use `0000 oooo`, `010r oooo`, `0110 oooo`, and `0111 oooo`; stack instructions use `001101 s p` and a separate register-mask postbyte; pages `10`/`11` share word-family builders, with long conditions on page `10` |
| [Z80](../../src/components/cpus/z80.ts) | Shared 8080 base families plus explicit Z80 extension slots; shared CB `xx yyy rrr` operations for ordinary/indexed operands; one DD/FD builder selecting IX/IY; ED pair and block families; decode the complete supported encoding before committing state |
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

For migrated 6502 instructions, keep patterns and selectors beside their bodies
in [the authored definitions](../../src/components/cpus/semantics/definitions/6502.ts).
Generate execution bindings from those same patterns; the CPU binds the complete
inventory after initializing state. Preserve the duplicate-opcode check. Avoid maintaining a second list of
generated method names or repeating migrated patterns in the CPU class.
Keep address and operand sources there too: all instructions now
expand them into complete generated bodies. Standalone source generation remains
a test of the same compiler. Address sources stop before the final data read, allowing stores and memory modifiers to preserve their own access order.
Keep instruction-specific exceptions, such as indirect JMP's page wrap, explicit.

For migrated 68000 register instructions, patterns likewise live beside their
[definitions](../../src/components/cpus/semantics/definitions/68000.ts).
`instructionSet(entries, 16)` checks the word-sized encoding inventory. The core
adds generated entries to its shared static table, passing the executing CPU's
state to each body. The remaining MOVE/MOVEA forms use a shared
[encoding inventory](../../src/components/cpus/68000-moves.ts) to select bodies
by operand role and supply the exact mode/register selectors.
MOVEQ retains its embedded-byte selector and supplies the immediate to one
parameterized body per destination. Literal values do not multiply coverage.
A7 selection expands into explicit S tests and SSP/USP branches at each operand's
turn. Byte/word data writes preserve the live upper portion, while EXT.W uses
its captured original. Keep SWAP's flags-before-write order distinct from
MOVE/MOVEQ/EXT's write-before-flags order.

For memory/immediate MOVE forms, the definition requests EA resolution at the
source and destination stages separately. Keep the existing decoder behind
`Cpu68000AddressContext`; it owns extension decoding and an instruction-local
map of pending auto-updates. The [logical inventory](../../src/components/cpus/68000-logic.ts)
uses the same context and binding, with [operand classification](../../src/components/cpus/68000-operands.ts)
shared across both inventories. Source reads, immediate fetches, byte transfers,
partial Dn writes, and result flags share construction in the definitions.
Generated bodies own alignment checks, all operand byte accesses, the explicit
update-commit point, writeback, and flags. Do not resolve the destination before
completing the source read. Keep logical
32-bit addresses until the memory adapter maps the physical bus, retaining
program/data space for fault delivery. Native-word operand fetching preserves
the core's complete-word cursor and instruction-byte recording boundary.

Logical memory destinations commit pending updates before reading their value,
including CLR's real memory read. Logical flags precede writeback, while TST
omits writeback altogether. Keep these stages explicit beside MOVE's distinct
order when sharing the underlying operand helpers.

The [arithmetic inventory](../../src/components/cpus/68000-arithmetic.ts) supplies
the same decoded operand inputs; quick constants reuse the source selector
field instead of multiplying bodies. Logic and arithmetic share an ALU
destination recipe, with calculation and optional writeback kept explicit.
Address-register destinations select their A7 bank before committing pending
updates and read the updated register afterward. Their arithmetic width is
always 32 bits; word EA sources sign-extend, while quick values remain positive.
Comparisons omit writeback. Extended arithmetic captures Z then X after operand
reads and applies cumulative zero separately from ordinary result flags.

The [bit/shift inventory](../../src/components/cpus/68000-bits.ts) uses the same
binding and destination stages. Capture bit numbers and shift counts before
reading the target; keep BTST's program-space and immediate reads distinct from
writable operands. Shifts share one-bit construction with the other CPUs.
Use named local iteration values for the result, extend, carry, and accumulated
overflow, updating them together and publishing architectural flags afterward.
Keep zero-count flag rules and TAS's original-byte flag calculation explicit.

Word-source MUL/DIV/CHK commit source updates after their result/flag effects,
including before requesting a synchronous exception. Preserve that stage when
sharing source readers. Use division's optional overflow capture when quotient
overflow completes by setting a flag; keep zero-divisor rejection and all flag
policies explicit. Decimal pairs reuse the ALU destination stages, correct low
then high digit, and publish C/X before reading cumulative Z. This differs from
binary extended arithmetic's earlier Z capture.

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
universal CPU base class, or definition language.

## Shared 8080/Z80 instruction family

[`Cpu8080Family`](../../src/components/cpus/8080-family.ts) is an internal abstract
base for the sibling `Cpu8080` and `CpuZ80` classes. It owns the common register
operands, pair views, data-word accesses, and 240 supported
8080 encodings. Its bit-pattern table gives both CPUs' mnemonics. The Z80 adds
the remaining unprefixed forms and its own CB, ED, DD, and FD pages.

The concrete CPUs supply protected hooks for ALU operations, accumulator/carry
operations, generated bodies keyed by opcode, and byte increment/decrement.
PSW/AF packing and all ordinary stack operations belong to generated bodies. Both CPUs' byte ALU and byte-adjustment selectors bind complete generated bodies with
explicit source reads, flags, and writeback. Shared
[Intel construction](../../src/components/cpus/semantics/intel.ts) supplies
register/(HL)/immediate sources and carry-before-A ordering; CPU definitions
provide flag policies. CMP/CP omit the destination write. The Z80's indexed
ALU bodies receive the decoder's resolved address and share the same construction.
INR/DCR and INC/DEC share read–adjust–flags–write construction with separate
CPU flag policies; their memory bodies receive one resolved HL or indexed address.
The old accumulator wrapper is gone. These hooks keep differing flag rules explicit, including parity
versus overflow and the opposite subtraction half-carry conventions. The shared
code does not select behavior by checking which processor is executing.

The shared [encoding inventory](../../src/components/cpus/intel-encodings.ts)
owns the `00 ddd 110` immediate and `01 ddd sss` matrix encodings. Definition
construction and execution binding consume that same inventory; the generated
method keys are the numeric opcodes. HALT remains explicit in the family table.
Ordinary bodies own source reads, H/L reads at the access point, and writeback.
Indexed Z80 bodies share construction and receive a resolved address instead.
Both CPUs use one binder, with no separate handwritten byte-operand read/write
helpers or per-CPU transfer dispatch tables. The same binder serves the common
word-arithmetic encodings `00 pp 1 001` and `00 pp q 011`.
The accumulator memory slots in `00 pp q 010` share that inventory and binder:
BC/DE addresses read high byte first; absolute addresses fetch low byte first.
These stores capture the address before A. Loads write A only after a successful
memory read. Both directions avoid flag access; the family no longer needs a
separate register-pair selector for them.

Word transfers use that same binder with their own immediate, memory, and SP-copy
inventory. Bodies fetch complete addresses, read or write memory low byte first,
and express split-register writes explicitly. Their pair descriptions reuse the
runtime's register-pair byte mapping. Z80 ED HL forms share their unprefixed
bodies; IX/IY use stored word registers through the same construction. Keep
prefix recognition and retirement in the Z80 decoder.

Word arithmetic reuses those pair descriptions. INX/DCX and word INC/DEC
never access flags. DAD and ADD capture the source before the destination;
ADC/SBC HL then capture incoming C. All write the result before flags, unlike
byte arithmetic. DAD updates only CY; Z80 ADD preserves S/Z/PV, while ADC/SBC
replace them with whole-word sign, zero, and overflow. Z80 H comes from carry
or borrow out of bit 11, expressed by bit 12 of `left XOR right XOR result`.
The handwritten addition hook, Z80 word-arithmetic helpers, and now-unused
IX/IY pair-read/write overrides are removed.

The `11 10 m 011` exchange inventory uses the same binder: m=0 selects
XTHL / EX (SP),HL, and m=1 selects XCHG / EX DE,HL. The stack-exchange
construction also serves IX/IY. Bodies capture the complete register before SP,
read low/high, write high/low, then replace the register only after both writes
succeed. Register-only exchanges swap D/H before E/L. The two handwritten
exchange helpers are removed; these bodies never write SP or access flags.

The jump inventory uses the same binder for `11 ccc 010`, unconditional JMP/JP,
and PCHL/JP (HL). Definitions capture complete targets before testing flags;
only taken paths write PC. The family jump helper is removed. Z80 JR and DJNZ
use the same conditional construction, and JP (IX/IY) uses a stored-word source.
DJNZ fetches before decrementing B and never accesses flags. Prefix decoding,
refresh, and supplied-instruction retirement remain in the core.

Each concrete constructor validates and copies its state before passing that
owned state to `super`. The base constructor binds only the state; the Z80
constructs its private runtime interrupt stack afterward. Each concrete CPU
initializes its operation selectors
before calling `baseInstructions()` to construct its table; the base constructor
must never call that builder or a CPU hook. CPU-specific helpers stay in `#` methods except for the required overrides;
protected members form the internal TypeScript inheritance boundary.

State descriptions, public snapshots, reset, instruction fetching, and step
outcomes remain in the concrete CPU modules. Z80 prefix validation and R updates
therefore keep their existing execution contract. Both expose `snapshot`,
`reset`, `step`, and their own boundary-level `interrupt` operation. The family
adds no public controls or mutable state access. This shallow hierarchy expresses
the 8080/Z80 relationship and is not a requirement for other processors.

The 8008 reuses the same `intelByteAlu` and `intelByteTransfer` construction
without inheriting this execution core. Its definitions keep native
A/B/C/D/E/H/L/M sources, a `3FFF` mask on memory addresses, and S/Z/P/C policies.
Its own opcode table binds the generated bodies; transfer definitions and
bindings consume one native encoding inventory with the `11 ddd sss` matrix
and an explicit HLT exception. The control-flow inventory also supplies both
construction and binding opcodes, including all ignored-bit aliases. Generated
calls and returns operate on the schema's physical address-register array and
three-bit selector; they never use the RAM-stack helper. The compiler validates
array bounds and exact stored widths, with explicit target narrowing to 14 bits.
Generated execution uses `Cpu8008StoredState`; constructor inputs still accept
readonly slots. Fetching retains the selected address-register PC and interrupt
supplied-byte rules.

## Shared execution records

The [execution-record types](../../src/components/cpus/execution-records.ts)
provide the common fields used by all eight CPUs:

- `FetchedInstruction` contains the start `address` and actual fetched `bytes`.
- `StateTransition<Snapshot, Access = MemoryAccess>` contains `before`, `after`,
  and ordered `accesses`. The supplied snapshot type retains its CPU's fields, derived
  views, and nested readonly guarantees.
- `InstructionStep<Snapshot>` describes ordinary execution or opcode rejection,
  both with a fetched instruction.
- `HaltedStep<Snapshot>` describes HALT, with a null instruction only for an
  already halted CPU.
- `WaitingStep<Snapshot>` describes a wait instruction or an already waiting
  CPU, with a null instruction in the latter case. The 6800, 6809, and 8088 share it.

CPU modules keep their public names as aliases, such as `Cpu6502Instruction`
and `Cpu6502ResetRecord`. `InstructionStep`, `HaltedStep`, and `WaitingStep` accept the same
optional access type. The 8008, 8080, Z80, and 8088 supply a union of memory and
port accesses. The 8088 additionally records ESC delivery and TEST samples through its
[device adapter](../../src/components/cpus/8088-external.ts); the
68000 includes a device-reset event. Other CPUs retain the memory-only default.
Each step type selects its supported outcomes. The 68000 selects only the executed
branch of `InstructionStep`: invalid opwords deliver exceptions instead of opcode
rejection. It adds its alignment-fault branch, including a possible null instruction
on an unaligned opcode fetch, optional exception metadata with source/vector/PC,
and a no-fetch trace-entry branch. The 8088 adds an executed no-fetch trap-entry
branch, while software interrupts retain their triggering fetched instruction.
An executed WAIT continuation instead has `instruction: null` and
`continuation: "wait"`: it samples TEST without fetching another instruction.
Address conventions are documented beside the aliases, including the 8088's physical instruction
address and the 68000's full logical instruction address.

The 68000's separate interrupt record contains a level, null instruction,
acknowledgement and frame/vector accesses, and acceptance, masking, trace-priority,
or alignment outcomes. Trace retirement and external entry share its native
frame helpers; `tracePending` survives snapshots independently of T.

The separate interrupt records for the 6502, 6800, and 6809 use `StateTransition` with
memory accesses,
a source, and a null instruction: external entry performs no opcode fetch.
Each distinguishes accepted entry from an ignored request. The 6809 also
distinguishes masked SYNC resumption and unarmed NMI. Wait modes and native
frames stay in each CPU; the runner preserves `waiting` as a stopping reason.

The separate interrupt records for the 8008 and 8080 use `StateTransition` with memory, port,
and acknowledgement accesses. Each supplied instruction has a source and bytes,
with no invented RAM address. The 8008 accepts every explicit offer, with no
mask or implicit call. The Z80 uses the same record conventions for
mode-0 execution and null instructions for NMI and mode-1/2 entry. It shares
its decoder and retirement logic between normal and supplied instructions,
while their PC/R fetch policies remain explicit. RETI notification follows
architectural retirement. Ordinary step records retain their existing shape.

These types describe records; each CPU still constructs detached snapshots and
access lists. Existing [public type checks](../../tests/types) verify readonly
fields, concrete snapshot types, and outcome narrowing through the CPU exports.

## Register pairs and packed flags

The [register-pair helpers](../../src/components/cpus/register-pairs.ts) define
BC, DE, and HL as high/low byte views shared by the 8080 and Z80. Runtime reads,
generated split writes, and snapshot views use that one mapping. CPU tables select pair names;
SP is stored directly. The Z80 applies the same views independently to each bank.
The last ordinary Z80 migration removes the unused runtime pair writer and its family wrapper.

The [flag-register helper](../../src/components/cpus/flags.ts) takes a map from
flag names to bit positions, plus any fixed output bits. `encode` reads current
Booleans; `decode` creates a fresh flag object and ignores unmodeled input bits.
The 6502's PHP/PLP, 8080's PSW, Z80's AF, 6800's TAP/TPA, and 6809's CC declare
their own layouts beside their state schemas. The helper owns and freezes both
the layout and its codec; generated status sources use the same `bits` and
`fixed` declaration as runtime encoding. Fixed output bits describe the model's packing policy;
they do not add stored flags or assert hardware behavior for omitted bits.
Layouts are checked for invalid, repeated, and overlapping bit positions.

[Register-pair tests](../../tests/components/cpus/register-pairs.test.ts)
check every word against native byte conversion, including preservation of
other registers and detached views. [Flag tests](../../tests/components/cpus/flags.test.ts)
check round trips, ignored/fixed bits, live values, and invalid layouts.
[Type checks](../../tests/types/cpu-helpers.ts) preserve named flags, valid pairs,
and the concrete readonly snapshot/record contracts.

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

The 6502, 6800, 6809, and shared 8080-family core import
`WordInstructionContext` as their local `InstructionContext`. The 8008, 8080,
and Z80 extend it with `BytePorts`; the 8080/Z80 add interrupt-deferral callbacks,
and the Z80 also queues RETI notification for retirement.
The 8088 extends it with `BytePorts`, the instruction start IP, local segment/repeat
prefixes, `InterruptDeferralContext` for instruction-local recognition delays,
and a callback for software entry. The 8008
fetches a full two-byte operand and masks it to a 14-bit address when jumping
or calling. The 68000 currently
extends `ByteMemory` with `fetchWord`, `fetchLong`, `nextAddress`, `jump`, and
a recorded device-reset callback.
Fetching and jumps update a local cursor; a successful instruction commits it
to PC. A synchronous exception instead stacks its selected return PC and
loads the handler PC. Its word-based instruction stream, explicit extension-word PC bases,
and atomic alignment rejection differ from the byte-fetch contexts.
Contexts require the operations they advertise; unavailable operations are
absent rather than optional.

Instruction fetches track fetched bytes and advance PC according to the CPU's
execution policy, while data accesses leave the instruction stream alone.
The shared executor below constructs these callbacks for five CPUs; the others
construct them in `step()`. Each CPU selects byte order and keeps any special
address mapping, alignment, and rejection rules. Handler return types also
remain local, including the 68000's alignment fault.

[Type checks](../../tests/types/instruction-context.ts) cover required callbacks
and readonly inheritance. Existing CPU tests retain their independent execution
expectations.

## Shared byte-instruction execution

The [byte-instruction executor](../../src/components/cpus/execute-byte-instruction.ts)
shares the fetch/dispatch loop used by the 8008, 8080, 6502, 6800, and 6809:

```ts
executeByteInstruction(state, ram, handlers, readWordLE)
```

It attempts one byte opcode with a wrapping 16-bit PC and byte memory.
The CPU supplies its stored state, opcode table, and word reader (`readWordLE`
or `readWordBE`). A PC view may impose a narrower wrap; an optional
`mapFetchAddress` callback translates instruction addresses before recording
their reads. Data addresses come directly from handlers. An absent handler
records the opcode read and preserves PC.
A supported opcode advances PC before invoking its handler. Operand fetches
read the current PC and RAM, advance only after a successful read, and append
only fetched instruction bytes. Handlers can interleave fetches with data
accesses or change PC, including the 6502's JSR operand/stack ordering.

The result contains the fetched instruction, ordered accesses, and whether a
handler executed. Each CPU's `step()` owns its before/after snapshots and
outcome; the 8008 and 8080 check HALT before calling the helper. A handler can return
`"unsupported"` after fetching an operand selector, as the 6809 does for an
undefined indexed postbyte. It must reject before changing other state or RAM;
the executor restores PC and retains the actual fetches. This is not general
rollback. RAM and handler errors
propagate without rolling back completed effects. Each call owns its records.

The executor also accepts an opcode lookup callback in place of a table. It
calls the lookup after fetching the opcode, before advancing PC. The 8008 and
8080 use this to bind fresh port recording callbacks; the 8080 also binds an
EI deferral callback. Their prebuilt handler tables still expose the opcode
patterns; the bound callbacks and logs belong to one execution. Both append
their port logs after the memory log because their input/output instructions
transfer once, after all memory fetches.
The Z80 binds the same port callbacks in its own prefix-aware step loop and
records actual memory/port interleaving, including block I/O.

8008 and 8080 interrupt delivery use the same tables and handler-context binding, with
acknowledgement supplying instruction bytes while PC stays unchanged by fetches.
They record data-memory and port transfers as they complete. Acceptance and HALT
release stay in the CPU; the shared RAM-fetch executor does not need an interrupt mode.

The [supplied-instruction recorder](../../src/components/cpus/interrupt-instruction.ts)
shares byte validation and acknowledgement recording between the 8008, 8080,
and Z80. It returns a fresh `instruction` and `fetchByte` callback; each fetch
asks the external source once, validates the byte, appends it, and reports the
completed acknowledgement to the combined access log. It never advances PC.
Native acceptance, stack behavior, decoding, Z80 refresh, and retirement remain
in each CPU. The public CPU instruction/access types alias its readonly shapes.
[Recorder tests](../../tests/components/cpus/interrupt-instruction.test.ts) cover
lazy reads, all byte values, ownership, and failures; CPU tests retain their
independent state and access expectations.

All eight CPUs wrap their mutating public operations with a per-instance
[`executionBoundary`](../../src/components/cpus/execution-boundary.ts) guard.
External callbacks may inspect snapshots, but nested mutations throw before
changing CPU state. The guard clears even when an operation throws; it neither
rolls back completed effects nor represents an architectural interrupt mask.
Each CPU selects which operations to guard and supplies its diagnostic message.

The four CPUs with a stored PC pass their state directly. The 8008 uses
`programCounter(read, write)` to expose its live address-stack slot and mask
writes to 14 bits without adding stored state. Its circular call stack stays
in the CPU file. The Z80 retains complete-prefix decoding and R updates; the
8088 retains segment/repeat prefixes, one-element REP steps, trap boundaries,
and native interrupt delivery; the 68000 retains word opcodes, alignment faults,
native exception frames, trace retirement, and interrupt offers. Those contracts
do not fit this executor. All still share instruction contexts and recorded
byte memory; specialized step loops do not require a broader executor API.

[Helper tests](../../tests/components/cpus/execute-byte-instruction.test.ts)
check unsupported attempts, byte order, wraparound, live register selection,
mapped fetches, interleaved data accesses, record independence, and error propagation.
[Type checks](../../tests/types/execute-byte-instruction.ts) preserve readonly
records. Existing CPU and example tests retain independent hardware expectations.

## Runtime Z80 interrupt stack

The [call-stack helper](../../src/components/cpus/call-stack.ts) remains in
use only for Z80 interrupt entry/return and is private to that CPU. Ordinary
BC/DE/HL/IX/IY and packed PSW/AF pushes/pops, CALL/RET/RST use generated definitions.
Both paths retain predecrement-before-write and increment-after-read ordering,
high/low pushes, low/high pops, and 16-bit wrap. The helper does not own flags,
interrupt acceptance, memory recording, or CPU lifecycle.
[Tests](../../tests/components/cpus/call-stack.test.ts) retain its independent
SP, access-order, and failure checks. The
[stack definitions contract](instruction-semantics.md#stacks-and-subroutines)
explains shared construction across the five migrated CPUs.

## Shared binary helpers

The [binary helpers](../../src/components/cpus/binary.ts) interpret byte values
without owning CPU state:

- `signed8(byte)` interprets an unsigned byte as a signed integer in `-128–127`.
  The 6809 and Z80 still use it for indexed offsets; the 68000 uses it
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

`recordMemory(ram, onAccess)` and `recordPorts(ports, onAccess)` can also report
each completed transfer to a caller's combined log. This preserves actual order
when memory, ports, and acknowledgement bytes share one execution record. A
failed transfer does not notify the combined log. The 8080 interrupt path and
Z80 and 8088 steps use these callbacks to capture their distinct access kinds without
duplicating the recorders' memory and port behavior.

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

## Shared control flow

[Control-flow definitions](../../src/components/cpus/semantics/control-flow.ts)
construct jumps and relative branches for the 6502, 6800, 6809, 8080, and Z80.
Fetch the complete operand before reading condition flags. A taken relative
branch reads the current PC and adds a signed displacement with word wrapping;
an untaken path does not read or write PC. CPU-owned fetch callbacks retain their
normal and interrupt-supplied advancement rules.

Use scoped `when` statements for conditional effects, `signExtend` for byte
displacements, and Boolean `and` for compound conditions. Their
[representation contract](instruction-semantics.md#primitive-meanings) defines
scope and failure behavior. Keep processor-specific target sources explicit:
6502 indirect JMP increments only the pointer's low byte, and Motorola JMP
receives an address after the existing decoder completes. These bodies never
read memory at the jump destination.

Calls, returns, restarts, and ordinary register pushes/pops use the
[shared stack construction](../../src/components/cpus/semantics/stack.ts).
Declare whether the pointer names an occupied or free byte, its fixed page when
needed, and the word byte order. Keep pointer reads/updates on the correct side
of each memory effect. Pop destinations and call targets are written only after
the complete stack access succeeds. The 6502 JSR's low fetch, high/low pushes,
and high fetch remain an explicit sequence in its definitions; RTS adds one to
the popped address. Motorola JSR receives the decoder's resolved target, retaining
indexed S updates and NMI arming. The Intel condition hooks and superseded
call/return wrappers are gone. Packed-status bodies add explicit packing and
complete flag replacement around the shared stack effects.

For masked stacks, supply register views in mask-bit order to `maskedStack`.
It expands conditional transfers, visits pushes in descending order and pulls
in ascending order, captures each source at its turn, and writes each pulled
register only after its complete read. The 6809 uses this recipe for S/U
instructions and supplied-mask frame helpers. Ordinary nonempty S-stack
instructions arm NMI at successful completion; interrupt frame helpers preserve
arming. PULU's S write arms before a subsequent PC pull. The CPU retains interrupt
recognition, frame selection, and vector delivery; its old stack helpers are gone.
The 8088 likewise shares its generated word push with interrupt entry; other
CPUs' interrupt paths still use runtime stack helpers.

`RegisterView` is a construction-time source plus a function producing write
statements. Keep compound effects explicit: D is A then B, CC replaces flags,
and S appends arming. The 6809 shares these writes between transfers, stacks,
and LEA. Its transfer inventory drives both definitions and postbyte bindings,
rejecting undefined or mixed-width pairs before body entry. TFR/EXG capture both
originals before any write; LEA enters only after successful indexed resolution.

The Z80's `intelPairView` reuses the same construction-time read/write view for
BC/DE/HL. Stored alternate-bank registers come from `cpu.bank("alternate")`,
not a second schema. Whole flag exchanges move object references explicitly;
ordinary register exchanges remain ordered reads and writes. Keep latch reads
explicit too: LD A,I/R captures IFF2 after the special-register byte and before C.

Repeated Z80 blocks use one generated iteration and a conditional PC rewind.
Keep source reads, counter capture, destination writes, live pair rereads,
flags, and repeat testing in their existing order. The next step owns refetching
and refresh. Digit rotates similarly keep their memory write before C, flag
replacement, and A writeback; constant logical shifts make nibble movement visible.

The 8088 uses `byteRegisterView` for the low/high halves of its stored words.
The source reads the word once. Its write statements read the word again at
writeback to preserve the current other half, after any intervening fetches or
flag effects. These are construction recipes, with no runtime view object in
new generated bodies. The [encoded register inventory](../../src/components/cpus/8088-registers.ts)
is shared by definitions and the remaining runtime operands.
When two byte-view writes share a statement scope, give their preservation
captures distinct names. XCHG must preserve each live other half at its own write.

Keep migrated 8088 bit patterns beside their bodies in
[the definitions](../../src/components/cpus/semantics/definitions/8088.ts), as for
the 6502. Build the combined table after state initialization, retaining collision
checks against handwritten entries. The decoder still owns prefixes, segmented
fetching, and retirement; generated bodies receive only the callbacks their
effects require. Preserve operand-before-CF captures and flags-before-writeback.

For resolved 8088 transfers, retain ModR/M and segment selection in the decoder.
Pass the captured segment and offset to the generated memory body. Express each
physical address with `projectAddress(segment, offset, 4, 20)`, wrapping each
logical byte offset before projection. Keep complete source capture, low-first
accesses, and partial writeback explicit; never replace them with an opaque
address callback. Register-pair bodies specialize the selectors at construction.
Reuse these operand definitions for arithmetic and logic. MOV/XCHG/ALU/TEST
share one ModR/M binding; their bodies retain different effect schedules.
ALU/TEST capture the source before the destination, then CF for ADC/SBB.
Share their arithmetic/flag recipe with accumulator forms; update flags before
writeback, preserve live byte halves, and omit writes entirely for CMP/TEST.

Unary bodies reuse those operands and flag recipes. INC/DEC capture CF after
the complete operand and restore it before writeback; NOT never accesses flags.
For relative branches, use IP with `relativeBranchSteps`; read it only on the
taken path after fetching. Preserve short-circuit flag reads with construction
decisions rather than eagerly capturing every condition bit. LOOP writes and
rereads CX before testing it. Use `updateStatus` for SAHF's partial flag update;
whole-object restoration would incorrectly replace its unlisted flags.

Use `segmentedWordStack` for the 8088's once-per-word pointer adjustment and
captured SS:SP. Capture push sources before pointer changes, and keep PUSH SP's
decremented source explicit. Far calls capture the whole target before pushing
CS, then capture live IP for the second push. Word FLAGS packing shares the
CPU-owned layout. Keep segment-pop and POPF recognition requests as explicit
`deferInterrupt` effects; they queue work for successful retirement rather than
writing stored boundary latches during the body.

String bodies specialize legal repeat modes and segment overrides at construction.
Keep zero-count checks before operand capture; capture source/destination
coordinates before access, but read DF and the live indices afterward.
Reuse subtraction flags for CMPS/SCAS. Repeated forms decrement and reread CX,
then test ZF only when required, and rewind to the supplied prefix-start IP.
Keep each body to one element; refetching, rejection, and retirement remain
CPU responsibilities. IRET composes the same return and FLAGS statements
used by RETF/POPF, retaining their separate commit points.

For multi-bit shifts, use bounded `iterate` around the shared one-bit recipe.
Capture the count before the operand, retain per-iteration carry effects, and
keep final flags and writeback outside the fold. This does not merge repeated
string instructions into a single CPU step. Use full-width `multiply` and
checked `divide` for double-width intermediates; narrow only at the documented
write. Division and explicit `reject` statements return named outcomes to the
CPU boundary, which continues to own exception delivery. Keep processor-specific
quotient limits and undefined-flag policies visible in the definitions.

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
CPU flag policies remain explicit in the core or a matching family helper:
the 6502 sets C when there is no borrow; the 8080 uses borrow for CY and inverted
half borrow for AC; the Z80 and 8088 use both borrow facts directly; the 6800
and 6809 preserve H during subtraction. The 68000 copies addition's carry or
subtraction's borrow to X and C, while comparison preserves X. Parity, flag
preservation, decimal corrections, and the NMOS 6502's intermediate flag rules
remain CPU behavior.

All eight CPUs use the shift helpers. The 6502
updates C there and N/Z at writeback; 8008/8080 accumulator rotates update only carry.
The 6800 sets V=N XOR C for
both directions; the 6809 sets V for left shifts and preserves it for right
shifts. The Z80's unprefixed accumulator rotates preserve S/Z/PV, while CB
rotates and shifts derive sign, zero, and parity from the result. The 8088
selects byte or word width, repeats the operation for its full CL count,
and distinguishes rotate flags from shift flags. The 68000 applies its six-bit
register counts, X behavior, and intermediate ASL overflow. These policies
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

## Shared result flags and memory modification

Pure result-flag helpers calculate named updates; the instruction schedules
when to apply them. Generated unary bodies now express memory modification
as ordered statements: the 6502 writes the original byte before transformation,
while the 6800/6809 ordinarily read, transform, and write once. Keep the
6502's carry before the result write and N/Z after it. The earlier `modifyByte`
helper has no remaining CPU callers and has been removed.

The [first operation-block experiment](shared-operation-blocks.md) defines
these contracts, comparison and transfer boundaries, and failure checks.
It also explains why the existing small comparison and transfer bodies remain
local. Use the narrow shared operations where their complete effect order
matches; retain the CPU's explicit sequence where it differs.

## Shared Motorola behavior

[Motorola helpers](../../src/components/cpus/motorola.ts) capture specific
family relationships. The 6800, 6809, and 68000 use the T/F, HI/LS, CC/CS,
NE/EQ, VC/VS, PL/MI, GE/LT, and GT/LE condition encoding. The 68000 retains
runtime condition tests. The 6800/6809 share generated branch construction
with explicit flag captures and native branch names. The opcode tables retain
the 6800's absent BRN, the 6809's standalone LBRA, and the 68000's BSR exception.

[Shared decimal construction](../../src/components/cpus/semantics/decimal.ts)
uses the original A/H/C, preserves H and control flags, and clears undefined
V under the Motorola model policy. The runtime DAA helper has no remaining callers
and is removed. Binary addition and subtraction now use
[shared definitions](../../src/components/cpus/semantics/motorola.ts).
The [shared unary definitions](../../src/components/cpus/semantics/motorola.ts)
express NEG/COM/shifts/rotates/INC/DEC/TST/CLR once. Each CPU declares whether
CLR reads its operand, TST clears C, and right shifts set V=N XOR C. The
`motorolaUnaryOperations` table binds generated register/memory bodies to their
shared `oooo` operation selectors. Addressing prefixes and JMP remain in each
CPU. Construction reads no live state; generated bodies receive the executing
CPU's state explicitly.

Comparison construction is also shared. Each CPU declares its compared registers
and any special policy, including the original 6800's CPX high-byte N/V rule.
`motorolaOperandBindings` binds immediate and resolved-memory bodies to the
`mm` addressing field. It reads no state during construction and rejects an
undefined address before body entry; the decoders remain CPU-specific.

Logical construction shares the operand-first recipe with the 6502, selecting
the Motorola N/Z policy with V cleared. BIT uses the same masked result for N/Z
and omits writeback. `motorolaByteBindings` owns the generated comparison,
arithmetic, logical, load, and store selectors in `1 r mm oooo`, sharing operand bindings
across both CPUs. Stores omit the immediate binding.
The 6800's ORAA/ORAB and the 6809's ORA/ORB retain their native display names.

Byte loads and the 6800's TAB/TBA reuse the transfer recipe, writing the
register before N/Z/V. Byte stores resolve the address, capture A/B, and write
once without a destination read; only a successful write applies N/Z/V.
They share the same result-flag policy as logic. The original 6800 retains
its native LDAA/LDAB and STAA/STAB names in explanations.

Word loads/stores use the same `motorolaTransfers` construction at width 16,
with explicit high-byte-first accesses and wrapping. A load writes its register
only after both reads succeed; a store applies flags only after both writes
succeed. The 6809 definition supplies D's A/B source and split writes, and S's
register write followed by NMI arming. `lowByte` and schema-checked `writeLatch`
keep these effects visible in generated code and explanations. The old word
load/store helpers and shared runtime result-flag helper have no remaining callers.

`motorolaArithmetic` constructs the binary result and explicit flag stage;
`motorolaArithmeticFamily` schedules operand reads, the accumulator, optional
incoming C, and register writeback. Byte addition replaces H; subtraction and
word arithmetic preserve it. Flags precede writeback, including the 6809's
explicit A-then-B writes for D. ABA/SBA supply A-then-B reads separately.
All byte arithmetic uses `motorolaByteBindings`; ADDD/SUBD use the existing
operand bindings. The old accumulator-operation table, byte-operand readers,
and word-arithmetic helpers have no remaining callers. Address decoders still
reject undefined indexed postbytes before body entry.

[Tests](../../tests/components/cpus/motorola.test.ts) compare encoded conditions
with unsigned and signed arithmetic and verify preserved flags.
[Generated-body tests](../../tests/components/cpus/semantics/arithmetic.test.ts)
verify captured carry, replaced flag objects, and flags before writeback. The
existing exhaustive CPU tests independently check arithmetic and all addressing forms. Sharing these behaviors does not imply that all
Motorola instructions or flag rules agree.

## Verify a reorganization

Preserve public contracts, supported encodings, flag effects, wrapping, reset,
unsupported-attempt behavior, and the order of actual memory accesses. Run the
existing independent CPU and example checks plus the build/type checks. Tests
should establish instruction behavior from independent expectations; avoid
tests that merely repeat a builder's encoding formula or prescribe private
method placement.
