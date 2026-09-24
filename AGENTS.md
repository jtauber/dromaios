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
same change. For CPUs with complete literate specifications, keep state,
execution-record, and reset contracts, hardware references, and model limitations
in the executable chapter alongside the formal definitions. Chapters should
teach the chip, including its history, architecture, and physical operation;
distinguish hardware background from behavior modeled by the emulator. Other
CPUs retain these in docs/cpus/<cpu>/model.md until their chapters take ownership.
Keep program behavior and acceptance criteria in the relevant example specifications.
Avoid duplicate contracts and status lists.

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

For CPU models, follow the [CPU implementation guide](docs/cpus/implementation.md).
Use its common reading order while preserving each processor's encoding and
execution conventions.

## Authored and generated sources

The eight CPU models are authored in executable Markdown chapters under
`src/components/cpus/specifications/`. Shared representations, builders, and
generation live in `src/components/cpus/semantics/`. Follow the
[literate specification guide](docs/cpus/literate-specifications.md) for chapters and the
[instruction semantics guide](docs/cpus/instruction-semantics.md) when changing
these definitions. Chapter contracts select shared decoding and execution
runtimes. Complete chapters also
generate public CPU modules; edit their `interface` declarations instead of
adding handwritten wrappers. For generated machine
factories, edit the `.machine` sources under
`src/machines/`, following the [machine definition guide](docs/machines/definitions.md).
Do not hand-edit or commit `src/components/cpus/generated/`,
`src/components/cpus/semantics/generated/`, `src/machines/generated/`, or `dist/`;
the build regenerates them.

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
