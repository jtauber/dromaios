# CPU runner

`runCpu` executes a bounded sequence of steps from a CPU's current state.
It uses the existing CPU-specific records and distinguishes caller completion,
CPU stopping, and exhaustion of the step budget.

[Implementation](../../src/runtime/run-cpu.ts) ·
[Runner tests](../../tests/runtime/run-cpu.test.ts) ·
[Example integration tests](../../tests/runtime/examples.test.ts) ·
[Public type checks](../../tests/types/run-cpu.ts)

## Calling the runner

For the unchanged [6502 arithmetic example](../cpus/6502/examples/arithmetic.md):

```ts
const { cpu, endAddress } = create6502Example();
const result = runCpu(cpu, { maxSteps: 16, endAddress });
```

The result has `stopReason: "completed"` and four `Cpu6502StepRecord` entries.
For an 8080 or Z80 example that ends in HLT or HALT, omit `endAddress`; its final
record reports the halt instruction and the runner returns `stopReason: "halted"`.

| Option | Meaning |
| --- | --- |
| `maxSteps` | Required maximum number of calls to `cpu.step()` |
| `endAddress` | Optional PC at which to stop before another step |

Both values must be nonnegative safe integers. A zero budget is valid.
Invalid options throw `RangeError` before inspecting or stepping the CPU.
The runner accepts addresses beyond 16 bits so that it does not impose the
initial CPUs' address width on other models. For the 8088, `endAddress` is the
physical address derived from `CS:IP`, rather than IP alone; different logical
addresses that translate to the same physical address match the same endpoint.
For the 68000, `snapshot().pc` is the full 32-bit register; high-byte aliases
of the same physical address therefore remain distinct completion addresses.
The caller chooses an endpoint
appropriate to its CPU and program; machine definitions retain their own
address validation.

Each call uses the supplied CPU's current state and memory. A second call
resumes where the first stopped. CPU reset and creating a fresh example remain
explicit caller operations, with their existing CPU and machine contracts.

## Stopping rules

After validating options, the runner repeats these checks in order:

1. If an endpoint was supplied and the current PC equals it, return `completed`.
2. If the step budget is exhausted, return `step-limit`.
3. Call `step()` once and append its original record.
4. If that record reports `halted` or `unsupported`, return that stopping reason
   immediately. Otherwise, repeat from the endpoint check.

This gives the following boundary behavior:

| Situation | Result |
| --- | --- |
| CPU starts at the endpoint, including with a zero budget | `completed`, no records or instruction fetch |
| Zero budget away from the endpoint | `step-limit`, no records |
| Last permitted executed step reaches the endpoint | `completed`, including that step's record |
| Last permitted step halts or reports unsupported | `halted` or `unsupported`, including that record |
| HLT, HALT, or STOP advances PC to the endpoint | `halted`, retaining the CPU's terminal result |
| Budget ends before any other stopping condition | `step-limit`, with exactly `maxSteps` records |

A step budget counts attempts, including unsupported instructions and the
8080's and Z80's already halted, no-fetch steps. An already halted CPU therefore
returns one such record if a step is permitted. With a zero budget it returns
`step-limit`; if it starts at a supplied endpoint, completion takes precedence
and it is not stepped.

`completed` means only that PC reached the caller's endpoint. Example tests
also check CPU state and RAM to establish the program's intended result.
The runner never fetches the next instruction to decide whether it should stop.
For endpoint checks, `snapshot()` supplies PC without accessing RAM, following
the [CPU model contracts](../README.md#cpu-models).

## Records and types

`CpuRunResult<Step>` has readonly `records` and `stopReason` fields. Each call
owns a fresh readonly record array. Its entries are the exact objects returned
by the CPU, in order; the runner does not copy, reinterpret, or freeze them.
Record contents and isolation guarantees belong to the CPU's model contract.

TypeScript infers the record type from the supplied CPU. A 6502 run retains
its non-null instruction and `opcode` unsupported reason;
an 8080 run retains its halted-record union; a 6809 run retains D and both
stack pointers in snapshots; a Z80 run retains both register banks, P/V, and R;
an 8088 run retains CS:IP, word registers, derived byte views, and physical PC;
a 68000 run retains long registers, both stack pointers, STOP state, and
alignment/synchronous-exception details, including a null instruction when an odd PC prevents fetching.
Selecting between CPU types produces the union of their record types. Run-level `stopReason` is separate from each record's
CPU-level `outcome` and optional `reason`.

The runner depends only on `snapshot().pc` and a `step()` result whose outcome
is `executed`, `halted`, or `unsupported`. The current CPU classes satisfy
that structural contract without adapters or changes to their state APIs.
CPU exceptions propagate immediately; the runner does not retry a failed step
or return a fabricated record. State changes already made remain visible.

## Scope and checks

Execution is synchronous and retains all records from the bounded call.
Browser scheduling, pausing between batches, streaming records, timing, and
breakpoints can be added when their consumers need them.

Tests cover the existing examples at their exact step budgets, checking
final PC, stopping reason, original record identity, RAM accesses, and writes.
The example specifications retain independently authored expected records and
memory images. Boundary checks cover zero and exhausted budgets, endpoint
precedence, already halted CPUs, unsupported opcodes and modes, 6809 prefixes,
successive runs, changed RAM, record retention, and propagated errors. Public
type checks preserve CPU-specific record fields, discriminated unions, and
readonly results.
