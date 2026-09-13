# 6502 example: load, add, and store

**Status: implemented and tested.**
The example loads 2, adds 3, and stores 5, providing a second architecture
against which to examine the [8080 example](../../8080/examples/arithmetic.md).

The [6502 model contract](../model.md) defines state, records, reset, and the
decimal-mode boundary. Current support is tracked in
[6502 implementation coverage](../../coverage.md#6502).

[Example definition](../../../../src/machines/6502/example.machine) ·
[Example tests](../../../../tests/machines/6502/example.test.ts) ·
[CPU tests](../../../../tests/components/cpus/6502.test.ts)

## Example scope

One NMOS MOS 6502 model is connected to flat 64 KiB RAM. The program uses four
opcode forms: `CLC` (`18`), `LDA #n` (`A9`), `ADC #n` (`69`), and `STA addr`
with absolute addressing (`8D`). Its initial D = false selects binary ADC.
The caller stops at the example's completion address.

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

## Initial state and setup

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

`create6502Example()` returns fresh `{ cpu, ram, endAddress }` values, with
`endAddress` equal to `0208`. Setup supplies the initial PC directly, so the
first instruction record begins at `0200` without an implicit reset record.
Calling the factory again restarts the lesson with independent components.

## Instruction behavior

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

Fetch all address bytes before STA writes, even when it overwrites itself.
The example initializes D = false. A CPU initialized with D true follows the
model's [unsupported decimal-mode policy](../model.md#unsupported-instructions-and-modes).

## Expected execution

Records use the [6502 step format](../model.md#step-records).

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
and no fifth CPU record. The fixture tests use the
[shared CPU runner](../../../runtime/runner.md) for bounded execution and
check the complete records and memory image independently.

Completion describes the lesson boundary, not a CPU latch. A caller must also
stop on an unsupported result and use a bounded instruction budget if it runs
modified programs. Reaching the endpoint alone does not prove that modified
code produced the intended result; acceptance tests check state and RAM too.

Calling the CPU directly at `0208` still attempts an instruction. In the fresh
fixture this is `00` (BRK), which is unsupported: reason `opcode`, one read
`R 0208:00`, and equal before/after snapshots. BRK is a software interrupt
operation, as described in the [manufacturer manual][1]; it is not being
assigned a lesson-stop meaning.

## Reset and restart

Reset follows the [6502 model contract](../model.md#cpu-reset).

After the completed lesson, reset produces PC `0200` and SP `FC`, while A and
RAM at `0080` remain `05`. The access list is exactly `R FFFC:00`, `R FFFD:02`.
A second reset changes SP to `F9`. Editing the vector before reset changes
the destination PC; the CPU must not cache or hard-code the lesson start.

Restarting via `create6502Example()` restores the initial registers and flags,
SP `FF`, the original program and vector, and the zero result byte. It does not
apply an additional reset or decrement SP. Old components and records remain
independent and available to their caller.

## Acceptance checks

The tests cover:

1. The full initial memory image, including reset vector, and independent setup
   calls. Constructor and snapshot validation/ownership follow the
   [model contract](../model.md).
2. All four exact records and the full final RAM image; caller completion with
   no extra access; a direct fifth CPU call reporting unsupported BRK.
3. CLC changes only C and PC; LDA tests `00`, `80`, and `FF`, replacing N/Z and
   preserving other flags. Use nonzero registers and mixed flags throughout.
4. Binary ADC exhaustively checks all 65,536 accumulator/operand pairs with
   both incoming carry values. Derive expected carry from unsigned arithmetic
   and overflow from signed arithmetic independently of the implementation;
   check replacement of old N/V/Z and preservation of I/D.
5. Decimal ADC stops after its opcode without changing state or RAM. The other
   three forms still execute with D true. Opcodes outside the
   [coverage inventory](../../coverage.md#6502) follow the model's rejection policy.
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

## References

- [Synertek/MOS MCS6500 Programming Manual][1], sections 2.1–2.2, 3, 5.4–5.5,
  9.2–9.3, 9.11, and Appendix B: instruction semantics, encodings, and flags.
  This is a reproduction of the manufacturer manual.
- The [model contract](../model.md#references) cites the reset references and
  distinguishes hardware behavior from model policies.

The initialization values and caller completion rule are choices for this example.

[1]: https://syncopate.us/books/Synertek6502ProgrammingManual.html
