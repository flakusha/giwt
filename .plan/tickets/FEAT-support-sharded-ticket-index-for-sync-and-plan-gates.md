<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FEAT: support sharded ticket index for sync and plan gates

**Status:** Not Started
**Priority:** high
**Effort:** Large
**Tags:** tickets, sync, plan

**Summary:**

Add first-class read/write support for a sharded `.plan/tickets/index.json` layout so consuming repos can split a multi-megabyte index into per-type shards without changing call sites. Legacy single-file repos must stay byte-for-byte compatible.

**Context:**

Operator ruling 2026-11-19: loop-lore must split its tracked `.plan/tickets/index.json` (about 2.2 MB, rewritten on every plan sync) into per-type shards before release 1.0.0. giwt owns the sync/index tooling, so this is the prerequisite for loop-lore's `TASK-split-ticket-index-before-1-0-0` (git issue `f7e7988`).

This reverses the 2026-10-04 decision in `TASK-shard-tickets-index-or-stop-per-branch-index-commits` (461e906), which chose regen-only (direction 2) instead of sharding. The linked-worktree write deferral and post-merge reconciliation from that decision must remain intact.

Alternatives: keep the monolith and accept churn; or let each repo patch giwt locally — both rejected because they leave the writer outside the tool and break linked-worktree safety.

**Scope:**

- Auto-detect legacy single index.json vs sharded layout through a small manifest (layout version, shard list, counts/checksums); no extra flag at call sites.
- Shards are per ticket-type prefix, so branches touching different types write disjoint files and the single-file churn disappears.
- One reader/writer used by `giwt sync` (check and `--fix`), the `plan validate` tickets gate, `plan matrix`/`priority`/`code-map`/`links`, and finalize post-merge reconciliation.
- Migration from a tracked single index.json to shards: atomic, idempotent, and fail-closed on missing or corrupt shards (never degrade to an empty index).
- Linked-worktree guard from the 461e906 decision still applies: fix-mode writes are deferred to the target branch, not committed per branch.
- Legacy repos keep current behavior byte-for-byte.

**Acceptance Criteria:**

- [ ] Fixture with two or more type shards: `giwt sync` check and `--fix` read, reconcile, and write shards; `plan validate`, `plan matrix`, `plan priority`, and `plan links` green against them.
- [ ] Corrupt/missing shard and malformed manifest fail closed with path-specific errors; no silent empty index.
- [ ] Migration from single index.json to shards loses no entries, leaves no tracked monolith, and a rerun is a no-op.
- [ ] Regression test proves two branches touching different ticket types produce no index conflict.
- [ ] Linked-worktree test proves canonical shard writes are reported deferred and performed only by post-merge reconciliation.
- [ ] Implementation complete
- [ ] Tests passing
- [ ] Documentation updated

**Caveats:** TOCTOU: shard writes must be atomic across files. Security: manifest paths must stay inside the tickets dir. Authorization: n/a. Parallelism: branches touch disjoint shard paths by construction. Partial failure: all shards roll back together. Rollback: restore the single-file index from git. Observability: `sync` report names the active layout and shard count.

**Related:** loop-lore `TASK-split-ticket-index-before-1-0-0` (f7e7988), `TASK-shard-tickets-index-or-stop-per-branch-index-commits` (461e906).
