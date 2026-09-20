# 8080 example: memory addressing through HL

This example uses the [HL register pair](register-pairs.md) to
copy a byte to the next memory address. Current support is tracked in
[8080 implementation coverage](../../coverage.md#8080).

[Example definition](../../../../src/machines/8080/addressing-example.machine) ·
[Example tests](../../../../tests/machines/8080/addressing-example.test.ts) ·
[CPU tests](../../../../tests/components/cpus/8080.test.ts)

## Program and initial state

All register values, addresses, and bytes here are hexadecimal.

| Address | Bytes | Instruction | Effect |
| --- | --- | --- | --- |
| `0000` | `21 FF 12` | `LXI H,12FFH` | Set HL to the source address |
| `0003` | `7E` | `MOV A,M` | Read `A5` from `12FF` into A |
| `0004` | `23` | `INX H` | Advance HL to `1300`, carrying from L into H |
| `0005` | `77` | `MOV M,A` | Write A to `1300` |
| `0006` | `76` | `HLT` | Advance PC to `0007` and halt |

Allocate 65,536 zeroed RAM bytes. Load `21 FF 12 7E 23 77 76` at `0000`
and `A5` at `12FF`. The destination at `1300` starts at zero. Loading the
image is setup activity and does not appear in CPU step records.

| Stored state | Initial value |
| --- | --- |
| A | `11` |
| B, C | `22`, `33` |
| D, E | `44`, `55` |
| H, L | `66`, `77` |
| PC | `0000` |
| SP | `ABCD` |
| S, Z, AC, P, CY | `1`, `0`, `1`, `0`, `1` |
| Interrupt enable, halted | False, false |

Initial snapshots show BC = `2233`, DE = `4455`, and HL = `6677`. These
values are deliberate lesson setup, not hardware power-on defaults.

`create8080AddressingExampleMemory()` returns the loaded RAM without a CPU.
`create8080AddressingExample()` returns fresh `{ cpu, ram }` components with
the state above, without reset or execution.

## Instruction behavior

In Intel assembly, `M` names the memory byte addressed by HL. H supplies the
high byte and L the low byte. `MOV A,M` (`7E`) copies that byte into A;
`MOV M,A` (`77`) copies A to that location. Both preserve HL and every flag.
The source is unchanged. These behaviors and encodings follow Intel's
[MOV description](https://altairclone.com/downloads/manuals/8080%20Programmers%20Manual.pdf#page=22)
and [opcode table](https://altairclone.com/downloads/manuals/8080%20Programmers%20Manual.pdf#page=78).

Each instruction fetches one opcode byte and advances PC by one, wrapping
`FFFF` to `0000`. It then performs one data read or write at the current HL.
The store does not read its destination, and writes even if that byte already
equals A. Neither operation increments HL; the example uses INX explicitly.
Other registers and control state are preserved.

The data byte belongs only in the access record, not in `instruction.bytes`.
HL may address any RAM byte, including the opcode or the following instruction.
A load from its own opcode records two reads of the same address. A store
may overwrite code; its captured opcode stays unchanged, and the next step
fetches the current RAM contents. These are instruction-level records, with
no cycle counts, dummy bus accesses, or electrical activity.

## Expected records

Records use the [8080 step format](../../../../src/components/cpus/specifications/8080.md#step-records). The first
`before` snapshot is the initial state above; subsequent `before` snapshots
equal the previous `after`. The table lists all changed fields. B, C, D, E,
BC, DE, SP, flags, and interrupt enable retain their initial values.

| Step | Instruction address | Instruction bytes | PC after | A after | H after | L after | HL after | Halted after | Outcome |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `0000` | `21 FF 12` | `0003` | `11` | `12` | `FF` | `12FF` | False | `executed` |
| 2 | `0003` | `7E` | `0004` | `A5` | `12` | `FF` | `12FF` | False | `executed` |
| 3 | `0004` | `23` | `0005` | `A5` | `13` | `00` | `1300` | False | `executed` |
| 4 | `0005` | `77` | `0006` | `A5` | `13` | `00` | `1300` | False | `executed` |
| 5 | `0006` | `76` | `0007` | `A5` | `13` | `00` | `1300` | True | `halted` |

The complete ordered access lists follow. `R address:value` denotes a byte
read and `W address:value` a byte write; there are no additional accesses.

| Step | Accesses |
| --- | --- |
| 1 | `R 0000:21`, `R 0001:FF`, `R 0002:12` |
| 2 | `R 0003:7E`, `R 12FF:A5` |
| 3 | `R 0004:23` |
| 4 | `R 0005:77`, `W 1300:A5` |
| 5 | `R 0006:76` |

Only RAM at `1300` changes, from `00` to `A5`; the source remains `A5`.
A sixth step returns `halted` with `instruction: null`, identical before/after
snapshots, and no accesses.

## Reset and restart

Reset sets PC to `0000` and clears halted and interrupt enable, preserving
A = `A5`, HL = `1300`, the other registers, flags, and RAM, including the copied
byte. It records no memory accesses. Execution can resume with the current
program and data. Restarting the lesson creates new components with the
original state and image; previous components and captured records remain
independent.

## Acceptance checks

- Verify the entire initial and final RAM images, all five exact records,
  and the subsequent halted call.
- Exercise both MOV forms with asymmetric HL bytes, page boundaries, `0000`,
  `8000`, and `FFFF`; include zero and high-bit data and each flag set and clear.
- Verify exactly one data access after the opcode fetch, no operand fetch,
  no destination read on stores, unchanged HL, and PC wrapping from `FFFF`.
- Read current RAM after caller edits; retain the loaded byte in A if its
  source changes before a later store.
- Read or overwrite instruction bytes while keeping data accesses separate
  from captured instruction bytes; execute newly written code on the next step.
- Exercise load, INX, and store across `FFFF → 0000`, as well as the lesson's
  `12FF → 1300` boundary. Keep captured records independent of later activity.
- Check reset preservation, fresh lesson restart, and every remaining
  unsupported opcode through the public CPU stepping API.
