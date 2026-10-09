<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# BUG: ticket create and sync --fix --import emit lint-defective/duplicated ticket markdown

**Status:** Done
**Priority:** medium
**Effort:** Medium
**Tags:** tickets, generator

**Summary:**

Two giwt ticket-generator paths emit defective output.

1. `giwt sync --fix --import` rewrites ticket `.md` files with markdownlint defects: MD031 (fenced block not blank-separated), MD032 (list not blank-separated), MD033 (bare angle-bracket token parsed as HTML), MD040 (fence without a language tag), MD012 (double trailing blank). Evidence: run `20261009T031451-1236009-sync` (2026-10-09 03:14:51-03:14:52 UTC) regenerated `BUG-remove-path-auto-detection-matches-main-worktree-registratio.md` and `BUG-exec-identity-patterns-author-equals-form-only-misses-space-.md` - their mtimes `1791515692037` / `1791515692054` ms fall inside that run window - and `markdownlint` then reported 6 and 4 defects. Plain `giwt sync --fix` never regenerates ticket `.md` bodies (runs `20261009T031433-1235372-sync`, close-flow syncs 03:30:01 / 03:31:36 UTC, and run `20261009T034212-1618161-sync`, which left this very file byte-identical while reporting `Missing hashes: 800aa4e` advisory-only); lint stays green across those, so the `--import` pass is the only body writer.

2. `giwt ticket <TYPE>` create runs exit 1 yet still write the file, and a repeat create for an existing ticket neither replaces nor refuses. Evidence: runs `20261009T030013-862472-ticket` and `20261009T030049-863262-ticket` - both recorded `exitCode: 1` after `BUG-remove-path-auto-detection-matches-main-worktree-registratio.md` had been written (first run) / found (second run). The repeat run only warns `ticket file already exists` and does not refuse: create.ts proceeds to the `git issue create` step for the same extid. The run records capture no output (`said: null`), so the nonzero exit ships without any diagnostic.

3. The `body` argument is embedded verbatim with no validation: a body that is itself a complete ticket document (its own SPDX header, `# BUG:` title, `Status:` block - exactly what both runs above passed) lands under the template header, yielding one `.md` with two nested ticket documents. That duplication shipped in `BUG-remove-path-auto-detection-matches-main-worktree-registratio.md` and had to be repaired by hand before commit.

**Context:**

`markdownlint` is part of the repo gate (`bun run check` runs `lint:md`), so generator output that fails it cannot pass pre-commit without manual repair. Expected: `sync --fix --import` output passes `markdownlint` unchanged; a successful `ticket create` exits 0; a duplicate create refuses nonzero with a clear message (or replaces idempotently); a body containing a nested ticket document is rejected or flattened. Filing this very ticket via `giwt ticket BUG` exited 0 (run `20261009T033919-1588644-ticket`, issue `800aa4e`), so the nonzero exit does not reproduce on every run.

**Acceptance Criteria:**

- [ ] Implementation complete
- [ ] Tests passing
- [ ] Documentation updated
