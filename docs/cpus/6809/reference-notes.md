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
  Broad opcode-family generators can wait until more forms justify them.
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
