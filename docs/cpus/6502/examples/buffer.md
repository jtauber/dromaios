# 6502 example: indexed buffer processing

**Status: implemented and tested.**
Read four bytes through a zero-page pointer, transform each in a subroutine,
and write an indexed output buffer. Record the last index whose result is at
least `A4`, then load that result back into A. Both buffers cross a page boundary.

[Model contract](../model.md#memory-operands-logic-and-comparison) ·
[Example definition](../../../../src/machines/6502/buffer-example.machine) ·
[Example tests](../../../../tests/machines/6502/buffer-example.test.ts) ·
[CPU coverage](../../coverage.md#6502)

## Definition and initial state

All addresses and byte values below are hexadecimal. Step counts are decimal.
Initialize zero-filled 64 KiB RAM with this program and data:

| Address | Bytes | Instruction or data |
| --- | --- | --- |
| `0000` | `30` | High byte of the pointer beginning at `00FF` |
| `007F` | `AA EE CC 55` | Sentinels around last qualifying index (`0080`) and count (`0081`) |
| `00FF` | `FE` | Pointer low byte: together with `0000`, source address `30FE` |
| `01FF` | `5A` | Sentinel below the return pointer |
| `0200` | `A2 00` | `LDX #$00` |
| `0202` | `A0 00` | `LDY #$00` |
| `0204` | `B1 FF` | Loop: `LDA ($FF),Y` |
| `0206` | `20 40 02` | `JSR $0240` |
| `0209` | `9D FE 40` | `STA $40FE,X` |
| `020C` | `C9 A4` | `CMP #$A4` |
| `020E` | `90 03` | `BCC $0213` |
| `0210` | `8E 80 00` | `STX $0080` |
| `0213` | `E8` | `INX` |
| `0214` | `C8` | `INY` |
| `0215` | `98` | `TYA` |
| `0216` | `C9 04` | `CMP #$04` |
| `0218` | `D0 EA` | `BNE $0204` |
| `021A` | `8C 81 00` | `STY $0081` |
| `021D` | `AE 80 00` | `LDX $0080` |
| `0220` | `AC 81 00` | `LDY $0081` |
| `0223` | `BD FE 40` | `LDA $40FE,X` |
| `0226` | `4C 50 02` | `JMP $0250` |
| `0240` | `29 0F` | `AND #$0F` |
| `0242` | `49 03` | `EOR #$03` |
| `0244` | `09 A0` | `ORA #$A0` |
| `0246` | `18` | `CLC` |
| `0247` | `69 01` | `ADC #$01` (binary) |
| `0249` | `60` | `RTS` |
| `30FD` | `AA 01 82 03 84 55` | Input bytes with sentinel neighbors |
| `40FD` | `AA CC CC CC CC 55` | Output space with sentinel neighbors |
| `FFFC` | `00 02` | Reset vector: `0200` |

| State | Initial value |
| --- | --- |
| A, X, Y | `11`, `22`, `33` |
| PC, SP | `0200`, `01` |
| N, V, D, I, Z, C | `0`, `1`, `0`, `0`, `1`, `1` |

These are explicit example choices; D is clear for binary ADC.
`create6502BufferExample()` supplies fresh `{ cpu, ram, endAddress }`, with
`endAddress = 0250`. `create6502BufferExampleMemory()` supplies just the
complete RAM image. Neither factory executes an instruction or resets the CPU.

## Expected execution

The loop transforms a byte by clearing its upper nibble, toggling its low two
bits, setting the upper nibble to A, and adding one. The independent values are:

| X/Y at loop entry | Source | Input | After AND | After EOR | After ORA | After ADC | Destination | CMP A4: N/Z/C | BCC |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `00` | `30FE` | `01` | `01` | `02` | `A2` | `A3` | `40FE` | `1/0/0` | Taken |
| `01` | `30FF` | `82` | `02` | `01` | `A1` | `A2` | `40FF` | `1/0/0` | Taken |
| `02` | `3100` | `03` | `03` | `00` | `A0` | `A1` | `4100` | `1/0/0` | Taken |
| `03` | `3101` | `84` | `04` | `07` | `A7` | `A8` | `4101` | `0/0/1` | Untaken |

Each iteration follows `0204 → 0206 → 0240 → 0242 → 0244 → 0246 → 0247 →
0249 → 0209 → 020C → 020E`, then `0213` directly or via `0210`, followed by
`0214 → 0215 → 0216 → 0218`. The first three BNEs return to `0204`; the last
falls through to `021A`. The input and output base addresses stay fixed while
X/Y advance together. Only the last iteration writes index `03` to `0080`.

Logic and loads replace N/Z from their result. CMP preserves A and replaces
N/Z/C from the comparison. Thus the loop-ending comparisons with `04` produce
N/Z/C = `1/0/0`, `1/0/0`, `1/0/0`, then `0/1/1`. V becomes clear on the first
ADC and remains clear. D/I remain clear throughout. Stores, calls, returns,
and branches preserve flags. The final loads leave N = 1 and Z = 0; C stays 1.

Each call pushes `02` at `0101` and `08` at `0100`, moving SP from `01` to
`FF`. RTS reads `08` then `02`, resumes at `0209`, and restores SP to `01`.
The stack bytes remain in RAM, including across repeated identical pushes.

There are **72 executed instructions**: two initial loads, three iterations
of 16 steps, one of 17 steps, and five final steps. Final state is
A = `A8`, X = `03`, Y = `04`, PC = `0250`, SP = `01`, with
N/V/D/I/Z/C = `1/0/0/0/0/1`.
RAM changes only at `0080:03`, `0081:04`, `0100:08`, `0101:02`, and
`40FE:A3`, `40FF:A2`, `4100:A1`, `4101:A8`.

The caller stops before fetching `0250`. A direct CPU step there attempts
unsupported BRK (`00`); the CPU has no synthetic completion or halt latch.

## Access records and acceptance checks

The [tests](../../../../tests/machines/6502/buffer-example.test.ts) specify
all 72 complete records independently. Each before-state is the initial state
or preceding after-state. Instruction bytes are the actual fetched bytes.

- Ordinary instructions read their opcode and operands in order. Each indirect
  LDA then reads `00FF:FE`, `0000:30`, and its source byte. The output STA
  writes its target once, without a destination read.
- JSR has the meaningful interleaving `R 0206:20`, `R 0207:40`, `W 0101:02`,
  `W 0100:08`, `R 0208:02`. RTS records its opcode read followed by the two
  stack reads. No dummy reads, prefetches, or cycle counts are included.
- Check actual RAM calls against these records, both branch paths, the complete
  initial/final RAM images, and fresh independent factories.
- Pause inside the subroutine or loop, reconstruct from a snapshot and the
  existing RAM, and require the same remaining records and result.
- Reset after the first JSR: PC becomes `0200`, SP changes from `FF` to `FC`,
  and I becomes set. Preserve every RAM byte and other state; running the
  program again completes using the new SP. A fresh factory restores the
  original state and image. Earlier records survive both paths unchanged.
- Replace the BNE displacement with `FE` while Z is clear and require the
  shared runner to stop at its instruction budget while the branch loops.

Addressing, flag effects, and opcode forms follow the
[Synertek/MOS programming manual](https://syncopate.us/books/Synertek6502ProgrammingManual.html),
sections 2.2.4, 4.2.1, 6.1–6.5, 7, 8, and Appendix B. The
[model contract](../model.md) defines the deliberately omitted bus activity.
