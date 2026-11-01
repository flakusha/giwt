<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# FEAT: git-annex passthrough second-level classifier policy for destructive annex ops

**Status:** Done

Resolution detail: implemented by agent session 2026-10-17 (FEAT-git-annex-passthrough-second-level-classifier-policy-for-des): two-token annex policy in src/git/policy-annex.ts + policy-tables.ts, annex `-c`/`${` refusals, warn-once destructive-allow in src/commands/git.ts; classify matrix in src/git/policy.test.ts.
**Priority:** medium
**Effort:** Medium
**Tags:** annex, git-passthrough, policy
**Caveats:** TOCTOU, security, authorization, parallelism, lock/unlock lifecycle, partial failure, rollback, stale state, data races, idempotency, observability

**Related:** FEAT-backup-command-family-l0-dump-engine-tar-zst-listed-incremen.md FEAT-backup-orchestration-state-staleness-alerts-scheduling-off-s.md
**Summary:**

## Summary

Problem: `giwt git` classifier (src/git/policy.ts, policy-tables.ts) is err-closed on first subcommand tokens; `annex` is therefore unusable through the passthrough, and destructive annex operations (`dropunused --force`, `forget --drop-dead`, `drop --key`) need explicit governance before git-annex becomes the L1 backup layer.

Scope:

- Second-level policy tokens: `[git] safe/allow/deny` entries may carry two tokens (`"annex status"`, `"annex dropunused"`); precedence unchanged (deny wins over allow wins over safe).
- Default tables: RO-safe = status, whereis, find, log, info, version, describe; RW-allow (must be enabled per-repo) = init, add, sync, copy, get, move, initremote, enableremote, mirror, export, import; DENY by default = drop, dropunused, dropkey, forget, dead, untrust, semitrust, unannex, uninit.
- `annex.*` config mutations refused like `-c` today (`annex.mincopies`, `annex.autoexpireunused` edits ride the same denial path; allow via `[git] allow` explicitly).
- `${` macro-free: refuse arbitrary interpolation in annex args; PID macro only where whitelisted.
- Docs: giwt.toml sample appendix + why (a backup stack must never destroy the last known copy; numcopies remains the safety net).

## Possible Caveats and Issues to Avoid

- TOCTOU: policy file reload between classify and spawn — read once per run (classifier contract already snapshot-based).
- False sense of safety: allow-listing "annex drop" as safe in a repo config must warn loudly once (echo refusal reason + config source).
- Parallelism: annex sync has its own lockfile inside .git/annex — classifier stays stateless, no giwt-side lock (document).
- Rollback: none — denied means never executed; allow-listing destructive ops is an operator decision recorded in the repo's giwt.toml.

## Acceptance Criteria

- [ ] two-token policy matching in classifier + policy-tables (tested matrix)
- [ ] annex RO/RW/allowable/default-deny tables shipped with docs
- [ ] refusal reasons print policy source (default table vs repo giwt.toml)
- [ ] loop-lore/others can mount the L1 annex layer through policy config alone

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [ ] Implementation complete
- [ ] Tests passing
- [ ] Documentation updated
