# 68000 buffer processing through nested calls

[Model contract](../model.md#control-flow-and-subroutines) ·
[Machine definition](../../../../src/machines/68000/control-flow-example.machine) ·
[Example tests](../../../../tests/machines/68000/control-flow-example.test.ts)

This program increments four bytes, replacing any zero result with one. A
counted loop calls a transformation routine; the main program calls the loop
routine. This exercises two live return addresses, both branch displacement
sizes, a conditional branch in both directions, and DBF's low-word counter.

## Initial state and RAM

| Registers | Values |
| --- | --- |
| D0, D1, D2, D3 | `11223344`, `55667788`, `99AABBCC`, `DDEEFF00` |
| D4, D5, D6, D7 | `01234567`, `89ABCDEF`, `FEDCBA98`, `76543210` |
| A0, A1, A2, A3 | `10000000`, `20000000`, `30000000`, `40000000` |
| A4, A5, A6 | `50000000`, `60000000`, `70000000` |
| USP, SSP, PC | `34008000`, `56009000`, `AB002000` |
| interruptMask | `2` |
| IR | `0000` |
| entry.kind, entry.vector | `none`, `00` |
| halted, faulted, tracePending | `false`, `false`, `false` |
| X, N, Z, V, C, T, S | `1`, `0`, `1`, `1`, `1`, `0`, `0` |

The 16 MiB RAM image is initially zero-filled except for these blocks:

| Physical address | Contents |
| --- | --- |
| `000000` | Reset vectors `56 00 90 00 AB 00 20 00` |
| `002000` | Main program: 28 bytes |
| `002040` | Loop routine: 12 bytes |
| `002060` | Transformation routine: 14 bytes |
| `002FFE` | Guarded input: `DE AD 00 7F FF FE BE EF` |
| `003FFE` | Guarded output count: `DE AD CC CC CC CC BE EF` |
| `007FF6`, `008FF6` | Guarded stack areas: `DE AD`, eight `CC` bytes, `BE EF` |

A7 initially exposes USP. Construction does not reset or execute the CPU.
The machine definition gives literal instruction bytes alongside the mnemonics.

## Program

Every PC and branch label below has the logical prefix `AB00`. Other values
are hexadecimal; instruction counts in prose are decimal.

| PC | Instruction | Purpose |
| --- | --- | --- |
| `2000` | `MOVEA.L #AB003000,A0` | Address the buffer |
| `2006` | `MOVE.L #12340003,D1` | Four iterations; retain a distinctive upper word |
| `200C` | `MOVEQ #0,D2` | Count processed bytes |
| `200E` | `BSR.W process` | Call `2040`, saving `AB002012` |
| `2012` | `MOVE.L D2,(CD004000).L` | Store the completed count |
| `2018` | `BRA.W finished` | Branch to caller endpoint `2080` |
| `2040` | `process: BSR.B transform` | Call `2060`, saving `AB002042` |
| `2042` | `ADDI.W #1,D2` | Increment completed count |
| `2046` | `DBF D1,process` | Decrement D1.W and branch unless it becomes `FFFF` |
| `204A` | `RTS` | Return to main |
| `2060` | `transform: ADDI.B #1,(A0)` | Increment the current byte |
| `2064` | `BNE.B readback` | Skip correction when the result is nonzero |
| `2066` | `ORI.B #1,(A0)` | Replace zero with one |
| `206A` | `readback: MOVE.B (A0)+,D0` | Inspect the result and advance the buffer pointer |
| `206C` | `RTS` | Return to the loop |

BSR.W at `200E` uses base `2010` and displacement `0030`; its return address
is `2012`. The inner BSR uses base `2042` and displacement `1E`. DBF uses
base `2048` and displacement `FFF8`, taking the back edge three times. The
final BRA uses base `201A` and displacement `0066`.

## Expected execution

The program executes **36 instructions**: three setup instructions, the outer
call, seven instructions per buffer byte, one correction, the outer return,
the count store, and the final branch.

| Input byte | After ADDI | Stored byte | Conditional path | D1.W after DBF |
| --- | --- | --- | --- | --- |
| `00` | `01` | `01` | BNE taken | `0002` |
| `7F` | `80` | `80` | BNE taken | `0001` |
| `FF` | `00` | `01` | BNE untaken; execute ORI | `0000` |
| `FE` | `FF` | `FF` | BNE taken | `FFFF`; fall through |

After completion, PC is `AB002080`, A0 is `AB003004`, D0 is `112233FF`,
D1 is `1234FFFF`, and D2 is `00000004`. Other stored registers retain their
initial values. X/N/Z/V/C are clear; T/S and the interrupt mask are unchanged.
DBF preserves flags from the preceding count increment, including on expiry.

The buffer at `003000` becomes `01 80 01 FF`, and `004000` contains
`00 00 00 04`. The stack reaches USP `34007FF8` while both calls are active
and returns to `34008000`. Physical `007FF8`–`007FFF` retains the two saved
addresses as `AB 00 20 42 AB 00 20 12`; popping does not erase them. Every
other RAM byte, including guards and the inactive supervisor stack, is unchanged.

Calls record four ascending writes after fetching the complete instruction.
Returns record four ascending reads after their opcode fetch. Branches and
DBF read only their instruction bytes, with no target prefetch. Tests specify
all complete snapshots, fetched bytes, and access lists independently.

## Running, resumption, and reset

`runCpu(cpu, { maxSteps: 36, endAddress: 0xAB002080 })` returns
`stopReason: "completed"`. The physical address `002080` does not match that
logical PC. A six-instruction budget pauses after the first increment with
both return addresses live; another thirty instructions completes execution.
Restoring the snapshot with the same RAM contents reproduces those records.

External reset selects SSP `56009000`, reloads PC `AB002000`, sets S, clears
T, and sets the interrupt mask to 7. It preserves general registers and RAM.
Tests run a fresh image after reset: both calls use the supervisor stack,
which reaches `56008FF8`; the user stack remains untouched. Final data and
counter values match the user-mode run.

Acceptance checks cover full initial/final memory images, actual RAM calls,
factory isolation, pause/resume, snapshot restoration with live calls, and
detached records. An odd inner-call target stops the runner before pushing;
fixing its displacement permits resumption. A self-branch obeys the step
budget. Changing input `FF` to `10` skips correction and completes in 35 steps.

Hardware expectations follow Motorola's
[M68000 Family Programmer's Reference Manual](https://www.nxp.com/docs/en/reference-manual/M68000PRM.pdf):
Bcc (4-25–4-26), BRA (4-55), BSR (4-59–4-60), DBcc (4-90–4-91), RTS (4-169),
and condition table 3-19. Alignment rejection follows the explicit model policy.
