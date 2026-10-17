<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# FEAT: annex sync orchestration lane in giwt backup

**Status:** Done (dump-lane session, 2026-10-17: `giwt backup annex-sync` landed in src/backup/annex-sync.ts + gate in src/commands/backup-gates.ts + dispatch in src/commands/backup.ts; repo-only policy resolution via `loadSettings({ skipGlobal: true })` (src/utils/settings.ts); classifier-authored refusals verified end-to-end under /tmp/giwt — denied repo exits 1 with the classifyAnnex policy-source reason, allowed repo syncs and the `sync (local)` row appears in `backup status`)
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

**Design decisions (recorded before implementation, 2026-10-17):**

- SHAPE — SUBCOMMAND `giwt backup annex-sync`, not a dump-lane step.
  Justification: cron/scripts compose it explicitly (`backup annex-sync
  && backup dump && backup verify`), dump latency and the transactional
  dump contract stay untouched, and a step inside dumpLocked would couple
  annex convergence to every dump (including annex-less repos) and blur
  the failure domain. Sync-before-dump ordering is documented as operator
  guidance in the HELP text and USAGE table; the dump lane is NOT
  hard-wired to sync first (no annex spawn, no latency, no new failure
  mode inside the .snar transaction).
- AUTHORIZATION — `classifyGit({ args: ["annex", "sync"], lists })` (the
  classifyGitInvocation → classifyAnnex path, identical tables) with the
  REPO'S OWN lists: `loadSettings(repoRoot, { skipGlobal: true })` — the
  global config layer is structurally skipped, so a [git] allow in
  ~/.config/giwt/config.toml or any env-resolved layer can never
  authorize. No dedicated [backup] annex_sync bypass; no raw spawn:
  every `git -C … annex …` invocation in the lane sits behind the
  classifier verdict, and the refusal text IS the classifier's reason
  (policy source named).
- LEDGER EVENT — `kind: "sync"`, `remote: ""` (offsite transfers already
  use kind "sync" with the remote name, so both converge views coexist
  under the same kind), `path` = repo root, `ok`, `note` (convergence
  summary incl. a `copy N/M` delta when annex prints one). Append-only and
  fsync'd via the shared `appendState`; REFUSALS also append an ok:false
  event so staleness/alerting sees attempted-but-blocked syncs.
  Visible via `backup status` as `sync (local): <ts>`.
- NUMCOPIES EVIDENCE — a single read-only `git annex whereis` probe
  (the same RO probe seam as the dump advisory gate) must exit 0 before
  the sync runs; annex unavailable / not an annex repo / probe failure
  → refusal with the probe's stderr. Chosen over per-key `annex count`:
  one bounded RO spawn, no per-key fan-out, and whereis failing is
  precisely the 'cannot verify availability' signal the invariant needs.
- CONCURRENT SYNCS — annex's own repo locks serialize agents; this lane
  spawns plain `git annex sync --content` and reports annex's exit, it
  adds no lock of its own. The dump advisory gate stays untouched (it
  reports worktree availability; this lane is the remediation path it
  names).

**Acceptance Criteria:**

- [x] the lane shape (subcommand vs orchestration step), authorization path, ledger event shape, and refusal semantics are decided and recorded in Context
- [x] the annex sync runs through the same classification as `giwt git` — no direct spawn bypass; unauthorized repos refuse with the policy-source reason
- [x] sync outcome (success/failure, remote deltas if available) is recorded in `.backup.jsonl` and visible via the status runner
- [x] numcopies-unverifiable repos refuse with a clear message instead of a green exit
- [x] USAGE table (src/cli-usage.ts) and registry entry updated for the new surface; `bun run check` green
- [x] default-deny verified by test: a repo with NO `[git] allow` entry refuses `backup annex-sync` with a policy-source-named reason, and the refusal is produced server-side by the classifier (classifyGitInvocation/classifyAnnex), not by a caller-side convenience check
- [x] the authorization is per-resource (per-repo giwt.toml): an allow entry in ~/.config/giwt/config.toml or env alone must NOT authorize the sync — the repo's own resolved config decides; test covers both layers

git issue: de8d81b
