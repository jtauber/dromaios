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
