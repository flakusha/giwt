<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FEAT: rebase --skip decisions are not recorded, so dropped work is unrecoverable

**Status:** Done
**Priority:** medium
**Effort:** Medium
**Tags:** rebase

**Summary:**

A `--skip` during a rebase silently deletes a commit. Nothing in the repo records what was skipped, why, or what it would have applied. If the skip was wrong, there is no trail — the commit is gone from the replayed history and the only recovery is a reflog dive.

On the loop-lore rebase, 199 of 221 todo entries were skipped (133 duplicates, 66 empty). The inventory was reconstructed by hand into a scratch file, outside version control, and it was the only record that the skips were correct. A reviewer asking "what did we drop and why" had nothing to read.

What is needed:

- every skip appends a record: sha, patch-id when available, subject, the detected reason, and the ref it would have applied
- the record is durable and reviewable — written under the repo runlog or plan directory, not scratch
- a command to read it back, and ideally to diff the ledger against the pre-rebase ref so a dropped-but-real commit is detectable after the fact
- the ledger should be the input to a final audit, not just a log

Scope note: this does not need to block the audit detectors. It can land first and independently, because a ledger that records skips is useful even before anything automates the classification — the reason can be a free-text note supplied by the operator.

Suggested surface: `giwt rebase --skip-note "..."`, plus `giwt runs`-style readback. Reuse the existing run-record and ledger plumbing rather than introducing a new store.

Acceptance:

- a skip with a reason writes a durable record containing sha, subject, reason, and the pre-rebase ref
- the record survives `giwt clean` and scratch pruning
- readback lists skipped commits in replay order
- a comparison mode flags any skipped commit whose patch-id does NOT appear in the pre-rebase ref, i.e. drops that were not actually duplicates

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated
**Resolved:** 2026-10-08T03:48:39.052Z Landed via feat-history-audit: giwt history skips readback + giwt rebase --skip-note with durable skips.jsonl ledger.
