# 6809 example: indexed word copy

Copy three nonzero words and their zero sentinel from a source buffer to a
destination buffer. X and U advance by two with each transfer. Save both final
pointers using the direct page after the sentinel ends the loop.

[Model contract](../model.md#indexed-addressing-and-word-transfers) ·
[Example definition](../../../../src/machines/6809/indexed-copy-example.machine) ·
[Example tests](../../../../tests/machines/6809/indexed-copy-example.test.ts) ·
[CPU coverage](../../coverage.md#6809)

## Definition and initial state

Initial control state is `waitMode = none` and `nmiArmed = false`. Neither
changes during this program.

Addresses, register values, and bytes below are hexadecimal; step counts are
decimal. Start with zero-filled 64 KiB RAM and these regions:

| Address | Bytes | Meaning |
| --- | --- | --- |
| `0200` | `BE 20 10` | `LDX >$2010`: load the source pointer from RAM |
| `0203` | `CE 40 00` | `LDU #$4000`: destination pointer |
| `0206` | `EC 81` | `LDD ,X++`: load a word, then use the advanced X on the next iteration |
| `0208` | `ED C1` | `STD ,U++`: store a word, advancing U by two |
| `020A` | `26 FA` | `BNE $0206`: repeat while the stored word is nonzero |
| `020C` | `9F 10` | `STX <$10`: save X at `DP:10` |
| `020E` | `DF 12` | `STU <$12`: save U at `DP:12` |
| `2010` | `30 00 00 00` | Initial source pointer and space for the final destination pointer |
| `2FFE` | `DE AD 12 34 80 00 FF FF 00 00 BE EF` | Source words, sentinel, and guard bytes |
| `3FFE` | `DE AD CC CC CC CC CC CC CC CC BE EF` | Destination and guard bytes |
| `FFFE` | `02 00` | Reset vector |

Initial state is A=`11`, B=`34`, DP=`20`, X=`2345`, Y=`4567`, S=`8000`,
U=`5000`, PC=`0200`; derived D=`1134`. Flags E/H/N/Z/V/C are 1 and F/I are 0.
The caller stops at `0210`; this is a completion address, not an instruction.

## Execution and acceptance

Execution takes sixteen instructions: two initial loads, four iterations of
LDD/STD/BNE, and two pointer stores. Each loop iteration transfers one word:

| Word | X after LDD | U after STD | N | Z | BNE |
| --- | --- | --- | --- | --- | --- |
| `1234` | `3002` | `4002` | 0 | 0 | Taken |
| `8000` | `3004` | `4004` | 1 | 0 | Taken |
| `FFFF` | `3006` | `4006` | 1 | 0 | Taken |
| `0000` | `3008` | `4008` | 0 | 1 | Not taken |

STD tests the whole word for zero, so the zero low byte of `8000` does not end
the loop. Loads and stores clear V and preserve E/F/H/I/C. The final STX/STU
set N=0 and Z=0 from their saved pointers; D remains zero. Final PC=`0210`,
X=`3008`, U=`4008`; A/B are zero. DP/Y/S and E/F/H/I/C retain their initial values.

RAM `4000–4007` becomes `12 34 80 00 FF FF 00 00`, and `2010–2013` becomes
`30 08 40 08`. All other bytes, including both sets of guards and the source,
remain unchanged. Every word read/write accesses the high byte then the low
byte. Instruction bytes and postbytes are fetched exactly once; branches do
not prefetch their targets and stores do not read their destinations.

Tests compare all sixteen complete records with real RAM calls and complete
initial/final memory images. A snapshot taken after the second LDD resumes
correctly before its STD. A fresh factory restores the complete initial state
and image independently of earlier CPU/RAM instances.

Reset preserves buffers and final pointers, sets DP=0 and F/I=1, and reads
`FFFE–FFFF` to return PC to `0200`. The next LDX consequently reads the saved
`3008` pointer from current RAM. Reset does not recreate the initial example.
Editing the source pointer to `3006` before execution copies only the sentinel
and finishes in seven steps. Replacing the LDD postbyte with undefined `90`
causes an unsupported attempt at `0206` before any destination write.
