# 6809 example: two independent stack pointers

**Status: implemented and tested.**
This example saves `12` on S and `34` on U, then retrieves them into separate
result locations. Pulling from S before U demonstrates that each pointer has
its own sequence of saved values. Both stacks occupy ordinary shared RAM.

[Example definition](../../../../src/machines/6809/stack-example.machine) ·
[Example tests](../../../../tests/machines/6809/stack-example.test.ts) ·
[CPU coverage](../../coverage.md#6809)

## Instruction behavior

The example uses the Motorola 6809 model's `PSHS` (`34`), `PULS` (`35`),
`PSHU` (`36`), and `PULU` (`37`). Each fetches an opcode and a register-mask
postbyte before accessing stack data. Every mask from `00` through `FF` works.

| Mask bit | PSHS/PULS register | PSHU/PULU register | Bytes |
| --- | --- | --- | --- |
| `01` | CC | CC | 1 |
| `02` | A | A | 1 |
| `04` | B | B | 1 |
| `08` | DP | DP | 1 |
| `10` | X | X | 2 |
| `20` | Y | Y | 2 |
| `40` | U | S | 2 |
| `80` | PC | PC | 2 |

Pushes process selected bits from `80` down to `01`, decrementing the active
16-bit pointer before each byte write. Words are pushed low byte first.
Pulls process bits from `01` up to `80`, reading before incrementing the active
pointer. Words are pulled high byte first. Both directions wrap at 16 bits.
Within each stored word, the high byte precedes the low byte at consecutive
addresses, with wrapping.
An empty mask performs only the two instruction fetches; a full mask transfers
12 bytes. These rules follow [Motorola's instruction definitions][instructions]
and [encoding table][encodings].

The active pointer cannot select itself; bit `40` names the other pointer.
The pushed PC is the address after the postbyte. A pulled PC replaces the
fall-through address and determines the next instruction fetch. Pulling A/B
also changes the D value derived in snapshots.

Pushes preserve every flag. Pulls preserve flags unless CC is selected; they
do not apply LDA's flag effects. CC bits 7 through 0 are E, F, H, I, N, Z, V,
and C, as defined in the [programming model][model]. All eight bits are packed
and restored as supplied. In particular, PSH does not force E, and PUL's mask
controls its transfers regardless of the restored E value.

The CPU continues to store individual Boolean flags; CC is packed only for
stack transfers. The machine language still supplies the explicit flags block.
No new public state fields, interrupt handling, or dedicated call/return
instructions are introduced.

## Access records and ownership

Each record contains both fetched bytes, followed by the ordered stack reads
or writes in `accesses`. Stack data never becomes part of `instruction.bytes`.
These are instruction-level records, with no cycle counts, dummy accesses,
or other claims of a complete hardware bus trace.

There is no stack container or depth check. Pulls read current RAM even without
a preceding push and leave bytes in place. Overlapping stack and program
addresses follow access order; instruction bytes remain captured even when
overwritten. S and U may point to overlapping memory, and equal numeric pointer
values do not make the two registers aliases. Snapshots and records remain
detached from later execution, RAM edits, reset, and JavaScript caller edits.

## Program and initial state

All numeric values below are hexadecimal. Load the following program into
zero-filled 64 KiB RAM, with reset vector `02 00` at `FFFE`:

| Address | Bytes | Instruction |
| --- | --- | --- |
| `0200` | `86 12` | `LDA #$12` |
| `0202` | `34 02` | `PSHS A` |
| `0204` | `86 34` | `LDA #$34` |
| `0206` | `36 02` | `PSHU A` |
| `0208` | `86 00` | `LDA #$00` |
| `020A` | `35 02` | `PULS A` |
| `020C` | `B7 00 80` | `STA >$0080` |
| `020F` | `37 02` | `PULU A` |
| `0211` | `B7 00 81` | `STA >$0081` |

The initial stored state is explicit:

| State | Initial value |
| --- | --- |
| A, B, DP | `56`, `78`, `12` |
| X, Y | `3456`, `789A` |
| S, U, PC | `8000`, `4000`, `0200` |
| E, F, H, I, N, Z, V, C | `0`, `0`, `1`, `0`, `1`, `0`, `1`, `1` |

D is initially `5678`, derived from A/B. These are lesson values, not reset
or power-on defaults. The factory constructs the CPU without resetting it.
`create6809StackExample()` returns fresh `{ cpu, ram, endAddress }` values,
with `endAddress = 0214`. `create6809StackExampleMemory()` loads RAM without
constructing a CPU.

## Expected execution

Every step returns `executed`. B, DP, X, and Y retain their initial values;
E, F, H, I, and C remain `0`, `0`, `1`, `0`, and `1`. Before-states are the
initial state or the preceding row's after-state. Fetched bytes are listed
in the program table above.

| Step | PC after | A | D | S | U | N | Z | V |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `0202` | `12` | `1278` | `8000` | `4000` | 0 | 0 | 0 |
| 2 | `0204` | `12` | `1278` | `7FFF` | `4000` | 0 | 0 | 0 |
| 3 | `0206` | `34` | `3478` | `7FFF` | `4000` | 0 | 0 | 0 |
| 4 | `0208` | `34` | `3478` | `7FFF` | `3FFF` | 0 | 0 | 0 |
| 5 | `020A` | `00` | `0078` | `7FFF` | `3FFF` | 0 | 1 | 0 |
| 6 | `020C` | `12` | `1278` | `8000` | `3FFF` | 0 | 1 | 0 |
| 7 | `020F` | `12` | `1278` | `8000` | `3FFF` | 0 | 0 | 0 |
| 8 | `0211` | `34` | `3478` | `8000` | `4000` | 0 | 0 | 0 |
| 9 | `0214` | `34` | `3478` | `8000` | `4000` | 0 | 0 | 0 |

Step 6 deliberately leaves Z set despite restoring nonzero A. Step 7's STA
then clears Z. This differs from [6502 PLA](../../6502/examples/stack.md), which
updates N/Z as part of the pull.

The complete ordered accesses follow; `R` means read and `W` means write.

| Step | Accesses: kind address:value |
| --- | --- |
| 1 | `R 0200:86`, `R 0201:12` |
| 2 | `R 0202:34`, `R 0203:02`, `W 7FFF:12` |
| 3 | `R 0204:86`, `R 0205:34` |
| 4 | `R 0206:36`, `R 0207:02`, `W 3FFF:34` |
| 5 | `R 0208:86`, `R 0209:00` |
| 6 | `R 020A:35`, `R 020B:02`, `R 7FFF:12` |
| 7 | `R 020C:B7`, `R 020D:00`, `R 020E:80`, `W 0080:12` |
| 8 | `R 020F:37`, `R 0210:02`, `R 3FFF:34` |
| 9 | `R 0211:B7`, `R 0212:00`, `R 0213:81`, `W 0081:34` |

Only four RAM bytes change: `7FFF` and `0080` become `12`; `3FFF` and `0081`
become `34`. The caller stops at `0214` before another fetch. A direct tenth
CPU step would execute `NEG <$00`. Tests install unsupported byte `01` at the
endpoint to check rejection independently of caller completion.

## Reset and restart

Reset follows the [existing 6809 policy](../model.md#cpu-reset).
After step 4, it reads `FFFE` then `FFFF`, returns PC to `0200`, clears DP,
and sets F/I. It preserves S = `7FFF`, U = `3FFF`, both saved bytes, and the
rest of the modeled state.

Resuming the full program uses those occupied stacks: the next saves write
at `7FFE` and `3FFE`, and the pulls return the pointers to `7FFF` and `3FFF`.
The earlier bytes remain intact. Restarting through the factory restores the
original state and RAM image in independent components. Existing records do
not change.

## Acceptance checks

- Check all 256 masks for each instruction, using independently authored push
  layouts and pull frames. Include empty/full masks, both byte widths, exact
  access order, wrapping pointers, unchanged-value writes, and retained bytes.
- Check every CC value for both stacks with CC-only and full masks, including
  E clear. Verify preservation when CC is omitted and derived D after A/B pulls.
- Check PC/postbyte wrapping, the saved next PC, and execution at a pulled PC.
  Transfer the other pointer even when S and U initially have equal values,
  then use its newly loaded value in a later stack operation.
- Exercise nested saves, stack/code overlap, rereading instruction locations
  as data, modified saved RAM, and detached records.
- Verify the full example image, nine exact records, caller completion,
  occupied-stack reset, subsequent execution, and fresh lesson restart.
- Retain rejection tests for all remaining unsupported first bytes and prefixes.

[instructions]: https://www.maddes.net/m6809pm/appendix_a.htm
[encodings]: https://www.maddes.net/m6809pm/appendix_d.htm
[model]: https://www.maddes.net/m6809pm/sections.htm
