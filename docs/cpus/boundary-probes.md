# CPU boundary probes

This reviews the [first shared operations](shared-operation-blocks.md) against
[stage 3 of the proposal](shared-building-blocks.md#3-review-the-boundaries-and-probe-future-cpus).
Existing cores remain unchanged. Three new regression tests cover partial
execution; the 6507 and 4004 examples below are **hand-worked design traces**,
not implemented CPUs. These probes do not implement I/O, interrupts, or
exception delivery; that work follows the separate [completion plan](completion.md).
Numbers in traces are hexadecimal, except widths and numbered steps.

The useful distinction is between a **register view**, a **resolved location**,
and a **captured value**. They have different lifetimes. Neither an address
nor a callback alone establishes when a value was read or when an update commits.

## Existing models: executable evidence

| Probe | Evidence | Constraint on sharing |
| --- | --- | --- |
| 6502 JSR with stack/code overlap | Existing success tests; new failures at both pushes and the final fetch | Fetch operands where the instruction requires them |
| 6502 memory ASL | Existing failures at both writes | Apply C and N/Z at separate points |
| 6809 CMPX/STX with `,X++` | Existing alias and failure tests | Resolve the address before capturing the register value |
| 8088 word moves at address boundaries | Existing wrapping tests; new failures at either data byte | Advance the logical offset before mapping each byte |
| 68000 MOVE with auto-updates | Existing alias/alignment tests; new failures at every source/destination byte | Distinguish pending updates, committed updates, and completed memory accesses |

The [6502 tests](../../tests/components/cpus/6502.test.ts),
[6809 tests](../../tests/components/cpus/6809.test.ts),
[8088 tests](../../tests/components/cpus/8088), and
[68000 tests](../../tests/components/cpus/68000.test.ts) check public snapshots
and actual RAM calls. Host errors below throw out of `step()` without returning
a step record. The independent RAM observer records completed accesses only.
These tests preserve existing software behavior; they do not specify hardware
bus faults, instruction timing, or a new rollback policy.

### 6502: a location can change after another byte was captured

Start with PC=`01FD`, SP=`FF`, and code `20 44 55` (JSR).
The [current instruction](../../src/components/cpus/6502.ts) performs:

| Step | Access | State/value captured after success |
| --- | --- | --- |
| 1 | Read `01FD` → `20` | PC=`01FE`; opcode captured |
| 2 | Read `01FE` → `44` | PC=`01FF`; target low=`44` |
| 3 | Write `01FF` ← `01` | SP=`FE`; target high in RAM replaced |
| 4 | Write `01FE` ← `FF` | SP=`FD`; target low in RAM replaced |
| 5 | Read `01FF` → `01` | Fetch advances PC to `0200`; jump then sets PC=`0144` |

The returned instruction bytes are `20 44 01`. All flags remain unchanged.
The new test injects failure before each of steps 3–5. PC remains `01FF`;
SP is respectively `FF`, `FE`, or `FD`. Only earlier writes survive.

A resolved location for `01FE` cannot substitute for the captured `44`.
An eager fetch of `55` cannot substitute for the later read of `01`.
Keep JSR's ordered body explicit; do not extend `modifyByte` to describe it.

### 8088: resolve a segmented location, not one physical word address

Two independently listed mappings in the [tests](../../tests/components/cpus/8088):

| Segment:offset | Low-byte bus address | High-byte bus address |
| --- | --- | --- |
| `1234:FFFF` | `2233F` | `12340` |
| `FFFF:000F` | `FFFFF` | `00000` |

For `MOV AX,[offset]` (`A1`) or `MOV [offset],AX` (`A3`), CS=`0000`,
IP=`0100`, AX=`A55A`, and data bytes initially `34 12`:

1. Fetch opcode, offset low, and offset high at `0100`–`0102`; IP becomes `0103`.
2. Capture the segment/offset and, for a store, the source word.
3. Access the low byte, then the high byte, mapping each logical offset.
4. A load writes AX only after both reads succeed; a store preserves AX.

The new test fails either data access in both mappings and both directions.
IP remains `0103`, AX and all flags remain unchanged. A failed second store
leaves the first byte `5A`; a failed first store leaves both bytes intact.
No failed access or later access appears in the observer's log.

The existing XCHG test also checks that writing an address register does not
retarget an already resolved memory destination. The current callback operand
captures its location and reads its value only when invoked. Preserve that
distinction if the location becomes structured data.

### 68000: validation and host failure have different boundaries

Use `MOVE.L (A0)+,(A1)+` (`22D8`), PC=`AB001000`, A0=`AB020000`,
A1=`CD030000`, source bytes `12 34 56 78`, and destination bytes all `CC`.
The [current MOVE body](../../src/components/cpus/68000.ts) orders effects as follows:

1. Fetch `22 D8` at bus addresses `001000`, `001001`; advance the local cursor only.
2. Resolve source=`AB020000`; propose A0=`AB020004`; check source alignment.
3. Read four source bytes at `020000`–`020003`, high first; capture `12345678`.
4. Resolve destination=`CD030000`; propose A1=`CD030004`; check destination alignment.
5. Commit both address updates.
6. Write four destination bytes at `030000`–`030003`, high first.
7. Set N/Z/V/C to zero, preserve X/system flags; commit PC=`AB001002`.

| Stopping point | Stored registers/flags | Retained memory effects |
| --- | --- | --- |
| Odd source rejected | Entire initial state | Opcode reads only |
| Odd destination rejected | Entire initial state | Opcode and all source reads |
| Any source read throws | Entire initial state | Earlier reads only |
| Any destination write throws | A0/A1 advanced; PC and flags unchanged | All source reads and earlier destination writes |

The new test covers all eight data-access failure positions. Existing tests
cover odd addresses and later addressing that uses a pending source increment.
`MOVEA.W (A0)+,A0` also verifies that the final destination write wins over the
increment. Pending values need a defined lookup and commit scope; they are
neither ordinary live register values nor general instruction transactions.

## 6507: family reuse with address projection

The manufacturer's [6507 pinout and features][mos] (printed page 2-23) show
an eight-bit data bus, A0–A12, and no IRQ/NMI inputs. The following is a
proposed binding of our current instruction-level 6502 subset:

```text
family MOS6507 uses MOS6502 {
  MEMORY.address = logical[12:0]
  external IRQ, NMI = absent
}
```

This is illustrative syntax. Inherit the full stored state, including the
16-bit PC. Map every instruction, data, stack, and vector access, immediately
before the external memory operation. Do not map values loaded into PC.
For this probe, ordinary access records contain bus addresses; the instruction
start and snapshots retain logical addresses. Dummy reads remain outside the
inherited model. A complete future family must retain software BRK semantics;
the current subset still defers BRK and interrupt delivery.

These independent traces derive from that binding and the
[current 6502 contract](6502/model.md). `R logical/bus → value` and
`W logical/bus ← value` denote complete accesses in order. Each case preserves
unmentioned state; N/Z entries below replace only those two flags.

| Case | Ordered accesses | Subsequent state changes |
| --- | --- | --- |
| LDA immediate at `1FFF` | R `1FFF/1FFF` → `A9`; R `2000/0000` → `7F` | PC=`2001`, A=`7F`, N=0, Z=0 |
| LDA absolute at `A000` | R `A000/0000` → `AD`; R `A001/0001` → `34`; R `A002/0002` → `F2`; R `F234/1234` → `A5` | PC=`A003`, A=`A5`, N=1, Z=0 |
| PHA at `B000`, A=`5A`, SP=`00` | R `B000/1000` → `48`; W `0100/0100` ← `5A` | PC=`B001` after fetch; SP=`FF` after write; flags preserved |
| Reset, SP=`02` | R `FFFC/1FFC` → `78`; R `FFFD/1FFD` → `F0` | After both reads: PC=`F078`, I=1, SP=`FF` |

This exposes a concrete integration gap: `Cpu6502` requires 64 KiB RAM and
records addresses before any external RAM subclass could project them. A
subclass masking RAM accesses alone would retain logical addresses in records.
A future family binding needs mapping at the recording boundary for **step
and reset**, with an 8 KiB memory contract. No such binding is added here.

## 4004: independent widths and retained selection

The [Intel programming manual][mcs4] specifies nibble registers, byte
instructions, a 12-bit PC, and three saved return addresses (§§2.1–2.4).
Its ADD/FIM/JMS/BBL rules and persistent DCL/SRC selection (§§3.4, 3.6, 3.8,
3.10–3.11) supply the constraints for these authored traces.

### Arithmetic and register views

Two boundary calculations for ADD: `A=F, R2=0, C=1 → A=0, C=1`;
`A=7, R2=8, C=0 → A=F, C=0`. R2 is preserved. There is no eight-bit
sign/zero/parity flag update to reuse here.

For `FIM 0P,95` at PC=`FFE`, fetch bytes `20 95` at `FFE`, `FFF`;
PC wraps to `000`, R0 becomes `9`, R1 becomes `5`. A and C are preserved.
Then writing R1=`6` makes the pair view `96`, with R0 still `9`.

The current state schema can express these widths, but `ArithmeticWidth`
excludes 4 and the pair helpers assume named eight-bit halves. Byte storage
for host convenience must not dictate calculation or view widths.

### Return-stack overflow

This trace follows the manual's programmer-visible capacity and return order.
The saved-address column is an explanatory newest-first list, not proposed
stored CPU state. Each JMS fetches two bytes, captures the following address,
then transfers control. Each BBL fetches one byte, loads A, then returns. C
and index registers are preserved; no data-memory access occurs.

| PC / bytes / instruction | Next PC | Still available return addresses | A |
| --- | --- | --- | --- |
| `100: 52 00` — JMS `200` | `200` | `102` | unchanged |
| `200: 53 00` — JMS `300` | `300` | `202`, `102` | unchanged |
| `300: 54 00` — JMS `400` | `400` | `302`, `202`, `102` | unchanged |
| `400: 55 00` — JMS `500` | `500` | `402`, `302`, `202`; `102` lost | unchanged |
| `500: C7` — BBL `7` | `402` | `302`, `202` | `7` |
| `402: C8` — BBL `8` | `302` | `202` | `8` |
| `302: C9` — BBL `9` | `202` | no valid caller remaining | `9` |

The probe covers exceeding capacity, not a subsequent return with no valid
caller. It does not establish physical slot layout or underflow behavior.
A complete model must specify those too; neither an unbounded host array nor
an automatic overflow exception follows from this trace.

### Selection captures values across instructions

For this interface probe, a CPU-owned command selector chooses the RAM bank;
the connected memory/port model retains each bank's SRC selection and the ROM
port selection. This ownership is an explicit instruction-level design choice,
not a new CPU register for every externally selected address. Only banks 0/1
are exercised; command-line combinations and pin timing are outside the probe.

Each instruction fetches its listed bytes from the program address shown,
advances PC by that byte count, then performs the listed effects. Initial
A=`0`, C=1; unmentioned CPU state and memory persist.
There are no data reads/writes except those listed. Numbers remain hexadecimal.

| PC / bytes / instruction | Ordered effects after fetch |
| --- | --- |
| `000: 20 26` — FIM `0P,26` | R0←`2`; R1←`6` |
| `002: FD` — DCL | Read A=`0`; command selector←bank 0 |
| `003: 21` — SRC `0P` | Capture pair=`26`; send to bank 0 and ROM selection |
| `004: D1` — LDM `1` | A←`1` |
| `005: FD` — DCL | Read A=`1`; command selector←bank 1 |
| `006: 20 95` — FIM `0P,95` | R0←`9`; R1←`5` |
| `008: 21` — SRC `0P` | Capture pair=`95`; send to bank 1 and ROM selection |
| `009: 20 37` — FIM `0P,37` | R0←`3`; R1←`7`; previous selections persist |
| `00B: DA` — LDM `A` | A←`A` |
| `00C: E0` — WRM | Write A=`A` to bank 1, chip 2, register 1, data character 5 |
| `00D: E6` — WR2 | Write A to bank 1, chip 2, register 1, status character 2 |
| `00E: E1` — WMP | Write A to bank 1, chip 2, output port |
| `00F: D0` — LDM `0` | A←`0` |
| `010: FD` — DCL | Read A=`0`; select bank 0 without sending a new SRC |
| `011: E9` — RDM | Read bank 0, chip 0, register 2, data character 6 → `B`; A←`B` |
| `012: E2` — WRR | Write A=`B` to ROM port 9, still selected by the last SRC |

Preload that bank-0 data character with `B`. Finish at PC=`013`, A=`B`,
R0=`3`, R1=`7`, C=1. All transfers preserve C=1.
The trace makes three incorrect simplifications visible: rereading the live
pair for WRM, using one SRC latch for all banks, or treating a status/port
operation as an access to a flat byte address. This is a paper I/O probe only.

## Decision: explicit reads before a general operand framework

| Candidate | Evidence from the probes | Decision |
| --- | --- | --- |
| Pure register slices and concatenation | 8080/Z80 BC, 6809 D, 8088 AL/AH, and the hypothetical nibble pair describe related layouts | Useful declaration vocabulary; evaluate writes that preserve other slices and live bank selection |
| A universal resolved-operand object | Segmented locations, delayed reads, and 68000 pending updates need different contracts | Keep current local representations; a `read`/`write` callback pair alone does not explain them |
| Generic instruction transaction | 6502/8088 partial effects and 68000 checked rejection differ | Keep lifecycle and commit policies explicit |
| Named ordered bodies plus pure expressions | Every trace can identify reads, captures, mutations, and failures separately | Proceed to a minimal inspectable representation of the comparison slice |

For example, the next representation must distinguish these schematic bodies:

```text
6502 JSR:  fetch LOW; capture RETURN=PC; push RETURN.high; push RETURN.low;
           fetch HIGH; write PC=concat(HIGH, LOW)
6809 CMPX: resolve SOURCE (including index update); read RIGHT from SOURCE;
           read LEFT from X; calculate subtraction; apply NZVC
4004 SRC:  read ADDRESS from pair; send ADDRESS to the selected interfaces
```

These sketches summarize the explicit contracts above; their named effects
still need represented definitions. They are not an executable DSL or opaque
builtins proposed for one. Register views describe storage relationships;
explicit reads turn views or locations into captured values. Address mapping,
external selection, and pending updates require separate definitions.

Within the DSL work, the next bounded task is **stage 4**: design typed
declarations, pure expressions, and ordered statements for comparisons on
6502/8080/6809. Include
one transfer and the split-flag memory modification as counterexamples.
Judge those definitions with their validation and expanded bodies before
choosing an executor or generator. The 6507/4004 traces remain acceptance
requirements; they are not evidence that the current helpers already support
those processors. Additional TypeScript sharing should follow demonstrated
benefit rather than becoming a prerequisite for the language experiment.

The project's [eight-CPU completion milestone](../../ROADMAP.md#complete-opcode-coverage-for-all-eight)
continues alongside these experiments. The [checkpoint review and completion
sequence](completion.md) now direct the remaining instruction work.
Completing a DSL or adding the probe CPUs must not delay finishing the eight
current instruction sets.

[mos]: https://bitsavers.org/components/mosTechnology/_dataBooks/1982_MOS_Technology_Data_Catalog.pdf
[mcs4]: https://bitsavers.trailing-edge.com/components/intel/MCS4/MCS-4_Assembly_Language_Programming_Manual_Dec73.pdf
