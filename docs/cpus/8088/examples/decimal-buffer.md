# 8088 decimal buffer

This example copies three words between segments, then formats the first word
as five decimal digits in a far subroutine. It combines segment-pointer loads,
REP, unsigned division, a counted loop, reverse string stores, packed FLAGS,
and HLT without devices or interrupt delivery.

[Machine definition](../../../../src/machines/8088/decimal-buffer-example.machine) ·
[Acceptance tests](../../../../tests/machines/8088/decimal-buffer-example.test.ts) ·
[Model contract](../model.md) · [Coverage](../../coverage.md#8088)

## Memory and entry state

Execution starts at `1234:0100` (physical `12440`). DS initially selects `2000`,
which holds the source and destination far pointers. SS is `6000`, SP is `0002`,
and `halted`, `interruptDeferred`, `segmentDeferred`, and `trapPending` are false. AF/IF/DF/OF are set; other flags are clear. The machine
definition supplies every initial register explicitly.

All addresses and bytes below are hexadecimal; input values and step counts
are decimal.

| Region | Address | Contents or purpose |
| --- | --- | --- |
| Main program | `1234:0100` | Save FLAGS, load pointers, copy, call, restore FLAGS, halt |
| Formatting subroutine | `5000:0200` | Repeated division by ten, writing digits from right to left |
| Far pointers | `2000:0000`, `2000:0004` | Source `3000:FFFE`, destination `4000:0100` |
| Source words | `3000:FFFE`, `3000:0000`, `3000:0002` | `3039`, `FFFF`, `0000` (12345, 65535, 0) |
| Copy destination | `4000:0100`–`0105` | Six bytes, guarded by `DE` and `AD` |
| Decimal text | `4000:0110`–`0114` | Five ASCII digits, guarded by `DE` and `AD` |
| Saved FLAGS | `6000:0000` | `FE12`, including original-8088 reserved bits |
| Far return frame | `6000:FFFC`–`FFFF` | Following IP `0118`, then caller CS `1234` |

LES runs before LDS so both pointers come from the original DS. The three
MOVSW iterations wrap SI from `FFFE` to `0000` within the new DS. Each word
is a separate step, including its refetched REP prefix.

## Execution

| Steps | Operation | Result |
| --- | --- | --- |
| 1–5 | PUSHF, CLD, LES, LDS, MOV CX,3 | Save caller flags and establish forward copy pointers |
| 6–8 | REP MOVSW | Copy all six bytes; CX=0, SI=`0004`, DI=`0106` |
| 9 | MOV AX,ES:[0100] | Read 12345 from the copied buffer using an ES override |
| 10 | Far CALL `5000:0200` | Save CS and return IP across SP wrapping |
| 11–14 | Set BX=10, CX=5, DI=`0114`; STD | Prepare backward decimal output |
| 15–49 | Five iterations of XOR, DIV, XCHG, ADD, STOSB, XCHG, LOOP | Emit `5`, `4`, `3`, `2`, `1` from right to left |
| 50 | RETF | Return to `1234:0118`; SP=0 |
| 51 | POPF | Restore all caller flags; SP=2 |
| 52 | HLT | IP=`011A`, physical PC=`1245A`, `halted=true` |

Each division zero-extends the current AX into DX:AX. DIV leaves the quotient
in AX and the remainder in DX. XCHG exposes the remainder in AL; adding `30`
turns it into ASCII. STOSB writes through ES and decrements DI because DF is
set. A second XCHG recovers the quotient. Five iterations produce leading
zeroes for every smaller unsigned input.

Final copied bytes are `39 30 FF FF 00 00`; the output is `31 32 33 34 35`
(`12345`). AX=CX=0, BX=`000A`, DX=`0031`, SI=`0004`, DI=`010F`, and SP=`0002`.
DS=`3000`, ES=`4000`; CS, SS, BP, and all caller flags are restored or preserved.
The saved stack bytes remain in RAM after popping.

## Acceptance criteria

Tests specify all 52 complete records independently, including before/after
snapshots, fetched bytes, physical read/write order, and the final halt record.
They compare actual RAM calls and the entire 1 MiB initial/final memory image,
including guards, unchanged code, source data, and retained stack bytes.

Restoration is checked after step 6 inside REP, after step 10 with a live far
frame, and inside the formatting routine. Snapshots alone suffice to resume;
retained records remain detached. Reset clears halt, segments, and flags under
the CPU contract while preserving general registers and RAM. Fresh factories
provide independent initial state and memory.

Edited inputs cover 0, single digits, decimal boundaries, 32768, and 65535;
expected text comes from decimal string conversion. The runner reports
`halted` on the HLT step, even though that step reaches the configured physical
endpoint. Later halted steps fetch nothing.
