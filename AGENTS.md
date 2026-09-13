# Working with the maintainer

Wait for the user's review before every commit. Leave changes uncommitted
until the user has reviewed them and given the go-ahead to commit. A request
to implement or edit something is not permission to commit it.

Keep changes small and reviewable, and report the checks performed.

Keep overview documentation stable across small implementation changes.
Update README.md, ROADMAP.md, docs/architecture.md, and docs/cpus/scope.md
when project scope, milestones, architecture, or development workflow changes;
do not update them just to add an opcode to a progress list. Track current CPU
instruction coverage and implementation progress in docs/cpus/coverage.md,
updating it in the same change as CPU support. Keep CPU state, execution-record,
and reset contracts in docs/cpus/<cpu>/model.md; keep program behavior and
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
