# 68000 decimal pipeline and status control

[Model contract](../../../../src/components/cpus/specifications/68000.md#packed-decimal-arithmetic) ·
[Machine definition](../../../../src/machines/68000/decimal-pipeline-example.machine) ·
[Example tests](../../../../tests/machines/68000/decimal-pipeline-example.test.ts)

This 26-step program follows a packed decimal calculation into signed binary
arithmetic, transfers its result through alternate memory bytes, and exercises
status and stack control before STOP. It runs entirely against RAM; MOVEP
does not require a device. Tracing stays disabled throughout this program.

## Initial state and memory

| Registers | Values |
| --- | --- |
| D0, D1, D2, D3 | `11223344`, `55667788`, `99AABBCC`, `DDEEFF00` |
| D4, D5, D6, D7 | `01234567`, `89ABCDEF`, `FEDCBA98`, `76543210` |
| A0, A1, A2, A3 | `AB003000`, `CD004000`, `EF005000`, `40000000` |
| A4, A5, A6 | `50000000`, `60000000`, `70000000` |
| USP, SSP, PC | `34008000`, `56009000`, `AB002000` |
| IR | `0000` |
| entry.kind, entry.vector | `none`, `00` |
| interruptMask, halted, faulted, tracePending | `2`, `false`, `false`, `false` |
| X, N, Z, V, C, T, S | `1`, `0`, `1`, `1`, `1`, `0`, `1` |

Zero-filled 16 MiB RAM contains the reset vectors
`56 00 90 00 AB 00 20 00` at `000000`, the 74-byte program at `002000`,
and these data blocks:

| Physical address | Initial bytes | Purpose |
| --- | --- | --- |
| `003000` | `5A CC 5A CC 5A CC 5A CC 5A` | Four alternate-byte destinations, with untouched gaps/guards |
| `003FFF` | `DE 00 AD` | TAS marker with guards |
| `008FFE` | `DE AD 00 05 AB 00 20 46 BE EF` | Guarded RTR frame: CCR `0005`, full PC `AB002046` |

## Program and results

PC values below have logical prefix `AB00`. Register and memory values are
hexadecimal; signed arithmetic explanations use decimal integers.

| PC | Instruction | Effect |
| --- | --- | --- |
| `2000`, `2002` | MOVEQ #45,D0; MOVEQ #55,D1 | Packed decimal operands 45 and 55 |
| `2004` | MOVE #04,CCR | X=0, Z=1 starts cumulative decimal flags |
| `2008` | ABCD D0,D1 | D1=`00`, X=C=1, Z remains 1 |
| `200A` | ABCD D0,D1 | Carry becomes an input: D1=`46`, X=C=0, Z=0 |
| `200C` | SBCD D0,D1 | D1=`01` |
| `200E` | NBCD D1 | D1=`99`, decimal borrow sets X/C |
| `2010`, `2012` | EXT.W D1; EXT.L D1 | Interpret byte `99` as signed −103; D1=`FFFFFF99` |
| `2014` | MULS #3,D1 | −309, D1=`FFFFFECB` |
| `2018` | DIVS #7,D1 | Remainder −1, quotient −44: D1=`FFFFFFD4` |
| `201C`, `201E` | SWAP D1; EXG D1,D2 | D2=`FFD4FFFF`; D1 receives old D2=`99AABBCC` |
| `2020` | MOVEP.L D2,(1,A0) | Write `FF D4 FF FF` at `3001`, `3003`, `3005`, `3007` |
| `2024` | MOVEP.W (1,A0),D3 | D3=`DDEEFFD4`; upper word preserved |
| `2028` | TAS (A1) | Read zero, set Z, then write `80`; preserve X |
| `202A` | MOVE SR,D4 | D4=`01232214`; upper word preserved |
| `202C` | ORI #1,CCR | Set C |
| `2030` | MOVE #0504,CCR | Only low five bits survive: Z=1, X/N/V/C=0 |
| `2034`, `2036` | MOVE A2,USP; MOVE USP,A3 | USP and A3 become `EF005000` |
| `2038` | MOVE #2304,SR | S=1, T=0, interrupt mask 3; condition codes unchanged |
| `203C` | CHK #7FFF,D0 | Signed value 69 lies within the bound |
| `2040` | NOP | Advance only PC |
| `2042` | RTR | Read CCR/PC through SSP; SSP=`56009006`, CCR=`05` |
| `2044` | NOP | Skipped by the restored return address |
| `2046` | STOP #001F | PC=`AB00204A`, `halted=true`; S=T=0, mask=0, all five condition codes set |

Final A7 is USP=`EF005000`. Final data registers are D0=`00000045`,
D1=`99AABBCC`, D2=`FFD4FFFF`, D3=`DDEEFFD4`, D4=`01232214`;
D5–D7 retain their initial values. A0–A2 and A4–A6 remain unchanged.
The sparse output is `5A FF 5A D4 5A FF 5A FF 5A`; the marker becomes
`DE 80 AD`; the RTR frame and its guards are untouched.

## Records, faults, and acceptance

Every step records its actual instruction fetches followed by data accesses.
MOVEP writes four alternate bytes without destination reads, then reads two
alternate bytes. TAS reads zero before writing `80`. RTR reads six bytes in
ascending order before committing CCR, PC, and SSP. It does not fetch the
skipped NOP or the return target. STOP fetches four instruction bytes, reports
`halted`, and later halted steps access nothing.

The runner returns `halted` for STOP even though it reaches the configured
endpoint. A new run with that endpoint returns `completed` immediately;
a run without an endpoint returns an already-halted record. Snapshot
resumption at every boundary produces the same remaining records and result.

The live-operand check pauses before DIVS, replaces its divisor with zero,
and installs a vector-5 handler at logical `CD006000`. Entry stacks SR and the
following PC `AB00201C` below the existing RTR frame. The handler substitutes
the expected D1 result with `MOVE.L #FFFFFFD4,D1`, then RTE restores SR and
resumes at SWAP. The shared runner continues through entry and return, and
the rest of the original program produces the same records. The exception
frame remains below the original RTR frame, and earlier records stay detached.

External reset wakes STOP, reads the vectors, selects SSP, clears T, and
masks interrupts, while preserving the changed RAM. A new example factory
restores both initial CPU state and the original memory image.
