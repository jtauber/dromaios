# 8080 example: register pairs

This focused example follows the [load, add, and store example](8080-example.md).
It shows how the same stored bytes can be inspected and changed as a 16-bit
register pair. Current support is tracked in [8080 implementation coverage](cpu-coverage.md#8080).

[Example definition](../src/machines/8080-register-pairs-example.machine) ·
[Example tests](../tests/machines/8080-register-pairs-example.test.ts) ·
[CPU tests](../tests/components/cpus/8080.test.ts)

## Register views and ownership

The CPU stores B, C, D, E, H, and L as individual bytes. Its snapshots also
contain these derived numeric views:

| Snapshot field | High byte | Low byte |
| --- | --- | --- |
| `bc` | B | C |
| `de` | D | E |
| `hl` | H | L |

For example, H = `12` and L = `FF` give HL = `12FF`. SP is a separately
stored 16-bit register. Intel assembly names the pairs `B`, `D`, and `H`;
the snapshot names `bc`, `de`, and `hl` show both component registers.

`Cpu8080State` continues to describe stored state. Construction accepts those
fields without requiring pair values. `Cpu8080Snapshot` adds readonly `bc`,
`de`, and `hl`, including in step and reset records. Pair values supplied by
a JavaScript caller or an existing snapshot are ignored when constructing a
CPU; only the stored bytes are copied and validated. Extra pair getters are
never evaluated.

Each snapshot owns plain numeric values, as with the [6809's D view](6809-example.md#state-initialization-and-ownership).
Later execution leaves those values unchanged. Deliberately bypassing
TypeScript readonly checks to edit snapshot bytes does not recalculate that
snapshot's pair fields or affect the CPU. Inspection performs no RAM accesses.

## Program and initial state

All register values, addresses, and bytes here are hexadecimal.

| Address | Bytes | Instruction | Effect |
| --- | --- | --- | --- |
| `0000` | `21 FF 12` | `LXI H,12FFH` | Set H = `12`, L = `FF`, and therefore HL = `12FF` |
| `0003` | `23` | `INX H` | Set H = `13`, L = `00`, and therefore HL = `1300` |
| `0004` | `76` | `HLT` | Advance PC to `0005` and halt |

Allocate 65,536 zeroed RAM bytes and load `21 FF 12 23 76` at `0000`.
The program performs no memory writes. Loading the image is setup activity
and does not appear in CPU step records.

| Stored state | Initial value |
| --- | --- |
| A | `11` |
| B, C | `22`, `33` |
| D, E | `44`, `55` |
| H, L | `66`, `77` |
| PC | `0000` |
| SP | `ABCD` |
| S, Z, AC, P, CY | True, false, true, false, true |
| Interrupt enable, halted | False, false |

Initial snapshots therefore show BC = `2233`, DE = `4455`, and HL = `6677`.
The nonzero registers and mixed flags make preservation visible. These values
are deliberate lesson setup, not hardware power-on defaults.

`create8080RegisterPairsExampleMemory()` returns the loaded RAM without a CPU.
`create8080RegisterPairsExample()` returns fresh `{ cpu, ram }` components in
the state above, without calling reset or executing instructions.

## Instruction behavior

LXI reads its opcode, then the low and high immediate bytes, and replaces the
selected pair or SP. PC advances by three. INX reads only its opcode and
increments the selected 16-bit value, wrapping `FFFF` to `0000`; PC advances
by one. Both preserve every flag and all unrelated registers and control
state. Operand fetching and PC advancement wrap at the 16-bit address boundary.
These behaviors follow Intel's [LXI description](https://altairclone.com/downloads/manuals/8080%20Programmers%20Manual.pdf#page=32)
and [INX description](https://altairclone.com/downloads/manuals/8080%20Programmers%20Manual.pdf#page=30).

All B, D, H, and SP forms of both instructions follow this contract, although
the program uses only H. Incrementing SP here performs no stack memory access.
The instruction-level access records omit timing, dummy bus accesses, and
electrical activity, as in the introductory example.

## Expected records

Records retain the [8080 step format](8080-example.md#step-record). The first
`before` snapshot is the initial state above; each following `before` equals
the previous `after`. The table lists every changed field. A, B, C, D, E, BC,
DE, SP, all flags, and interrupt enable remain at their initial values.

| Step | Instruction address | Instruction bytes | PC after | H after | L after | HL after | Halted after | Outcome |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `0000` | `21 FF 12` | `0003` | `12` | `FF` | `12FF` | False | `executed` |
| 2 | `0003` | `23` | `0004` | `13` | `00` | `1300` | False | `executed` |
| 3 | `0004` | `76` | `0005` | `13` | `00` | `1300` | True | `halted` |

The complete ordered access lists are below. `R address:value` denotes a byte
read. There are no writes or reads beyond these entries.

| Step | Accesses |
| --- | --- |
| 1 | `R 0000:21`, `R 0001:FF`, `R 0002:12` |
| 2 | `R 0003:23` |
| 3 | `R 0004:76` |

A fourth call returns `halted` with `instruction: null`, identical before/after
snapshots, and no accesses. The [unsupported-opcode policy](8080-example.md#halt-and-unsupported-opcodes)
is unchanged for forms outside the coverage inventory.

## Reset and restart

Reset after this program sets PC to `0000` and clears the halted and
interrupt-enable latches. It preserves H = `13`, L = `00`, HL = `1300`, the
other data registers and pair views, SP, flags, and RAM. Its separate record
contains before/after snapshots and no accesses. Execution can then resume
from the current bytes at `0000`.

Restarting the example creates new CPU and RAM instances with the original
program and initial state, including HL = `6677`. Previous components and
captured records remain independent.

## Acceptance checks

- Verify the entire initial RAM image, all three exact records, the additional
  halted call, and the unchanged final RAM image.
- Check all four LXI forms with asymmetric bytes, zero, and high-bit values;
  preserve unrelated state and observe exactly three RAM reads.
- Check all four INX forms at ordinary values, byte carries, `7FFF → 8000`,
  and `FFFF → 0000`, with each flag both set and clear. Observe one read only.
- Exercise LXI at `FFFD`, `FFFE`, and `FFFF`, and INX at `FFFF`, checking
  wrapped operand reads and the resulting PC.
- Verify pair ordering and unsigned values, construction from stored state
  and snapshots, ignored pair getters, and single reads of stored-field getters.
- Check detached pair views across successive instructions, reset, restart,
  and caller edits; enforce readonly views in [public type checks](../tests/types/8080.ts).
- Continue checking every unimplemented opcode against the unsupported policy
  and preserve the introductory arithmetic example's behavior.
