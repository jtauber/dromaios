# 6800 example: signed word transformation

Arithmetic-shift a signed 16-bit word right once, then negate it. The initial
word `FF81` (−127) becomes `FFC0` (−64), then `0040` (+64). This demonstrates
word operations composed from byte shifts, rotates, complements, and increments.

[Model contract](../model.md#unary-operations) ·
[Example definition](../../../../src/machines/6800/word-transform-example.machine) ·
[Example tests](../../../../tests/machines/6800/word-transform-example.test.ts) ·
[CPU coverage](../../coverage.md#6800)

## Definition and initial state

Addresses, bytes, and register values below are hexadecimal; instruction counts
are decimal. Start with zero-filled 64 KiB RAM and these regions:

| Address | Bytes | Instruction or data |
| --- | --- | --- |
| `0000` | `FF 81 DE AD` | Signed word −127 followed by two guard bytes |
| `0200` | `67 80` | `ASR $80,X`: shift the high byte, retaining its sign |
| `0202` | `76 00 01` | `ROR >$0001`: shift the low byte through carry |
| `0205` | `63 80` | `COM $80,X`: complement the high byte |
| `0207` | `73 00 01` | `COM >$0001`: complement the low byte |
| `020A` | `7C 00 01` | `INC >$0001`: add one to the complemented low byte |
| `020D` | `26 02` | `BNE $0211`: skip high-byte increment unless the low byte wrapped |
| `020F` | `6C 80` | `INC $80,X`: propagate the low-byte wrap |
| `0211` | `A6 80` | `LDAA $80,X`: load the resulting high byte into A |
| `0213` | `F6 00 01` | `LDAB >$0001`: load the resulting low byte into B |
| `0216` | `7D 00 00` | `TST >$0000`: test whether the high byte is zero |
| `FFFE` | `02 00` | Reset vector |

Initial registers: A=`81`, B=`22`, X=`FF80`, SP=`789A`, PC=`0200`.
H/N/V/C are 1; I/Z are 0. Indexed displacement `80` is unsigned +128, so
`FF80 + 0080` wraps to address `0000`. X never changes. The word resides in RAM;
the 6800 does not expose the 6809's combined D register.

## Expected execution

The default program executes nine instructions, skipping `INC $80,X`:

| Step | Instruction | RAM word after step | N | Z | V | C |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | ASR high | `FF81` | 1 | 0 | 0 | 1 |
| 2 | ROR low | `FFC0` | 1 | 0 | 0 | 1 |
| 3 | COM high | `00C0` | 0 | 1 | 0 | 1 |
| 4 | COM low | `003F` | 0 | 0 | 0 | 1 |
| 5 | INC low | `0040` | 0 | 0 | 0 | 1 |
| 6 | BNE | `0040` | 0 | 0 | 0 | 1 |
| 7 | LDAA high | `0040` | 0 | 1 | 0 | 1 |
| 8 | LDAB low | `0040` | 0 | 0 | 0 | 1 |
| 9 | TST high | `0040` | 0 | 1 | 0 | 0 |

H/I retain their initial values. INC preserves C, so the branch detects the
low-byte wrap using Z. Final A=`00`, B=`40`, X=`FF80`, SP=`789A`, PC=`0219`.
Only RAM `0000–0001` changes; the guard bytes, program, and reset vector remain
intact. The caller stops before fetching at `0219`.

Memory transforms fetch their complete instruction, read one byte, and write
one byte. ASR writes `FF` even though it was already `FF`. TST only reads its
operand. Data accesses do not become instruction bytes, and the branch never
prefetches its target.

## Acceptance and alternate paths

Tests compare all nine complete records against actual RAM calls and compare
the entire initial/final RAM image. Snapshot resumption between ASR and ROR
must preserve the carry that links the two bytes. Independent factory instances
restore all initial state and memory.

Changing the input to `FE00` (−512) gives `FF00` after halving. Complementing
and incrementing the low byte wraps `FF` to `00`, so BNE falls through and INC
updates the high byte. This path takes ten instructions and finishes with RAM
`0100`, A=`01`, B=`00`, and Z=0 after TST high. Changing the BNE displacement
to `FE` instead traps the default path at `020D`; the runner must return its
step-limit outcome at the requested budget.

Reset preserves the transformed word, registers, and all flags except I,
which becomes 1. Its two vector reads return PC to `0200`; it does not recreate
the original input. A fresh example factory performs that restart.
