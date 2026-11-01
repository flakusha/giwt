<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# FEAT: backup command family L0 dump engine tar-zst listed-incremental sha256 verify GFS rotation

**Status:** Done

Resolution detail: L0 dump engine landed on master (commit feat(backup)); verify/rotation/lock/quiesce + tests in src/backup/, orchestration ticket remains open.
**Priority:** high
**Effort:** Large
**Tags:** backup, dump, tar
**Caveats:** TOCTOU, security, authorization, parallelism, lock/unlock lifecycle, partial failure, rollback, stale state, data races, idempotency, observability

**Related:** FEAT-git-annex-passthrough-second-level-classifier-policy-for-des.md FEAT-backup-orchestration-state-staleness-alerts-scheduling-off-s.md
**Summary:**

## Summary

Problem: giwt has no backup lane; researched in loop-lore scratchpad (.tmp/investigations/open-items-alignment.md, processing .tmp/open-items/DistributedSync.md) — L0 "plain archive dumps" is the zero-dependency insurance layer (restore needs nothing but tar+zstd).

Scope: `giwt backup dump [targets...]` — tar.zst archives with GNU `--listed-incremental` (.snar chain: weekly full + daily incremental), `-T0` multithreaded compression, sha256 sidecar per archive, `zstd -t` integrity verify, GFS/keep-N rotation (configurable keep counts, default 7 dailies / 4 weeklies / 12 monthlies), off-site targets dir. `giwt backup verify` replays the youngest full+increment chain into a temp dir and asserts table/manifest presence. Transactional runner reuses finalize family DNA: lock (full-jitter retry), atomic temp+rename archive writes, SIGINT/TERM handler with staging cleanup, recoverable via a `--dry-run` preview. Quiesce rule: never tar a live sqlite — snapshot sources via `sqlite3 .backup` (or an upstream checkpointed export, e.g. loop-lore's backup export contract, loop-lore task `TASK-loop-lore-backup-export-contract-snapshot-producer-assets-manifest`) into staging first; record failed-to-quiesce DBs as warnings, never silently include torn snapshots.

First consumer: loop-lore's export contract publishes checkpointed snapshot + assets manifest; the verify side consumes external archives with row-count assertions (loop-lore task `TASK-restore-acceptance-external-archives-row-count-table-presence`).

## Possible Caveats and Issues to Avoid

- TOCTOU: source tree mutates during a long tar run — use snapshot source for DBs, accept file-tree race for text (document), re-verify checksums post-write.
- Security: archives may carry plaintext PII — per-target encryption hook (age/gpg) opt-in; never auto-upload unencrypted to remote tier.
- - Authorization: giwt backup writes only inside its configured root; refuse writes into PATH sources owned by root unless explicitly allowed.
- Partial failure: temp file + rename per archive; partial chain leaves .snar untouched; rotate runs only after successful verify.
- OS support: GNU tar + zstd on Linux/macOS; windows via WSL (document, don't emulate).
- Idempotency: re-running dump within the same day appends a timestamp suffix, never overwrites the previous archive it didn't build.

## Acceptance Criteria

- [ ] dump with .snar incremental chain + sha256 + zstd -t verification
- [ ] GFS/keep-N rotation config + verified rotation following successful verify
- [ ] transactional: lock, temp+rename, signal-safe rollback, --dry-run
- [ ] sqlite quiesce path + warning on unquiesceable sources
- [ ] bun run check green; unit tests for chain/rotate/verify + a real tar fixture

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [ ] Implementation complete
- [ ] Tests passing
- [ ] Documentation updated
