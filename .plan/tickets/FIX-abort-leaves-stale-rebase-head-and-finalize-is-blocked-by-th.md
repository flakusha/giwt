<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FIX: abort leaves stale REBASE_HEAD and finalize is blocked by the orphan marker

**Status:** Done
**Priority:** high
**Effort:** Small

**Summary:**

Symptom: giwt abort reports success but does not remove an orphan REBASE_HEAD marker; finalize then keeps failing on it until the marker is deleted by hand.

**Context:**

Evidence (2026-09-18, minimax session 2026-09-18T01-15-39, giwt repo):

- 01:31:07 finalize #1 fails: "error: dev checkout ..." — stale rebase state.
- 01:31:37 abort --dry-run plans the recovery; 01:31:44 abort runs and prints "Found REBASE_HEAD — aborting", claims success.
- 01:31:54 finalize #2 fails on the same marker; agent verifies REBASE_HEAD still exists while rebase-merge/rebase-apply dirs do not (git itself considers the rebase concluded).
- 01:32:08 agent works around with `rm .git/REBASE_HEAD`; finalize then proceeds.
- abort.ts detects MERGE_HEAD/REBASE_HEAD/CHERRY_PICK_HEAD (DEV_IN_PROGRESS_HEADS) but the marker-only cleanup path is incomplete, and finalize gates on the bare marker file.

Acceptance:

- abort removes orphan *_HEAD marker files when the corresponding rebase/merge dirs are absent (git semantics for a concluded operation).
- finalize ignores orphan markers without dirs (or reports them as non-blocking with a remedy).
- Regression test: create marker without dirs in a scratch repo; abort clears it; finalize no longer fails on it.

**Acceptance Criteria:**

- [ ] Implementation complete
- [ ] Tests passing
- [ ] Documentation updated
