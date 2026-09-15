# Ideas from dromaios-coco

Recorded while reviewing the [arithmetic example](examples/arithmetic.md),
using the existing repository at
[`099aeb7c54f0a3d27299bcad490ad883ead9fa6f`][coco-tree]. These are design evidence
and targeted observations, not a certification of the complete emulator.

- **Keep one source of register state.** The [CPU's D getter/setter][coco-cpu]
  already derives D from A/B and splits D writes into those bytes. Use that
  relationship here, with detached numeric snapshots and no public mutation API.
- **Compose operations with operand access.** The [instruction definitions][coco-instructions]
  pass addressing-specific reads into operation families, and keep the extended
  store's address resolution separate from a data read. Retain that separation.
  The expanded byte families now share operand readers while retaining explicit
  encoding groups. Indexed forms now share address resolution with byte and word
  operations.
- **Specify reset and stopping independently.** The old CPU reset clears A/B,
  X/Y, S/U, and CC before setting F/I and reading the vector. A targeted run of
  the proposed lesson confirmed that reset clears the registers while leaving
  the stored result intact. The new reset follows the narrower [model policy](model.md#cpu-reset).
  The old step path advances PC before reporting unsupported instructions and
  fetches a second byte after a prefix. Here both boundaries stop without
  changing state, using the explicit [prefix policy](model.md#unsupported-instructions-and-prefixes).
- **Check prose against hardware.** The [CoCo architecture note][coco-architecture]
  assigns BSR/JSR to U, but those calls use S in both [Motorola's instruction
  definitions][instructions] and the reference implementation. Do not carry that statement
  into the two-stack model or later lessons.
- **Keep inspection separate from CPU access.** A [memory watchpoint][coco-memory]
  rereads instruction bytes through the normal memory read path, which also
  routes accesses to PIAs. Completed-step explanations should use captured
  records; future previews need side-effect-free inspection. This agrees with
  the [6502 reference notes](../6502/reference-notes.md).
- **Revisit broader test ideas later.** The [embedded CPU tests][coco-main]
  include D transfers, stack round-trips, indexed addressing, and flag operations.
  They are candidates for later focused examples. Derive new expectations from
  hardware references, and keep Dromaios tests independent of the browser and
  CoCo devices. The old CPU's timing counters, interrupt logic, and trace buffer
  do not expand this example's scope.

A focused run of the pinned CPU with flat observed RAM confirmed the proposed
instruction sequence's A/D values, flag changes, and ordered accesses. Separate
probes confirmed D writes splitting into A/B, register clearing on reset, and
PC advancement by one for an unsupported base byte or two for an unsupported
prefixed opcode. These checks inform the comparison; acceptance tests for the
new implementation must use the [example specification](examples/arithmetic.md) and hardware references
for expected values.

## Expanded byte-instruction comparison

The expanded base-page subset was compared against the same pinned CoCo
implementation in 35,072 single-step cases: all 137 supported opcodes with all
256 initial CC values, varied register/data bytes, and PC/S boundary values.
Stored registers, derived D, final flags, and ordered instruction-level RAM
accesses agreed, with one intentional correction:

- **Memory CLR must read before clearing.** The old direct and extended CLR
  handlers only write zero. [Motorola's CLR entry][instructions] explicitly
  requires an effective-address read first. Dromaios includes and independently
  tests that read, including code/data overlap and unchanged-value writes.
  The comparison accounts for this missing read in 512 CLR cases; all remaining
  accesses and resulting state match.

This comparison supplements the independently authored arithmetic, flag,
addressing, and stack expectations in the [CPU tests](../../../tests/components/cpus/6809.test.ts).
The old emulator remains design evidence, not the definition of correctness.

## Indexed and word-transfer comparison

A further 21,634 single-step cases compared stored state, D, flags, ordered RAM
accesses, and written memory against the same pinned implementation:

- 41 indexed opcodes × 217 documented postbytes × two initial CC patterns:
  17,794 cases, with varied registers, memory contents, and instruction wrapping.
- 15 newly supported immediate/direct/extended word-load/store forms × all
  256 initial CC values: 3,840 cases. The six indexed word forms are included above.

All cases agree after accounting for the old emulator's omitted read in the
434 indexed CLR cases, matching the correction already documented above.
Its indexed word stores confirm address resolution and register auto-update
before reading the source; word loads replace any auto-updated destination.

The reference decoder accepts undefined forms, including indirect increment
or decrement by one and aliases of extended indirect. Dromaios follows
[Motorola Table 2-1](https://www.maddes.net/m6809pm/sections.htm): PC-relative
forms explicitly ignore rr, but extended indirect is exactly `9F`. All 39
undefined postbytes are rejected without effects. Their rejection expectations
come from the model boundary and independent tests, not the CoCo decoder.

The pinned sources provide implementation ideas. Dromaios's
[model contract](model.md) defines its reset, prefix rejection, and record API;
the example specification defines its initial values and expected execution.

[instructions]: https://www.maddes.net/m6809pm/appendix_a.htm
[coco-tree]: https://github.com/jtauber/dromaios-coco/tree/099aeb7c54f0a3d27299bcad490ad883ead9fa6f
[coco-cpu]: https://github.com/jtauber/dromaios-coco/blob/099aeb7c54f0a3d27299bcad490ad883ead9fa6f/js/cpu.js
[coco-instructions]: https://github.com/jtauber/dromaios-coco/blob/099aeb7c54f0a3d27299bcad490ad883ead9fa6f/js/instructions.js
[coco-architecture]: https://github.com/jtauber/dromaios-coco/blob/099aeb7c54f0a3d27299bcad490ad883ead9fa6f/ARCHITECTURE.md
[coco-memory]: https://github.com/jtauber/dromaios-coco/blob/099aeb7c54f0a3d27299bcad490ad883ead9fa6f/js/mem.js
[coco-main]: https://github.com/jtauber/dromaios-coco/blob/099aeb7c54f0a3d27299bcad490ad883ead9fa6f/js/main.js
