# 8088 example: a loop with nested subroutines

Add five to a RAM word three times, preserving an AX loop counter on the
stack while subroutines use AX for arithmetic. This combines comparison,
conditional branches, near calls/returns, register saves, and separate
code, data, and stack segments.

[Model contract](../../../../src/components/cpus/specifications/8088.md#control-flow-and-stack) ·
[Machine definition](../../../../src/machines/8088/control-flow-example.machine) ·
[Example tests](../../../../tests/machines/8088/control-flow-example.test.ts) ·
[CPU coverage](../../coverage.md#8088)

## Program and initial state

All addresses and values below are hexadecimal; instruction counts are decimal.
CS:IP starts at `1234:0200`, physical `12540`. Caller completion is physical
`12557`, reached at `1234:0217`. DS=`2000` and SS=`3000` remain distinct.

| IP | Physical address | Bytes | Instruction |
| --- | --- | --- | --- |
| `0200` | `12540` | `B8 03 00` | MOV AX,0003h: loop counter |
| `0203` | `12543` | `E8 1A 00` | CALL 0220h |
| `0206` | `12546` | `05 FF FF` | ADD AX,FFFFh: decrement the restored counter |
| `0209` | `12549` | `3D 00 00` | CMP AX,0000h |
| `020C` | `1254C` | `75 F5` | JNE 0203h: −11 from 020E |
| `020E` | `1254E` | `A1 80 00` | MOV AX,[0080h]: inspect the result |
| `0211` | `12551` | `E9 03 00` | JMP 0217h: skip failure marker |
| `0214` | `12554` | `B8 FF FF` | MOV AX,FFFFh: skipped |
| `0220` | `12560` | `50` | PUSH AX: save the loop counter |
| `0221` | `12561` | `A1 80 00` | MOV AX,[0080h]: load the running sum |
| `0224` | `12564` | `E8 09 00` | CALL 0230h |
| `0227` | `12567` | `A3 80 00` | MOV [0080h],AX: store the new sum |
| `022A` | `1256A` | `58` | POP AX: restore the counter |
| `022B` | `1256B` | `C3` | RET to 0206h |
| `0230` | `12570` | `05 05 00` | ADD AX,0005h |
| `0233` | `12573` | `C3` | RET to 0227h |

Begin with zero-filled 1 MiB RAM, load the program blocks above, and place
`DE 00 00 AD` at physical `2007F`. The middle word is DS:0080; DE/AD are
sentinels. Initial state is:

| Registers | Values |
| --- | --- |
| AX, BX, CX, DX | `1122`, `3344`, `5566`, `7788` |
| SP, BP, SI, DI | `8000`, `9000`, `0010`, `0020` |
| CS, DS, SS, ES, IP | `1234`, `2000`, `3000`, `4000`, `0200` |
| CF, PF, AF, ZF, SF, TF, IF, DF, OF | `1`, `0`, `1`, `1`, `1`, `0`, `1`, `1`, `1` |
| `halted`, `waiting`, `interruptDeferred`, `recognitionDeferred`, `trapPending` | `false` |

`create8088ControlFlowExample()` returns independent `{ cpu, ram, endAddress }`.
`create8088ControlFlowExampleMemory()` creates the same image without a CPU.
Neither factory performs reset or execution; byte-register and physical-PC
views derive from stored registers.

## Expected execution

The program completes in **39 instructions**: the initial MOV, three twelve-step
iterations, and the final load/JMP. Each iteration uses these values:

| Iteration | Saved counter | Sum before | Sum after | Counter after decrement | JNE |
| --- | --- | --- | --- | --- | --- |
| 1 | `0003` | `0000` | `0005` | `0002` | Taken |
| 2 | `0002` | `0005` | `000A` | `0001` | Taken |
| 3 | `0001` | `000A` | `000F` | `0000` | Untaken |

Each step first reads its listed instruction bytes through CS:IP. The following
table describes each iteration's additional accesses, in order. `R` means read,
`W` means write; all addresses here are physical. Words are low byte first.

| IP before → after | SP after | AX after | Data accesses |
| --- | --- | --- | --- |
| `0203 → 0220` | `7FFE` | Counter | W `37FFE:06`, W `37FFF:02` |
| `0220 → 0221` | `7FFC` | Counter | W counter low at `37FFC`, W `37FFD:00` |
| `0221 → 0224` | `7FFC` | Old sum | R old sum low at `20080`, R `20081:00` |
| `0224 → 0230` | `7FFA` | Old sum | W `37FFA:27`, W `37FFB:02` |
| `0230 → 0233` | `7FFA` | New sum | — |
| `0233 → 0227` | `7FFC` | New sum | R `37FFA:27`, R `37FFB:02` |
| `0227 → 022A` | `7FFC` | New sum | W new sum low at `20080`, W `20081:00` |
| `022A → 022B` | `7FFE` | Saved counter | R counter low at `37FFC`, R `37FFD:00` |
| `022B → 0206` | `8000` | Counter | R `37FFE:06`, R `37FFF:02` |
| `0206 → 0209` | `8000` | Decremented counter | — |
| `0209 → 020C` | `8000` | Decremented counter | — |
| `020C → 0203/020E` | `8000` | Decremented counter | — |

ADD of five sets CF/AF/ZF/SF/OF to zero and PF to one in all three iterations.
Decrementing through ADD sets CF/AF to one, SF/OF to zero, and PF/ZF to
`0/0`, `0/0`, then `1/1`. CMP clears CF/AF/SF/OF while retaining those PF/ZF
results. CMP preserves AX. All other instructions preserve flags; TF/IF/DF
remain `0/1/1` throughout. In particular, POP restores the counter without
replacing flags from the sum.

The final load reads `20080:0F`, then `20081:00`; JMP reaches IP=`0217`
without touching its target. Final AX=`000F`, SP=`8000`, PF/ZF=`1/1`,
CF/AF/SF/OF=`0/0/0/0`. All other stored registers retain their initial values.
The final result block is `DE 0F 00 AD`. The stack retains
`27 02 01 00 06 02` at `37FFA`; no other RAM changes. Writes of unchanged zero
high bytes are still real, recorded writes.

## Pause, reset, and acceptance checks

A five-step budget pauses inside the nested call at IP=`0230`, SP=`7FFA`.
A CPU constructed from that snapshot and the same RAM completes in 34 more
steps; concatenated records match uninterrupted execution.

Reset preserves general registers and RAM, clears segments other than CS, sets
CS:IP=`FFFF:0000`, and clears flags without accessing RAM. It does not resume
the nested call or restore the example's segments. A fresh factory restores
the complete initial state and image.

Tests check all 39 records and actual RAM calls independently, full memory
images, factory isolation, snapshot resumption, detached records, reset,
and fresh restart. Completion is physical: `1244:0117` aliases the same
endpoint. Editing the saved inner return address redirects RET immediately;
changing JNE's displacement to `FE` makes a bounded run stop at its instruction
budget. These are instruction-level accesses without prefetch or cycle claims.

The [reference notes](../reference-notes.md#stack-and-control-flow-comparison)
record the matching 39-step run in `dromaios-pc`, independent hardware tests,
and the separate PUSH SP and segment-boundary regressions.
