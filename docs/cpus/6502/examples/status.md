# 6502 example: status preservation and indirect dispatch

**Status: implemented and tested.**
Save the caller's flags, call a dispatch stub that jumps through a RAM pointer,
and restore the flags after arithmetic in the selected subroutine. Keep the
accumulator result while branching on the restored Z flag.

[Model contract](../../../../src/components/cpus/specifications/6502.md#status-as-a-byte) ·
[Example definition](../../../../src/machines/6502/status-example.machine) ·
[Example tests](../../../../tests/machines/6502/status-example.test.ts) ·
[CPU coverage](../../coverage.md#6502)

## Definition and initial state

Addresses and byte values are hexadecimal; step counts are decimal. Initialize
zero-filled 64 KiB RAM with:

| Address | Bytes | Instruction or data |
| --- | --- | --- |
| `007F` | `AA CC 55` | Sentinels around the result at `0080` |
| `0200` | `08` | `PHP` |
| `0201` | `20 40 02` | `JSR $0240` |
| `0204` | `28` | `PLP` |
| `0205` | `F0 02` | `BEQ $0209` |
| `0207` | `00 00` | Failure path: BRK and padding |
| `0209` | `8D 80 00` | `STA $0080` |
| `020C` | `6C 00 31` | `JMP ($3100)` to completion |
| `0240` | `6C FF 30` | Dispatch: `JMP ($30FF)` |
| `0260` | `D8` | `CLD` |
| `0261` | `18` | `CLC` |
| `0262` | `A9 7F` | `LDA #$7F` |
| `0264` | `69 01` | `ADC #$01` |
| `0266` | `60` | `RTS` |
| `3000` | `02` | Wrapped high byte of the dispatch target |
| `30FF` | `60` | Low byte of the dispatch target: `0260` |
| `3100` | `04 03` | Completion pointer: `0304` |
| `FFFC` | `00 02` | Reset vector: `0200` |

Initial A/X/Y = `11/22/33`, PC/SP = `0200/00`, and N/V/D/I/Z/C = 1/0/1/0/1/1.
These are explicit example choices, including flags independent of A.
`create6502StatusExample()` supplies fresh `{ cpu, ram, endAddress }` with
`endAddress = 0304`. `create6502StatusExampleMemory()` supplies the same
image without a CPU. Neither factory resets or executes instructions.

## Expected execution

The twelve steps below all execute. Each before-state is the preceding
after-state or the initial state. X/Y stay `22/33`, I stays clear, and fields
not mentioned retain their values.

| Step | PC before → after | Changes |
| --- | --- | --- |
| 1 | `0200 → 0201` | PHP writes `BB` at `0100`; SP = `FF`; flags unchanged |
| 2 | `0201 → 0240` | JSR writes `02` at `01FF`, then `03` at `01FE`; SP = `FD` |
| 3 | `0240 → 0260` | Read target low `60` at `30FF`, then high `02` at `3000` |
| 4 | `0260 → 0261` | D = 0 |
| 5 | `0261 → 0262` | C = 0 |
| 6 | `0262 → 0264` | A = `7F`; N/Z = 0/0 |
| 7 | `0264 → 0266` | A = `80`; N/V/Z/C = 1/1/0/0 |
| 8 | `0266 → 0204` | RTS reads `03` at `01FE`, then `02` at `01FF`; SP = `FF` |
| 9 | `0204 → 0205` | PLP reads `BB` at `0100`; SP = `00`; N/V/D/I/Z/C = 1/0/1/0/1/1 |
| 10 | `0205 → 0209` | BEQ taken on restored Z, despite A = `80` |
| 11 | `0209 → 020C` | Store `80` at `0080` |
| 12 | `020C → 0304` | Read target low `04` at `3100`, then high `03` at `3101` |

PHP encodes **N V 1 1 D I Z C**, giving `BB`. PLP restores the six flags and
ignores bits 5/4. The status frame and JSR's return frame share ordinary
page-one RAM; RTS removes the return frame before PLP removes the status frame.
Pulling leaves all three bytes in RAM.

The dispatch pointer intentionally ends a page. On this NMOS 6502, its high
byte comes from `3000`; reading `3100` instead would jump to zero-filled RAM
at `0460`, where BRK follows the unused IRQ/BRK vector to `0000`. The completion pointer demonstrates ordinary adjacent pointer reads.

Final A/X/Y = `80/22/33`, PC/SP = `0304/00`, and flags match the initial state.
Only RAM `0080:80`, `0100:BB`, `01FE:03`, and `01FF:02` differ from the initial
image. The caller stops before fetching `0304`.

## Records and acceptance checks

Instruction fetches capture the bytes above. PHP/PLP then write/read the
status slot. Indirect JMP then reads two target bytes. JSR reads its target
low byte, pushes its return address high then low, and only then fetches its
target high byte. RTS reads the saved return low then high and adds one.
The final STA writes once. No other data accesses, dummy reads, prefetches,
or cycle counts appear in the model's records.

The tests independently specify all twelve complete records and compare them
with actual RAM calls and the entire initial/final image. Fresh factories must
provide independent components. Pausing after steps 1, 2, 3, 7, 8, or 9 and
resuming from a snapshot with current RAM must produce the same remaining trace.
Reset after completion reads the vector, sets PC/SP to `0200/FD`, sets I, and
preserves other state and all RAM. Captured records survive reset and host edits.

Changing `30FF` to `61` after JSR makes the dispatch skip CLD. The subsequent
ADC then executes in decimal mode, producing `86` from the invalid BCD
operand `7F` plus `01`. The program completes in eleven instructions, stores
`86`, and restores the caller's flags and SP through RTS/PLP.

The [model contract](../../../../src/components/cpus/specifications/6502.md#status-as-a-byte) cites manufacturer instruction
rules and the independent PHP/PLP/JMP reference cases, and defines the omitted
bus activity and deferred interrupt behavior.
