# 8080 example: load, add, and store

**Status: implemented and tested.**
The example loads 2 into the accumulator, adds 3, stores 5 in RAM, and halts.
Its purpose is to make each instruction's state changes and memory accesses
observable and independently checkable.

The [8080 model contract](../../../../src/components/cpus/specifications/8080.md) defines state, records, and reset.
Current support is tracked in [8080 implementation coverage](../../coverage.md#8080).

[Example definition](../../../../src/machines/8080/example.machine) ·
[Example tests](../../../../tests/machines/8080/example.test.ts) ·
[CPU tests](../../../../tests/components/cpus/8080.test.ts)

## Example scope

One Intel 8080 model is connected to flat 64 KiB RAM. The program uses four
opcode forms: `MVI A,n`, `ADI n`, `STA addr`, and `HLT`. All other supported
forms are outside this example.

## Program and memory image

Addresses and bytes below are hexadecimal. The assembly operands 2 and 3 are
decimal; `0080H` denotes hexadecimal address 0080.

| Address | Bytes | Instruction | Effect |
| --- | --- | --- | --- |
| `0000` | `3E 02` | `MVI A, 2` | Load 2 into A |
| `0002` | `C6 03` | `ADI 3` | Add 3 to A and update arithmetic flags |
| `0004` | `32 80 00` | `STA 0080H` | Store A at address 0080 |
| `0007` | `76` | `HLT` | Enter the halted state |

The complete eight-byte image is:

```text
3E 02 C6 03 32 80 00 76
```

Allocate 65,536 bytes, initialize them to zero, and load this image at address
`0000`. The destination byte at `0080` starts at `00`. Loading the fixture is
setup activity and does not appear in CPU step records. An assembler is not
required for this example; the byte image is the executable fixture.

## Initial state and setup

| State | Initial value |
| --- | --- |
| A, B, C, D, E, H, L | `00` each |
| Derived BC, DE, HL | `0000` each |
| PC | `0000` |
| SP | `0000` |
| Flags S, Z, AC, P, CY | All false |
| Interrupt enable | False |
| Halted | False |

These are deliberate lesson initialization values, not a claim about all
register values after hardware power-on or reset. Flags are stored state;
initializing A to zero does not itself set Z or P.

`create8080ExampleMemory()` returns fresh RAM with the program loaded, without
creating or executing a CPU. `create8080Example()` returns fresh `{ cpu, ram }`
components with the initial state above. Setup performs no reset or execution;
the [machine definition guide](../../../machines/definitions.md) describes
how these factories are generated.

## Instruction behavior

- `MVI A,n` reads its opcode and immediate byte, writes A, advances PC by two,
  and preserves flags and the other registers.
- `ADI n` reads its opcode and immediate byte, adds the immediate to A without
  adding the incoming carry flag, stores the low eight bits in A, advances PC
  by two, and replaces all five arithmetic flags. S reflects result bit 7;
  Z indicates a zero result; AC indicates carry from bit 3 to bit 4; P indicates
  even parity of the eight-bit result; CY indicates carry beyond bit 7.
- `STA addr` reads its opcode, then the low and high address bytes, and writes
  A to that address. It advances PC by three and preserves registers and flags
  other than PC.
- `HLT` reads its opcode, advances the model's PC by one to the following
  instruction address, and sets halted. Other registers and flags are preserved.

All four preserve SP, B, C, D, E, H, L, and the interrupt-enable latch. The
instruction semantics and encodings are grounded in the Intel references below;
the record format and unsupported-opcode policy are choices for this model.

## Expected records for the program

Records use the [8080 step format](../../../../src/components/cpus/specifications/8080.md#step-records).

The initial-state table supplies the first `before` snapshot. Each following
record's `before` equals the preceding record's `after`.

| Step | `instruction.address` | `instruction.bytes` | PC after | A after | `outcome` |
| --- | --- | --- | --- | --- | --- |
| 1 | `0000` | `3E 02` | `0002` | `02` | `executed` |
| 2 | `0002` | `C6 03` | `0004` | `05` | `executed` |
| 3 | `0004` | `32 80 00` | `0007` | `05` | `executed` |
| 4 | `0007` | `76` | `0008` | `05` | `halted` |

After step 1, all flags remain false. Step 2 sets P to true because `05` has
two set bits; S, Z, AC, and CY are false. Steps 3 and 4 preserve those flags.
Halted stays false until step 4. SP, B, C, D, E, H, L, and interrupt enable
remain at their initial values throughout.

The following is the complete access list for each record, in order. `R`
denotes a read and `W` a write; the notation is `kind address:value`.

| Step | `accesses` |
| --- | --- |
| 1 | `R 0000:3E`, `R 0001:02` |
| 2 | `R 0002:C6`, `R 0003:03` |
| 3 | `R 0004:32`, `R 0005:80`, `R 0006:00`, `W 0080:05` |
| 4 | `R 0007:76` |

Memory at `0080` stays `00` until step 3, then becomes `05`. There are no other
memory writes. Together these tables and the unchanged-state rules define
the complete four records.

A fifth call follows the [already halted policy](../../../../src/components/cpus/specifications/8080.md#halt-and-unsupported-opcodes):
`outcome: halted`, `instruction: null`, equal before/after snapshots, and no
accesses. PC stays at `0008`; A and RAM retain their final values.

## Reset and restart

Reset follows the [8080 model contract](../../../../src/components/cpus/specifications/8080.md#reset).

After resetting the completed program, PC is `0000` and both control latches
are false. A and RAM at `0080` still contain `05`, and P is still true.

Restarting the lesson restores the entire specified initial state and memory
image, including clearing the result byte and flags. The caller starts a new
execution history; records retained from the prior run remain unchanged.

## Acceptance checks

Headless checks establish:

1. The exact four records and final memory above, including a fifth halted call.
2. Preservation of unrelated state by each supported instruction, using nonzero
   register values and pre-set flags so accidental clearing is detectable.
3. ADI behavior beyond the lesson's 2 + 3: carry, auxiliary carry, zero, sign,
   both parity outcomes, and replacement of old flags. In particular, `FF + 01`
   yields `00` with Z, AC, P, CY set; `7F + 01` yields `80` with S and AC set;
   `FF + 00` with incoming CY set yields `FF` with S and P set and CY cleared.
4. STA uses the low/high operand order and records only its actual write after
   the three reads; include a destination such as `1234` to exercise both bytes.
5. PC and operand fetching wrap at `FFFF`: placing `MVI A,n` at `FFFF` reads its
   immediate from `0000` and leaves PC at `0001`.
6. Unsupported opcodes, CPU reset, record independence, and inspection follow
   the [model contract](../../../../src/components/cpus/specifications/8080.md). Restart restores this example's initial
   state and memory image.
7. RAM follows its [host API contract](../../../machines/definitions.md#ram-and-cpu-ownership).

ADI checks include the explicit edge cases above and Intel's examples
`14 + 42 = 56` and `56 + BE = 14` (all hexadecimal), from the programming manual
below. An independent reference adds one binary column at a time to check all
65,536 accumulator/immediate pairs, once with all incoming flags clear and
once with them set. This gives 131,072 cases checking the result, all five
flags, and independence from incoming carry. Separate tests check exact state
and access records, preservation of unrelated state and memory, boundary
wrapping, snapshot independence, and reset versus lesson restart after addition.

STA checks cover destinations `1234`, `0000`, and `FFFF`; preservation of all
CPU state except PC; and operand fetching and PC wrapping with the instruction
at `FFFD`, `FFFE`, and `FFFF`. Tests observe actual RAM calls to check three
reads followed by exactly one write, including when the destination already
contains that value. Writing over the opcode or either operand preserves the
fetched instruction bytes in the record. Further checks cover detached write
entries, the example's complete memory image, and reset versus lesson restart
after the store.

HLT checks cover a single opcode read, PC advancement including wrapping from
`FFFF` to `0000`, preservation of unrelated state, and repeated halted steps
without RAM accesses. Reset after HLT preserves data and allows execution to
resume at `0000`. The complete example checks all four instruction records,
a fifth halted step, final memory, and lesson restart after halting.

## References

- [Intel 8080 Assembly Language Programming Manual, page 27](https://altairclone.com/downloads/manuals/8080%20Programmers%20Manual.pdf#page=33): ADI semantics and explicit arithmetic examples.
- [Intel 8080 Assembly Language Programming Manual, page 30](https://altairclone.com/downloads/manuals/8080%20Programmers%20Manual.pdf#page=36): direct-address encoding and STA semantics.
- [Intel 8080 Assembly Language Programming Manual, page 39](https://altairclone.com/downloads/manuals/8080%20Programmers%20Manual.pdf#page=45): HLT and advancement to the next instruction address.
- [Intel 8080 Microcomputer Systems User's Manual, September 1975](https://www.bitsavers.org/components/intel/MCS80/98-153B_Intel_8080_Microcomputer_Systems_Users_Manual_197509.pdf): instruction encodings and semantics.
- [Intel MCS-80 User's Manual, October 1977](https://www.bitsavers.org/components/intel/MCS80/98-153D__MCS-80_Users_Manual_Oct77.pdf): addressing and arithmetic flag definitions.
