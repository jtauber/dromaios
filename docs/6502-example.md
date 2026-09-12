# Second example: the same calculation on a 6502

**Status: CPU state, snapshots, LDA immediate, and the example fixture implemented
and tested.** The complete example will load 2, add 3, and
store 5, providing a second architecture against which to examine the
[8080 example](first-example.md). The interfaces below are specific to the
6502 and remain provisional through the 6809 example.

## Implementation progress

The [CPU](../src/components/cpus/6502.ts) provides explicit validated state,
detached snapshots, and instruction records. `LDA #n` updates A, N, Z, and PC
and preserves all other state, including D. The
[example factory](../src/machines/6502-example.ts) loads the full program and
reset vector, supplies the initial state, and returns the completion address.

CLC, reset, ADC, and STA remain to be implemented in that order. Every opcode
except `A9` currently returns `unsupported` with reason `opcode`, including
ADC with either D value. The `decimal-mode` reason in the record type will be
used when binary ADC is added. The lesson currently stops at its opening CLC;
LDA tests start directly at `0201`. The complete execution and reset behavior
below remain the specification for later changes.

[CPU tests](../tests/components/cpus/6502.test.ts) cover flags, actual accesses,
PC wrapping, all unsupported opcodes, input validation, and ownership.
[Fixture tests](../tests/machines/6502-example.test.ts) check the entire memory
image, initial state, LDA at `0201`, and independent restarts.
[Type checks](../tests/types/6502.ts) cover readonly records and snapshots,
non-null instructions, and the outcome/reason relationship.

## Model boundary

- An original **NMOS MOS 6502**, connected to the existing flat 64 KiB `Ram`.
  This is not a 65C02 or the NES's Ricoh 2A03 variant.
- Four opcode forms: `CLC` (`18`), `LDA #n` (`A9`), `ADC #n` (`69`), and
  `STA addr` using absolute addressing (`8D`). ADC initially supports binary
  arithmetic only; the decimal-mode policy is specified below.
- Instruction-level execution and access records. Timing, dummy bus reads,
  interrupt inputs, stack instructions, other addressing modes, undocumented
  opcodes, devices, and browser controls are outside this example.
- One `step()` attempts one instruction. The CPU has no lesson-completion
  address or synthetic halted latch. The caller decides when to stop stepping.

## Program and memory image

Addresses and bytes in this document are hexadecimal. Assembly uses `#` for
immediate values and `$` for hexadecimal addresses.

| Address | Bytes | Instruction | Effect |
| --- | --- | --- | --- |
| `0200` | `18` | `CLC` | Clear incoming carry |
| `0201` | `A9 02` | `LDA #2` | Load 2 into A and update N and Z |
| `0203` | `69 03` | `ADC #3` | Add 3 and carry to A; update N, V, Z, C |
| `0205` | `8D 80 00` | `STA $0080` (absolute) | Store A at address 0080 |
| `0208` | — | Lesson completion address | Caller stops before another fetch |

The complete eight-byte program is:

```text
18 A9 02 69 03 8D 80 00
```

Create zero-filled RAM, load these bytes at `0200`, and write reset-vector bytes
`00` at `FFFC` and `02` at `FFFD`. These are the only initialized regions; RAM
at `0080` and `0208` starts at `00`. Program storage is above zero page and
the stack page. Absolute STA is intentional even though the destination fits
in zero page; the byte fixture determines the addressing form without relying
on an assembler's optimization choices.

## State, initialization, and ownership

| State | Lesson initial value |
| --- | --- |
| A, X, Y | `00` each |
| SP | `FF` (an 8-bit offset within page `01`) |
| PC | `0200` |
| C | True, making the first CLC change visible |
| I | True |
| N, V, D, Z | False |

These are explicit lesson choices, not power-on or reset defaults. In
particular, the lesson sets D to false and initializes SP itself. Flags are
stored state: supplying A = `00` does not implicitly set Z.

