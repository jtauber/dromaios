# Working with the maintainer

Wait for the user's review before every commit. Leave changes uncommitted
until the user has reviewed them and given the go-ahead to commit. A request
to implement or edit something is not permission to commit it.

Keep changes small and reviewable, and report the checks performed.

Keep overview documentation stable across small implementation changes.
Update README.md, ROADMAP.md, docs/architecture.md, and docs/cpu-roadmap.md
when project scope, milestones, architecture, or development workflow changes;
do not update them just to add an opcode to a progress list. Keep detailed
instruction coverage and implementation progress in the relevant example or
CPU document (currently docs/first-example.md), avoiding duplicate status lists.
