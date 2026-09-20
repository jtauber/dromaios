# 6800 decimal addition and stack inspection example

This program adds decimal 58 and 67 as packed-BCD bytes, producing `25H`
with decimal carry set. It reaches the arithmetic routine through an indexed
JSR, records the saved return-address location with TSX/STX, and captures
the decimal flags with TPA. The caller verifies the pointer with CPX before
jumping to its completion address.

[Model contract](../../../../src/components/cpus/specifications/6800.md#decimal-adjustment) ·
[Coverage](../../coverage.md#6800) ·
[Machine definition](../../../../src/machines/6800/decimal-example.machine) ·
[Example tests](../../../../tests/machines/6800/decimal-example.test.ts) ·
[CPU tests](../../../../tests/components/cpus/6800.test.ts)

## Initial state and memory

`waiting` starts false and remains false throughout this example.

Numbers below are hexadecimal except step counts, flag values, and explicitly
identified decimal values. The machine has 64 KiB RAM. A/B/X/SP/PC start at
`81/22/3456/789A/0200`, with H/I/N/Z/V/C = `1/0/1/0/1/1`.

The six result bytes at `0080`–`0085` start at zero, with `CC` guards on
either side. The two stack bytes at `03FF`–`0400` also start at zero, between
`CC` guards at `03FE` and `0401`. Code occupies `0200`–`0219` and
`0300`–`030A`; the reset vector at `FFFE`–`FFFF` is `02 00`. All other RAM
starts at zero.

The generated factories `create6800DecimalExampleMemory()` and
`create6800DecimalExample()` return fresh components without executing.
The CPU factory also returns `endAddress = 0240`. That address belongs to
the runner; the CPU has no synthetic halt there.

## Program and expected execution

LDS selects a stack whose first push writes at `0400`. JSR saves `020E`
low byte first at `0400`, then high byte at `03FF`, leaving SP at `03FE`.
TSX exposes `SP + 1 = 03FF`, the location of the high return byte. Ordinary
word stores use high-byte-first order, in contrast to pushing a return address.

| Step | Address | Bytes | Instruction | PC after | Register or RAM change |
| --- | --- | --- | --- | --- | --- |
| 1 | `0200` | `8E 04 00` | LDS #$0400 | `0203` | SP = `0400` |
| 2 | `0203` | `9F 84` | STS <$84 | `0205` | `[0084..0085] = 04 00` |
| 3 | `0205` | `CE 03 00` | LDX #$0300 | `0208` | X = `0300` |
| 4 | `0208` | `86 58` | LDAA #$58 | `020A` | A = `58` |
| 5 | `020A` | `C6 67` | LDAB #$67 | `020C` | B = `67` |
| 6 | `020C` | `AD 00` | JSR 0,X | `0300` | SP = `03FE`; stack contains return `020E` |
| 7 | `0300` | `30` | TSX | `0301` | X = `03FF` |
| 8 | `0301` | `DF 80` | STX <$80 | `0303` | `[0080..0081] = 03 FF` |
| 9 | `0303` | `1B` | ABA | `0304` | A = `BF` |
| 10 | `0304` | `19` | DAA | `0305` | A = `25`, carry set |
| 11 | `0305` | `16` | TAB | `0306` | B = `25` |
| 12 | `0306` | `07` | TPA | `0307` | A = `C1` |
| 13 | `0307` | `97 82` | STAA <$82 | `0309` | `[0082] = C1` |
| 14 | `0309` | `17` | TBA | `030A` | A = `25` |
| 15 | `030A` | `39` | RTS | `020E` | SP = `0400` |
| 16 | `020E` | `D7 83` | STAB <$83 | `0210` | `[0083] = 25` |
| 17 | `0210` | `DE 80` | LDX <$80 | `0212` | X = `03FF` |
| 18 | `0212` | `8C 03 FF` | CPX #$03FF | `0215` | Z set; X and carry preserved |
| 19 | `0215` | `26 FE` | BNE $0215 | `0217` | Not taken |
| 20 | `0217` | `7E 02 40` | JMP $0240 | `0240` | Runner completes before another fetch |

ABA produces binary `BF` from `58 + 67`. H is clear, N/V are set, and C
is clear. DAA adds correction `66`, giving `125`; A retains `25` and carry
becomes one, representing decimal 125. DAA preserves H/I and sets N/Z from
the byte result; V is cleared under the model's documented undefined-flag
policy. TPA then produces `C1`: fixed bits 7–6 plus carry. STAA subsequently
sets N from this packed byte, so flag capture must precede the store.

| After step(s) | H | I | N | Z | V | C |
| --- | --- | --- | --- | --- | --- | --- |
| 1–8 | 1 | 0 | 0 | 0 | 0 | 1 |
| 9 | 0 | 0 | 1 | 0 | 1 | 0 |
| 10–12 | 0 | 0 | 0 | 0 | 0 | 1 |
| 13 | 0 | 0 | 1 | 0 | 0 | 1 |
| 14–17 | 0 | 0 | 0 | 0 | 0 | 1 |
| 18–20 | 0 | 0 | 0 | 1 | 0 | 1 |

There are **37 instruction-byte reads, four data reads, and eight writes**.
Data reads are the two RTS bytes and the two bytes read by LDX. Stores make
no destination reads, and JSR/JMP do not prefetch target data or instructions.

## Final state and acceptance checks

After 20 steps, A/B/X/SP/PC are `25/25/03FF/0400/0240` and H/I/N/Z/V/C are
`0/0/0/1/0/1`. RAM at `0080`–`0085` contains `03 FF C1 25 04 00`: the
saved-return pointer, captured flags, decimal sum, and original SP. The
return bytes `02 0E` remain in RAM at `03FF`–`0400`. Guards, code, and other
RAM are unchanged.

- Both factories provide the complete initial memory image and detached state.
- A 20-step budget completes with every expected record and actual RAM call.
- A ten-step budget pauses after DAA with carry set and a pending return.
  Restoring that snapshot resumes correctly even if the caller edits its copy.
- Reset rereads `0200` from the reset vector and sets I, preserving other
  registers and RAM. Earlier records remain detached; a fresh factory restores
  the initial lesson state.
- Editing the recorded pointer before LDX makes CPX unequal. BNE then loops
  at `0215` until the step budget expires, demonstrating bounded failure.