Use state fields `a`, `x`, `y`, `sp`, `pc`, and `flags`; flags contain booleans
`n`, `v`, `d`, `i`, `z`, and `c`. I is the interrupt-disable flag, with the
opposite sense to the 8080's interrupt-enable latch. This subset exposes the
six flags it models; packed status bytes and their B/unused-bit conventions
will be specified with stack and interrupt instructions.

`new Cpu6502(ram, initialState)` requires exactly 64 KiB of RAM and copies only
the declared state fields, including flags, into CPU-owned storage. It performs
no reset, vector reads, or instruction fetches. A, X, Y, and SP must be integers
in `00`–`FF`; PC must be an integer in `0000`–`FFFF`. Invalid numeric values or
RAM size throw `RangeError`; non-boolean flags throw `TypeError`. Extra input
properties are ignored, and declared fields may be supplied through getters.

`snapshot()` returns a detached `Cpu6502Snapshot` with recursively readonly
TypeScript fields. Records have the same ownership guarantees: later CPU or
RAM changes cannot alter them, and edits made by JavaScript to returned values
cannot change live state. Readonly typing does not require runtime freezing.
Snapshots copy CPU state, not RAM, and inspection performs no RAM accesses.

`create6502Example()` will return fresh `{ cpu, ram, endAddress }` values, with
`endAddress` equal to `0208`. Setup supplies the initial PC directly, so the
first instruction record begins at `0200` without an implicit reset record.
Calling the factory again restarts the lesson with independent components.

## Instruction behavior and decimal-mode boundary

| Instruction | State changes | Preserved state |
| --- | --- | --- |
| CLC | C becomes false; PC advances by 1 | All registers except PC; N, V, D, I, Z |
| LDA immediate | A receives the operand; N reflects bit 7; Z reflects a zero byte; PC advances by 2 | X, Y, SP; V, D, I, C |
| ADC immediate, D false | A receives the low byte of A + operand + incoming C; N, V, Z, C are replaced; PC advances by 2 | X, Y, SP; D, I |
| STA absolute | Write A to the low/high operand address; PC advances by 3 | A, X, Y, SP and all flags |

For binary ADC, N reflects result bit 7, Z indicates a zero byte, C indicates
an unsigned sum above `FF`, and V indicates signed overflow: the signed sum
of the two input bytes and incoming carry lies outside -128 through 127.
There is no parity or auxiliary-carry flag. PC and operand fetching wrap at
16 bits; host calls to RAM still validate addresses instead of wrapping them.
The [manufacturer manual][1] defines these operations and encodings.

**Decimal arithmetic is deferred, and must never silently use binary ADC.**
The constructor accepts either D value. CLC, LDA, and STA work with either
value and preserve D. If opcode `69` is encountered with D true, `step()`
returns `unsupported` with reason `decimal-mode`: one opcode read, no operand
read, and unchanged CPU state and RAM. Check this limitation before advancing
PC or reading the operand. SED and CLD are outside the initial opcode subset.
This is a limitation of this implementation, not an illegal hardware operation.

The lesson's D = false initialization keeps its arithmetic within the supported
subset. Reset preserves D, so resetting a separately initialized D = true CPU
does not remove this limitation. Supporting NMOS decimal ADC, including its
flag behavior, will require a separate reviewed change.

## Step records and expected execution

Use a CPU-specific `Cpu6502StepRecord` with these fields:

| Field | Meaning |
| --- | --- |
| `instruction` | Non-null `{ address, bytes }` from the attempted instruction |
| `before`, `after` | Complete detached CPU snapshots |
| `accesses` | Ordered `{ kind, address, value }` entries, with kind `read` or `write` |
| `outcome` | `executed` or `unsupported` |
| `reason` | Present only with `unsupported`: `opcode` or `decimal-mode` |

