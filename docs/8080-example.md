# 8080 example: load, add, and store

**Status: implemented and tested.**
The complete program, step records, CPU reset, and lesson restart follow the
specification below.
Current CPU support is tracked in [8080 implementation coverage](cpu-coverage.md#8080).
Development uses TypeScript compiled to ES modules and Node.js 24's built-in
test runner; see the
[development instructions](../README.md#development).

[Example definition](../src/machines/8080/example.machine) uses the shared
[machine format](machine-definitions.md).

The example loads 2 into the accumulator, adds 3, stores 5 in RAM, and halts.
Its purpose is to make each instruction's state changes and memory accesses
observable and independently checkable.

## Model boundary

- One Intel 8080 model connected to flat **64 KiB of RAM**.
- One call to `step()` executes at most one instruction.
- The example uses four opcode forms: `MVI A,n`, `ADI n`, `STA addr`, and `HLT`.
  Other forms of `MVI` are outside this first subset.
- Instruction-level execution and access records. Cycle timing, electrical bus
  activity, interrupts, devices, and browser controls are outside this slice.
- The interrupt-enable latch is represented but initially false; no interrupt
  inputs or instructions that enable interrupts are implemented in this slice.

This contract is specific to the first 8080 example. Shared conventions remain
provisional while [focused examples exercise all three CPUs](cpu-roadmap.md).

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

## Initial state and ownership

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

The CPU owns its registers, flags, interrupt-enable latch, and halted state.
RAM owns the bytes. The example setup owns allocation, program loading, and
deterministic initialization. The CPU accesses RAM through byte reads and
writes; it does not own program loading or lesson restart.

The implemented memory API is `new Ram(size)`, with a read-only `size` getter,
`read(address)`, and `write(address, value)`. Storage is private and initially
zeroed. Size must be a positive safe integer; invalid sizes, addresses, and
byte values throw `RangeError`. `create8080ExampleMemory()` returns a fresh
RAM instance with the program loaded. It does not create or execute a CPU.

Values exposed in records are numbers, with byte values in `00`–`FF` and
addresses in `0000`–`FFFF`. Hexadecimal formatting belongs to presentation.
CPU arithmetic and PC advancement wrap to their hardware widths. RAM's host
API rejects non-integer or out-of-range addresses and byte values, so caller
errors are not silently wrapped by the memory component.

## Current API

`new Cpu8080(ram, initialState)` connects the CPU to exactly 64 KiB of RAM and
copies only the declared model fields into new plain objects. Extra properties
are ignored; declared fields may be supplied through getters. The TypeScript
state fields are `a`, `b`, `c`, `d`, `e`, `h`, `l`, `pc`, `sp`, `flags`,
`interruptEnabled`, and `halted`;
flags have fields `s`, `z`, `ac`, `p`, and `cy`. Registers must be integers in
their byte or 16-bit ranges, otherwise construction throws `RangeError`.
Flags and control latches must be booleans, otherwise it throws `TypeError`.

- `snapshot()` returns an independent, readonly state copy without accessing RAM,
  including derived BC, DE, and HL views. Their ownership and initialization
  rules are specified in the [register-pair example](8080-register-pairs-example.md#register-views-and-ownership).
- `step()` executes the forms in the [coverage inventory](cpu-coverage.md#8080)
  and returns `unsupported` for other opcodes. Executing `HLT` returns `halted`
  with its instruction; subsequent calls return `halted` without fetching.
- `reset()` applies only the CPU reset changes specified below and returns a
  reset record with before/after snapshots and an empty access list.
- `create8080Example()` returns fresh `{ cpu, ram }` components with the
  specified initial state and program. Call it again to restart the lesson;
  the previous components and records remain available to their caller.

## Instruction behavior for this example

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

## Step record

`step()` updates the model and returns one record with the following fields.
These are provisional field names for the 8080, not a platform-wide CPU API.

| Field | Meaning |
| --- | --- |
| `instruction` | Object with `address` and `bytes`, or null if already halted |
| `before` | Snapshot of all CPU state listed in the initial-state table |
| `after` | Snapshot of the same state after this call |
| `accesses` | Ordered list of `{ kind, address, value }` entries; kind is `read` or `write` |
| `outcome` | `executed`, `halted`, or `unsupported` |
| `reason` | `opcode` for unsupported records; absent for other outcomes |

Instruction bytes and read values come from the actual reads made during the
step. A write entry contains the value written. Capturing a record must not
perform extra memory reads; in particular, it does not read the old value of a
write destination just to report it. Both opcode and operand reads are included.

The CPU snapshots do not copy RAM. Each record owns detached snapshots, byte
arrays, and access entries, independent of live state and other records. Later
execution or restart cannot change an earlier record, and modifying a returned
record cannot mutate the CPU or RAM.
Inspecting state outside execution must not add accesses to a step record.

Public snapshots and records are readonly in TypeScript, including nested
flags, instruction bytes, access arrays, and their entries. `Cpu8080State`
remains the mutable state shape for initialization and the CPU's internal
storage; `Cpu8080Snapshot` is its readonly public view with derived pair fields.
Readonly is a compiler check, not runtime freezing. Copies still provide isolation if JavaScript
code or a deliberate type-check bypass edits a returned value.

`Cpu8080StepRecord` is a discriminated union on `outcome`. Executed and
unsupported records always contain an instruction. Halted records permit
null for an already halted CPU, or an instruction when executing `HLT`.
Each call to `step()` returns a complete record.

These entries describe the accesses required by this instruction-level model.
They do not claim to reproduce every electrical bus operation or idle cycle.
No cycle-count or elapsed-time field is specified in this first record.

## Expected records for the program

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

## Halt and unsupported opcodes

Calling `step()` when already halted returns `outcome: halted`,
`instruction: null`, equal before/after snapshots, and an empty access list.
It performs no fetch and does not advance PC. Thus a fifth call after this
program leaves PC at `0008` and A and RAM at their final values.

Interrupt inputs are outside this model. Setting the initial interrupt-enable
latch to true does not itself resume a halted CPU; `reset()` clears the halted
state, and restarting the lesson creates a fresh CPU.

For any opcode outside the [coverage inventory](cpu-coverage.md#8080), return
`outcome: unsupported` with `reason: opcode`.
The instruction field contains the attempted address and the single opcode byte;
the access list contains just that opcode read. PC and all other CPU state,
and all RAM, remain unchanged. No operands are fetched and no instruction is
silently skipped. A caller running repeatedly must stop on this outcome.

For example, `00` is a valid 8080 NOP but is unsupported in this first subset.
With PC at a zero-filled location, the result reports that address and byte,
and keeps PC there. Repeating the call repeats that read and result; this is
a reported limitation, not a hardware fault or a latched CPU halt.

Invalid calls to the host RAM API are programming errors and are separate
from the guest's `unsupported` outcome.

## CPU reset and lesson restart

CPU reset affects the CPU's modeled reset state: PC becomes `0000`, interrupt
enable becomes false, and halted becomes false. It preserves A, B, C, D, E,
H, L, SP, and the arithmetic flags. It does not read, clear, or reload RAM.
This follows the 8080 reset distinction in the Intel hardware reference.

`reset()` returns a `Cpu8080ResetRecord` with detached `before` and `after`
snapshots and an empty `accesses` list. It has the same readonly and ownership
guarantees as step records, but no `instruction`, `outcome`, or `reason`.
Repeated resets leave the reset state unchanged and return fresh records.

After resetting the completed program, A and RAM at `0080` therefore still
contain `05`, and P is still true.

Restarting the lesson restores the entire specified initial state and memory
image, including clearing the result byte and flags. The caller starts a new
execution history; records retained from the prior run remain unchanged.

## Acceptance checks and implementation order

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
6. Unsupported opcodes, CPU reset, lesson restart, record independence, and
   inspection follow the contracts above.
7. RAM enforces its byte and address bounds and rejects invalid host values.

The implementation order was RAM and fixture setup; CPU state, stepping, and
reset with `MVI A,n`; `ADI n` and its flags; `STA addr`; then `HLT` and the
completed example.

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

Changes remain uncommitted until maintainer review and an explicit go-ahead
to commit, as recorded in [AGENTS.md](../AGENTS.md).

## References

- [Intel 8080 Assembly Language Programming Manual, page 27](https://altairclone.com/downloads/manuals/8080%20Programmers%20Manual.pdf#page=33): ADI semantics and explicit arithmetic examples.
- [Intel 8080 Assembly Language Programming Manual, page 30](https://altairclone.com/downloads/manuals/8080%20Programmers%20Manual.pdf#page=36): direct-address encoding and STA semantics.
- [Intel 8080 Assembly Language Programming Manual, page 39](https://altairclone.com/downloads/manuals/8080%20Programmers%20Manual.pdf#page=45): HLT and advancement to the next instruction address.
- [Intel 8080 Microcomputer Systems User's Manual, September 1975](https://www.bitsavers.org/components/intel/MCS80/98-153B_Intel_8080_Microcomputer_Systems_Users_Manual_197509.pdf): instruction encodings and semantics.
- [Intel MCS-80 User's Manual, October 1977](https://www.bitsavers.org/components/intel/MCS80/98-153D__MCS-80_Users_Manual_Oct77.pdf): addressing and arithmetic flag definitions.
- [Intel Intellec 8/MOD 80 Reference Manual, February 1975](https://bitsavers.org/components/intel/MCS80/Intellec_8_Mod_80/Intel_Intellec_8_Mod_80_Reference_Manual_Feb75.pdf): 8080 functional pin definitions, especially RESET and INTE.
