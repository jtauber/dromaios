# 8080 rotates and carry example

This example rotates the word in HL left through carry, saves it, then rotates
it right through carry to restore the original word. Each byte moves through
A; MOV preserves carry between the two byte rotations. Circular rotations and
CMA then transform the low byte for a final store.

[Model contract](../model.md#rotates-and-carry) ·
[Coverage](../../coverage.md#8080) ·
[Machine definition](../../../../src/machines/8080/rotates-example.machine) ·
[Example tests](../../../../tests/machines/8080/rotates-example.test.ts) ·
[CPU tests](../../../../tests/components/cpus/8080.test.ts)

## Initial state and memory

Numbers are hexadecimal except step counts and flag values. The machine has
flat, zero-filled 64 KiB RAM, with the code below at `0200`. Output bytes
`0080`–`0084` start at zero.

| State | Value |
| --- | --- |
| A, B, C, D, E, H, L | `11`, `22`, `33`, `44`, `55`, `66`, `77` |
| PC, SP | `0200`, `ABCD` |
| S, Z, AC, P, CY | `1`, `0`, `1`, `0`, `0` |
| Interrupt enabled, halted | true, false |

Initial snapshots derive BC = `2233`, DE = `4455`, HL = `6677`.

## Program and expected execution

Each row is one executed instruction. Each record's `before` is the previous
row's resulting state. S/Z/AC/P remain `1/0/1/0` throughout; state not listed
remains unchanged. The last column lists changes apart from PC and CY.

| Step | Address | Bytes | Instruction | PC after | CY after | Other state changes |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `0200` | `21 80 81` | LXI H,8180H | `0203` | 0 | H = `81`, L = `80`, HL = `8180` |
| 2 | `0203` | `37` | STC | `0204` | 1 | — |
| 3 | `0204` | `3F` | CMC | `0205` | 0 | — |
| 4 | `0205` | `7D` | MOV A,L | `0206` | 0 | A = `80` |
| 5 | `0206` | `17` | RAL | `0207` | 1 | A = `00` |
| 6 | `0207` | `6F` | MOV L,A | `0208` | 1 | L = `00`, HL = `8100` |
| 7 | `0208` | `7C` | MOV A,H | `0209` | 1 | A = `81` |
| 8 | `0209` | `17` | RAL | `020A` | 1 | A = `03` |
| 9 | `020A` | `67` | MOV H,A | `020B` | 1 | H = `03`, HL = `0300` |
| 10 | `020B` | `22 80 00` | SHLD 0080H | `020E` | 1 | — |
| 11 | `020E` | `1F` | RAR | `020F` | 1 | A = `81` |
| 12 | `020F` | `67` | MOV H,A | `0210` | 1 | H = `81`, HL = `8100` |
| 13 | `0210` | `7D` | MOV A,L | `0211` | 1 | A = `00` |
| 14 | `0211` | `1F` | RAR | `0212` | 0 | A = `80` |
| 15 | `0212` | `6F` | MOV L,A | `0213` | 0 | L = `80`, HL = `8180` |
| 16 | `0213` | `22 82 00` | SHLD 0082H | `0216` | 0 | — |
| 17 | `0216` | `07` | RLC | `0217` | 1 | A = `01` |
| 18 | `0217` | `0F` | RRC | `0218` | 1 | A = `80` |
| 19 | `0218` | `2F` | CMA | `0219` | 1 | A = `7F` |
| 20 | `0219` | `32 84 00` | STA 0084H | `021C` | 1 | — |
| 21 | `021C` | `76` | HLT | `021D` | 1 | halted = true |

STC followed by CMC clears carry. The two RAL instructions treat CY:HL as a
17-bit value: `0:8180` becomes `1:0300`. Rotating the high byte right first,
then the low byte, restores `0:8180`. The MOV and SHLD instructions between
rotations preserve carry. RLC followed by RRC restores A but leaves CY set;
these circular rotations ignore incoming CY. CMA complements A without
changing any flags.

These operations preserve S/Z/AC/P even when A becomes zero at step 5 or
changes sign. Consequently the final S is still one although A = `7F`, and
Z remains zero throughout.

Each step fetches exactly its listed bytes, consecutively. The only additional
accesses are these writes, after the instruction fetches:

| Step | Ordered data accesses |
| --- | --- |
| 10 | Write `00` at `0080`, then `03` at `0081` |
| 16 | Write `80` at `0082`, then `81` at `0083` |
| 20 | Write `7F` at `0084` |

The unchanged-value write at `0080` is still performed and recorded. There
are no data reads. Steps 1–20 report `executed`; HLT reports `halted`.
A subsequent step has no instruction and no accesses.

The final state is A = `7F`, BC = `2233`, DE = `4455`, HL = `8180`, SP = `ABCD`,
PC = `021D`, with S/Z/AC/P/CY = `1/0/1/0/1` and interrupt enable still true.
The final output is `00 03 80 81 7F` at `0080`–`0084`. All code and other RAM
remain unchanged.

## Acceptance checks and references

`create8080RotatesExample()` produces fresh CPU and RAM instances. With a
budget of 21 steps, the [runner](../../../runtime/runner.md) returns 21 complete
records and `stopReason: "halted"`. Tests check both full memory images,
every record, and the actual RAM calls. A run paused after step 5 resumes
with A = `00` and CY = 1, producing the same remaining records.

Reset clears halt and interrupt enable and sets PC to `0000`, preserving
registers, flags, and modified RAM. Restarting the example restores its entry
point `0200`, interrupt enable, and original memory in fresh components.
Retained records survive later execution, reset, RAM edits, and restart.

CPU checks cover all 256 accumulator values, all 32 initial flag combinations,
and both interrupt-enable values for all seven instructions. They use
independent bit-string rotations plus literal examples, and verify unrelated
state preservation, PC wrapping, exact opcode reads, and current A/CY across
successive instructions.

The [Intel 8080 Assembly Language Programming Manual][intel], pages 14–15 and
21–22, defines STC/CMC, CMA, and the four rotates. Appendix B specifies their
encodings and bit transfers. The [model contract](../model.md#rotates-and-carry)
records the flag and access rules.

[intel]: https://altairclone.com/downloads/manuals/8080%20Programmers%20Manual.pdf
