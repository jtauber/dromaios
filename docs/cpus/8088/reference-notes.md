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
full opcode patterns, while ModR/M decoding remains deferred.

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

- Keep opcode-extension bits distinct from operand-selection bits when adding
  ModR/M. Explain direct-address and BP-based segment-selection exceptions.
- Represent a decoded operand explicitly if it helps reuse the same address
  for reading and writing; the older core caches the address in mutable fields.
- Treat prefixes as instruction-local context. Segment overrides, repeat
  behavior, and invalid combinations need their own contracts and tests.
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
