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
CS. Word data access translates its starting address once, then accesses the
next physical byte. Keeping these paths separate makes their boundary behavior
visible. The new tests distinguish segment-end instruction fetching from
segment-end data transfers, as well as wrapping on the twenty-bit address bus.

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
- Preserve the original 8088's stack quirks and flag semantics as those
  instruction families arrive; later x86 behavior is not automatically suitable.

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
