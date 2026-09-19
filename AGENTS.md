# Working with the maintainer

Wait for the user's review before every commit. Leave changes uncommitted
until the user has reviewed them and given the go-ahead to commit. A request
to implement or edit something is not permission to commit it.

Keep changes small and reviewable, and report the checks performed.

Keep overview documentation stable across small implementation changes.
Update README.md, ROADMAP.md, docs/architecture.md, and docs/cpus/scope.md
when project scope, milestones, architecture, or development workflow changes;
do not update them just to add an opcode to a progress list. Track current CPU
support, instruction-definition coverage, and source footprint in
docs/cpus/coverage.md, updating the affected figures and descriptions in the
same change. Keep CPU state, execution-record, and reset contracts in
docs/cpus/<cpu>/model.md; keep program behavior and
acceptance criteria in the relevant example specifications. Avoid duplicate
status lists.

## Priorities for source code

For code under `src/`, prioritize the following, in order:

1. **Correctness:** faithfully implement the declared model, with independently
   checked behavior and explicit limitations. This does not require cycle
   accuracy before we have chosen to model cycles.
2. **Clarity:** make what happens and why easy to understand. Names, control
   flow, and organization should expose the behavior being modeled.
3. **Elegance:** express meaningful patterns through a small set of coherent
   concepts. Reduce duplication when the abstraction improves understanding;
   fewer lines alone is not an improvement.
4. **Performance:** choose efficient approaches that preserve the priorities
   above. Require measurements before accepting extra complexity for speed.

An improvement lower on this list needs justification if it compromises
something higher up. The implementation itself should help explain the hardware.

For CPU models, follow the [CPU source organization guide](docs/cpus/implementation.md).
Use its common reading order while preserving each processor's encoding and
execution conventions.

## Authored and generated sources

Instruction behavior is authored in `src/components/cpus/semantics/`, using
CPU definitions and shared builders. Follow the
[instruction semantics guide](docs/cpus/instruction-semantics.md) when changing
these definitions; decoding and execution-boundary logic also remain in the
CPU cores. For generated machine factories, edit the `.machine` sources under
`src/machines/`, following the [machine definition guide](docs/machines/definitions.md).
Do not hand-edit or commit `src/components/cpus/generated/`,
`src/machines/generated/`, or `dist/`; the build regenerates them.

The tracked [expanded instruction listing](docs/cpus/semantic-examples.md) is
also generated. When definitions or their descriptions change, regenerate it
with `node scripts/describe-cpu-semantics.ts`; the build does not refresh it.

## Validation

Use the Node version in `.nvmrc` and the [development workflow](README.md#development).
CPU-filtered test runs include that CPU's component tests and machine examples,
but omit shared-helper and semantics tests. Use the full `npm test` suite for
the final regression check on code changes. Use `npm run test:built` only while
compiled output is current. For documentation-only changes, check links and
consistency; a full test run is unnecessary.
