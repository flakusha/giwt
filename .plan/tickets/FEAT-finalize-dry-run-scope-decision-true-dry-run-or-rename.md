<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# FEAT: finalize --dry-run scope decision: true dry-run or rename

**Status:** Done
**Priority:** low
**Effort:** Small
**Tags:** finalize, cli, decision

**Summary:**

`giwt finalize --dry-run` still merges, removes the worktree, and deletes the branch —
the flag only scopes the Step-6a scratchpad prune. The behavior is documented in-source
but surprising given the repo's own dry-run convention (clean/tmp/doctor/abort
dry-runs mutate nothing). Decide: implement a true dry-run, or rename/rescope the flag
to say what it does.

**Context:**

Deferred decision (followup to the 2026-10-14 proposals sweep; not covered by P1-P8).

Evidence (read from source):

- src/commands/finalize/run.ts:254-257:
  `// --dry-run scopes to the Step 6a scratchpad prune only (see USAGE): the merge,
  the worktree removal and the branch delete still run.` /
  `const dryRun = args.includes("--dry-run");` /
  `teardownFinalizedWorktree({ ..., dryRun })`.

- finalize/teardown.ts:18-19, 40-45: `dryRun` is threaded only into
  `pruneWorktreeScratch`; worktree removal and branch deletion proceed regardless.

- finalize/scratch-prune.ts:125-128: with dryRun the prune prints
  "Step 6a: --dry-run — scratchpad left untouched" and deletes nothing (tested,
  scratch-prune.test.ts:121-131).

- House convention is "dry-run mutates nothing": clean defaults to dry-run deleting
  nothing (clean.ts:60), tmp likewise (tmp.ts:39), doctor (doctor.ts:9,143),
  abort --dry-run "report only, no mutations" (abort.ts:26, tested at
  abort.test.ts:144). A user pattern-matching that convention gets a merge + branch
  deletion from finalize --dry-run.

Decision to make:

**DECIDED (2026-10-16): Option B — reject `--dry-run`, rename to `--prune-dry-run`.**
Rationale: the flag never skipped the merge/teardown, so it could not be made
toothless without a large, separately-designed "plan the staging CAS merge"
surface (Option A); the house convention (`clean`/`tmp`/`doctor`/`abort`)
already owns the name `--dry-run`, and a flag that merges and deletes branches
under that name is a trap. `finalize` now rejects `--dry-run` with a remedy
naming `--prune-dry-run` (src/commands/finalize/run.ts `rejectLegacyDryRun`);
the Step-6a prune-plan-only behavior is unchanged under the new name.

- Option A (true dry-run): `--dry-run` performs every step read-only — run the gates
  (or plan them), report merge plan/prune plan/teardown plan, mutate nothing. Larger
  surface; must define what "plan the merge" means for the staging CAS path.

- Option B (rescope/rename): remove `--dry-run` from finalize (or rename to
  `--skip-prune-apply` / `--prune-dry-run`), keep the prune-plan-only behavior under a
  name that cannot be mistaken for the house dry-run convention; update USAGE
  (src/cli-usage.ts) and the run.ts comment.

**Acceptance Criteria:**

- [ ] A decision is recorded in this ticket (comment or status note) with rationale
- [ ] If Option A: a finalize --dry-run run leaves the branch, the worktree, and the scratchpad byte-identical (test asserts no ref move, no worktree removal, prune report only); USAGE updated
- [ ] If Option B: `giwt finalize --dry-run` is no longer accepted (or is an explicit alias documented as prune-plan-only); the new flag name appears in src/cli-usage.ts and the run.ts comment; scratch-prune tests keep passing under the new flag
- [ ] Either way: help text (`giwt finalize --help` / USAGE table) and the run.ts comment agree with the implemented behavior; `bun run check` + `bun test` green
