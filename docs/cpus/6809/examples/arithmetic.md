# 6809 example: load, add, and store

**Status: implemented and tested.**
The example loads 2, adds 3, and stores 5, providing a third architecture
alongside the [8080](../../8080/examples/arithmetic.md) and
[6502](../../6502/examples/arithmetic.md) examples.

The [6809 model contract](../model.md) defines state, records, reset, and
unsupported-prefix behavior. Current support is tracked in
[6809 implementation coverage](../../coverage.md#6809).

[Example definition](../../../../src/machines/6809/example.machine) ·
[Example tests](../../../../tests/machines/6809/example.test.ts) ·
[CPU tests](../../../../tests/components/cpus/6809.test.ts)

## Example scope

One Motorola MC6809 model is connected to flat 64 KiB RAM. The program uses
three forms: `LDA #n` (`86`), `ADDA #n` (`8B`), and `STA addr` with extended
addressing (`B7`). Encodings and lengths follow the
[Motorola instruction summary][summary]. The caller stops at the example's
completion address; neither stack is exercised by this program.

## Program and memory image

Addresses and bytes below are hexadecimal. In assembly, `#` introduces an
immediate value and `$` introduces a hexadecimal number. The `>` in the store
explicitly selects extended addressing; the literal bytes determine the form.

| Address | Bytes | Instruction | Effect |
| --- | --- | --- | --- |
| `0200` | `86 02` | `LDA #2` | Load A and update load flags |
| `0202` | `8B 03` | `ADDA #3` | Add 3 to A, ignoring incoming carry |
| `0204` | `B7 00 80` | `STA >$0080` | Store A using the full address |
| `0207` | — | Lesson completion address | Caller stops before fetching |

The seven-byte program is:

```text
86 02 8B 03 B7 00 80
```

Start with zero-filled RAM, load those bytes at `0200`, and write reset-vector
bytes `02` at `FFFE` and `00` at `FFFF`. All other bytes initially remain zero,
including `0080`, `0207`, and `1280`.

The address bytes in extended instructions are high byte then low byte.
Extended addressing bypasses DP; this lesson deliberately initializes DP to
`12`, yet stores at `0080`. Direct STA (`97`) is exercised separately in the
[addressing example](addressing.md). Motorola's
[addressing descriptions and vector table][model] establish these distinctions.

## Initial state and setup

| State | Width | Lesson initial value |
| --- | --- | --- |
| A | 8 bits | `00` |
| B | 8 bits | `34` |
| DP | 8 bits | `12` |
| X, Y | 16 bits each | `0000` each |
| S | 16 bits | `8000` |
| U | 16 bits | `4000` |
| PC | 16 bits | `0200` |
| F, I | Boolean each | True |
| H, V, C | Boolean each | True |
| E, N, Z | Boolean each | False |
| D, derived from A and B | 16 bits | `0034` |

These are deliberate lesson values, not power-on or reset defaults. B makes
the D view visible; DP demonstrates the scope of extended addressing. Distinct
S and U values make preservation checks meaningful. Incoming C remains true
through LDA so ADDA visibly ignores it; H and V start true to expose their
replacement. Flags are supplied state, not inferred from the initial A value.

The snapshot's D value follows the [model's A:B view](../model.md#register-views).

`create6809Example()` returns fresh `{ cpu, ram, endAddress }` values, with
`endAddress` equal to `0207`. Setup supplies the initial PC directly and does
not call reset. Calling the factory again restarts the lesson from its original
state and complete memory image.

## Instruction behavior

The flag behavior follows Motorola's [instruction details][instructions].
All three forms preserve B, X, Y, S, U, DP, E, F, and I. D changes only as a
consequence of A changing.

| Instruction | State changes | Additional preserved state |
| --- | --- | --- |
| LDA immediate | A receives the byte; N/Z reflect A; V becomes false; PC advances by 2 | H, C |
| ADDA immediate | A receives the low byte of A + operand; replace H/N/Z/V/C; PC advances by 2 | — |
| STA extended | Write A once; N/Z reflect A; V becomes false; PC advances by 3 | A, H, C |

For these 8-bit operations, N reflects bit 7 and Z tests the byte for zero.
In particular, A = `00`, B = `34` gives Z true after LDA or STA even though
the derived D is nonzero. A store's flags depend on A, not on the destination's
old contents. It must not read that old value or skip an unchanged-value write.

For ADDA, H indicates a carry out of bit 3, C indicates an unsigned sum above
`FF`, and V indicates that the signed sum is outside -128 through 127.
There is no carry input and no 6502-style decimal-mode flag. Decimal adjustment
uses a separate DAA instruction, which remains unsupported here.

The CPU wraps PC and operand fetches to 16 bits. RAM itself continues to
validate host addresses. Fetch both extended-address bytes before writing,
including when STA overwrites its opcode or either operand.

Useful arithmetic cases, each with old C both false and true:

| A | Operand | Result | H | N | Z | V | C |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `02` | `03` | `05` | 0 | 0 | 0 | 0 | 0 |
| `0F` | `01` | `10` | 1 | 0 | 0 | 0 | 0 |
| `FF` | `01` | `00` | 1 | 0 | 1 | 0 | 1 |
| `7F` | `01` | `80` | 1 | 1 | 0 | 1 | 0 |
| `80` | `80` | `00` | 0 | 0 | 1 | 1 | 1 |
| `FF` | `00` | `FF` | 0 | 1 | 0 | 0 | 0 |

## Expected lesson execution and completion

Records use the [6809 step format](../model.md#step-records).

Each record's `before` equals the preceding `after`, starting with the initial
state above. All three outcomes are `executed`:

| Step | Address | Bytes | PC after | A after | D after | H | V | C |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `0200` | `86 02` | `0202` | `02` | `0234` | True | False | True |
| 2 | `0202` | `8B 03` | `0204` | `05` | `0534` | False | False | False |
| 3 | `0204` | `B7 00 80` | `0207` | `05` | `0534` | False | False | False |

Throughout these records, B = `34`, DP = `12`, X/Y = `0000`, S = `8000`,
U = `4000`, F/I = true, and E/N/Z = false. The table plus these preserved
values defines every field in every after snapshot.

| Step | Actual accesses, in order |
| --- | --- |
| 1 | `R 0200:86`, `R 0201:02` |
| 2 | `R 0202:8B`, `R 0203:03` |
| 3 | `R 0204:B7`, `R 0205:00`, `R 0206:80`, `W 0080:05` |

The final RAM image differs from the initial image only at `0080`, now `05`.
In particular, `1280` remains zero despite DP = `12`.

The caller checks `cpu.snapshot().pc === endAddress` before stepping, stops on
unsupported results, and uses a bounded instruction budget. The unchanged
lesson finishes after three records without reading `0207`. Tests can exercise
this directly; no generic runner is introduced.

A direct fourth CPU step at `0207` reads `00` and reports `unsupported`, reason
`opcode`, with equal before/after snapshots. On hardware, `00` is direct NEG,
not a stop instruction ([opcode map][opcodes]). This subset does not fetch its
operand or access the direct page. Completion belongs solely to the caller.

## Reset and restart

Reset follows the [6809 model contract](../model.md#cpu-reset).

After the lesson, reset yields PC `0200`, DP `00`, and the exact accesses
`R FFFE:02`, `R FFFF:00`. A stays `05`, B stays `34`, D stays `0534`, S/U stay
`8000`/`4000`, and the result byte stays `05`. A repeated reset has the same
state effects; editing the vector changes the destination.

Restarting through `create6809Example()` restores the full initial state,
including DP `12`, H/V/C true, A `00`, and D `0034`, plus the original program,
vector, and zero result byte. It does not apply an additional CPU reset.

## Acceptance checks

The tests cover:

1. Fresh independent factory calls and the entire initial memory image.
   Constructor validation and D ownership follow the [model contract](../model.md).
2. LDA values `00`, `7F`, `80`, and `FF`, replacing N/Z and clearing old V while
   preserving H/C and unrelated state. Include A = zero with nonzero B.
3. ADDA for all 65,536 accumulator/operand pairs, with both old carry values
   and old H/N/Z/V both clear and set. Compute expected half-carry from low-nibble
   arithmetic and overflow from signed arithmetic, independently of the
   implementation. Check unchanged B/DP/pointers/E/F/I and correct derived D.
4. STA to `0000`, `1234`, and `FFFF`, including unchanged-value writes and each
   possible overlap with its three instruction bytes. Require three reads then
   one write, no destination read, and independent retained bytes/write values.
   Use mixed flags, nonzero DP, and A values `00`, `80`, and `FF` to verify N/Z/V
   replacement and preservation of H/C/E/F/I and every stored register except PC.
5. All operand/PC wrapping positions at `FFFF` for the two instruction lengths.
6. All three exact lesson records, the complete final RAM image, observed RAM
   calls proving no endpoint prefetch, and a direct fourth CPU step remaining
   an unsupported attempt rather than a lesson-completion result.
7. Reset produces the exact state and accesses above, preserving the result
   byte; restart restores the full original state and image. General reset and
   record-ownership checks are specified in the
   [model contract](../model.md#contract-checks).

## References

- [Motorola MC6809–MC6809E programming manual, sections 1–3][model]: register
  relationships, addressing, and vector byte order.
- [Motorola instruction details, Appendix A][instructions]: LD (8-bit), ADD
  (8-bit), and ST (8-bit).
- [Motorola instruction summary, Appendix D][summary]: opcode forms, lengths,
  and affected flags; [Appendix F opcode map][opcodes]: opcode `00`.

These links are HTML transcriptions of the manufacturer manual. The
[model contract](../model.md#references) cites reset and prefix references;
the [CoCo reference notes](../reference-notes.md) record implementation ideas
from the earlier emulator. Initial values and completion are example choices.

[model]: https://www.maddes.net/m6809pm/sections.htm
[instructions]: https://www.maddes.net/m6809pm/appendix_a.htm
[summary]: https://www.maddes.net/m6809pm/appendix_d.htm
[opcodes]: https://www.maddes.net/m6809pm/appendix_f.htm