Make the outcome/reason relationship a discriminated union. All public record
fields, nested snapshots, byte arrays, and access entries are readonly. There
is no `halted` or `complete` CPU outcome in this subset, and no null instruction.
Unsupported opcodes use reason `opcode`, read only the opcode, and leave CPU
state and RAM unchanged. Repeating the call repeats that read; it does not
advance past the limitation. During incremental implementation, each opcode
remains unsupported until its implementation is added.

Instruction bytes come from the actual opcode and operand reads. Data writes
do not become instruction bytes. Record the actual accesses during execution,
without rereading an instruction or the old contents of a write destination.
Fetch all address bytes before STA writes, even when it overwrites itself.
These records omit dummy bus accesses and carry no cycle-count claim.

Each record's `before` equals the preceding record's `after`, starting with
the initial state above. All four outcomes are `executed`:

| Step | Instruction address | Instruction bytes | PC after | A after | C after | N, V, Z after |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `0200` | `18` | `0201` | `00` | False | All false |
| 2 | `0201` | `A9 02` | `0203` | `02` | False | All false |
| 3 | `0203` | `69 03` | `0205` | `05` | False | All false |
| 4 | `0205` | `8D 80 00` | `0208` | `05` | False | All false |

X and Y remain `00`, SP remains `FF`, I remains true, and D remains false.
Using `R` and `W` for read and write, the complete access lists are:

| Step | Accesses, in order |
| --- | --- |
| 1 | `R 0200:18` |
| 2 | `R 0201:A9`, `R 0202:02` |
| 3 | `R 0203:69`, `R 0204:03` |
| 4 | `R 0205:8D`, `R 0206:80`, `R 0207:00`, `W 0080:05` |

The store is the only memory write during execution. The complete final RAM
image equals the initial image with `0080` changed to `05`.

## Lesson completion

The caller checks `cpu.snapshot().pc === endAddress` before calling `step()`.
For this fixed program it stops after four records, with no fetch at `0208`
and no fifth CPU record. The initial tests can perform this check directly;
this specification does not introduce a generic runner or new runner API.

Completion describes the lesson boundary, not a CPU latch. A caller must also
stop on an unsupported result and use a bounded instruction budget if it runs
modified programs. Reaching the endpoint alone does not prove that modified
code produced the intended result; acceptance tests check state and RAM too.

Calling the CPU directly at `0208` still attempts an instruction. In the fresh
fixture this is `00` (BRK), which is unsupported: reason `opcode`, one read
`R 0208:00`, and equal before/after snapshots. BRK is a software interrupt
operation, as described in the [manufacturer manual][1]; it is not being
assigned a lesson-stop meaning.

## CPU reset and lesson restart

`reset()` will return a separate `Cpu6502ResetRecord` containing `before`,
`after`, and `accesses`, with the same detached, readonly ownership guarantees
as step records. It has no instruction, outcome, or reason fields. The CPU
does not retain either kind of record.

The model's reset operation:

1. Reads `FFFC` and then `FFFD`, combining low and high bytes into the new PC.
2. Sets I to true and changes SP to `(oldSp - 3) & 0xff`.
3. Preserves A, X, Y, N, V, D, Z, C, and all RAM.

This captures the NMOS reset state effects, including the stack-pointer
decrement; it does not set SP to a fixed reset constant. See the
[manufacturer manual][1] and [Visual6502 reset analysis][2]. At this
instruction-level boundary, only the two vector reads are performed and
recorded. The model omits the dummy instruction and stack reads shown in
that analysis and does not prefetch an instruction at the reset target.

After the completed lesson, reset produces PC `0200` and SP `FC`, while A and
RAM at `0080` remain `05`. The access list is exactly `R FFFC:00`, `R FFFD:02`.
A second reset changes SP to `F9`. Editing the vector before reset changes
the destination PC; the CPU must not cache or hard-code the lesson start.

Restarting via `create6502Example()` restores the initial registers and flags,
SP `FF`, the original program and vector, and the zero result byte. It does not
apply an additional reset or decrement SP. Old components and records remain
independent and available to their caller.

## Acceptance checks and implementation order

The eventual checks should cover:

