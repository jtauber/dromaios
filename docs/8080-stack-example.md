# 8080 example: stack round-trip

This example builds on the [register-pair example](8080-register-pairs-example.md).
It saves BC on a RAM stack, clears the pair, and restores it. The records show
how SP selects memory and how stack data reads differ from instruction fetching.
Current support is tracked in [8080 implementation coverage](cpu-coverage.md#8080).

[Example definition](../src/machines/8080-stack-example.machine) ·
[Example tests](../tests/machines/8080-stack-example.test.ts) ·
[CPU tests](../tests/components/cpus/8080.test.ts)

## Program and initial state

All addresses, bytes, and register values below are hexadecimal.

| Address | Bytes | Instruction | Effect |
| --- | --- | --- | --- |
| `0000` | `31 00 20` | `LXI SP,2000H` | Set SP to `2000` |
| `0003` | `01 34 12` | `LXI B,1234H` | Set BC to `1234` |
| `0006` | `C5` | `PUSH B` | Save BC on the stack; SP becomes `1FFE` |
| `0007` | `01 00 00` | `LXI B,0000H` | Clear BC while its saved bytes remain in RAM |
| `000A` | `C1` | `POP B` | Restore BC to `1234`; SP returns to `2000` |
| `000B` | `76` | `HLT` | Advance PC to `000C` and halt |

Allocate 65,536 zeroed RAM bytes and load the twelve-byte image
`31 00 20 01 34 12 C5 01 00 00 C1 76` at `0000`. Stack locations `1FFE`
and `1FFF` begin at zero. Loading the image is setup activity, outside the
CPU's execution records.

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

Snapshots initially show BC = `2233`, DE = `4455`, and HL = `6677`.
The lesson deliberately starts with SP at `ABCD` so its explicit initialization
is visible. These are lesson values, not hardware power-on defaults.

`create8080StackExampleMemory()` returns the loaded RAM without creating a CPU.
`create8080StackExample()` returns fresh `{ cpu, ram }` components in the state
above, without resetting or executing the CPU. State ownership and derived
views follow the [register-pair contract](8080-register-pairs-example.md#register-views-and-ownership).

## Stack instruction behavior

PUSH and POP each occupy one instruction byte. They advance PC by one and
preserve all flags, the accumulator, unrelated register pairs, and control
latches. B, D, and H select BC, DE, and HL respectively. The PSW forms remain
unsupported pending packed-flag support; they follow the existing
[unsupported-opcode policy](8080-example.md#halt-and-unsupported-opcodes).

PUSH writes the pair's high byte at `SP−1`, then its low byte at `SP−2`,
leaving SP at `SP−2`. The pair is unchanged. POP reads the low byte at SP,
then the high byte at `SP+1`, replaces the pair, and leaves SP at `SP+2`.
POP does not erase the saved memory. These behaviors follow Intel's
[PUSH and POP descriptions, pages 22–23](https://altairclone.com/downloads/manuals/8080%20Programmers%20Manual.pdf#page=28).

SP arithmetic and PC advancement wrap independently at 16 bits. There is no
separate stack allocation or tracked depth: POP reads RAM at SP even without
a preceding PUSH. Stack memory can overlap program bytes. A PUSH that
overwrites its opcode still reports the byte already fetched; a POP whose
stack overlaps its opcode reads that location again as data.

## Expected records and memory

The [8080 record format](8080-example.md#step-record) is unchanged. Only
instruction fetches contribute to `instruction.bytes`. Stack reads and writes
appear in `accesses`, in the order they occur. Thus POP records one instruction
byte and three accesses: the opcode read and two data reads. No extra read is
performed to inspect a write destination. These are instruction-level records;
timing and dummy bus accesses remain outside their scope.

The first `before` snapshot is the initial state above. Each following `before`
equals the previous `after`. A, D, E, H, L, DE, HL, all flags, and interrupt
enable remain at their initial values throughout.

| Step | Instruction address | Instruction bytes | PC after | B after | C after | BC after | SP after | Outcome |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `0000` | `31 00 20` | `0003` | `22` | `33` | `2233` | `2000` | `executed` |
| 2 | `0003` | `01 34 12` | `0006` | `12` | `34` | `1234` | `2000` | `executed` |
| 3 | `0006` | `C5` | `0007` | `12` | `34` | `1234` | `1FFE` | `executed` |
| 4 | `0007` | `01 00 00` | `000A` | `00` | `00` | `0000` | `1FFE` | `executed` |
| 5 | `000A` | `C1` | `000B` | `12` | `34` | `1234` | `2000` | `executed` |
| 6 | `000B` | `76` | `000C` | `12` | `34` | `1234` | `2000` | `halted` |

Halted remains false until step 6. A seventh call returns `halted` with
`instruction: null`, identical before/after snapshots, and no accesses.

The complete ordered access lists follow. `R` means read and `W` means write;
each entry is `kind address:value`.

| Step | Accesses |
| --- | --- |
| 1 | `R 0000:31`, `R 0001:00`, `R 0002:20` |
| 2 | `R 0003:01`, `R 0004:34`, `R 0005:12` |
| 3 | `R 0006:C5`, `W 1FFF:12`, `W 1FFE:34` |
| 4 | `R 0007:01`, `R 0008:00`, `R 0009:00` |
| 5 | `R 000A:C1`, `R 1FFE:34`, `R 1FFF:12` |
| 6 | `R 000B:76` |

The only memory changes are `1FFF = 12` and `1FFE = 34` during step 3.
Both bytes remain after POP and HLT. The program and all other RAM retain
their initial contents.

## Reset and restart

CPU reset sets PC to `0000` and clears halted and interrupt enable, preserving
the register pairs, SP, flags, and RAM. Its separate record has no accesses.
Reset immediately after PUSH therefore leaves SP at `1FFE` with the saved
bytes intact. If execution resumes at `0000`, the program's first LXI sets
SP to `2000`; that change belongs to the instruction, not to reset.

Restarting the example creates independent CPU and RAM instances with the
original image and initial state, including BC = `2233`, SP = `ABCD`, and
zeroed stack locations. Earlier components and records remain unchanged.

## Acceptance checks

- Verify the full initial memory image, all six exact records, the additional
  halted call, and the final memory image containing only the two stack writes.
- Check all three register-pair forms of PUSH and POP with asymmetric bytes,
  zero, and high-bit values. Preserve each flag with both initial values and
  check all unrelated state and derived views.
- Observe actual RAM calls to verify PUSH writes high then low, POP reads low
  then high, unchanged-value pushes still write, and POP performs no writes.
- Exercise SP wrapping in both directions and PC wrapping at `FFFF`.
- Verify nested pushes and pops across different pairs use the same stack and
  restore words in last-in, first-out order.
- Check stack/program overlap, retained instruction bytes after self-overwrite,
  and repeated reads when an opcode also serves as stack data.
- Modify saved RAM before POP to prove it reads current memory. Keep captured
  records independent of RAM edits, later execution, reset, and caller edits.
- Verify reset with an occupied stack, execution after reset, and lesson restart.
  Retain rejection checks for every unimplemented opcode, including PSW forms.
