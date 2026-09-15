# 8008 model contract

The Intel 8008 model implements all documented opcode forms with native port
selectors and flat 16 KiB RAM. Its PC is a view of an internal address register;
its memory addresses wrap at 14 bits.

[Implementation](../../../src/components/cpus/8008.ts) ·
[CPU tests](../../../tests/components/cpus/8008.test.ts) ·
[Public type checks](../../../tests/types/8008.ts) ·
[Coverage](../coverage.md#8008) ·
[Arithmetic example](examples/arithmetic.md) ·
[ALU example](examples/alu.md) ·
[Nested-call example](examples/stack.md) ·
[Transfer example](examples/transfers.md) ·
[Control-flow example](examples/control-flow.md) ·
[Carry and restart example](examples/carry.md)

The hardware reference is Intel's
[8008 User's Manual, April 1972](https://www.bitsavers.org/components/intel/MCS8/Intel_8008_8-Bit_Parallel_Central_Processing_Unit_Rev1_Apr72.pdf)
([searchable copy](https://manuals.plus/m/c23aa03524a8348d87dbe05c0a002b2aef66f39578347a483393e89283fb0f96)).
Relevant sections are *Basic Functional Blocks*, *Basic Instruction Set*,
*Start-Up of the 8008*, and Appendix I's functional definitions.
The [November 1972 revision](https://manualzz.com/doc/10956006/intel-8008--8008-1-microprocessors-users-manual),
Appendix II, also describes PC increments before stack selection changes.
The tutorial's earlier teaching model uses 8080 encodings; this core implements
the hardware encoding described by Intel.

## Stored state and register views

`Cpu8008State` requires all of the following:

| Field | Range | Meaning |
| --- | --- | --- |
| A, B, C, D, E, H, L | `00`–`FF` | Seven byte registers |
| `flags` with S, Z, P, C | Boolean | Sign, zero, even parity, carry |
| `addressStack` | Eight values in `0000`–`3FFF` | Physical address registers, in slot order |
| `stackIndex` | `0`–`7` | Selector identifying the current PC slot |
| `halted` | Boolean | Whether execution is stopped |

TypeScript register and flag fields are lowercase. Machine definitions use
uppercase register and flag names and the descriptive names `addressStack`,
`stackIndex`, and `halted`.

Snapshots derive `pc = addressStack[stackIndex]` and the raw 16-bit `hl` pair.
Neither is separately stored or initialized. H remains an eight-bit register;
a memory access uses only its low six bits together with L. Thus H:L = `E677`
addresses RAM at `2677`, while the snapshot still shows HL = `E677`.

The selected slot holds PC; the other seven can hold return addresses. Calls
and returns change which slot is selected, as described below. There is no RAM
stack pointer, stack-depth counter, interrupt-enable latch, auxiliary carry,
or overflow flag in this state model.

## Construction and inspection

`new Cpu8008(ram, initialState, ports?)` requires exactly 16 KiB RAM. It copies declared
fields, flags, and all eight address slots, then validates register and address
ranges, the selector, and Boolean flags and halt state. Numeric violations throw
`RangeError`; malformed address arrays and non-Boolean flags or latches throw
`TypeError`. Sparse address arrays fail numeric validation. Construction does
not reset, execute instructions, or access RAM or ports.

Each declared input field and array slot is read once, including non-enumerable
properties. Derived views and extra metadata are ignored. A snapshot can be
used to initialize a fresh CPU. `snapshot()` returns detached state without
reading RAM, and public snapshot types are recursively readonly. The values
are ordinary JavaScript objects: bypassing readonly typing cannot change the
CPU or another snapshot. The CPU retains no record history.

## Instruction steps

`step()` returns a `Cpu8008StepRecord` containing independent `before` and
`after` snapshots, the instruction address and fetched bytes, ordered byte
`accesses`, and an `outcome` of `executed`, `halted`, or `unsupported`.
Only unsupported records have `reason: "opcode"`. An already halted step has
`instruction: null`, no accesses, and unchanged state.

Supported fetches advance the selected address register, wrapping from `3FFF`
to `0000`. Immediate instructions fetch their operand after the opcode. Memory
loads and stores access RAM at the masked H:L address. Data reads are recorded
separately from instruction bytes and do not advance PC. Stores never read
the destination, and writes are recorded even if the value does not change.
Instruction bytes remain intact in records when a store overwrites code;
subsequent instructions read current RAM.

The six undefined encodings (`22`, `2A`, `32`, `38`, `39`, `3A`) remain
unsupported. These attempts read only the opcode and preserve all state and RAM.
Repeating the attempt repeats that one read. Atomic rejection is a model
policy, including leaving PC unchanged despite the recorded fetch.

All three documented HLT encodings (`00`, `01`, `FF`) advance PC once and set
`halted`. Later stopped steps make no accesses. The model does not reproduce
ongoing internal refresh, pin activity, dummy accesses, or cycle timing.

## Loads

The two load families use A/B/C/D/E/H/L/M in selector order, with M referring
to RAM through H:L's low 14 bits:

- `00 rrr 110`: an immediate byte is loaded into the selected register or
  memory. These are the seven LrI forms (LAI through LLI) and LMI.
- `11 ddd sss`: transfer from the selected source to the selected destination.
  There are 49 register transfers, seven memory reads, and seven memory writes.
  The `11 111 111` slot selects HLT during table construction and performs no
  data access; it is not a memory-to-memory transfer.

All loads preserve S/Z/P/C and the inactive address slots. Register self-transfers
read only the opcode. H and L remain full bytes when loaded or used as data;
only the address sent to RAM discards H's top two bits. Loading H or L from
memory reads through the original H:L before replacing the destination byte.
LMI fetches its immediate before writing, including when H:L aliases the opcode
or operand address. Subsequent steps use the current registers and RAM.

Intel's [November 1973 manual](https://deramp.com/downloads/mfe_archive/050-Component%20Specifications/Intel/Microprocessors%20and%20Support/8008%20Family/i8008UM%20Nov%2073.pdf),
printed pages 8–11, describes these selectors, load forms, and flag rules.
The [transfer example](examples/transfers.md) follows a byte through registers
and RAM, then changes the next memory address by loading H from memory.

## Arithmetic and logic

The complete accumulator ALU uses two encodings: `10 ooo sss` selects an
operation and register/memory source, while `00 ooo 100` selects the same
operation with an immediate byte. Source selectors follow A/B/C/D/E/H/L/M;
operation selectors are:

| `ooo` | Register/memory / immediate | Operation | Carry flag |
| --- | --- | --- | --- |
| `000` | ADr / ADI | A + operand | Set when the sum exceeds `FF`; ignore incoming C |
| `001` | ACr / ACI | A + operand + C | Set when the sum exceeds `FF` |
| `010` | SUr / SUI | A − operand | Set on borrow; ignore incoming C |
| `011` | SBr / SBI | A − operand − C | Set on borrow, including operand `FF` with incoming C |
| `100` | NDr / NDI | A AND operand | Clear |
| `101` | XRr / XRI | A XOR operand | Clear |
| `110` | ORr / ORI | A OR operand | Clear |
| `111` | CPr / CPI | Set subtraction flags and retain A | Set when A < operand; ignore incoming C |

Each operation wraps its result to eight bits. S is that result's high bit,
Z indicates zero, and P indicates even parity. Comparison uses the subtraction
result for these flags even though A remains unchanged. All four flags are
replaced; there is no half-carry or signed-overflow flag on this CPU.
Intel's November 1973 manual, printed pages 11–12, defines these operations.

Register operations read the original source, including when the source is A.
H and L contribute their full byte values as operands. Memory operations read
the byte at H:L's low 14 bits, after fetching the opcode, with no write or
additional PC increment. Even when that address equals the instruction address,
the data read is recorded separately from the instruction fetch. Immediate
bytes wrap with PC and remain in the instruction record. Other registers,
inactive address slots, and RAM remain unchanged. Operand and carry values
are read during execution.

The [ALU example](examples/alu.md) propagates carry and borrow between two
bytes, combines bits, and stores results while preserving comparison flags.

### Register increment and decrement

`00 rrr 00d` selects INr (`d=0`) or DCr (`d=1`) for B/C/D/E/H/L.
The selected byte wraps at eight bits; S/Z/P describe its result and C is
preserved. A and the other registers stay unchanged. H remains a full byte;
incrementing L does not automatically increment H. The `rrr=000` slots are
HLT, and `rrr=111` is undefined: there is no accumulator or memory adjustment.

### Accumulator rotations

`00 0td 010` rotates A once. `t=0` uses the outgoing bit as the incoming
bit (RLC/RRC); `t=1` uses the old carry (RAL/RAR). `d=0` rotates left,
and `d=1` right. C receives the outgoing bit; S/Z/P remain unchanged.
The four `00 1xx 010` encodings are undefined.

Adjustments and rotations fetch one opcode byte and make no data accesses.
Intel's November 1973 manual, printed pages 11 and 13, defines their flag
rules. The [carry example](examples/carry.md) preserves carry across pointer
and count adjustments between two byte rotations.

## Jumps, calls, and returns

JMP and CAL fetch a low address byte followed by a high byte. The high byte's
top two bits are ignored for addressing but retained in the instruction record.
All three fetches advance the caller's PC, including wrap at `3FFF`.

- JMP replaces the selected PC with the destination and preserves other slots.
- CAL leaves the address after its three bytes in the caller's slot, selects
  the next slot, and writes the destination there.
- RST (`00 vvv 101`) calls `0000`, `0008`, …, `0038`. It saves the address
  after its single opcode byte and selects the next slot, like CAL.
- RET advances the outgoing PC by one for its opcode fetch, then selects the
  preceding slot. The outgoing slot retains that advanced address.

Slot numbering is a model convention: CAL/RST increment `stackIndex` modulo eight;
RET decrements it modulo eight. Seven calls can preserve all return addresses.
An eighth nested call overwrites the oldest; extra returns continue around the
same ring without a depth check or fault. No slot is cleared on return.

JMP, CAL, and RET each have eight documented encodings: `01 xxx 100` for JMP,
`01 xxx 110` for CAL, and `00 xxx 111` for RET. The `xxx` bits are ignored.
All forms preserve data registers and flags. Their only RAM accesses are the
instruction bytes: there is no RAM stack access or destination prefetch.
RST's eight encodings select distinct vectors, rather than aliases. This is
ordinary execution from RAM; interrupt delivery and externally supplied
instructions remain deferred. RST is a call, not `reset()` or a way to resume
an already halted CPU. Intel's November 1973 manual describes it on printed
page 14.

Conditional control flow uses the same flag selector in all three families:

| Encoding | Instruction | Action when the condition matches |
| --- | --- | --- |
| `00 ccc 011` | RFc / RTc | Return through the preceding address slot |
| `01 ccc 000` | JFc / JTc | Replace the current PC with the fetched destination |
| `01 ccc 010` | CFc / CTc | Save the fall-through PC and call through the next slot |

Here `ccc = vff`: bit 5 (`v`) requires false (`0`) or true (`1`), and bits
4–3 (`ff`) select carry (`00`), zero (`01`), sign (`10`), or parity (`11`).
Thus the eight condition suffixes are FC/FZ/FS/FP/TC/TZ/TS/TP. These are
distinct conditions, unlike the unconditional instructions' ignored bits.

Both paths of a conditional jump or call fetch all three instruction bytes,
wrap the current PC at 14 bits, and retain the full encoded address bytes in
the record. An untaken path leaves the current slot at that fall-through PC;
an untaken call never selects or overwrites another slot. A conditional return
always fetches one byte and advances its outgoing slot, but only a taken return
changes the selector. Untaken returns preserve all seven inactive slots.

Taken forms use the same circular-stack rules as their unconditional
counterparts. All conditional forms preserve data registers, flags, and RAM,
report `executed`, and access only instruction bytes. Conditions read the
current flags on each step. Intel's November 1973 manual, printed pages 13–14,
describes these encodings and both paths. The
[control-flow example](examples/control-flow.md) connects comparisons and
arithmetic flags to a loop and conditional subroutine calls and returns.

## Port input and output

`01 ppppp 1` embeds the five-bit port selector in a single opcode byte.
Written as `rrmmm`, its high two bits select input (`rr=00`) or output
(`rr=01/10/11`):

| Instruction | Port numbers | Encodings | Effect |
| --- | --- | --- | --- |
| INP | `00`–`07` | `41`, `43`, …, `4F` | Read the selected input into A |
| OUT | `08`–`1F` | `51`, `53`, …, `7F` | Write A to the selected output |

Output port numbers retain their encoded values. Both instructions preserve
S/Z/P/C and all other data registers. They fetch one opcode, advance the
selected PC once with 14-bit wrapping, then transfer one byte. No operand
byte, H:L access, or inactive address-slot change occurs.
Intel's [November 1973 manual](https://deramp.com/downloads/mfe_archive/050-Component%20Specifications/Intel/Microprocessors%20and%20Support/8008%20Family/i8008UM%20Nov%2073.pdf),
printed page 14, defines the transfers; page 62 confirms the assembler's
port numbering (input `000`–`007`, output `010`–`037` in octal).

The optional third constructor argument is the shared
[`BytePorts`](../../../src/components/cpus/port-access.ts) connection, with
`readPort(port): number` and `writePort(port, value): void`. Inputs must return
an unsigned byte. The CPU retains the connection, calls it at execution time,
and neither snapshots nor resets it. Reconstructing a CPU from a snapshot
requires reconnecting the device explicitly; the caller owns device state.
Construction, inspection, reset, undefined instructions, and already halted
steps make no port calls. RAM-only programs need no connection.

`Cpu8008Access` combines memory and port transfers. Memory entries retain
`{ kind: "read" | "write", address, value }`; port entries use
`{ kind: "input" | "output", port, value }`. A successful INP or OUT record
contains its RAM opcode read followed by its port transfer, even when the
input equals A's existing value or outputs repeat. Port transfers do not
become instruction bytes. Records own their snapshots and access entries;
later CPU or device activity does not change earlier records. Reset records
retain their memory-only access type and empty list.

Missing connections, invalid input bytes, and device errors throw host errors;
they do not return an instruction record. The completed opcode fetch remains:
the selected PC has advanced, while A, flags, and inactive slots stay unchanged.
Device side effects are not rolled back. RAM errors likewise retain completed
effects. Callbacks may inspect `snapshot()`, but nested `step()` or `reset()`
calls throw before mutating CPU state. The guard clears after success or error.

This models instruction-level transfers. Multiplexed pin activity, including
A and the flags exposed during input cycles, READY waits, timing, and external
interrupt delivery remain unmodeled.

## CPU reset

The 8008 has no dedicated reset input. Its documented power-on sequence clears
its internal memories and leaves it stopped; an interrupt starts execution.
`reset()` models the settled clearing-and-stop result at an instruction boundary:
it clears A/B/C/D/E/H/L and all eight address registers, selects slot zero,
and sets `halted = true`. It preserves RAM. Choosing selector zero and preserving
flags, whose values the startup description does not specify, are deterministic
model policies.

The reset record contains independent `before` and `after` snapshots and an
empty access list, with no instruction or step outcome. Repeating reset has
the same effects. No power transition, clock sequence, forced instruction, or
interrupt is simulated. This method is distinct from the 8008 RST instruction.

Since interrupt delivery is deferred, a reset CPU remains stopped. Example
factories explicitly initialize `halted = false`; creating a new example
restarts the lesson with fresh RAM and its original state. Construction never
implies physical power-on behavior.

## Checks and limits

CPU tests check every byte pair and both incoming carry values for all eight
immediate ALU operations against independent decimal arithmetic, logical truth
tables, and binary-digit counts. Every register/memory and immediate encoding
also checks all operand bytes and incoming flag patterns at accumulator
boundaries, including A as its own source. Memory ALU checks cover H's four
address aliases, boundaries, and code overlaps, with no writes.

Other tests check all load bytes and flag patterns, all H:L combinations,
every PC, and each address-stack selector. They compare complete records and actual RAM accesses,
including unchanged-value writes, self-modified code, unsupported attempts,
all three HLT encodings, reset, and detached records.

Transfer checks cover every matrix encoding, byte value, and incoming flag
pattern, with all eight PC slots and wrapped opcode fetches. Memory cases also
check the four aliases formed by H's top bits, address-space boundaries,
instruction overlap, and loads into H and L. LAM and LMA each cover every H:L
combination. LMI covers every byte and flag pattern, wrapped operand fetches,
and aliased writes over its own opcode or operand. Further checks verify that
memory loads see RAM edits and the pointer left by a preceding load.

Control-flow checks cover all documented aliases, every encoded destination
including ignored high bits, every selector and flag pattern, wrapped fetches,
eight nested calls, overwritten return addresses, and unbalanced returns.
Conditional checks cover all 24 encodings and all 16 flag patterns in every
slot. Jump/call cases include four address aliases, byte-boundary wrapping,
self-targets, and destinations overlapping instruction bytes on both paths.
Return cases check retained outgoing slots, boundary destinations, and equal
PC values in different slots. A repeated conditional jump also checks current
flags, edited address bytes, and detached records.

Adjustment and rotation tests cover all 256 operand values and all 16 incoming
flag patterns, checking full records, preserved registers/flags, and actual
RAM calls. RST tests cover every vector from every PC, all stack selectors and
flag patterns, wrapped fetches, overlapping targets, returns, and eight nested
restarts overwriting the oldest return address. An opcode audit exercises all
250 documented forms and rejects exactly the six undefined bytes. Port tests
check every selector and byte, preserved flags and address slots, wrapped
fetches, live device state, ordered transfers, detached records, callback
reentrancy, and connection failures. A combined INP/CAL/ADI/OUT/RET/HLT program
checks bounded running and snapshot restoration across a wrapped call.

The generated examples check both factories, whole memory images, complete
traces, bounded running, caller completion, reset, and fresh restart. The
nested-call trace also checks inactive slot contents across returns.
The ALU example checks resumption with a pending borrow and preservation of
comparison flags through the output stores and halt.
The control-flow trace checks both paths of each conditional family, a skipped
failure path, and resumption between an untaken RFZ and a taken RTZ.
The carry trace checks RST/RET, both RFZ paths, pointer page crossing, and
resumption with carry pending between two RAM bytes.
Parser and generator tests cover address lists, ranges, RAM size, diagnostics,
and declaration order. Type checks preserve concrete CPU and runner records.

All documented instruction forms are implemented. External interrupt delivery,
memory-mapped devices, and timing remain outside this model; opcode completion
does not imply complete processor emulation or cycle accuracy.