1. The full initial memory image, including reset vector, and independent setup
   calls. Constructor and snapshot validation/ownership follow the API above.
2. All four exact records and the full final RAM image; caller completion with
   no extra access; a direct fifth CPU call reporting unsupported BRK.
3. CLC changes only C and PC; LDA tests `00`, `80`, and `FF`, replacing N/Z and
   preserving other flags. Use nonzero registers and mixed flags throughout.
4. Binary ADC exhaustively checks all 65,536 accumulator/operand pairs with
   both incoming carry values. Derive expected carry from unsigned arithmetic
   and overflow from signed arithmetic independently of the implementation;
   check replacement of old N/V/Z and preservation of I/D.
5. Decimal ADC stops after its opcode without changing state or RAM. The other
   three forms still execute with D true. All other opcodes remain unsupported.
6. STA uses low/high addressing, performs three reads then one write, preserves
   flags, and handles identical-value writes and overwriting its own bytes.
7. PC/operand wrapping at `FFFF` for each instruction length; addresses `0000`,
   `1234`, and `FFFF` for stores; SP wrapping on reset.
8. Reset reads only the current vector in order, preserves RAM and unrelated
   state including D, changes SP on each call, and permits execution at the
   new PC. Restart restores the entire lesson. Records remain independent of
   later execution, reset, restart, host RAM edits, and edits to returned values.

Explicit binary ADC cases, with D false:

| A | Operand | Incoming C | Result | N | V | Z | Outgoing C |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `02` | `03` | 0 | `05` | 0 | 0 | 0 | 0 |
| `02` | `03` | 1 | `06` | 0 | 0 | 0 | 0 |
| `FF` | `01` | 0 | `00` | 0 | 0 | 1 | 1 |
| `7F` | `01` | 0 | `80` | 1 | 1 | 0 | 0 |
| `80` | `80` | 0 | `00` | 0 | 1 | 1 | 1 |
| `7F` | `00` | 1 | `80` | 1 | 1 | 0 | 0 |

Implement in small reviewed changes: fixture and CPU state with snapshots,
LDA immediate, and step records; CLC; reset and its record; binary ADC and the
decimal-mode rejection; then STA and the complete example. The first LDA
tests can start a CPU directly at the LDA address; the lesson cannot execute
its first instruction until CLC is added.

Reuse RAM and the pattern of small opcode handlers composing operand access
with CPU-specific operations. Operations that consume data accept values;
handlers obtain them through recorded operand or data reads. Store handlers
resolve a destination and write without first reading its contents.

Keep 6502 flags, addressing, reset, and records specific to this CPU. The
comparison with the 8080 already exposes distinct load flags, carry input,
status layout, stack width, reset reads, and completion behavior. Shared
interfaces will be assessed with the 6809 example as well.

Future explanations of completed steps should use the captured instruction
bytes, snapshots, and accesses. The [6502 reference notes](6502-reference-notes.md)
record the applepy and dromaios-apple2 comparison, including the distinction
between these explanations and side-effect-free previews, and when to revisit
opcode metadata, lesson annotations, additional addressing, and timing.

Changes wait for maintainer review and explicit permission to commit, as
recorded in [AGENTS.md](../AGENTS.md).

## References

[1]: https://syncopate.us/books/Synertek6502ProgrammingManual.html
[2]: https://www.pagetable.com/?p=410

- [Synertek/MOS MCS6500 Programming Manual][1], sections 2.1–2.2, 3, 5.4–5.5,
  9.2–9.3, 9.11, and Appendix B: instruction semantics, encodings, flags, and
  reset. This is a reproduction of the manufacturer manual; its startup
  discussion is supplemented by the transistor-level analysis below.
- [Michael Steil's Visual6502 analysis of BRK/IRQ/NMI/RESET][2]: reset vector
  order, discarded stack reads, and the three stack-pointer decrements.

The initialization values, completion rule, unsupported-mode policy, API,
record shapes, and omitted bus accesses are deliberate choices for this model.
