<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# BUG: backup dump verify: scratch cleanup EACCES and leaked trees

**Status:** Not Started
**Priority:** critical
**Effort:** Medium
**Epic:** epic-backup-annex-and-api
**Tags:** backup, annex, verify, filesystem
**Related:** BUG-dump-on-annex-repos-is-a-silent-partial-backup.md
**Caveats:** TOCTOU, security, authorization, parallelism, lock/unlock lifecycle, partial failure, rollback, stale state, data races, idempotency, observability

**Summary:**

`giwt backup dump` on a repo containing git-annex content exits FAIL after
the archive is already written. The verify replay extracts the annex tree
with tar-preserved modes (directories 0555, files 0444 — annex drops write
bits on content it manages), and the cleanup `rm` in `verifyTarget` then
throws EACCES: the scratch dir is created at src/backup/verify.ts:100
(`mkdtempSync(join(scratchRoot, "giwt-backup-verify-"))`) and removed in the
`finally` at src/backup/verify.ts:104 (`rmSync(tmp, { recursive: true,
force: true })`) — `force` does not grant write permission, so unwritable
dirs are unremovable.

Two compounding failures:

1. The run FAILs even though the archive itself is complete and its chain
   replay evidence was already collected — the verdict is polluted by
   cleanup, not by verify evidence.
2. Failed runs LEAK stale `giwt-backup-verify-*` trees under the scratch
   root (`config.settings.scratch.root`, default `.tmp` — wired at
   src/commands/backup.ts:44), inside the repo tree. The next dump
   re-archives the leaked scratch: observed archive member
   `repo/.tmp/giwt-backup-verify-Pbrhtu/…`. The same scratch root feeds the
   standalone `giwt backup verify` lane (src/commands/backup.ts:140).

Repro: in a git-annex repo, `git annex get` one file, then `bun run giwt --
backup dump` — dump FAILs with EACCES from verify cleanup and leaves the
scratch tree behind.

**Context:**

Constraints: the cleanup must stay inside the scratch tree giwt created
(chmod -R on anything else is off-limits); the dump-traversal exclusion must
be pattern-based (`.tmp/giwt-backup-verify-*` under any target), not a
one-time sweep, because a concurrent verify lane may legitimately hold a
live scratch tree while a dump runs. Alternatives considered: running verify
scratch outside the repo (breaks same-filesystem atomicity assumptions and
the configured scratch-root contract), or `rm -rf` with elevated perms
(unacceptable).

**Scope:**

- Mode-safe cleanup in `verifyTarget` (src/backup/verify.ts:100-105): make
  the tree user-writable before removal (e.g. `chmod -R u+w` on the scratch
  dir, or equivalent) so tar-preserved 0555/0444 modes never block `rm` —
  cleanup failure must never fail a run whose verify evidence is complete.
- Exclude the verify-scratch pattern from dump traversal so a leaked (or
  concurrently-live) `giwt-backup-verify-*` tree is never archived: extend
  the tar plan's exclude list in `buildTarPlan` (src/backup/tarball.ts:50-65)
  with the `giwt-backup-verify-*` pattern (path-anchored like the existing
  recursion-guard excludes).
- Cover both the dump-embedded verify and the standalone `giwt backup
  verify` lane — they share `verifyRoot`/`verifyTarget`.

**Acceptance Criteria:**

- [ ] dump on an annex-content repo (one annexed file `annex get`-ed) exits 0 with mode-safe cleanup — no EACCES from verify scratch removal
- [ ] no `giwt-backup-verify-*` dirs remain under the scratch root after success AND after an injected verify failure
- [ ] a dump target covering the scratch root never archives `giwt-backup-verify-*` members (assert via `tar --list` on a fixture)
- [ ] standalone `giwt backup verify` gets the same mode-safe cleanup
- [ ] regression test with a mode-preserved fixture (dir 0555, file 0444) extracted into a scratch dir, asserting removal succeeds
- [ ] `bun run check` green

git issue: cd119e1
