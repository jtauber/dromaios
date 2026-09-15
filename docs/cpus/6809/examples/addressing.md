# 6809 example: a configurable direct page

This example copies a byte using the DP register to select a memory page.
It completes the basic addressing comparison with the
[8080's HL pair](../../8080/examples/addressing.md) and the
[6502's fixed zero page](../../6502/examples/addressing.md).

[Example definition](../../../../src/machines/6809/addressing-example.machine) ·
[Example tests](../../../../tests/machines/6809/addressing-example.test.ts) ·
[CPU coverage](../../coverage.md#6809)

## Instruction behavior

Use the existing Motorola 6809 model and flat 64 KiB RAM. Direct `LDA`
(`96`) and `STA` (`97`) each have one address-operand byte. DP supplies the
high byte of the effective address and the operand supplies the low byte.
For example, DP = `12` and operand `80` select `1280`. Neither instruction
changes DP or uses X/Y/S/U to calculate this address. See Motorola's
[direct-page register and addressing description](https://www.maddes.net/m6809pm/sections.htm),
sections 1.9 and 2.2.4.

LDA loads the addressed byte into A; STA writes A there. Both replace N/Z
from the transferred byte, clear V, and preserve E/F/H/I/C. B stays unchanged;
the snapshot's D value reflects A:B after a load. These effects and encodings
follow Motorola's [instruction table](https://www.maddes.net/m6809pm/appendix_d.htm).

The CPU records the opcode fetch, operand fetch, and one data read or write,
in that order. PC advances by two with 16-bit wrapping. Stores do not read
their destination and still write when the value is unchanged. Data accesses
never become part of `instruction.bytes`. These records omit timing, dummy
accesses, and electrical activity.

All pages, including `00` and `FF`, are available. DP is read for each
instruction, including after a stack pull changes it. Code can occupy the
selected page: loads can reread instruction bytes as data, and stores can
overwrite them. Captured bytes remain unchanged; later execution uses current
RAM. A source edit after loading leaves the captured byte in A.

## Definition and initial state

Initial control state is `waitMode = none` and `nmiArmed = false`. Neither
changes during this program.

All numbers below are hexadecimal. Create zero-filled RAM and load:

| Address | Bytes | Instruction or data |
| --- | --- | --- |
| `0080` | `5A` | Source in page zero, used after reset |
| `0200` | `96 80` | `LDA <$80` (direct) |
| `0202` | `97 81` | `STA <$81` (direct) |
| `1280` | `A5` | Source selected by the initial DP |
| `FFFE` | `02 00` | Reset vector: `0200`, high byte first |

The `<` notation denotes direct addressing; `80` and `81` are the encoded
low bytes. Destinations `0081` and `1281`, and completion address `0204`,
start at zero. Loading the image does not appear in CPU records.

| State | Initial value |
| --- | --- |
| A, B, DP | `11`, `34`, `12` |
| X, Y | `2345`, `4567` |
| S, U, PC | `8000`, `4000`, `0200` |
| E, F, H, I, N, Z, V, C | `1`, `0`, `1`, `0`, `0`, `1`, `1`, `1` |

Initial D is `1134`. These are explicit lesson choices; construction does
not reset the CPU or execute instructions. `create6809AddressingExample()`
returns fresh `{ cpu, ram, endAddress }`, with `endAddress = 0204`.
`create6809AddressingExampleMemory()` loads the same image without a CPU.

## Expected execution

Both steps return `executed`. B, DP, X, Y, S, U, E, F, H, I, and C retain
their initial values. The first record's before-state is the initial state;
the second's before-state equals the first's after-state.

| Step | PC before | Fetched bytes | PC after | A | D | N | Z | V |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `0200` | `96 80` | `0202` | `A5` | `A534` | 1 | 0 | 0 |
| 2 | `0202` | `97 81` | `0204` | `A5` | `A534` | 1 | 0 | 0 |

The complete ordered accesses follow; `R` means read and `W` means write.

| Step | Accesses: kind address:value |
| --- | --- |
| 1 | `R 0200:96`, `R 0201:80`, `R 1280:A5` |
| 2 | `R 0202:97`, `R 0203:81`, `W 1281:A5` |

Only `1281` changes, from `00` to `A5`. Page zero and both source bytes stay
unchanged. The caller stops at `0204` before fetching again. A direct CPU
step would execute `NEG <$00`. Tests install unsupported byte `01` there to
check rejection independently of caller completion.

## Reset and restart

Reset follows the [existing 6809 policy](../model.md#cpu-reset).
It reads `FFFE` then `FFFF`, sets PC to `0200`, clears DP, and sets F/I.
Other state and RAM remain unchanged, including the `A5` copied to `1281`.

Resuming the same two instructions with DP = `00` loads `5A` from `0080`
and stores it at `0081`. The load sets A = `5A`, D = `5A34`, N = `0`,
Z = `0`, and V = `0`; the store preserves those values. PC reaches `0204`
again. The access records use `0080` and `0081` in place of `1280` and `1281`.
The original result at `1281` remains `A5`.

Restarting through the factory restores DP = `12` and the original state
and RAM image in independent components. Earlier step and reset records
remain unchanged throughout.

## Acceptance checks

- Verify both factories, the full initial and final images, exact step
  records, and caller completion before another fetch.
- Exercise DP values `00`, `12`, `80`, and `FF`, including both ends of a page
  and the address space. Use nonzero X/Y/S/U to expose accidental indexing.
- Check zero, positive, negative, and unchanged values with every flag set
  and clear. Both loads and stores replace N/Z and clear V; stores must not
  read their destination. Verify D after changes to A.
- Wrap opcode/operand fetching at `FFFE` and `FFFF` while preserving DP.
  Check actual RAM calls independently of the CPU's access records.
- Read and overwrite code, retain captured opcode/operand bytes, and fetch
  newly written instructions on later steps.
- Pull a new DP from the stack and use it for subsequent direct loads and
  stores; retain a loaded byte even if its source is subsequently edited.
- Verify reset's page change, subsequent execution, fresh restart, detached
  records, and rejection of all remaining unsupported bytes and prefixes.
- Retain the existing extended-STA checks, including its independence from DP.
