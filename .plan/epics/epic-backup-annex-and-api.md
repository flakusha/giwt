<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->

# EPIC: backup annex hardening and public API surface

**Status:** ✅ Done
**Priority:** high
**Effort:** Large
**Type:** epic
**Tags:** backup, annex, api
**Overview:** backup/annex dump correctness fixes + the programmatic API surface + an optional annex sync lane

## Overview

`giwt backup` is the zero-dependency insurance layer, but on git-annex repos
its trust is unfounded today: verify replays of annex mode-preserved trees
die in their own cleanup (EACCES) and leak scratch trees back into the dump
target, and a dump of a repo with dropped-but-present annexed files exits
green while archiving 0-byte symlinks. Alongside the two fixes, the
documented programmatic seam (src/index.ts) grows the backup/annex surface,
and an optional annex sync orchestration lane closes the gap between
`giwt backup` and `git annex sync --content`.

## Linked Tasks

- [x] BUG-backup-dump-verify-scratch-cleanup-eacces-and-leaked-trees.md — critical: mode-safe scratch cleanup + verify-scratch exclusion from dump traversal
- [x] BUG-dump-on-annex-repos-is-a-silent-partial-backup.md — high: annex-aware dump gate (loud advisory or refusal, never silent partial green)
- [x] FEAT-programmatic-api-surface-for-backup-and-annex-seams.md — medium: export dump/verify/orchestrate runners, ledger readers, annexCounts, classifier wrapper
- [x] FEAT-annex-sync-orchestration-lane-in-giwt-backup.md — low: `backup annex-sync` through the same authorization, outcome in `.backup.jsonl`

git issue: 091616f
