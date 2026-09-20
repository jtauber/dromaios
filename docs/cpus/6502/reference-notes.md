# Ideas from applepy and dromaios-apple2

Recorded on 12 September 2026 while reviewing the [first 6502 example](examples/arithmetic.md).
These recommendations guide implementation and later design reviews. The first
example remains a four-instruction subset; the later ideas below do not expand
its scope.
Source links identify the versions examined. Existing emulator behavior is
evidence to investigate, with hardware expectations checked independently
against the references in the [model contract](../../../src/components/cpus/specifications/6502.md#references) and
example specifications.

## Operation and operand separation: use in the first example

[Applepy composes addressing helpers with operation methods][applepy-operations].
Carry that separation forward, refining the boundary so operations that consume
data accept values. For example, `loadAccumulator(value)` can serve an immediate
load and a later memory load; the opcode handler obtains the value through the
appropriate recorded reads. A store instead resolves a destination and writes
to it without first reading its contents.

Keep these helpers small and specific to the CPU. There is no need to force
implied, immediate, memory, and eventual read-modify-write instructions through
one operand interface. Preserve the distinction between fetching instruction
bytes and reading data when composing handlers.

## Opcode metadata: revisit when adding disassembly

Both projects maintain separate execution and disassembly tables.
[Dromaios-apple2's executable entries][apple2-definitions] already include a
mnemonic and addressing mode, while its [disassembler][apple2-disassembler]
maintains another description of each opcode.

When disassembly gets its first consumer, aim for one typed definition per
opcode form supplying the shared encoding facts and executable handler.
Disassembly and explanations can use that metadata while retaining their own
responsibilities. This is a possible first step toward the definition languages
discussed in [architecture.md](../../architecture.md#implementation-language-and-future-definition-languages).
Choose fields when they have consumers; custom syntax and a universal CPU
schema remain deferred. Correctness tests must still use independently derived
expectations rather than treating the definitions as their own oracle.

## Explanations and inspection: preserve captured facts now, add views later

[Dromaios-apple2's explainer][apple2-explainer] shows effective addresses,
arithmetic, flag effects, and branch decisions. These are useful teaching
features to carry forward.

An explanation of a completed step should use its captured instruction bytes,
before/after snapshots, and access records. Do not execute the operation again
or reread current memory to reconstruct what happened. A preview of the next
instruction is a separate operation and needs side-effect-free inspection;
it must also respect unsupported instructions and modes.

A focused check of the reference version demonstrated why this matters:
place `8D 10 C0` (`STA $C010`) at `$0200`, set PC to `$0200`, and set keyboard
data to `$C1` with its strobe true. Calling `Explain.explain(memory, cpu)` alone
changes the data to `$41` and clears the strobe, with PC unchanged. The explainer
reads the destination while resolving the address. The [memory controller][apple2-memory]
has a separate `peek()` path, but the explainer and disassembler use `read()`.

Use this as a regression case when introducing device inspection. The first
example needs the record guarantees already specified, with no additional UI
or generic inspection API required yet.

## Lesson annotations: revisit with the first explanatory views

The [Apple II instrument design][apple2-instruments] lets specialist modules
contribute address labels, comments, and named memory regions independently
of the CPU. The tiny lesson could label `$0080` as `result` and explain its
role; later instruments could identify BASIC variables or ROM routines.

Keep those names and meanings with the lesson or instrument. CPU execution
continues to use addresses and values. Introduce the smallest annotation
mechanism that the first view needs before considering a public plugin API.

## Boundary examples and timing: follow the initial three CPU examples

[Applepy's tests][applepy-tests] provide candidates for focused lessons on
zero-page indexing, pointer wrapping, and indirect addressing. Revisit these
after the initial 8080, 6502, and 6809 examples, as addressing support expands.
Derive each expectation from hardware references and exercise the public
instruction-stepping path, including accesses, rather than only calling
operation helpers directly.

[Applepy's cycle notes][applepy-cycles] pursue the teaching goal of explaining
why instructions take time. Revisit that goal when timing enters scope,
including differences between reads, writes, read-modify-write operations,
and page crossings. Cycle totals and complete bus traces are distinct claims;
the current instruction-level access records promise neither. The notes are
design inspiration, not a verified timing specification.

## Decimal arithmetic: verify NMOS behavior independently

[Applepy's ADC][applepy-adc] asserts that decimal mode is off.
[Dromaios-apple2's ADC][apple2-adc] performs binary arithmetic without checking
D. A focused check with A = `$09`, operand = `$01`, C false, and D true produced
A = `$0A` while leaving D true in that implementation.

These older implementations do not establish decimal-mode correctness. The
[arithmetic contract](../../../src/components/cpus/specifications/6502.md#arithmetic-in-binary-and-decimal) instead specifies
NMOS digit correction and intermediate flags, checked exhaustively and against
independent reference cases. The [decimal example](examples/decimal.md) exercises
carry and borrow between packed-decimal bytes.

[applepy-operations]: https://github.com/jtauber/applepy/blob/934bf1a495583e7b4b08d42eae27e3532b51c3f2/cpu6502.py#L806-L880
[applepy-tests]: https://github.com/jtauber/applepy/blob/934bf1a495583e7b4b08d42eae27e3532b51c3f2/tests.py#L951-L997
[applepy-cycles]: https://github.com/jtauber/applepy/blob/934bf1a495583e7b4b08d42eae27e3532b51c3f2/cycle_notes.txt
[applepy-adc]: https://github.com/jtauber/applepy/blob/934bf1a495583e7b4b08d42eae27e3532b51c3f2/cpu6502.py#L1086-L1104
[apple2-definitions]: https://github.com/jtauber/dromaios-apple2/blob/569baf98006f61e80ed93c36aa4f8d9ae23011d3/js/cpu.js#L1077-L1084
[apple2-disassembler]: https://github.com/jtauber/dromaios-apple2/blob/569baf98006f61e80ed93c36aa4f8d9ae23011d3/js/disassembler.js
[apple2-explainer]: https://github.com/jtauber/dromaios-apple2/blob/569baf98006f61e80ed93c36aa4f8d9ae23011d3/js/explain.js
[apple2-memory]: https://github.com/jtauber/dromaios-apple2/blob/569baf98006f61e80ed93c36aa4f8d9ae23011d3/js/apple2.js#L199-L252
[apple2-instruments]: https://github.com/jtauber/dromaios-apple2/blob/569baf98006f61e80ed93c36aa4f8d9ae23011d3/ARCHITECTURE.md#instrument-architecture
[apple2-adc]: https://github.com/jtauber/dromaios-apple2/blob/569baf98006f61e80ed93c36aa4f8d9ae23011d3/js/cpu.js#L1090-L1103
