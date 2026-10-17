<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# FEAT: annex sync orchestration lane in giwt backup

**Status:** Not Started
**Priority:** low
**Effort:** Medium
**Epic:** epic-backup-annex-and-api
**Tags:** backup, annex, sync, orchestration
**Related:** FEAT-backup-orchestration-state-staleness-alerts-scheduling-off-s.md FEAT-programmatic-api-surface-for-backup-and-annex-seams.md FEAT-git-annex-passthrough-second-level-classifier-policy-for-des.md
**Caveats:** TOCTOU, security, authorization, parallelism, lock/unlock lifecycle, partial failure, rollback, stale state, data races, idempotency, observability

**Summary:**

`giwt backup` never drives `git annex sync` — today an agent must hand-run
it through the `giwt git` passthrough with a per-repo `[git] allow = ["annex
sync"]` entry, and nothing records whether content actually converged. A
backup taken before sync can silently miss content that existed only on
another replica, and the `.backup.jsonl` state ledger has no sync kind to
alert on staleness.

**Scope:**

Design-first ticket — settle the shape in this ticket's Context before any
implementation:

- A narrow `giwt backup annex-sync` (or a `sync` step in the orchestration
  lane) that runs `git annex sync --content` through the SAME authorization
  as the `giwt git` passthrough (two-token `[git] allow` entries, no
  bypass, refusals name the policy source).
- The outcome lands in `.backup.jsonl` (the state ledger from
  FEAT-backup-orchestration-…) as a `sync`-kind event so staleness/alerting
  sees annex convergence, not just dump/verify/copy freshness.
- Refuses when numcopies is unverifiable (annex unavailable, repo not an
  annex repo, or `annex status`-class RO probe fails) — never a green sync
  without content-assurance evidence.
- Interaction with the dump lane (sync-before-dump ordering), concurrent
  agent syncs (annex locks), and the advisory gate from
  BUG-dump-on-annex-repos-is-a-silent-partial-backup.

**Context:**

Constraints: authorization must reuse the existing two-token policy rows —
a dedicated `[backup] annex_sync = true` bypass would fork the security
model the passthrough already owns; the ledger event must be append-only
and fsync'd like the other `.backup.jsonl` kinds. Design judgment open:
subcommand vs orchestration step (subcommand is composable from scripts and
cron; a step in the dump lane gets sync-before-dump ordering for free but
blurs dump latency), and what numcopies evidence suffices (`annex count`
per key vs a bounded whereis sample) — record the decision before
implementation.

**Acceptance Criteria:**

- [ ] the lane shape (subcommand vs orchestration step), authorization path, ledger event shape, and refusal semantics are decided and recorded in Context
- [ ] the annex sync runs through the same classification as `giwt git` — no direct spawn bypass; unauthorized repos refuse with the policy-source reason
- [ ] sync outcome (success/failure, remote deltas if available) is recorded in `.backup.jsonl` and visible via the status runner
- [ ] numcopies-unverifiable repos refuse with a clear message instead of a green exit
- [ ] USAGE table (src/cli-usage.ts) and registry entry updated for the new surface; `bun run check` green
- [ ] default-deny verified by test: a repo with NO `[git] allow` entry refuses `backup annex-sync` with a policy-source-named reason, and the refusal is produced server-side by the classifier (classifyGitInvocation/classifyAnnex), not by a caller-side convenience check
- [ ] the authorization is per-resource (per-repo giwt.toml): an allow entry in ~/.config/giwt/config.toml or env alone must NOT authorize the sync — the repo's own resolved config decides; test covers both layers

git issue: de8d81b
