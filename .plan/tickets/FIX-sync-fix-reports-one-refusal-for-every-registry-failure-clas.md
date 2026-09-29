<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FIX: sync --fix reports one refusal for every registry failure class

**Status:** Done
**Priority:** Medium
**Effort:** Medium
**Tags:** sync, tickets

**Summary:**

`readGitIssues` folded every failure into one `available: false` → "git issue CLI unavailable" refusal: timeout, missing git, and a nonzero CLI exit (corrupt store) all printed the same words, so --fix blamed a missing tool for three different problems. (Timeout was split out in 22e79de; the remaining classes were still conflated.)

**Context:**

`GitIssueRead` carries `reason?: "timeout" | "missing" | "failed"` plus a bounded stderr-tail `detail`:

- timeout — unchanged ceiling message + remedy.
- missing — shell command-not-found (exit 127) or spawn ENOENT → "git executable not found" + install/PATH remedy.
- failed — nonzero exit → "git issue ls failed (exit N: stderr tail)" + manual-inspection remedy.

Scan header labels each class; `stderr` is now piped (was `2>/dev/null`) so the failed-class remedy can quote the store error without leaking it on success.

**Acceptance Criteria:**

- [x] Each failure class produces a distinct refusal line and remedy; sibling classes never bleed in (asserted `not.toContain`).
- [x] Plain non-repo dir reports the failed class with exit 128 detail.
- [x] Empty-PATH env reports the missing class.
- [x] Nonzero-exit shim reports the failed class with stderr tail.
- [x] `bun run check` green.

git issue: 704d7d5
