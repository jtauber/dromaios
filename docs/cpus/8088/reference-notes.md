# 8088 reference notes

This records the comparison with `dromaios-pc` at commit
[`a6fb9d1`](https://github.com/jtauber/dromaios-pc/tree/a6fb9d10f4274dbd8ba40400e0b6761aec1d4b54),
reviewed on 14 September 2026. The existing emulator is a source of design
ideas and comparison cases; Intel's manual remains the hardware reference for
the [new model contract](model.md).

## Useful distinctions

The [CPU core](https://github.com/jtauber/dromaios-pc/blob/a6fb9d10f4274dbd8ba40400e0b6761aec1d4b54/js/cpu_8088.js)
stores AX/BX/CX/DX once and derives their byte halves. Its register selectors
also show the different encoded orders for word and byte registers. The new
core keeps this ownership rule, exposing detached byte views in snapshots and
mapping each writable byte to its stored word and shift.

Instruction fetching increments a 16-bit IP and translates each byte through
CS. The older core's data-word helpers instead translate once and access the
next physical byte. That distinction was initially carried into Dromaios;
the [expanded hardware comparison](#stack-and-control-flow-comparison) exposed
it as incorrect at offset FFFF. Data words now wrap their offsets within the
selected segment, independently of wrapping on the twenty-bit physical bus.

The [instruction table](https://github.com/jtauber/dromaios-pc/blob/a6fb9d10f4274dbd8ba40400e0b6761aec1d4b54/js/instructions_86.js)
groups ALU operations by encoded fields and gives immediate-register moves a
regular family. Word arithmetic uses only the low byte for parity. These are
useful guides for the expanded register and accumulator families. Typed selector
arrays now expose the byte/word widths and both register orders beside the
full opcode patterns. The expanded core resolves ModR/M into instruction-local
operand readers/writers, capturing an effective address once without mutable
decoder fields on the CPU.

## Differences to preserve

The existing `reset()` clears general registers and then sets IF. Intel's
reset table specifies clear flags, including IF, and does not specify the
general registers. The new model clears all nine flags and preserves general
registers under an explicit deterministic policy. Reset is separate from
constructing or restarting an example.

The PC core includes later x86 additions and compatibility behavior, such as
handling `64`–`67` as ignored prefixes and `0F` as POP CS. These do not belong
to the new model's documented original-8088 scope. Its reported `244/256`
opcode coverage counts table slots and is not the new tracker's documented
form denominator; grouped opcode extensions need separate accounting.

The older step loop owns tracing, callbacks, run state, cycles, and interrupt
connections. The new core returns detached instruction records; history and
bounded execution belong to callers. Unsupported instructions preserve state
instead of advancing IP and stopping the CPU. BIOS/DOS traps, device wiring,
interrupts, and display logic remain outside this initial CPU-and-RAM slice.

## Ideas to revisit

- Instruction-local prefixes and original stack/flag behavior are now covered
  in the [completion review](#ordinary-instruction-completion); retain those
  distinctions when adding external devices and interrupt resumption.
- Preserve original-8088 behavior when extending stack and flag families;
  PUSH SP already demonstrates why later x86 behavior is not automatically suitable.

## Independent hardware comparison

The register and accumulator families were compared with Daniel Balsom's
[hardware-generated 8088 V2 tests](https://github.com/SingleStepTests/8088/tree/aea84484abc79d09639d855b7b0ab32bc9e4dbeb/v2),
at revision `aea8448`. All **109,996 unprefixed cases across 22 encodings**
passed: `04`–`05`, `A0`–`A3`, and `B0`–`BF`. The comparison checked fetched
bytes, stored registers, all nine modeled flags, expected RAM after execution,
and that recorded accesses addressed bytes included in the fixture. Prefixed
cases were excluded because prefixes remain unsupported.

This was a development cross-check using downloaded fixtures, not a new
network-dependent test-suite requirement. The committed CPU and example tests
use independent local expectations. Prefetch queues and cycle traces were not
compared, consistent with the instruction-level model.

## Stack and control-flow comparison

The expansion adds **365,174 unprefixed hardware cases across 39 encodings**:
`3C`–`3D`, `50`–`5F`, `70`–`7F`, `C2`–`C3`, `E8`–`E9`, and `EB`, using the
same pinned V2 fixture revision. All pass, as do the earlier 109,996 cases
rerun after the memory correction: **475,170 cases across 61 encodings**.
The comparison checks fetched bytes, stored state and modeled flags, final
RAM, and recorded accesses against fixture memory. It omits prefetch queues,
cycle traces, and unsupported prefixes. The hardware suite does not exercise
TF/IF; local tests cover preservation of all 512 modeled flag combinations.

Two distinctions were checked against the pinned `dromaios-pc` code:

- **PUSH SP stores the decremented pointer.** The old register handler reads SP
  before its push helper decrements it, storing the original value. Dromaios
  implements the original-8088 behavior; every SP value has a local regression.
- **Word accesses wrap the offset inside the segment.** V2 `5A` case 3252
  (hash `445ddb088cd7d3f60bfb27947ee7c2152b3b4e82`) pops DX with SS=`4B5A`,
  SP=`FFFF`: it reads `A7` at physical `5B59F`, then `11` at `4B5A0`, producing
  DX=`11A7`, SP=`0001`. The earlier core read the second byte at `5B5A0`.
  This case is now a focused local regression with a conflicting sentinel at
  the wrong address.

Daniel Balsom's [MartyPC word-bus implementation][marty-biu] independently
translates the second byte using a wrapping 16-bit offset for reads and writes;
its [stack implementation][marty-stack] applies that behavior to pushes and
pops. The same bus routines handle data words, so the correction also applies
to existing direct MOV word forms. The earlier unprefixed `A1`/`A3` hardware
sample contained no offset-FFFF cases. Local tests now cover all MOV offsets
with the corrected rule and explicit segment/bus boundary cases. This changes
behavior at offset FFFF; the modeled opcode count is unaffected by the fix.

The [control-flow example](examples/control-flow.md) was separately run through
the pinned PC emulator: all 39 steps matched stored state, flags, ordered
accesses, and the full final RAM image. Its stack stays away from the segment
boundary and it does not use PUSH SP; dedicated tests cover those differences.

[marty-biu]: https://github.com/dbalsom/martypc/blob/05c0d088e84ad6bbfac9b3f0d051e7eadefd9f44/crates/lib/marty_core/src/cpu_808x/biu.rs
[marty-stack]: https://github.com/dbalsom/martypc/blob/05c0d088e84ad6bbfac9b3f0d051e7eadefd9f44/crates/lib/marty_core/src/cpu_808x/stack.rs

## Arithmetic, logic, and ModR/M comparison

The next batch adds **550,172 unprefixed hardware cases across 94 forms**:
44 further ALU forms in `00`–`3D`, 16 register INC/DEC forms, 26 documented
immediate-group operations in `80`–`83`, four TEST forms, and four ModR/M MOV
forms. All pass against the same pinned V2 revision. The previous 475,170
cases also pass after the shared ALU refactoring, giving **1,025,342 cases
across all 155 supported forms**.

Checks compare fetched bytes, stored registers, all modeled flags, final RAM,
and that recorded accesses address fixture memory. The suite's prefixed cases
are excluded; prefetch queues, cycle traces, and bus access order are not part
of this comparison. Local tests independently check instruction-level access
order and preservation of control flags, including TF/IF which the hardware
suite does not exercise.

The 1979 decoding guide documents only ADD/ADC/SBB/SUB/CMP for `82` and `83`.
Its unused `/1`, `/4`, and `/6` choices remain unsupported even though the old
PC emulator and hardware suite also implement those encodings. Tests reject
all such ModR/M choices before displacement/immediate fetches or data accesses,
preserving the complete state and RAM.

The [masked word-sum example](examples/word-sum.md) was compared with the pinned
PC core over all 76 steps and the complete final RAM image. Registers and defined
flags agree; all access addresses and values agree. Two model distinctions are
explicit:

- The old core preserves AF during logic. Intel leaves AF undefined; Dromaios
  clears it, matching the hardware fixtures. The comparison normalizes that
  undefined flag after logical instructions before comparing later states.
- For the final immediate-memory OR, the old core reads destination RAM before
  fetching the immediate. Dromaios follows its instruction-level contract:
  fetch the complete encoding, read operands, then write the result. The other
  75 steps have matching access order. This is not a claim about a prefetch
  queue or a hardware bus-cycle trace.

The typed operand closures keep register access and memory access explicit.
Effective addresses are fixed before an instruction changes registers, including
`MOV BX,[BX+SI]`; BP-relative reads use SS while direct offsets use DS. ALU
operation selectors return a result for writing, or no result for CMP/TEST.
This shares addressing and flag behavior across instruction families without
adding a CPU base class or mutable cached ModR/M state.

## Unary, shift, and transfer comparison

The next expansion adds **206,779 unprefixed hardware cases across 50 forms**:
`86`–`87`, `90`–`97`, `C6`–`C7` /0, `D0`–`D3` /0–5 and /7,
`F6`–`F7` /0, /2, /3, and `FE`–`FF` /0–1. All pass against the same pinned
V2 revision. Rerunning the preceding 1,025,342 cases gives **1,232,121 passing
cases across all 205 supported forms**.

The C6/C7 files mix documented `/0` with hardware aliases using other
operation selectors. Only `/0` counts here; prefixes and undocumented
encodings remain excluded. Local tests reject every unsupported selector
before displacement/immediate fetches, operand accesses, or state changes.

The comparison checks fetched bytes, registers, defined flags, final RAM,
and accessed addresses. Intel leaves OF undefined for multi-bit shifts and
rotates, and AF undefined for nonzero shifts. Those bits are normalized to
the model's explicit policies: preserve OF for counts greater than one and
clear AF after nonzero shifts. Local independent tests check those policies,
zero-count preservation, all 256 CL counts, and complete access ordering.

The pinned `dromaios-pc` source supplied useful encoding and operation
comparisons, with three differences retained in the new model:

- **CL is not masked to five bits.** The old D2/D3 handlers apply `& 0x1F`;
  Intel's 1979 manual permits counts through 255 on the original 8088.
  For example, SHL AL,CL with AL=`81`, CL=`20` produces zero, not an
  unchanged AL. This has exhaustive local count coverage.
- **One-bit rotates update OF when the sign changes.** The old core's ROL
  formula compares the final two high bits, and its RCL/RCR paths omit OF.
  ROL of `80` becomes `01` with CF=OF=1; RCL of `40` with CF=0 becomes
  `80` with CF=0, OF=1; RCR of `01` with CF=1 becomes `80` with CF=OF=1.
  Independent tests and the hardware comparison check the new flag behavior.
- **Undefined AF has an explicit policy.** The old shifts preserve AF; the
  new model clears it after nonzero shifts, consistently with logic. This
  bit is excluded from hardware equality rather than claimed as portable
  behavior.

The [signed word transformation](examples/word-transform.md) combines carry
propagation across two words, negation with borrow, byte-register exchanges,
and guarded memory output. Its high-word read exercises the segment-offset
boundary already identified above. Independent expectations check every
instruction record, both marker paths, signed boundaries, and full RAM images.

## Ordinary-instruction completion

The 15 September 2026 ordinary-instruction expansion added 63 documented forms
and all seven prefix modifiers. That slice kept interrupt-specific instructions,
port I/O, ESC, and WAIT deferred, reaching 268 of 291 forms; HLT and its
stored latch are included. The [model contract](model.md) defines the limits.

The same pinned
[SingleStepTests/8088 V2 suite](https://github.com/SingleStepTests/8088/tree/aea84484abc79d09639d855b7b0ab32bc9e4dbeb)
provides **460,629 passing hardware cases across 62 added forms**, including
**24,444 divide-error boundaries**. That suite has no HLT file; permanent tests
check its fetched record, stopped latch, restoration, and reset behavior.
Rerunning the earlier families with their segment-prefixed cases included gives
**2,423,129 passing cases across 267 forms**. These are instruction-level checks
against the suite's AMD D8088 hardware, not cycle-accuracy claims.

The comparison includes all stored registers, defined flags, fetched instruction
bytes, final fixture RAM, and accessed addresses. For REP it joins the bounded
one-element steps before comparing hardware's final state. It excludes **51,871
cases** across the full set: undocumented selectors/aliases, non-`0A` AAM/AAD
radices, undocumented repeat combinations, and REP writes overlapping fetched
code where the model's refetch policy differs from hardware prefetching.
Those exclusions do not remove documented forms. Undefined flags follow the
model's explicit policies; TF/IF preservation is covered locally because those
flags are not exercised by the hardware generator.

For divide errors, the fixtures enter interrupt type 0. The comparison instead
checks detection, `reason: "divide-error"`, complete state preservation, and no
writes at our deferred-interrupt boundary. It does not claim that the emulator
reproduces the hardware exception frame or interrupt destination yet. Valid
divisions compare the complete quotient and remainder.

The hardware cases establish three original-chip details.
[MartyPC's decimal routines](https://github.com/dbalsom/martypc/blob/05c0d088e84ad6bbfac9b3f0d051e7eadefd9f44/crates/lib/marty_core/src/cpu_808x/bcd.rs)
also corroborate the two decimal-adjustment distinctions:

- DAA/DAS use a high-digit threshold of `9F` when incoming AF is set, `99`
  otherwise. DAS does not set CF solely for low-digit borrow. Later x86
  pseudocode differs for some non-BCD inputs. Permanent regressions include
  AL=`9E`, AF=1, CF=0 and subtraction from AL=0 with AF=1.
- AAA/AAS adjust AL and AH independently, so overflow/underflow in the AL
  adjustment does not enter AH again. The old PC core agrees with this rule.
- IDIV accepts signed quotients only in −127..127 or −32767..32767 on the
  original chip. Intel's 1979 manual states these ranges; hardware fixture
  `F6.7`, case 1828 (`AX=C4CC`, `CH=76`) confirms that a quotient of −128
  triggers a divide error. Independent BigInt boundary cases check both widths.

The old PC core helped review ModR/M groups, far pointer capture, segment
selection, and string index updates. Its word DIV combines DX:AX with signed
JavaScript bitwise arithmetic; the new core uses exact unsigned multiplication
and addition before dividing. It also packs original FLAGS reserved bits
15–12 as ones, where the old core leaves them clear. Hardware PUSHF/POPF cases
and exhaustive local packing/unpacking tests establish the new behavior.

Prefixes are local to an attempt, while source/destination and stack addresses
are captured before register writes. REP uses visible CX/SI/DI/IP plus RAM,
with one element per step and no hidden continuation object. This requires an
8088-owned step loop; the common instruction context, state validation,
recorded byte memory, flag packing, and ALU helpers are still shared.

The [decimal buffer example](examples/decimal-buffer.md) combines wrapped source
words, REP MOVSW, an ES override, a far call/return frame, DIV, backward STOSB,
LOOP, saved FLAGS, and HLT. Independent expectations cover all 52 records,
full guarded memory images, unsigned input boundaries, and snapshot restoration
inside both REP and the subroutine.

## Port input and output comparison

The PC core's eight IN/OUT handlers use byte callbacks for both AL and AX.
The new core expresses their shared `1110 r 1 d w` encoding once and reuses
`BytePorts` and the common access recorders. Its word transfers explicitly wrap
the second port to 16 bits, independently of segmented memory addressing.
[MartyPC's byte-bus routines][marty-biu] also use low-first transfers with a
wrapping 16-bit second address.

All **80,000 hardware-generated cases across E4–E7 and EC–EF** passed at the
same pinned [8088 V2 revision](https://github.com/SingleStepTests/8088/tree/aea84484abc79d09639d855b7b0ab32bc9e4dbeb/v2).
The comparison checks every modeled register and flag, fetched instruction
bytes, fixture RAM, and ordered port addresses/values extracted from the bus
trace: latch the address on ALE, then sample the transfer at T3. One output
fixture starts at port FFFF and confirms the second byte goes to 0000.
Input fixtures supply FF; local tests separately vary input bytes and check
all 512 modeled flag combinations, failures, and instruction-boundary resumption.
Prefetch queues, idle cycles, and timing remain outside the comparison.
