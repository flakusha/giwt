<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# BUG: patch-id duplicate detection is defeated by a rename between two identical commits

**Status:** Not Started
**Priority:** critical
**Effort:** Medium
**Tags:** git, rebase

**Summary:**

Observed in loop-lore during a long rebase. Two commits carried the SAME stable patch-id, yet git applied one of them instead of skipping it as an already-applied duplicate. The result was not cosmetic: it resurrected a retired file and broke the migration chain.

The sequence:

1. `c809ab514 feat(db): unique index enforces message idempotency dedup` adds `040_messages_idempotency_unique.ts`.
2. `17ea74046 fix(db): renumber colliding migrations` renames it to `045_messages_idempotency_unique.ts` (git records this as R097 — the docblock and one warning string changed).
3. `35f29d6c9 feat(db): unique index enforces message idempotency dedup` — the same change, same stable patch-id `8008c589` as step 1 — is replayed onto the tip.

Git compares each replayed commit against the commits it has already walked. Because the rename sat between the two copies, the later copy no longer matched anything already applied, so git replayed it and re-added `040_messages_idempotency_unique.ts`. Both migrations then ran, and the second `CREATE UNIQUE INDEX uq_messages_idempotency_enforced` failed with `index already exists`.

Blast radius: every `createTestDb()` aborted, so a 73-failure suite reported as 2608. One resurrected file.

Root cause: patch-id dedup is content-addressed on the diff, and a rename is itself a diff. Any rename in the upstream range opens a window in which a replayed twin stops being recognized as a twin.

Fix direction: when git declines to skip a commit, do not assume it is fresh. Before replaying, compare the candidate against the target history using a rename-insensitive fingerprint — normalize each commit to its per-file content deltas, ignoring path renames, and match on that. Report any hit as a probable duplicate rather than silently applying it.

Acceptance:

- a detector that flags a replayed commit whose rename-normalized fingerprint matches a commit already in the target, even when a rename separates the two
- the loop-lore case is a regression fixture: same patch-id, rename between, must be reported
- never silently drop on a fingerprint match alone — report, let the caller accept or reject
- does not regress the existing already-applied fast path

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [ ] Implementation complete
- [ ] Tests passing
- [ ] Documentation updated
