# 68000 long arithmetic example

[Model contract](../model.md) ·
[Machine definition](../../../../src/machines/68000/example.machine) ·
[Example tests](../../../../tests/machines/68000/example.test.ts)

This first program loads a long word into D0, adds one, and stores the result.
It exercises big-endian data, signed overflow, and full 32-bit logical addresses
on a 24-bit memory bus. Caller completion stops execution after the store.

## Program and memory

| Full PC | Physical address | Bytes | Instruction |
| --- | --- | --- | --- |
| `AB001000` | `001000` | `20 3C 7F FF FF FF` | `MOVE.L #7FFFFFFF,D0` |
| `AB001006` | `001006` | `06 80 00 00 00 01` | `ADDI.L #1,D0` |
| `AB00100C` | `00100C` | `23 C0 CD 02 00 82` | `MOVE.L D0,(CD020082).L` |

The 16 MiB image starts zero-filled. Bytes at `000000` are
`12 FF F0 00 AB 00 10 00`, supplying external-reset SSP `12FFF000` and PC
`AB001000`. The program occupies eighteen bytes at `001000`. The final store
uses physical `020082`–`020085`; this even address does not require four-byte
alignment. No bytes change except those four destination bytes.

## Initial state

| Registers | Values |
| --- | --- |
| D0, D1, D2, D3 | `11223344`, `55667788`, `99AABBCC`, `DDEEFF00` |
| D4, D5, D6, D7 | `01234567`, `89ABCDEF`, `FEDCBA98`, `76543210` |
| A0, A1, A2, A3 | `10000000`, `20000000`, `30000000`, `40000000` |
| A4, A5, A6 | `50000000`, `60000000`, `70000000` |
| USP, SSP, PC | `34FFE000`, `56FFD000`, `AB001000` |
| interruptMask | `2` |
| X, N, Z, V, C, T, S | `1`, `0`, `1`, `1`, `1`, `0`, `0` |

A7 initially exposes USP (`34FFE000`), because S is clear. Physical PC is
`001000`. Constructing the example neither reads reset vectors nor steps.

## Expected execution

| After instruction | PC | D0 | X | N | Z | V | C |
| --- | --- | --- | --- | --- | --- | --- | --- |
| MOVE immediate | `AB001006` | `7FFFFFFF` | 1 | 0 | 0 | 0 | 0 |
| ADDI | `AB00100C` | `80000000` | 0 | 1 | 0 | 1 | 0 |
| MOVE to memory | `AB001012` | `80000000` | 0 | 1 | 0 | 0 | 0 |

ADDI ignores incoming X and C, then sets both from unsigned carry. Adding one
to the largest signed positive long word sets N and V without unsigned carry.
Both MOVE forms set N/Z from the transferred value, clear V/C, and preserve X.
The store therefore clears ADDI's overflow flag. Other registers, T/S, and the
interrupt mask are unchanged throughout.

Each instruction reads its six bytes in order. The store then writes
`80 00 00 00` at physical `020082`–`020085`, high byte first. The complete
run records eighteen reads and four writes. Instruction addresses retain the
full PC; memory-access addresses contain only the physical address.

`runCpu(cpu, { maxSteps: 3, endAddress: 0xAB001012 })` returns three executed
records and `stopReason: "completed"`. Using physical `001012` as the endpoint
does not match this PC. Without an endpoint the same three-step run stops at
the budget; another step reads `00 00` and reports an unsupported opcode.

External reset preserves the arithmetic result in D0 and RAM, replaces SSP/PC
from the vectors, sets S, clears T, and sets the interrupt mask to 7. A7 then
exposes `12FFF000`. Reset permits another run of the program; restarting the
example instead restores all supplied state and its original memory image.

## Acceptance checks

The tests independently specify complete snapshots, instruction bytes, access
records, and the full initial/final RAM images. They compare the records with
actual RAM calls, verify bounded pause/resume and logical completion, and check
reset, rerunning, factory isolation, and retained records. The
[CPU tests](../../../../tests/components/cpus/68000.test.ts) additionally cover
arithmetic boundaries, alignment errors, address wrapping, and unsupported words.

Encoding and flag expectations come from Motorola's
[programmer's reference manual](https://www.nxp.com/docs/en/reference-manual/M68000PRM.pdf),
ADDI (4-9–4-10) and MOVE (4-116–4-118), restricted to the original 68000.
