<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# FEAT: programmatic API surface for backup and annex seams

**Status:** Not Started
**Priority:** medium
**Effort:** Medium
**Epic:** epic-backup-annex-and-api
**Tags:** api, backup, annex, exports
**Related:** FEAT-annex-sync-orchestration-lane-in-giwt-backup.md FEAT-git-annex-passthrough-second-level-classifier-policy-for-des.md FEAT-backup-orchestration-state-staleness-alerts-scheduling-off-s.md
**Caveats:** TOCTOU, security, authorization, parallelism, lock/unlock lifecycle, partial failure, rollback, stale state, data races, idempotency, observability

**Summary:**

`src/index.ts` — the sole `exports["."]` path in package.json, whose
re-exports are a compatibility promise (AGENTS.md: "Public exports: add to
src/index.ts deliberately") — exports ZERO backup/annex symbols today. Every
backup family module (src/backup/: dump lane, verdict/verify, state ledger,
schedule, remote, annex-status, orchestrate) and the git-invocation policy
classifier are reachable only by deep-importing file paths, so external
consumers (and selftest-style harnesses) either replicate internals or
deep-import unstable paths.

A second sharp edge: `classifyGitInvocation` (src/git/policy.ts:142) is
positional — `(args, lists?, options?)` — so a plain-JS consumer following
the now-standard options-object convention and calling
`classifyGitInvocation({ args })` silently misbinds (the object lands in
`args`, per-call `pathExists` never arrives). The repo's own 3+-param rule
mandates a first-class options-object form for new seams.

**Scope:**

Export the documented seam from src/index.ts — re-exports plus one small
wrapper, no behavior changes to existing modules:

- Dump/verify runners: the dump lane entry (plan/tarball/dump transactional
  runner), `verifyRoot` verdict replay, and the orchestrate runners for
  status/schedule/remote (src/backup/orchestrate.ts).
- State-ledger readers: the `.backup.jsonl` append-only ledger read/verdict
  API from src/backup/state.ts (readers + staleness verdict types; the
  writer stays internal to the runners).
- `annexCounts` + `AnnexCounts` (src/backup/annex-status.ts:11,32).
- A typed options-object wrapper around `classifyGitInvocation` (e.g.
  `classifyGit({ args, lists?, options? })` returning the `GitVerdict`),
  implemented per the options-object convention; the positional form stays
  as the internal primitive.

Types travel with the symbols (`TarPlan`, `TargetVerdict`, `GitVerdict`,
`AnnexCounts`, ledger event/verdict types). knip stays green: package.json
`exports["."]` is a knip entry, so new index re-exports are not flagged.

**Context:**

Constraints: src/index.ts is a compatibility promise — add symbols only,
never rename or drop existing ones; the wrapper must live beside the
positional primitive (src/git/policy.ts) so the classification tables stay
single-sourced. Alternatives considered: converting `classifyGitInvocation`
itself to an options object (breaks every in-repo callsite for no behavioral
gain — the repo grandfathered positional seams) vs a `giwt/annex`
subpath export (new package.json surface for no current consumer need —
keep everything on the single `.` path).

**Acceptance Criteria:**

- [ ] `import { … } from "giwt"` resolves the dump/verify/orchestrate runners, ledger readers, `annexCounts`, and the classifier wrapper (types included) — covered by a compile-time/tsc-checked test
- [ ] the options-object wrapper returns verdicts identical to the positional `classifyGitInvocation` for the same inputs (unit test incl. a custom `pathExists`)
- [ ] no behavior change in any existing module (re-exports + wrapper only); positional `classifyGitInvocation` untouched
- [ ] knip/deadcode and `bun run check` stay green

git issue: 2ad50d6
