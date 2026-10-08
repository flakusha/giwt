<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->

# FEAT: weave damage scan: duplicated and orphaned blocks are structurally silent

**Status:** Done
**Priority:** high
**Effort:** Medium
**Tags:** rebase, weave

**Summary:**

giwt owns the weave (`src/plan/reconcile-conflicts.ts`), so detecting the damage it produces is giwt responsibility, not the consuming repo responsibility. This is the most dangerous class of rebase outcome because it does not announce itself.

A resolved merge can leave a file that is syntactically valid, typechecks, lints, and passes every test — while having silently lost or duplicated real code. Confirmed three ways during the loop-lore rebase:

- `src/frontend/ui.ts`: a single callback parameter line was triplicated in place, and 17 further copies of the same line were appended at the end of the file. 21 occurrences of a signature that exists exactly once. A parse error surfaced it; nothing else would have.
- `src/chat/service/branches.ts`: an orphaned merge hint comment, plus the blank line it had absorbed, breaking a padding rule.
- `src/test-utils/isolate-only.ts`: an orphaned `const globals` binding with no referents.

The general shape is always the same: a merge resolution concatenates or repeats a region instead of choosing one side, and the result is still legal code.

Checks worth implementing, all cheap and none requiring an AST:

1. **Repeated line runs** — an identical non-trivial line appearing N times (N >= 2) in one file, where it is not a legitimate repeated construct. In the observed case: 21 occurrences of a single parameter line.
2. **Orphaned trailing block** — statements after the last top-level declaration, especially when they are not syntactically reachable from it.
3. **Orphaned comment markers** — resolution artifacts (`hint:`, conflict-note text, branch names) left inline.
4. **Brace balance** — an anomaly relative to the pre-merge version of the file.

Note the deliberate limit: check 1 must not fire on legitimately repetitive code (generated files, table-driven blocks, import lists). Rank by signal rather than hard-failing, and always print the offending lines so a human can accept the finding in seconds.

Suggested surface: `giwt doctor` check, or a mode on the audit umbrella, so it can run post-rebase and post-finalize.

Acceptance:

- flags the ui.ts triple plus 17-copy orphan block as it stood
- flags the orphaned binding in isolate-only.ts
- does not fire on known-legitimate repetitive files in the consuming repo
- every finding prints file, line range, and the repeated content

**Context:**

(fill in before starting: why this change, constraints, alternatives considered.)

**Acceptance Criteria:**

- [x] Implementation complete
- [x] Tests passing
- [x] Documentation updated
**Resolved:** 2026-10-08T08:48:04.161Z Merged feat/audit-detectors (83bb11d) + wiring (2c8d0a0). Standalone gate: giwt history weave file... [--baseline ref-or-file]
