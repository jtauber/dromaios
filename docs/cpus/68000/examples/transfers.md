# 68000 data-register transfers

[Model contract](../model.md) ·
[Machine definition](../../../../src/machines/68000/transfers-example.machine) ·
[Example tests](../../../../tests/machines/68000/transfers-example.test.ts)

This program exercises five data-register instruction families. It moves a
negative immediate through D7 and D2, computes unsigned carry and signed
overflow in different registers, and stores both results. The register and
quick transfers need only their operation word; long immediates and absolute
addresses follow in extension words.

## Program and memory

PC retains its high byte `AB`; the table gives physical addresses. Initial
PC is `AB002000` and caller completion is `AB002024`.

| Physical address | Bytes | Instruction |
| --- | --- | --- |
| `002000` | `7E FF` | `MOVEQ #-1,D7` |
| `002002` | `24 07` | `MOVE.L D7,D2` |
| `002004` | `06 82 00 00 00 01` | `ADDI.L #1,D2` |
| `00200A` | `2A 3C 7F FF FF FF` | `MOVE.L #7FFFFFFF,D5` |
| `002010` | `06 85 00 00 00 01` | `ADDI.L #1,D5` |
| `002016` | `22 05` | `MOVE.L D5,D1` |
| `002018` | `23 C1 CD 02 00 82` | `MOVE.L D1,(CD020082).L` |
| `00201E` | `23 C2 CD 02 00 86` | `MOVE.L D2,(CD020086).L` |

The 16 MiB RAM image starts zero-filled, with three blocks:

- `000000`: `12 FF F0 00 AB 00 20 00`, the external-reset SSP and PC vectors.
- `002000`: the 36 program bytes above.
- `020080`: `DE AD 11 22 33 44 AA BB CC DD BE EF`, two result slots bracketed
  by sentinels. The first slot becomes `80 00 00 00`; the second becomes
  `00 00 00 00`. Neither sentinel changes.

## Initial state

| Registers | Values |
| --- | --- |
| D0, D1, D2, D3 | `11223344`, `55667788`, `99AABBCC`, `DDEEFF00` |
| D4, D5, D6, D7 | `01234567`, `89ABCDEF`, `FEDCBA98`, `76543210` |
| A0, A1, A2, A3 | `10000000`, `20000000`, `30000000`, `40000000` |
| A4, A5, A6 | `50000000`, `60000000`, `70000000` |
| USP, SSP, PC | `34FFE000`, `56FFD000`, `AB002000` |
| interruptMask | `2` |
| IR | `0000` |
| entry.kind, entry.vector | `none`, `00` |
| halted, faulted, tracePending | `false`, `false`, `false` |
| X, N, Z, V, C, T, S | `1`, `0`, `1`, `1`, `1`, `0`, `0` |

A7 exposes USP because S is clear. Construction does not reset or execute.

## Expected execution

The flag columns below are in X/N/Z/V/C order. All unspecified registers and
control fields retain their previous values.

| After instruction | Full PC | Register change | X | N | Z | V | C |
| --- | --- | --- | --- | --- | --- | --- | --- |
| MOVEQ | `AB002002` | D7 = `FFFFFFFF` | 1 | 1 | 0 | 0 | 0 |
| MOVE D7,D2 | `AB002004` | D2 = `FFFFFFFF` | 1 | 1 | 0 | 0 | 0 |
| ADDI to D2 | `AB00200A` | D2 = `00000000` | 1 | 0 | 1 | 0 | 1 |
| MOVE immediate | `AB002010` | D5 = `7FFFFFFF` | 1 | 0 | 0 | 0 | 0 |
| ADDI to D5 | `AB002016` | D5 = `80000000` | 0 | 1 | 0 | 1 | 0 |
| MOVE D5,D1 | `AB002018` | D1 = `80000000` | 0 | 1 | 0 | 0 | 0 |
| Store D1 | `AB00201E` | None | 0 | 1 | 0 | 0 | 0 |
| Store D2 | `AB002024` | None | 0 | 0 | 1 | 0 | 0 |

MOVEQ sign-extends its embedded `FF` byte to `FFFFFFFF`, replacing the whole
destination register. The long data-register MOVE forms here preserve X, set N/Z from the
transferred long, and clear V/C. Register transfers preserve the source; self-transfers
still update flags. ADDI ignores incoming X/C and replaces both from carry.
The first addition produces unsigned carry without signed overflow; the second
produces signed overflow without unsigned carry. The subsequent transfer clears V.

Each instruction reads only its encoded bytes. The run has 36 reads followed,
at the two store instructions, by four high-byte-first writes each. Instruction
addresses retain all 32 PC bits; accesses use physical addresses. Completion
requires `AB002024`, not the physical alias `002024`.

The runner completes at exactly eight steps. A five-step budget pauses after
the overflow-producing addition and can resume through the transfer and stores.
A CPU restored from that snapshot can run the same remaining program.

External reset preserves the results and general registers, loads SSP
`12FFF000` and PC `AB002000`, sets S, clears T, and masks interrupts. Running
again produces the same result bytes. Restarting the example creates fresh
state and restores the original result-slot contents and sentinels.

## Acceptance checks

The tests independently specify complete state and records, compare the trace
to actual RAM calls, and inspect full initial/final memory images. They check
factory isolation, logical completion, pause/resume, snapshot restoration,
reset and rerunning, and detached earlier records. The
[CPU tests](../../../../tests/components/cpus/68000.test.ts) check every register
combination, every MOVEQ byte, every incoming flag pattern, self-transfers,
address wrapping, faulting stores, current operands, and all illegal/emulator-line words.

The encoding and flag reference is Motorola's
[M68000 Family Programmer's Reference Manual](https://www.nxp.com/docs/en/reference-manual/M68000PRM.pdf):
ADDI (4-9–4-10), MOVE (4-116–4-118), and MOVEQ (4-134), restricted to the original 68000.
